"""Train and evaluate a run-split XGBoost classifier on TEP CSV files.

Each example is one 25-sample window from the end of a simulation run. Features
are computed independently per run; no samples from a run cross the train and
validation split. The held-out testing CSVs are evaluated only after fitting.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.preprocessing import LabelEncoder
from sklearn.utils.class_weight import compute_sample_weight

from .train_autoencoder import sha256_file

PROJECT_ROOT = Path(__file__).resolve().parents[1]
FEATURE_COLUMNS = tuple(
    [f"xmeas_{index}" for index in range(1, 42)]
    + [f"xmv_{index}" for index in range(1, 12)]
)
METADATA_COLUMNS = ("faultNumber", "simulationRun", "sample")
WINDOW_START = 476
WINDOW_END = 500
WINDOW_SIZE = WINDOW_END - WINDOW_START + 1
DEFAULT_ARTIFACT_DIR = PROJECT_ROOT / "server" / "ml" / "artifacts" / "xgboost_52"


def _stable_validation_run(fault_id: int, run_id: int, fraction: float) -> bool:
    digest = hashlib.sha256(f"{fault_id}:{run_id}".encode("ascii")).digest()
    bucket = int.from_bytes(digest[:8], "big") / (2**64)
    return bucket < fraction


def _window_features(window: np.ndarray) -> np.ndarray:
    """Return last, mean, standard deviation, and linear slope per sensor."""
    if window.shape != (WINDOW_SIZE, len(FEATURE_COLUMNS)):
        raise ValueError(f"Expected a {WINDOW_SIZE}x{len(FEATURE_COLUMNS)} sensor window.")
    time = np.arange(WINDOW_SIZE, dtype=np.float64)
    centered_time = time - time.mean()
    slope = centered_time @ window.astype(np.float64) / (centered_time @ centered_time)
    return np.concatenate((window[-1], window.mean(axis=0), window.std(axis=0), slope)).astype(np.float32)


def feature_names() -> list[str]:
    return [f"{stat}__{column.upper()}" for stat in ("last", "mean", "std", "slope") for column in FEATURE_COLUMNS]


def _read_run_windows(paths: list[Path], chunk_size: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
    """Read large CSVs in chunks and retain only the final labeled window per run."""
    by_run: dict[tuple[int, int], list[tuple[int, np.ndarray]]] = {}
    summaries: dict[str, Any] = {}
    usecols = [*METADATA_COLUMNS, *FEATURE_COLUMNS]
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(f"Dataset not found: {path}")
        print(f"Reading {path.name} ({path.stat().st_size:,} bytes)...", flush=True)
        row_count = 0
        for chunk_index, frame in enumerate(pd.read_csv(path, usecols=usecols, chunksize=chunk_size, low_memory=False), start=1):
            row_count += len(frame)
            if chunk_index % 10 == 0:
                print(f"  scanned {row_count:,} rows from {path.name}", flush=True)
            if frame.empty:
                continue
            meta = frame.loc[:, METADATA_COLUMNS].to_numpy(dtype=np.float64)
            values = frame.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float32)
            if not np.isfinite(meta).all() or not np.equal(meta, np.floor(meta)).all():
                raise ValueError(f"Invalid fault/run/sample metadata in {path.name}.")
            if not np.isfinite(values).all():
                raise ValueError(f"Missing or non-finite sensor values in {path.name}.")
            fault_ids = meta[:, 0].astype(np.int32)
            run_ids = meta[:, 1].astype(np.int64)
            samples = meta[:, 2].astype(np.int64)
            if np.any((fault_ids < 0) | (fault_ids > 20)) or np.any(run_ids < 0):
                raise ValueError(f"Out-of-range fault or run ID in {path.name}.")
            selected = (samples >= WINDOW_START) & (samples <= WINDOW_END)
            for row_index in np.flatnonzero(selected):
                key = (int(fault_ids[row_index]), int(run_ids[row_index]))
                by_run.setdefault(key, []).append((int(samples[row_index]), values[row_index].copy()))
        if row_count == 0:
            raise ValueError(f"Dataset has no data rows: {path}")
        print(f"  scanned {row_count:,} rows; hashing {path.name} for reproducibility...", flush=True)
        summaries[path.name] = {"bytes": path.stat().st_size, "rows": row_count, "sha256": sha256_file(path)}

    features: list[np.ndarray] = []
    final_values: list[np.ndarray] = []
    labels: list[int] = []
    runs: list[int] = []
    omitted: list[str] = []
    for (fault_id, run_id), rows in sorted(by_run.items()):
        rows.sort(key=lambda item: item[0])
        sample_ids = [sample for sample, _ in rows]
        # Require every sample in the declared interval, preventing silently
        # inconsistent windows from being compared as if they were equivalent.
        if len(sample_ids) != WINDOW_SIZE or sample_ids != list(range(WINDOW_START, WINDOW_END + 1)):
            omitted.append(f"{fault_id}:{run_id}")
            continue
        features.append(_window_features(np.stack([values for _, values in rows])))
        final_values.append(rows[-1][1])
        labels.append(fault_id)
        runs.append(run_id)
    if not features:
        raise ValueError(f"No complete {WINDOW_SIZE}-sample windows found in {', '.join(p.name for p in paths)}.")
    summaries["windowing"] = {
        "startSample": WINDOW_START,
        "endSample": WINDOW_END,
        "windowSize": WINDOW_SIZE,
        "completeRuns": len(features),
        "omittedIncompleteRuns": len(omitted),
        "omittedRunExamples": omitted[:20],
    }
    return (np.stack(features), np.stack(final_values), np.asarray(labels, dtype=np.int32),
            np.asarray(runs, dtype=np.int64), summaries)


def _evaluate_existing_mlp(values: np.ndarray, labels: np.ndarray, artifact_path: Path) -> dict[str, Any] | None:
    """Score the existing supervised MLP on the identical held-out runs/end samples."""
    if not artifact_path.is_file():
        return None
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    if artifact.get("modelType") != "standardized_mlp_fault_classifier":
        return None
    features = artifact.get("features", [])
    if features != [column.upper() for column in FEATURE_COLUMNS]:
        return None
    scaler = artifact["scaler"]
    activations = (values.astype(np.float64) - np.asarray(scaler["mean"])) / np.asarray(scaler["scale"])
    for layer in artifact["layers"]:
        activations = activations @ np.asarray(layer["weights"]) + np.asarray(layer["biases"])
        if layer["activation"] == "relu":
            activations = np.maximum(0, activations)
        elif layer["activation"] == "softmax":
            activations = np.exp(activations - np.max(activations, axis=1, keepdims=True))
            activations = activations / np.sum(activations, axis=1, keepdims=True)
        else:
            raise ValueError("Existing MLP artifact has an unknown activation.")
    classes = np.asarray(artifact["classes"], dtype=np.int32)
    if activations.shape[1] != len(classes) or 0 not in classes:
        return None
    normal_index = int(np.flatnonzero(classes == 0)[0])
    fault_scores = 1.0 - activations[:, normal_index]
    predicted = classes[np.argmax(activations, axis=1)]
    predicted = np.where(fault_scores >= float(artifact["decisionThreshold"]), predicted, 0)
    evaluation_classes = np.union1d(classes, np.unique(labels))
    return {
        "model": "Existing standardized MLP classifier",
        "input": "last sample from the same held-out runs; no temporal window features",
        "test": _classification_metrics(labels, predicted.astype(np.int32), evaluation_classes),
    }


def _validation_threshold(y_true: np.ndarray, probabilities: np.ndarray, classes: np.ndarray) -> dict[str, float]:
    normal_positions = np.flatnonzero(classes == 0)
    if len(normal_positions) != 1:
        raise ValueError("Training data must include the normal class (faultNumber=0).")
    fault_score = 1.0 - probabilities[:, normal_positions[0]]
    is_fault = y_true != 0
    best: tuple[float, float, float] | None = None
    for threshold in np.linspace(0.05, 0.95, 181):
        predicted_fault = fault_score >= threshold
        tp = int(np.count_nonzero(predicted_fault & is_fault))
        fp = int(np.count_nonzero(predicted_fault & ~is_fault))
        fn = int(np.count_nonzero(~predicted_fault & is_fault))
        tn = int(np.count_nonzero(~predicted_fault & ~is_fault))
        recall = tp / max(1, tp + fn)
        fpr = fp / max(1, fp + tn)
        precision = tp / max(1, tp + fp)
        candidate = (recall - fpr, precision, float(threshold))
        if best is None or candidate > best:
            best = candidate
    assert best is not None
    return {"threshold": best[2], "validationYoudenJ": best[0], "validationPrecision": best[1]}


def _selective_class_threshold(
    y_true: np.ndarray,
    probabilities: np.ndarray,
    classes: np.ndarray,
    fault_threshold: float,
    *,
    target_accuracy: float = 0.90,
) -> dict[str, float | bool]:
    normal_index = int(np.flatnonzero(classes == 0)[0])
    fault_indices = np.flatnonzero(classes != 0)
    fault_score = 1.0 - probabilities[:, normal_index]
    predicted_fault_index = fault_indices[np.argmax(probabilities[:, fault_indices], axis=1)]
    predicted_ids = classes[predicted_fault_index]
    class_score = probabilities[np.arange(len(y_true)), predicted_fault_index]
    eligible = (y_true != 0) & (fault_score >= fault_threshold)
    best: tuple[int, float, float] | None = None
    for threshold in np.linspace(0.05, 0.95, 181):
        accepted = eligible & (class_score >= threshold)
        count = int(np.count_nonzero(accepted))
        if count == 0:
            continue
        selective_accuracy = float(np.mean(predicted_ids[accepted] == y_true[accepted]))
        if selective_accuracy >= target_accuracy:
            candidate = (count, selective_accuracy, float(threshold))
            if best is None or candidate > best:
                best = candidate
    if best is None:
        return {
            "threshold": 1.0,
            "targetAccuracy": target_accuracy,
            "validationSelectiveAccuracy": 0.0,
            "validationCoverage": 0.0,
            "targetAchieved": False,
        }
    return {
        "threshold": best[2],
        "targetAccuracy": target_accuracy,
        "validationSelectiveAccuracy": best[1],
        "validationCoverage": best[0] / max(1, int(np.count_nonzero(eligible))),
        "targetAchieved": True,
    }


def _classification_metrics(y_true: np.ndarray, y_pred: np.ndarray, classes: np.ndarray) -> dict[str, Any]:
    p, r, f, support = precision_recall_fscore_support(
        y_true, y_pred, labels=classes, zero_division=0
    )
    actual_fault = y_true != 0
    predicted_fault = y_pred != 0
    tp = int(np.count_nonzero(actual_fault & predicted_fault))
    fp = int(np.count_nonzero(~actual_fault & predicted_fault))
    tn = int(np.count_nonzero(~actual_fault & ~predicted_fault))
    fn = int(np.count_nonzero(actual_fault & ~predicted_fault))
    return {
        "runs": int(len(y_true)),
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "macroF1": float(f1_score(y_true, y_pred, labels=classes, average="macro", zero_division=0)),
        "faultDetection": {
            "truePositive": tp, "falsePositive": fp, "trueNegative": tn, "falseNegative": fn,
            "faultDetectionRate": tp / max(1, tp + fn),
            "falseAlarmRate": fp / max(1, fp + tn),
        },
        "unknownPredictions": int(np.count_nonzero(y_pred == -1)),
        "perFault": [
            {"faultId": int(label), "precision": float(precision), "recall": float(recall),
             "f1": float(f1), "supportRuns": int(count)}
            for label, precision, recall, f1, count in zip(classes, p, r, f, support)
        ],
        "confusionMatrix": confusion_matrix(y_true, y_pred, labels=classes).tolist(),
    }


def train_and_evaluate(
    normal_training: Path,
    fault_training: Path,
    normal_testing: Path,
    fault_testing: Path,
    artifact_dir: Path,
    *,
    validation_fraction: float = 0.2,
    chunk_size: int = 100_000,
    seed: int = 42,
    n_estimators: int = 180,
    reuse_model: bool = False,
) -> dict[str, Any]:
    if not 0.05 <= validation_fraction <= 0.5:
        raise ValueError("validation_fraction must be between 0.05 and 0.5.")
    x_all, _raw_train_end, y_all, run_all, training_sources = _read_run_windows(
        [normal_training, fault_training], chunk_size
    )
    validation_mask = np.fromiter(
        (_stable_validation_run(int(y), int(run), validation_fraction) for y, run in zip(y_all, run_all)),
        dtype=bool,
        count=len(y_all),
    )
    x_train, y_train = x_all[~validation_mask], y_all[~validation_mask]
    x_val, y_val = x_all[validation_mask], y_all[validation_mask]
    if len(np.unique(y_train)) < 2 or len(np.unique(y_val)) < 2:
        raise ValueError("Grouped split must contain at least two classes in train and validation.")
    label_encoder = LabelEncoder().fit(y_train)
    class_ids = label_encoder.classes_
    y_train_encoded = label_encoder.transform(y_train)
    y_val_encoded = label_encoder.transform(y_val)
    missing_validation_classes = sorted(set(class_ids.tolist()) - set(np.unique(y_val).tolist()))
    if missing_validation_classes:
        raise ValueError(f"Validation split is missing classes: {missing_validation_classes}")

    artifact_dir.mkdir(parents=True, exist_ok=True)
    model_path = artifact_dir / "tep_xgboost_classifier.json"
    model = xgb.XGBClassifier()
    if reuse_model:
        if not model_path.is_file():
            raise FileNotFoundError(f"Cannot reuse missing model: {model_path}")
        model.load_model(model_path)
        if not np.array_equal(np.asarray(model.classes_), np.arange(len(class_ids))):
            raise ValueError("Existing XGBoost model classes do not match the current run split.")
    else:
        model = xgb.XGBClassifier(
            objective="multi:softprob",
            num_class=int(len(class_ids)),
            n_estimators=n_estimators,
            max_depth=4,
            learning_rate=0.06,
            subsample=0.85,
            colsample_bytree=0.85,
            reg_lambda=1.0,
            tree_method="hist",
            eval_metric="mlogloss",
            early_stopping_rounds=20,
            random_state=seed,
            n_jobs=max(1, min(8, os.cpu_count() or 1)),
        )
        model.fit(
            x_train,
            y_train_encoded,
            sample_weight=compute_sample_weight("balanced", y_train_encoded),
            eval_set=[(x_val, y_val_encoded)],
            verbose=False,
        )
    val_probabilities = model.predict_proba(x_val)
    threshold = _validation_threshold(y_val, val_probabilities, class_ids)
    class_threshold = _selective_class_threshold(
        y_val, val_probabilities, class_ids, threshold["threshold"]
    )

    x_test, raw_test_end, y_test, run_test, testing_sources = _read_run_windows(
        [normal_testing, fault_testing], chunk_size
    )
    test_probabilities = model.predict_proba(x_test)
    normal_index = int(np.flatnonzero(class_ids == 0)[0])
    fault_score = 1.0 - test_probabilities[:, normal_index]
    # Keep normal/fault decision tied to the validation-calibrated binary gate;
    # among fault cases, report the highest-scoring fault class.
    best_fault_index = np.argmax(np.where(class_ids[None, :] == 0, -np.inf, test_probabilities), axis=1)
    best_fault_score = test_probabilities[np.arange(len(y_test)), best_fault_index]
    is_fault = fault_score >= threshold["threshold"]
    is_known = best_fault_score >= float(class_threshold["threshold"])
    predicted = np.where(is_fault, np.where(is_known, class_ids[best_fault_index], -1), 0).astype(np.int32)

    if not reuse_model:
        model.save_model(model_path)
    metadata: dict[str, Any] = {
        "formatVersion": 1,
        "modelType": "xgboost_tep_run_window_classifier",
        "modelFile": model_path.name,
        "features": feature_names(),
        "sensorColumns": [name.upper() for name in FEATURE_COLUMNS],
        "classes": [int(value) for value in class_ids],
        "window": {"startSample": WINDOW_START, "endSample": WINDOW_END, "size": WINDOW_SIZE,
                   "statistics": ["last", "mean", "std", "slope"]},
        "faultDecision": threshold,
        "unknownFault": {
            **class_threshold,
            "rule": "Anomalous fault candidate below this validation-selected class-confidence threshold is abstained as unknown.",
        },
        "seed": seed,
        "validationFraction": validation_fraction,
        "training": {
            "runs": int(len(y_train)), "validationRuns": int(len(y_val)),
            "trainingClassCounts": {str(int(c)): int(np.count_nonzero(y_train == c)) for c in class_ids},
            "validationClassCounts": {str(int(c)): int(np.count_nonzero(y_val == c)) for c in class_ids},
            "modelParameters": {
                "objective": "multi:softprob", "nEstimatorsRequested": n_estimators,
                "maxDepth": 4, "learningRate": 0.06, "subsample": 0.85,
                "colsampleBytree": 0.85, "regLambda": 1.0, "treeMethod": "hist",
                "evalMetric": "mlogloss", "earlyStoppingRounds": 20,
                "modelReused": reuse_model,
            },
            "bestIteration": int(model.best_iteration) if hasattr(model, "best_iteration") else None,
            "validationMetrics": _classification_metrics(y_val, np.where(
                (1.0 - val_probabilities[:, normal_index]) >= threshold["threshold"],
                np.where(
                    np.max(np.where(class_ids[None, :] == 0, -np.inf, val_probabilities), axis=1) >= float(class_threshold["threshold"]),
                    class_ids[np.argmax(np.where(class_ids[None, :] == 0, -np.inf, val_probabilities), axis=1)], -1), 0), class_ids),
        },
        "test": _classification_metrics(y_test, predicted, class_ids),
        "sameRunComparison": _evaluate_existing_mlp(
            raw_test_end, y_test, PROJECT_ROOT / "server" / "ml" / "artifacts" / "tep_fault_classifier.json"
        ),
        "sources": {"training": training_sources, "testing": testing_sources},
        "notes": [
            "Evaluation unit is one complete simulation run; input is the final 25-sample window.",
            "Fault detection rate is recall across faulty runs; false alarm rate is the share of normal runs flagged faulty.",
            "This is benchmark simulation data, not plant validation.",
        ],
    }
    metadata_path = artifact_dir / "tep_xgboost_metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2, allow_nan=False), encoding="utf-8")
    return {"modelPath": str(model_path), "metadataPath": str(metadata_path), **metadata}


def main() -> None:
    parser = argparse.ArgumentParser(description="Train and evaluate a run-split TEP XGBoost classifier.")
    parser.add_argument("--normal-training", type=Path, default=PROJECT_ROOT / "TEP_FaultFree_Training.csv")
    parser.add_argument("--fault-training", type=Path, default=PROJECT_ROOT / "faulty_training.csv")
    parser.add_argument("--normal-testing", type=Path, default=PROJECT_ROOT / "fault_free_testing.csv")
    parser.add_argument("--fault-testing", type=Path, default=PROJECT_ROOT / "faulty_testing.csv")
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--chunk-size", type=int, default=100_000)
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--n-estimators", type=int, default=180)
    parser.add_argument("--reuse-existing-model", action="store_true", help="Reuse an existing XGBoost model file and recompute validation thresholds and held-out evaluation.")
    args = parser.parse_args()
    report = train_and_evaluate(
        args.normal_training, args.fault_training, args.normal_testing, args.fault_testing,
        args.artifact_dir, validation_fraction=args.validation_fraction,
        chunk_size=args.chunk_size, seed=args.seed, n_estimators=args.n_estimators,
        reuse_model=args.reuse_existing_model,
    )
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
