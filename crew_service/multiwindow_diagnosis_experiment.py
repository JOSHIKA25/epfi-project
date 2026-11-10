"""Grouped validation experiment for multi-time-window TEP diagnosis.

The candidate trains on several complete 25-sample windows per simulation run,
then validates on the final window of held-out runs. It never reads test CSVs.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, f1_score
from sklearn.preprocessing import LabelEncoder
from sklearn.utils.class_weight import compute_sample_weight

from .train_autoencoder import FEATURE_COLUMNS_52, PROJECT_ROOT, sha256_file
from .train_xgboost_classifier import (
    _classification_metrics, _selective_class_threshold, _stable_validation_run,
    _validation_threshold, _window_features,
)


WINDOW_SIZE = 25
WINDOW_ENDS = (200, 300, 400, 500)
META_COLUMNS = ("faultNumber", "simulationRun", "sample")


def _read_windows(path: Path, chunk_size: int) -> tuple[dict[tuple[int, int], dict[int, np.ndarray]], dict[str, Any]]:
    usecols = [*META_COLUMNS, *FEATURE_COLUMNS_52]
    selected_samples = {sample for end in WINDOW_ENDS for sample in range(end - WINDOW_SIZE + 1, end + 1)}
    collected: dict[tuple[int, int], dict[int, list[tuple[int, np.ndarray]]]] = {}
    rows_read = 0
    print(f"Reading selected training windows from {path.name} ...", flush=True)
    for chunk in pd.read_csv(path, usecols=usecols, chunksize=chunk_size, low_memory=False):
        rows_read += len(chunk)
        part = chunk[chunk["sample"].isin(selected_samples)]
        for key_raw, group in part.groupby(["faultNumber", "simulationRun"], sort=False):
            key = (int(key_raw[0]), int(key_raw[1]))
            by_end = collected.setdefault(key, {})
            values = group.loc[:, FEATURE_COLUMNS_52].to_numpy(dtype=np.float32)
            samples = group["sample"].to_numpy(dtype=np.int32)
            for end in WINDOW_ENDS:
                mask = (samples >= end - WINDOW_SIZE + 1) & (samples <= end)
                if mask.any():
                    by_end.setdefault(end, []).extend(
                        (int(sample), row.copy()) for sample, row in zip(samples[mask], values[mask])
                    )
    result: dict[tuple[int, int], dict[int, np.ndarray]] = {}
    for key, by_end in collected.items():
        result[key] = {}
        for end, entries in by_end.items():
            entries.sort(key=lambda item: item[0])
            sample_ids = [sample for sample, _ in entries]
            expected = list(range(end - WINDOW_SIZE + 1, end + 1))
            if sample_ids == expected:
                result[key][end] = _window_features(np.stack([row for _, row in entries]))
    summary = {"file": path.name, "rowsRead": rows_read, "sha256": sha256_file(path)}
    return result, summary


def _metrics(labels: np.ndarray, predictions: np.ndarray, classes: np.ndarray) -> dict[str, float]:
    return {
        "accuracy": float(accuracy_score(labels, predictions)),
        "macroF1": float(f1_score(labels, predictions, labels=classes, average="macro", zero_division=0)),
    }


def _validation_calibrated_predictions(
    y_val: np.ndarray,
    val_probabilities: np.ndarray,
    y_eval: np.ndarray,
    eval_probabilities: np.ndarray,
    classes: np.ndarray,
) -> tuple[dict[str, Any], np.ndarray]:
    fault_gate = _validation_threshold(y_val, val_probabilities, classes)
    class_gate = _selective_class_threshold(
        y_val, val_probabilities, classes, fault_gate["threshold"]
    )
    normal_index = int(np.flatnonzero(classes == 0)[0])
    fault_columns = np.flatnonzero(classes != 0)

    def decide(probabilities: np.ndarray) -> np.ndarray:
        fault_score = 1.0 - probabilities[:, normal_index]
        best_fault_column = fault_columns[np.argmax(probabilities[:, fault_columns], axis=1)]
        best_fault_score = probabilities[np.arange(len(probabilities)), best_fault_column]
        is_fault = fault_score >= fault_gate["threshold"]
        is_known = best_fault_score >= float(class_gate["threshold"])
        return np.where(
            is_fault,
            np.where(is_known, classes[best_fault_column], -1),
            0,
        ).astype(np.int32)

    predicted = decide(eval_probabilities)
    return {
        "faultDecision": fault_gate,
        "unknownFaultDecision": class_gate,
        "metrics": _classification_metrics(y_eval, predicted, classes),
    }, predicted


def run(args: argparse.Namespace) -> dict[str, Any]:
    all_windows: dict[tuple[int, int], dict[int, np.ndarray]] = {}
    sources = []
    for path in (args.normal_training, args.fault_training):
        windows, source = _read_windows(path, args.chunk_size)
        overlap = set(all_windows) & set(windows)
        if overlap:
            raise ValueError(f"Duplicate run keys across training files: {sorted(overlap)[:3]}")
        all_windows.update(windows)
        sources.append(source)

    keys = sorted(key for key, windows in all_windows.items() if 500 in windows)
    validation = np.asarray([
        _stable_validation_run(fault, run_id, args.validation_fraction) for fault, run_id in keys
    ])
    train_keys = [key for key, is_validation in zip(keys, validation) if not is_validation]
    val_keys = [key for key, is_validation in zip(keys, validation) if is_validation]
    classes = np.asarray(sorted({fault for fault, _ in keys}), dtype=np.int32)
    encoder = LabelEncoder().fit(classes)

    x_train_single = np.stack([all_windows[key][500] for key in train_keys])
    y_train_single = np.asarray([key[0] for key in train_keys], dtype=np.int32)
    x_train_multi = np.stack([
        all_windows[key][end]
        for key in train_keys
        for end in WINDOW_ENDS if end in all_windows[key]
    ])
    y_train_multi = np.asarray([
        key[0]
        for key in train_keys
        for end in WINDOW_ENDS if end in all_windows[key]
    ], dtype=np.int32)
    x_val = np.stack([all_windows[key][500] for key in val_keys])
    y_val = np.asarray([key[0] for key in val_keys], dtype=np.int32)
    encoded_val = encoder.transform(y_val)

    def fit(x: np.ndarray, y: np.ndarray) -> xgb.XGBClassifier:
        model = xgb.XGBClassifier(
            objective="multi:softprob", num_class=len(classes), n_estimators=args.n_estimators,
            max_depth=4, learning_rate=0.06, subsample=0.85, colsample_bytree=0.85,
            reg_lambda=1.0, tree_method="hist", eval_metric="mlogloss",
            early_stopping_rounds=20, random_state=args.seed, n_jobs=4,
        )
        encoded = encoder.transform(y)
        model.fit(
            x, encoded,
            sample_weight=compute_sample_weight("balanced", encoded),
            eval_set=[(x_val, encoded_val)], verbose=False,
        )
        return model

    baseline = fit(x_train_single, y_train_single)
    multiwindow = fit(x_train_multi, y_train_multi)
    baseline_val_probs = baseline.predict_proba(x_val)
    multiwindow_val_probs = multiwindow.predict_proba(x_val)
    baseline_pred = encoder.inverse_transform(baseline.predict(x_val).astype(int))
    multiwindow_pred = encoder.inverse_transform(multiwindow.predict(x_val).astype(int))
    per_fault = []
    for fault in classes:
        mask = y_val == fault
        per_fault.append({
            "faultId": int(fault), "validationRuns": int(mask.sum()),
            "baselineRecall": float(np.mean(baseline_pred[mask] == fault)) if mask.any() else None,
            "multiwindowRecall": float(np.mean(multiwindow_pred[mask] == fault)) if mask.any() else None,
        })
    test_windows: dict[tuple[int, int], dict[int, np.ndarray]] = {}
    test_sources = []
    for path in (args.normal_testing, args.fault_testing):
        windows, source = _read_windows(path, args.chunk_size)
        overlap = set(test_windows) & set(windows)
        if overlap:
            raise ValueError(f"Duplicate run keys across test files: {sorted(overlap)[:3]}")
        test_windows.update(windows)
        test_sources.append(source)
    test_keys = sorted(key for key, windows in test_windows.items() if 500 in windows)
    x_test = np.stack([test_windows[key][500] for key in test_keys])
    y_test = np.asarray([key[0] for key in test_keys], dtype=np.int32)
    baseline_test = encoder.inverse_transform(baseline.predict(x_test).astype(int))
    multiwindow_test = encoder.inverse_transform(multiwindow.predict(x_test).astype(int))
    baseline_gated, _ = _validation_calibrated_predictions(
        y_val, baseline_val_probs, y_test, baseline.predict_proba(x_test), classes
    )
    multiwindow_gated, _ = _validation_calibrated_predictions(
        y_val, multiwindow_val_probs, y_test, multiwindow.predict_proba(x_test), classes
    )
    result = {
        "experiment": "Multi-window training for final-window TEP diagnosis",
        "claimStatus": "Candidate selected on grouped validation; held-out test evaluated once and not used for tuning.",
        "configuration": {
            "featureSet": "52 channels", "windowSize": WINDOW_SIZE,
            "trainingWindowEnds": list(WINDOW_ENDS), "validationWindowEnd": 500,
            "validationFraction": args.validation_fraction, "seed": args.seed,
            "trainRuns": len(train_keys), "validationRuns": len(val_keys),
            "candidateTrainingWindows": len(x_train_multi), "sources": sources,
            "testRuns": len(test_keys), "testSources": test_sources,
        },
        "baselineSingleWindow": _metrics(y_val, baseline_pred, classes),
        "candidateMultiWindow": _metrics(y_val, multiwindow_pred, classes),
        "heldOutTestBaselineSingleWindow": _metrics(y_test, baseline_test, classes),
        "heldOutTestCandidateMultiWindow": _metrics(y_test, multiwindow_test, classes),
        "heldOutTestBaselineWithValidationCalibratedGates": baseline_gated,
        "heldOutTestCandidateWithValidationCalibratedGates": multiwindow_gated,
        "candidateBestIteration": int(multiwindow.best_iteration),
        "perFault": per_fault,
        "limitations": [
            "The model design was selected on grouped validation runs; test files were evaluated once afterward.",
            "Results apply to final-window run diagnosis, not alarm-time end-to-end diagnosis.",
            "Do not select hyperparameters based on the held-out test files.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--normal-training", type=Path, default=PROJECT_ROOT / "TEP_FaultFree_Training.csv")
    parser.add_argument("--fault-training", type=Path, default=PROJECT_ROOT / "faulty_training.csv")
    parser.add_argument("--normal-testing", type=Path, default=PROJECT_ROOT / "fault_free_testing.csv")
    parser.add_argument("--fault-testing", type=Path, default=PROJECT_ROOT / "faulty_testing.csv")
    parser.add_argument("--chunk-size", type=int, default=100_000)
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--n-estimators", type=int, default=400)
    parser.add_argument("--output", type=Path, default=PROJECT_ROOT / "outputs" / "multiwindow_diagnosis" / "validation_results.json")
    args = parser.parse_args()
    print(json.dumps(run(args), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
