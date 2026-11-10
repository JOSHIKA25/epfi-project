"""Evaluate a calibrated anomaly alarm followed by XGBoost fault diagnosis.

Whole simulation runs are kept separate: normal-only runs fit/calibrate the
detector, labeled training runs fit/validate the classifier, and supplied test
runs are used once for final evaluation. The classifier is trained on the
25-sample telemetry window ending at the detector's first relevant alarm.

Run with: python -m crew_service.alarm_time_pipeline_experiment
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import joblib
from pathlib import Path
from typing import Any, Iterator

import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from sklearn.metrics import accuracy_score, f1_score, precision_recall_fscore_support
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.utils.class_weight import compute_sample_weight
from sklearn.decomposition import PCA
from sklearn.neural_network import MLPRegressor

from .run_repeated_calibration_experiment import (
    _wilson,
    calibrated_threshold,
    grouped_folds,
)
from .run_level_calibration_experiment import critical_run_score
from .train_autoencoder import (
    DEFAULT_DATASET, FEATURE_COLUMNS, FEATURE_COLUMNS_52, PROJECT_ROOT,
    split_run_ids, sha256_file,
)


META = ("faultNumber", "simulationRun", "sample")
ONSET_SAMPLE = 161
WINDOW_SIZE = 25
METHOD = "autoencoder"
OUTPUT_ROOT = PROJECT_ROOT / "outputs"


def _iter_runs(
    path: Path, feature_columns: tuple[str, ...], chunk_size: int = 100_000,
) -> Iterator[tuple[int, int, np.ndarray, np.ndarray]]:
    """Yield complete, ordered runs from a CSV without loading the full file."""
    if not path.is_file():
        raise FileNotFoundError(path)
    usecols = [*META, *feature_columns]
    current_key: tuple[int, int] | None = None
    current_samples: list[np.ndarray] = []
    current_values: list[np.ndarray] = []
    completed: set[tuple[int, int]] = set()

    def finish(key: tuple[int, int], sample_parts: list[np.ndarray], value_parts: list[np.ndarray]):
        samples = np.concatenate(sample_parts).astype(np.int64, copy=False)
        values = np.concatenate(value_parts).astype(np.float64, copy=False)
        if len(samples) == 0 or not np.isfinite(values).all():
            raise ValueError(f"Empty or invalid run {key} in {path.name}")
        order = np.argsort(samples)
        samples, values = samples[order], values[order]
        if len(samples) > 1 and not np.all(np.diff(samples) == 1):
            raise ValueError(f"Non-contiguous samples in run {key} of {path.name}")
        return key[0], key[1], samples, values

    for chunk in pd.read_csv(path, usecols=usecols, chunksize=chunk_size, low_memory=False):
        if chunk.empty or chunk[usecols].isna().any().any():
            raise ValueError(f"Missing required values in {path.name}")
        for key_raw, group in chunk.groupby(["faultNumber", "simulationRun"], sort=False):
            key = (int(key_raw[0]), int(key_raw[1]))
            samples = group["sample"].to_numpy(dtype=np.int64)
            values = group.loc[:, feature_columns].to_numpy(dtype=np.float64)
            if not np.isfinite(values).all():
                raise ValueError(f"Non-finite telemetry in run {key} of {path.name}")
            if current_key is None:
                current_key = key
            if key != current_key:
                if key in completed:
                    raise ValueError(f"Run rows are not contiguous in {path.name}: {key}")
                yield finish(current_key, current_samples, current_values)
                completed.add(current_key)
                current_key = key
                current_samples, current_values = [], []
            current_samples.append(samples)
            current_values.append(values)
    if current_key is not None:
        yield finish(current_key, current_samples, current_values)


def fit_detector(train_values: np.ndarray, seed: int) -> tuple[StandardScaler, PCA, StandardScaler, MLPRegressor]:
    pca_scaler = StandardScaler().fit(train_values)
    pca = PCA(n_components=0.95, svd_solver="full").fit(pca_scaler.transform(train_values))
    ae_scaler = StandardScaler().fit(train_values)
    scaled = ae_scaler.transform(train_values)
    ae = MLPRegressor(
        hidden_layer_sizes=(32, 12, 32), activation="relu", solver="adam", alpha=1e-4,
        batch_size=1024, learning_rate_init=1e-3, max_iter=100, tol=1e-4,
        n_iter_no_change=10, random_state=seed, verbose=False,
    ).fit(scaled, scaled)
    return pca_scaler, pca, ae_scaler, ae


def score_detector(values: np.ndarray, detector: tuple[StandardScaler, PCA, StandardScaler, MLPRegressor]) -> dict[str, np.ndarray]:
    pca_scaler, pca, ae_scaler, ae = detector
    pca_scaled = pca_scaler.transform(values)
    projected = pca.transform(pca_scaled)
    t2 = np.sum(np.square(projected) / pca.explained_variance_[None, :], axis=1)
    residual = pca_scaled - pca.inverse_transform(projected)
    spe = np.sum(np.square(residual), axis=1)
    ae_scaled = ae_scaler.transform(values)
    reconstructed = ae.predict(ae_scaled)
    ae_error = np.sum(np.square(ae_scaled - reconstructed), axis=1)
    return {"t2": t2, "spe": spe, "ae": ae_error}


def persistent_alarm(scores: np.ndarray, threshold: float, persistence: int) -> np.ndarray:
    alarms = np.zeros(len(scores), dtype=bool)
    streak = 0
    for index, score in enumerate(scores):
        streak = streak + 1 if score > threshold else 0
        alarms[index] = streak >= persistence
    return alarms


def _window_features(window: np.ndarray) -> np.ndarray:
    """Last, mean, standard deviation, and slope for every selected channel."""
    if window.shape[0] != WINDOW_SIZE:
        raise ValueError(f"Expected a {WINDOW_SIZE}-sample telemetry window.")
    time = np.arange(WINDOW_SIZE, dtype=np.float64)
    centered_time = time - time.mean()
    slope = centered_time @ window.astype(np.float64) / (centered_time @ centered_time)
    return np.concatenate((window[-1], window.mean(axis=0), window.std(axis=0), slope)).astype(np.float32)


def _event(
    values: np.ndarray, samples: np.ndarray, alarms: np.ndarray, fault_id: int,
    feature_columns: tuple[str, ...], diagnosis_delay: int = 0,
    respect_benchmark_onset: bool = True,
) -> dict[str, Any] | None:
    eligible = alarms if fault_id == 0 or not respect_benchmark_onset else alarms & (samples >= ONSET_SAMPLE)
    positions = np.flatnonzero(eligible)
    if len(positions) == 0:
        return None
    alarm_position = int(positions[0])
    end = alarm_position + diagnosis_delay
    delay_fallback = end >= len(samples)
    if end >= len(samples):
        end = len(samples) - 1
    if end + 1 < WINDOW_SIZE:
        return {"alarmSample": int(samples[alarm_position]), "diagnosisSample": int(samples[end]),
                "features": None, "windowAvailable": False, "delayFallback": delay_fallback}
    window = values[end - WINDOW_SIZE + 1 : end + 1]
    return {
        "alarmSample": int(samples[alarm_position]),
        "diagnosisSample": int(samples[end]),
        "features": _window_features(window),
        "windowAvailable": True,
        "delayFallback": delay_fallback,
    }


def collect_events(
    paths: list[Path], detector: tuple[StandardScaler, PCA, StandardScaler, MLPRegressor],
    limits: dict[str, float], multiplier: float, persistence: int, *, keep_rows: bool,
    feature_columns: tuple[str, ...],
    allowed_keys: set[tuple[int, int]] | None = None,
    diagnosis_delay: int = 0,
    respect_benchmark_onset: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    events: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    threshold = limits["ae"] * multiplier
    for path in paths:
        print(f"Scoring run alarms in {path.name} ...", flush=True)
        for fault_id, run_id, samples, values in _iter_runs(path, feature_columns):
            if allowed_keys is not None and (fault_id, run_id) not in allowed_keys:
                continue
            scores = score_detector(values, detector)["ae"]
            alarm_mask = persistent_alarm(scores, threshold, persistence)
            event = _event(values, samples, alarm_mask, fault_id, feature_columns,
                           diagnosis_delay, respect_benchmark_onset)
            detected = event is not None and (fault_id == 0 or event["alarmSample"] >= ONSET_SAMPLE)
            prediction_row: dict[str, Any] = {
                "faultId": fault_id, "simulationRun": run_id, "isNormal": fault_id == 0,
                "firstAlarmSample": event["alarmSample"] if detected else None,
                "firstPersistentAlarmSample": event["alarmSample"] if event else None,
                "alarmBeforeBenchmarkOnset": bool(event and fault_id > 0 and event["alarmSample"] < ONSET_SAMPLE),
                "diagnosisSample": event.get("diagnosisSample") if detected else None,
                "diagnosisDelayFallback": bool(event and event.get("delayFallback")),
                "detectedAfterOnset": bool(detected and fault_id != 0),
                "falseAlarm": bool(detected and fault_id == 0),
                "windowAvailable": bool(event and event["windowAvailable"]),
                "predictedFaultId": None,
                "diagnosisConfidence": None,
            }
            if event is not None and event["windowAvailable"]:
                events.append({
                    "faultId": fault_id, "simulationRun": run_id,
                    "alarmSample": event["alarmSample"], "features": event["features"],
                })
            if keep_rows:
                rows.append(prediction_row)
    return events, rows


def _train_classifier(events: list[dict[str, Any]], seed: int) -> tuple[xgb.XGBClassifier, LabelEncoder, dict[str, Any]]:
    faulty = [event for event in events if event["faultId"] > 0]
    if len(faulty) < 40:
        raise ValueError(f"Too few fault runs reached an alarm for classifier fitting: {len(faulty)}")
    x = np.stack([event["features"] for event in faulty]).astype(np.float32)
    y = np.asarray([event["faultId"] for event in faulty], dtype=np.int32)
    keys = [(int(event["faultId"]), int(event["simulationRun"])) for event in faulty]
    validation = np.asarray([
        int.from_bytes(hashlib.sha256(f"{fault}:{run}".encode()).digest()[:8], "big") / 2**64 < 0.2
        for fault, run in keys
    ], dtype=bool)
    encoder = LabelEncoder().fit(y)
    y_encoded = encoder.transform(y)
    train_mask = ~validation
    if len(np.unique(y_encoded[train_mask])) < 2:
        raise ValueError("Classifier training split has fewer than two fault classes")
    model = xgb.XGBClassifier(
        objective="multi:softprob", num_class=len(encoder.classes_), n_estimators=180,
        max_depth=4, learning_rate=0.06, subsample=0.85, colsample_bytree=0.85,
        reg_lambda=1.0, tree_method="hist", eval_metric="mlogloss", random_state=seed,
        n_jobs=4,
    )
    model.fit(x[train_mask], y_encoded[train_mask],
              sample_weight=compute_sample_weight("balanced", y_encoded[train_mask]),
              eval_set=[(x[validation], y_encoded[validation])] if validation.any() else None,
              verbose=False)
    val_pred = model.predict(x[validation]) if validation.any() else np.array([], dtype=int)
    validation_metrics = {
        "runs": int(validation.sum()),
        "accuracy": float(accuracy_score(y_encoded[validation], val_pred)) if validation.any() else None,
        "macroF1": float(f1_score(y_encoded[validation], val_pred, average="macro", zero_division=0)) if validation.any() else None,
        "faultClassesInTraining": [int(value) for value in encoder.classes_],
        "faultClassesMissingFromAlarmedTrainingRuns": sorted(set(range(1, 21)) - set(int(value) for value in encoder.classes_)),
    }
    return model, encoder, validation_metrics


def evaluate(args: argparse.Namespace) -> dict[str, Any]:
    feature_columns = FEATURE_COLUMNS_52 if args.feature_set == "52" else FEATURE_COLUMNS
    output_dir = args.output_dir or OUTPUT_ROOT / f"alarm_time_pipeline_{args.feature_set}"
    normal_training = pd.read_csv(args.normal_training, usecols=["faultNumber", "simulationRun", *feature_columns], low_memory=False)
    if set(normal_training["faultNumber"].unique()) != {0}:
        raise ValueError("Normal training input must contain only faultNumber=0")
    faulty_training_meta = pd.read_csv(args.fault_training, usecols=["faultNumber", "simulationRun"], low_memory=False)
    if not (faulty_training_meta["faultNumber"] > 0).all():
        raise ValueError("Fault training input must contain only fault runs")
    fault_training_keys = set(
        (int(row.faultNumber), int(row.simulationRun))
        for row in faulty_training_meta.drop_duplicates().itertuples(index=False)
    )
    if args.internal_holdout:
        if args.folds != 1:
            raise ValueError("The internal run-level holdout uses exactly one evaluation fold.")
        normal_ids = normal_training["simulationRun"].astype(int).unique().tolist()
        _, _, normal_holdout_ids = split_run_ids(normal_ids, args.seed)
        fault_holdout_keys = {
            key for key in fault_training_keys
            if int.from_bytes(hashlib.sha256(f"{key[0]}:{key[1]}".encode()).digest()[:8], "big") / 2**64 < 0.2
        }
        if not fault_holdout_keys:
            raise ValueError("The internal fault holdout contains no runs.")
        normal_test_meta = pd.DataFrame({"faultNumber": [0] * len(normal_holdout_ids), "simulationRun": normal_holdout_ids})
        fault_test_meta = pd.DataFrame(sorted(fault_holdout_keys), columns=["faultNumber", "simulationRun"])
        test_meta = pd.concat([normal_test_meta, fault_test_meta], ignore_index=True)
        normal_test_path, fault_test_path = args.normal_training, args.fault_training
        assignments = {tuple(map(int, row)): 0 for row in test_meta.itertuples(index=False, name=None)}
    else:
        normal_test_meta = pd.read_csv(args.normal_testing, usecols=["faultNumber", "simulationRun"], low_memory=False)
        fault_test_meta = pd.read_csv(args.fault_testing, usecols=["faultNumber", "simulationRun"], low_memory=False)
        test_meta = pd.concat([normal_test_meta, fault_test_meta], ignore_index=True)
        assignments = grouped_folds(test_meta, args.folds, args.fold_seed)
        normal_test_path, fault_test_path = args.normal_testing, args.fault_testing
        fault_holdout_keys = set()
    test_keys = test_meta.drop_duplicates().itertuples(index=False, name=None)
    if len(assignments) != test_meta.drop_duplicates().shape[0]:
        raise AssertionError("Test run assignments are incomplete")

    fold_reports: list[dict[str, Any]] = []
    all_rows: list[dict[str, Any]] = []
    selected_demo: dict[str, Any] | None = None
    for fold in range(args.folds):
        seed = args.seed + fold
        train_ids, calibration_ids, _ = split_run_ids(
            normal_training["simulationRun"].astype(int).unique().tolist(), seed
        )
        train_values = normal_training.loc[normal_training["simulationRun"].isin(train_ids), feature_columns].to_numpy(dtype=np.float64)
        calibration_frame = normal_training.loc[normal_training["simulationRun"].isin(calibration_ids)]
        calibration_values = calibration_frame.loc[:, feature_columns].to_numpy(dtype=np.float64)
        detector = fit_detector(train_values, seed)
        cal_scores = score_detector(calibration_values, detector)
        limits = {"t2": float(np.quantile(cal_scores["t2"], args.row_quantile, method="higher")),
                  "spe": float(np.quantile(cal_scores["spe"], args.row_quantile, method="higher")),
                  "ae": float(np.quantile(cal_scores["ae"], args.row_quantile, method="higher"))}

        # Obtain the AE run threshold from normal calibration runs only.
        run_critical: list[float] = []
        for fault, run_id, samples, values in _iter_runs(args.normal_training, feature_columns):
            if run_id not in set(calibration_ids):
                continue
            scores = score_detector(values, detector)["ae"] / limits["ae"]
            run_critical.append(critical_run_score(scores, args.persistence))
        multiplier, _ = calibrated_threshold(run_critical, args.target_run_far)

        train_events, _ = collect_events(
            [args.fault_training], detector, limits, multiplier, args.persistence,
            keep_rows=False, feature_columns=feature_columns,
            diagnosis_delay=args.diagnosis_delay,
            allowed_keys=(fault_training_keys - fault_holdout_keys) if args.internal_holdout else None,
        )
        model, encoder, validation_metrics = _train_classifier(train_events, seed)

        # Save a reproducible serving bundle from fold 1. It uses the same
        # normal-only detector, run-calibrated threshold, and alarm-window
        # classifier evaluated below; live CSV replay can therefore follow the
        # exact same detector -> first alarm -> XGBoost path.
        if fold == 0:
            serving_dir = output_dir / "serving_model"
            serving_dir.mkdir(parents=True, exist_ok=True)
            joblib.dump(detector, serving_dir / "detector.joblib")
            model.save_model(serving_dir / "classifier.json")
            (serving_dir / "metadata.json").write_text(json.dumps({
                "formatVersion": 1,
                "modelType": "tep_alarm_time_xgboost",
                "featureSet": args.feature_set,
                "featureColumns": [column.upper() for column in feature_columns],
                "features": [
                    f"{stat}__{column.upper()}"
                    for stat in ("last", "mean", "std", "slope")
                    for column in feature_columns
                ],
                "windowSize": WINDOW_SIZE,
                "diagnosisDelaySamples": args.diagnosis_delay,
                "persistence": args.persistence,
                "autoencoderThreshold": float(limits["ae"] * multiplier),
                "autoencoderRowThreshold": float(limits["ae"]),
                "runThresholdMultiplier": float(multiplier),
                "classes": [int(value) for value in encoder.classes_],
                "validation": validation_metrics,
                "detectorTrainRuns": len(train_ids),
                "normalCalibrationRuns": len(calibration_ids),
                "calibrationTargetRunFAR": args.target_run_far,
                "sourceDatasets": {
                    "normalTraining": args.normal_training.name,
                    "faultTraining": args.fault_training.name,
                },
                "note": "Fold-1 serving model trained on labeled training runs only; test partition is not used for fitting.",
            }, indent=2, allow_nan=False), encoding="utf-8")

        # Use only test runs assigned to this fold. Filter in the streaming pass.
        allowed_keys = {key for key, assigned_fold in assignments.items() if assigned_fold == fold}
        fold_events, fold_rows = collect_events(
            [normal_test_path, fault_test_path], detector, limits, multiplier,
            args.persistence, keep_rows=True, feature_columns=feature_columns,
            allowed_keys=allowed_keys,
            diagnosis_delay=args.diagnosis_delay,
            respect_benchmark_onset=False,
        )
        class_ids = [int(value) for value in encoder.classes_]
        explainer = shap.TreeExplainer(model)
        for row in fold_rows:
            event = next((e for e in fold_events if e["faultId"] == row["faultId"] and e["simulationRun"] == row["simulationRun"]), None)
            if not row["detectedAfterOnset"] or event is None:
                continue
            probabilities = model.predict_proba(np.asarray(event["features"], dtype=np.float32)[None, :])[0]
            pred_class = int(encoder.inverse_transform([int(np.argmax(probabilities))])[0])
            row["predictedFaultId"] = pred_class
            row["diagnosisConfidence"] = float(np.max(probabilities))
            row["diagnosisCorrect"] = pred_class == row["faultId"]
            if selected_demo is None and row["diagnosisCorrect"]:
                shap_values = explainer.shap_values(np.asarray(event["features"], dtype=np.float32)[None, :], check_additivity=False)
                class_index = class_ids.index(pred_class)
                if isinstance(shap_values, list):
                    contributions = np.asarray(shap_values[class_index])[0]
                else:
                    values = np.asarray(shap_values)
                    contributions = values[0, :, class_index] if values.ndim == 3 else values[0]
                names = [f"{stat}__{column.upper()}" for stat in ("last", "mean", "std", "slope") for column in feature_columns]
                feature_rows = [{"feature": name, "contribution": float(value)} for name, value in zip(names, contributions)]
                selected_demo = {
                    "fold": fold + 1, "runId": row["simulationRun"], "actualFaultId": row["faultId"],
                    "predictedFaultId": pred_class, "alarmSample": row["firstAlarmSample"],
                    "diagnosisSample": row["diagnosisSample"],
                    "diagnosisDelayFallback": row["diagnosisDelayFallback"],
                    "confidence": row["diagnosisConfidence"], "windowSamples": [row["diagnosisSample"] - WINDOW_SIZE + 1, row["diagnosisSample"]],
                    "explanationMethod": "TreeSHAP", "topFeatures": sorted(feature_rows, key=lambda x: abs(x["contribution"]), reverse=True)[:10],
                    "note": "Held-out benchmark run. The actual fault ID is evaluation ground truth; do not show it before revealing the model prediction in a live presentation.",
                }
        all_rows.extend({"fold": fold + 1, **row} for row in fold_rows)
        fold_metrics = _pipeline_metrics(fold_rows)
        fold_reports.append({
            "fold": fold + 1, "detectorTrainRuns": len(train_ids), "normalCalibrationRuns": len(calibration_ids),
            "faultClassifierTrainingAlarmWindows": len(train_events), "classifierTraining": validation_metrics,
            "thresholdMultiplier": multiplier, "threshold": limits["ae"] * multiplier,
            "pcaComponents": detector[1].n_components_, "testRuns": len(fold_rows), "metrics": fold_metrics,
        })
        print(f"Fold {fold + 1}/{args.folds}: FAR={fold_metrics['far']:.3f}, FDR={fold_metrics['fdr']:.3f}, end-to-end={fold_metrics['endToEndCorrectRate']:.3f}", flush=True)
        # Checkpoint completed folds so a long run can be resumed or audited.
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "pipeline_checkpoint.json").write_text(
            json.dumps({"foldsCompleted": len(fold_reports), "folds": fold_reports,
                        "heldOutRows": all_rows, "demoCase": selected_demo},
                       indent=2, allow_nan=False, default=_json_default),
            encoding="utf-8",
        )

    aggregate = _pipeline_metrics(all_rows)
    # Publish the untouched fold-1 test metrics alongside the exact serving
    # bundle that the replay endpoint loads. These metrics are context only;
    # a single replay's prediction is never presented as a test-set score.
    serving_metadata_path = output_dir / "serving_model" / "metadata.json"
    if serving_metadata_path.is_file() and fold_reports:
        serving_metadata = json.loads(serving_metadata_path.read_text(encoding="utf-8"))
        serving_metadata["heldOutEvaluation"] = fold_reports[0]["metrics"]
        serving_metadata_path.write_text(
            json.dumps(serving_metadata, indent=2, allow_nan=False), encoding="utf-8"
        )
    output = {
        "experiment": "Run-level evaluation of calibrated MLP autoencoder alarms followed by alarm-time XGBoost diagnosis",
        "claimStatus": "Held-out benchmark evaluation; not evidence of industrial deployment, causal diagnosis, or novelty by itself.",
        "configuration": {
            "normalTrainingCsv": args.normal_training.name, "faultTrainingCsv": args.fault_training.name,
            "normalTestingCsv": args.normal_testing.name, "faultTestingCsv": args.fault_testing.name,
            "featureSet": args.feature_set,
            "featureCount": len(feature_columns), "features": [c.upper() for c in feature_columns],
            "detector": "MLP autoencoder squared reconstruction error; 99.5th percentile row limit; normal-run calibration; 2 consecutive exceedances",
            "targetNormalRunFar": args.target_run_far, "faultOnsetSampleAssumption": ONSET_SAMPLE,
            "diagnosisWindow": "25 consecutive samples ending after the persistent alarm",
            "diagnosisDelaySamples": args.diagnosis_delay,
            "evaluationSplit": "run-level internal holdout from the supplied training CSVs" if args.internal_holdout else "supplied test CSVs",
            "groupedTestFolds": args.folds, "foldSeed": args.fold_seed,
            "sha256": {p.name: sha256_file(p) for p in [args.normal_training, args.fault_training, args.normal_testing, args.fault_testing]},
        },
        "aggregate": aggregate, "folds": fold_reports,
        "limitations": [
            "The fault onset at sample 161 follows the supplied TEP benchmark convention.",
            "The target run FAR is estimated from a finite normal calibration split and is not a future guarantee.",
            "The classifier is trained only on fault runs that reached an alarm; undetected training runs cannot teach an alarm-time diagnosis.",
            "Some fault classes may have few or no alarmed training windows; these are reported and must not be hidden.",
            "The XGBoost decision is a benchmark class prediction; TreeSHAP ranks model contributions and does not establish physical causality.",
            f"The result uses {len(feature_columns)} TEP benchmark channels and simulated benchmark data, not live plant telemetry.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "pipeline_results.json").write_text(json.dumps(output, indent=2, allow_nan=False, default=_json_default), encoding="utf-8")
    with (output_dir / "pipeline_test_runs.csv").open("w", newline="", encoding="utf-8") as handle:
        fields = ["fold", "faultId", "simulationRun", "isNormal", "firstAlarmSample", "firstPersistentAlarmSample", "alarmBeforeBenchmarkOnset", "diagnosisSample", "diagnosisDelayFallback", "detectedAfterOnset", "falseAlarm", "windowAvailable", "predictedFaultId", "diagnosisConfidence", "diagnosisCorrect"]
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader(); writer.writerows(all_rows)
    if selected_demo is not None:
        (output_dir / "demo_case.json").write_text(json.dumps(selected_demo, indent=2, allow_nan=False, default=_json_default), encoding="utf-8")
    print(json.dumps({"results": str((output_dir / "pipeline_results.json").resolve()), "perRun": str((output_dir / "pipeline_test_runs.csv").resolve()), "aggregate": aggregate}, indent=2))
    return output


def _json_default(value: Any) -> Any:
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Not JSON serializable: {type(value).__name__}")


def _pipeline_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    normal = [row for row in rows if row["isNormal"]]
    faulty = [row for row in rows if not row["isNormal"]]
    detected = [row for row in faulty if row["detectedAfterOnset"]]
    correct = [row for row in detected if row.get("diagnosisCorrect")]
    diagnosed = [row for row in detected if row.get("predictedFaultId") is not None]
    delay = [int(row["firstAlarmSample"]) - ONSET_SAMPLE for row in detected]
    normal_false = sum(bool(row["falseAlarm"]) for row in normal)
    return {
        "normalRuns": len(normal), "normalRunsWithFalseAlarm": normal_false,
        "far": normal_false / max(1, len(normal)), "farWilson95": _wilson(normal_false, len(normal)),
        "faultRuns": len(faulty), "faultRunsDetectedAfterOnset": len(detected),
        "fdr": len(detected) / max(1, len(faulty)), "fdrWilson95": _wilson(len(detected), len(faulty)),
        "meanDetectionDelaySamples": float(np.mean(delay)) if delay else None,
        "detectedRunsWithDiagnosisWindow": sum(bool(row["windowAvailable"]) for row in detected),
        "diagnosesCorrectAmongDetected": len(correct),
        "conditionalDiagnosisAccuracy": len(correct) / max(1, len(detected)),
        "conditionalDiagnosisMacroF1": float(f1_score(
            [row["faultId"] for row in diagnosed], [row["predictedFaultId"] for row in diagnosed],
            labels=list(range(1, 21)), average="macro", zero_division=0,
        )) if diagnosed else 0.0,
        "endToEndCorrectDiagnoses": len(correct),
        "endToEndCorrectRate": len(correct) / max(1, len(faulty)),
        "perFault": [
            {"faultId": fault_id, "runs": sum(r["faultId"] == fault_id for r in faulty),
             "detected": sum(r["faultId"] == fault_id and r["detectedAfterOnset"] for r in faulty),
             "correctDiagnosis": sum(r["faultId"] == fault_id and r.get("diagnosisCorrect", False) for r in faulty)}
            for fault_id in sorted({r["faultId"] for r in faulty})
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--normal-training", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--fault-training", type=Path, default=PROJECT_ROOT / "faulty_training.csv")
    parser.add_argument("--normal-testing", type=Path, default=PROJECT_ROOT / "fault_free_testing.csv")
    parser.add_argument("--fault-testing", type=Path, default=PROJECT_ROOT / "faulty_testing.csv")
    parser.add_argument("--output-dir", type=Path, default=None,
                        help="Defaults to outputs/alarm_time_pipeline_<feature-set>.")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--fold-seed", type=int, default=20261019)
    parser.add_argument("--feature-set", choices=("38", "52"), default="52",
                        help="Use all 52 standard TEP process variables (default) or the legacy 38-variable live-app set.")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--row-quantile", type=float, default=0.995)
    parser.add_argument("--target-run-far", type=float, default=0.05)
    parser.add_argument("--persistence", type=int, default=2)
    parser.add_argument("--diagnosis-delay", type=int, default=0,
                        help="Wait this many samples after the persistent alarm before taking the 25-sample diagnosis window.")
    parser.add_argument("--internal-holdout", action="store_true",
                        help="Evaluate on held-out simulation runs from the training CSVs; keep those runs out of classifier fitting.")
    evaluate(parser.parse_args())


if __name__ == "__main__":
    main()
