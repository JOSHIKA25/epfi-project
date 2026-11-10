"""Grouped five-fold evaluation for normal-only TEP fault detectors.

Each simulation run from the supplied test CSVs is evaluated exactly once by a
model that did not train on that run. PCA and the MLP autoencoder are refitted
per fold, and thresholds are calibrated from normal-only calibration runs.
Outputs are separate from the production model artifacts and the original
single-split experiment.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

try:
    from .run_level_calibration_experiment import (
        DEFAULT_OUTPUT,
        META,
        calibrated_threshold,
        calibration_run_stats,
        method_scores,
        pca_scores,
        read_frame,
        run_scores,
        split_run_ids,
        summarize,
    )
    from .train_autoencoder import (
        DEFAULT_DATASET, FEATURE_COLUMNS, FEATURE_COLUMNS_52, PROJECT_ROOT, sha256_file,
    )
except ImportError:
    from run_level_calibration_experiment import (
        DEFAULT_OUTPUT,
        META,
        calibrated_threshold,
        calibration_run_stats,
        method_scores,
        pca_scores,
        read_frame,
        run_scores,
        split_run_ids,
        summarize,
    )
    from train_autoencoder import (
        DEFAULT_DATASET, FEATURE_COLUMNS, FEATURE_COLUMNS_52, PROJECT_ROOT, sha256_file,
    )


OUTPUT_ROOT = PROJECT_ROOT / "outputs"
METHODS = ("pca", "autoencoder", "fusion_max")
POLICIES = ("baseline", "run_calibrated")


def fit_autoencoder(train_values: np.ndarray, seed: int) -> tuple[StandardScaler, MLPRegressor]:
    """Fit the same MLP architecture/hyperparameters as train_autoencoder.py."""
    scaler = StandardScaler()
    normalized = scaler.fit_transform(train_values)
    model = MLPRegressor(
        hidden_layer_sizes=(32, 12, 32),
        activation="relu",
        solver="adam",
        alpha=1e-4,
        batch_size=1024,
        learning_rate_init=1e-3,
        max_iter=100,
        tol=1e-4,
        n_iter_no_change=10,
        random_state=seed,
        verbose=False,
    )
    model.fit(normalized, normalized)
    return scaler, model


def make_autoencoder_scorer(
    scaler: StandardScaler, model: MLPRegressor
):
    def score(values: np.ndarray) -> np.ndarray:
        normalized = scaler.transform(values.astype(np.float64))
        reconstructed = model.predict(normalized)
        return np.sum(np.square(normalized - reconstructed), axis=1)

    return score


def grouped_folds(frame: pd.DataFrame, fold_count: int, seed: int) -> dict[tuple[int, int], int]:
    """Assign whole (fault ID, run ID) groups to balanced, deterministic folds."""
    run_table = frame.loc[:, ["faultNumber", "simulationRun"]].drop_duplicates()
    result: dict[tuple[int, int], int] = {}
    rng = np.random.default_rng(seed)
    for fault_id, group in run_table.groupby("faultNumber", sort=True):
        run_ids = group["simulationRun"].astype(int).to_numpy().copy()
        rng.shuffle(run_ids)
        for fold_index, run_chunk in enumerate(np.array_split(run_ids, fold_count)):
            for run_id in run_chunk:
                key = (int(fault_id), int(run_id))
                if key in result:
                    raise ValueError(f"Run was assigned to multiple folds: {key}")
                result[key] = fold_index
    if len(result) != len(run_table):
        raise ValueError("Not every evaluation run was assigned to exactly one fold")
    return result


def select_runs(
    frame: pd.DataFrame, assignments: dict[tuple[int, int], int], fold_index: int
) -> pd.DataFrame:
    keys = set(frame.loc[:, ["faultNumber", "simulationRun"]].drop_duplicates().itertuples(index=False, name=None))
    selected = {key for key in keys if assignments[key] == fold_index}
    mask = [
        (int(fault_id), int(run_id)) in selected
        for fault_id, run_id in frame[["faultNumber", "simulationRun"]].itertuples(index=False, name=None)
    ]
    return frame.loc[mask].copy()


def metrics_from_rows(rows: list[dict[str, Any]], onset_sample: int) -> dict[str, Any]:
    normal = [row for row in rows if row["isNormal"]]
    faulty = [row for row in rows if not row["isNormal"]]
    detected = [row for row in faulty if row["detectedAfterOnset"]]
    delays = [int(row["delaySamples"]) for row in detected if row["delaySamples"] is not None]
    per_fault = []
    for fault_id in sorted({int(row["faultId"]) for row in faulty}):
        subset = [row for row in faulty if int(row["faultId"]) == fault_id]
        n_detected = sum(bool(row["detectedAfterOnset"]) for row in subset)
        per_fault.append({
            "faultId": fault_id,
            "runs": len(subset),
            "detectedRuns": n_detected,
            "faultDetectionRate": n_detected / max(1, len(subset)),
        })
    false_alarm_count = sum(bool(row["falseAlarm"]) for row in normal)
    return {
        "normalRuns": len(normal),
        "normalRunsWithFalseAlarm": false_alarm_count,
        "normalRunFalseAlarmRate": false_alarm_count / max(1, len(normal)),
        "normalRunFalseAlarmRateWilson95": _wilson(false_alarm_count, len(normal)),
        "faultRuns": len(faulty),
        "faultRunsDetectedAfterOnset": len(detected),
        "faultDetectionRate": len(detected) / max(1, len(faulty)),
        "faultDetectionRateWilson95": _wilson(len(detected), len(faulty)),
        "assumedFaultOnsetSample": onset_sample,
        "meanDetectionDelaySamples": float(np.mean(delays)) if delays else None,
        "medianDetectionDelaySamples": float(np.median(delays)) if delays else None,
        "perFault": per_fault,
    }


def _wilson(successes: int, total: int, z: float = 1.96) -> list[float] | None:
    if total == 0:
        return None
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    margin = z * np.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return [max(0.0, float(center - margin)), min(1.0, float(center + margin))]


def evaluate(args: argparse.Namespace) -> dict[str, Any]:
    feature_columns = FEATURE_COLUMNS_52 if args.feature_set == "52" else FEATURE_COLUMNS
    output_dir = args.output_dir or OUTPUT_ROOT / f"repeated_run_level_calibration_{args.feature_set}"
    normal_training = read_frame(args.normal_training, feature_columns)
    normal_testing = read_frame(args.normal_testing, feature_columns)
    fault_testing = read_frame(args.fault_testing, feature_columns)
    if sorted(normal_training["faultNumber"].unique().tolist()) != [0]:
        raise ValueError("Normal training CSV must contain only faultNumber=0")
    if sorted(normal_testing["faultNumber"].unique().tolist()) != [0]:
        raise ValueError("Normal testing CSV must contain only faultNumber=0")
    if not (fault_testing["faultNumber"] > 0).all():
        raise ValueError("Fault testing CSV must contain faulty runs only")
    if args.folds < 2:
        raise ValueError("At least two grouped folds are required")
    if not 0 < args.target_run_far < 0.5:
        raise ValueError("Target run FAR must be between 0 and 0.5")

    test_frame = pd.concat([normal_testing, fault_testing], ignore_index=True)
    fold_assignments = grouped_folds(test_frame, args.folds, args.fold_seed)
    all_fold_rows: list[dict[str, Any]] = []
    fold_reports: list[dict[str, Any]] = []

    for fold_index in range(args.folds):
        model_seed = args.seed + fold_index
        train_ids, calibration_ids, internal_holdout_ids = split_run_ids(
            normal_training["simulationRun"].astype(int).unique().tolist(), model_seed
        )
        train_frame = normal_training[normal_training["simulationRun"].isin(train_ids)]
        calibration_frame = normal_training[normal_training["simulationRun"].isin(calibration_ids)]
        internal_holdout = normal_training[normal_training["simulationRun"].isin(internal_holdout_ids)]
        if set(train_ids) & set(calibration_ids) or set(train_ids) & set(internal_holdout_ids) or set(calibration_ids) & set(internal_holdout_ids):
            raise AssertionError("Normal training/calibration/holdout runs overlap")

        train_values = train_frame.loc[:, feature_columns].to_numpy(dtype=np.float64)
        calibration_values = calibration_frame.loc[:, feature_columns].to_numpy(dtype=np.float64)

        pca_scaler = StandardScaler().fit(train_values)
        pca = PCA(n_components=0.95, svd_solver="full").fit(pca_scaler.transform(train_values))
        pca_score = lambda values, scaler=pca_scaler, model=pca: pca_scores(scaler, model, values)

        ae_scaler, ae_model = fit_autoencoder(train_values, model_seed)
        ae_score = make_autoencoder_scorer(ae_scaler, ae_model)

        cal_t2, cal_spe = pca_score(calibration_values)
        cal_ae = ae_score(calibration_values)
        limits = {
            "t2": float(np.quantile(cal_t2, args.row_quantile, method="higher")),
            "spe": float(np.quantile(cal_spe, args.row_quantile, method="higher")),
            "ae": float(np.quantile(cal_ae, args.row_quantile, method="higher")),
        }

        calibration_runs = run_scores(calibration_frame, pca_score, ae_score, feature_columns)
        internal_holdout_runs = run_scores(internal_holdout, pca_score, ae_score, feature_columns)
        fold_test_frame = select_runs(test_frame, fold_assignments, fold_index)
        fold_test_runs = run_scores(fold_test_frame, pca_score, ae_score, feature_columns)
        fold_record: dict[str, Any] = {
            "fold": fold_index + 1,
            "modelSeed": model_seed,
            "trainRuns": len(train_ids),
            "calibrationRuns": len(calibration_ids),
            "internalNormalHoldoutRuns": len(internal_holdout_ids),
            "testRuns": len(fold_test_runs),
            "pcaComponents": int(pca.n_components_),
            "autoencoderIterations": int(ae_model.n_iter_),
            "methods": {},
        }
        for method in METHODS:
            cal_stats = calibration_run_stats(calibration_runs, limits, method, args.persistence)
            calibrated_multiplier, _ = calibrated_threshold(cal_stats, args.target_run_far)
            thresholds = {"baseline": 1.0, "run_calibrated": calibrated_multiplier}
            for policy, threshold in thresholds.items():
                _, split_rows = summarize(
                    fold_test_runs, limits, method, threshold, args.onset_sample, args.persistence
                )
                for row in split_rows:
                    all_fold_rows.append({
                        "fold": fold_index + 1,
                        "modelSeed": model_seed,
                        "method": method,
                        "policy": policy,
                        "thresholdMultiplier": threshold,
                        **row,
                        "falseAlarm": bool(row["isNormal"] and row["firstRelevantAlarmSample"] is not None),
                    })
                fold_record["methods"].setdefault(method, {})[policy] = {
                    "thresholdMultiplier": threshold,
                    "test": metrics_from_rows(
                        [record for record in all_fold_rows if record["fold"] == fold_index + 1 and record["method"] == method and record["policy"] == policy],
                        args.onset_sample,
                    ),
                }
        fold_reports.append(fold_record)

    aggregate_reports = []
    for method in METHODS:
        for policy in POLICIES:
            rows = [row for row in all_fold_rows if row["method"] == method and row["policy"] == policy]
            aggregate_reports.append({
                "method": method,
                "policy": policy,
                "evaluation": metrics_from_rows(rows, args.onset_sample),
                "foldMeanAndStd": _fold_mean_std(fold_reports, method, policy),
            })

    output = {
        "experiment": "Grouped cross-validation of run-calibrated PCA, MLP autoencoder, and max-score fusion",
        "claimStatus": "repeated grouped evaluation; not proof of novelty or physical-plant performance",
        "configuration": {
            "normalTrainingCsv": str(args.normal_training),
            "normalTestingCsv": str(args.normal_testing),
            "faultTestingCsv": str(args.fault_testing),
            "normalTrainingSha256": sha256_file(args.normal_training),
            "folds": args.folds,
            "foldAssignmentSeed": args.fold_seed,
            "modelSeedStart": args.seed,
            "featureSet": args.feature_set,
            "featureCount": len(feature_columns),
            "features": [column.upper() for column in feature_columns],
            "targetRunFalseAlarmRate": args.target_run_far,
            "rowQuantile": args.row_quantile,
            "persistenceConsecutiveSamples": args.persistence,
            "faultOnsetSampleAssumption": args.onset_sample,
            "faultIdsPresent": sorted(int(value) for value in fault_testing["faultNumber"].unique()),
            "normalTestRuns": int(normal_testing[["faultNumber", "simulationRun"]].drop_duplicates().shape[0]),
            "faultTestRuns": int(fault_testing[["faultNumber", "simulationRun"]].drop_duplicates().shape[0]),
        },
        "folds": fold_reports,
        "aggregate": aggregate_reports,
        "limitations": [
            "Each supplied test simulation run is held out in exactly one fold; repeated fold metrics are not independent replications.",
            "The normal training CSV is re-split by run for every fold; the official test runs are not used to fit models or thresholds.",
            "Threshold calibration uses only normal calibration runs; a target FAR is empirical and not a future guarantee.",
            "The run-level calibration set is small, so the target FAR has coarse resolution.",
            "The experiment uses the selected channel set and provided fault test IDs; published results using different channels, splits, onset conventions, or dataset versions are not directly comparable.",
            "TEP is simulated data; results do not establish physical-plant performance.",
            "Fusion is a simple maximum of normalized scores, not a learned weighted fusion method.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "repeated_results.json").write_text(
        json.dumps(output, indent=2, allow_nan=False), encoding="utf-8"
    )
    with (output_dir / "repeated_run_results.csv").open("w", newline="", encoding="utf-8") as target:
        fieldnames = list(all_fold_rows[0].keys()) if all_fold_rows else []
        writer = csv.DictWriter(target, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_fold_rows)
    compact = [
        {
            "method": item["method"],
            "policy": item["policy"],
            "FAR": item["evaluation"]["normalRunsWithFalseAlarm"],
            "normalRuns": item["evaluation"]["normalRuns"],
            "FDR": item["evaluation"]["faultRunsDetectedAfterOnset"],
            "faultRuns": item["evaluation"]["faultRuns"],
            "meanDelaySamples": item["evaluation"]["meanDetectionDelaySamples"],
            "foldMeanAndStd": item["foldMeanAndStd"],
        }
        for item in aggregate_reports
    ]
    print(json.dumps({
        "summary": compact,
        "results": str((output_dir / "repeated_results.json").resolve()),
        "perRunResults": str((output_dir / "repeated_run_results.csv").resolve()),
    }, indent=2))
    return output


def _fold_mean_std(folds: list[dict[str, Any]], method: str, policy: str) -> dict[str, Any]:
    metric_paths = {
        "FAR": ("normalRunFalseAlarmRate",),
        "FDR": ("faultDetectionRate",),
        "meanDelaySamples": ("meanDetectionDelaySamples",),
    }
    result: dict[str, Any] = {}
    for output_key, path in metric_paths.items():
        values = []
        for fold in folds:
            value = fold["methods"][method][policy]["test"]
            for part in path:
                value = value[part]
            if value is not None:
                values.append(float(value))
        result[output_key] = {
            "mean": float(np.mean(values)) if values else None,
            "std": float(np.std(values, ddof=1)) if len(values) > 1 else None,
            "foldsWithValue": len(values),
        }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--normal-training", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--normal-testing", type=Path, default=PROJECT_ROOT / "fault_free_testing.csv")
    parser.add_argument("--fault-testing", type=Path, default=PROJECT_ROOT / "faulty_testing.csv")
    parser.add_argument("--output-dir", type=Path, default=None,
                        help="Defaults to outputs/repeated_run_level_calibration_<feature-set>.")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--fold-seed", type=int, default=20261019)
    parser.add_argument("--feature-set", choices=("38", "52"), default="52",
                        help="Use all 52 standard TEP process variables (default) or the legacy 38-variable live-app set.")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--row-quantile", type=float, default=0.995)
    parser.add_argument("--target-run-far", type=float, default=0.05)
    parser.add_argument("--persistence", type=int, default=2)
    parser.add_argument("--onset-sample", type=int, default=161)
    evaluate(parser.parse_args())


if __name__ == "__main__":
    main()
