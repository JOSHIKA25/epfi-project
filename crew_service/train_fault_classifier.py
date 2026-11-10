from __future__ import annotations

import argparse
import json
import warnings
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, precision_recall_fscore_support
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.exceptions import ConvergenceWarning

from crew_service.train_autoencoder import sha256_file

PROJECT_ROOT = Path(__file__).resolve().parents[1]
FEATURE_COLUMNS = tuple(
    [f"xmeas_{index}" for index in range(1, 28)]
    + [f"xmv_{index}" for index in range(1, 12)]
)
FEATURE_IDS = tuple(column.upper() for column in FEATURE_COLUMNS)
DEFAULT_NORMAL_TRAINING = PROJECT_ROOT / "TEP_FaultFree_Training.csv"
DEFAULT_FAULT_TRAINING = PROJECT_ROOT / "faulty_training.csv"
DEFAULT_ARTIFACT = PROJECT_ROOT / "server" / "ml" / "artifacts" / "tep_fault_classifier.json"
VALIDATION_RUN_MODULUS = 5
TRAINING_SAMPLE_START = 476
TRAINING_SAMPLE_END = 500


def _iter_csv_chunks(path: Path, use_columns: list[str], chunk_size: int) -> Iterator[pd.DataFrame]:
    reader = pd.read_csv(path, usecols=use_columns, chunksize=chunk_size)
    try:
        yield from reader
    finally:
        reader.close()


def select_fault_detection_threshold(sweep: list[dict[str, float]]) -> dict[str, float]:
    if not sweep:
        raise ValueError("Threshold calibration requires validation operating points.")
    return max(
        sweep,
        key=lambda item: (
            item["recall"] - item["falsePositiveRate"],
            item["precision"],
            item["threshold"],
        ),
    )


def recalibrate_fault_threshold(artifact_path: Path) -> dict[str, Any]:
    if not artifact_path.is_file():
        raise FileNotFoundError(f"Fault classifier artifact was not found: {artifact_path}")
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    if not isinstance(artifact, dict) or artifact.get("modelType") != "standardized_mlp_fault_classifier":
        raise ValueError("Artifact is not a supported standardized TEP fault classifier.")
    training = artifact.get("training")
    sweep = training.get("validationThresholdSweep") if isinstance(training, dict) else None
    if not isinstance(sweep, list) or not sweep:
        raise ValueError("Artifact has no grouped-validation threshold sweep to recalibrate.")

    selected = select_fault_detection_threshold(sweep)
    selected = {**selected, "youdenJ": selected["recall"] - selected["falsePositiveRate"]}
    artifact["decisionThreshold"] = selected["threshold"]
    training["validationFaultDetectionAtThreshold"] = selected
    training["thresholdSelectionObjective"] = (
        "maximum Youden J (recall minus false-positive rate) over grouped validation runs"
    )
    temporary_path = artifact_path.with_suffix(f"{artifact_path.suffix}.tmp")
    temporary_path.write_text(json.dumps(artifact, separators=(",", ":")), encoding="utf-8")
    temporary_path.replace(artifact_path)
    return artifact


def _load_stratified_training_samples(
    normal_path: Path,
    fault_path: Path,
    *,
    sample_stride: int,
    chunk_size: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
    if sample_stride < 1:
        raise ValueError("Sample stride must be a positive integer.")
    if chunk_size < 1:
        raise ValueError("Chunk size must be a positive integer.")

    train_features: list[np.ndarray] = []
    train_labels: list[np.ndarray] = []
    validation_features: list[np.ndarray] = []
    validation_labels: list[np.ndarray] = []
    source_stats: dict[str, Any] = {}
    validation_sample_count = 0

    for path, expected_fault_free in ((normal_path, True), (fault_path, False)):
        if not path.is_file():
            raise FileNotFoundError(f"Training dataset was not found: {path}")

        use_columns = ["faultNumber", "simulationRun", "sample", *FEATURE_COLUMNS]
        rows = 0
        sampled_rows = 0
        all_run_ids: dict[int, set[int]] = {}
        train_run_ids: dict[int, set[int]] = {}
        validation_run_ids: dict[int, set[int]] = {}
        observed_fault_ids: set[int] = set()

        for frame in _iter_csv_chunks(path, use_columns, chunk_size):
            if frame.empty:
                continue
            rows += len(frame)
            metadata = frame[["faultNumber", "simulationRun", "sample"]].to_numpy(dtype=np.float64)
            if not np.isfinite(metadata).all() or not np.equal(metadata, np.floor(metadata)).all():
                raise ValueError(f"{path.name} contains invalid fault, run, or sample metadata.")

            fault_ids = metadata[:, 0].astype(np.int32)
            run_ids = metadata[:, 1].astype(np.int64)
            samples = metadata[:, 2].astype(np.int64)
            if np.any(fault_ids < 0) or np.any(fault_ids > 20) or np.any(samples < 0):
                raise ValueError(f"{path.name} contains an out-of-range fault ID or sample number.")

            chunk_fault_ids = set(int(value) for value in np.unique(fault_ids))
            if expected_fault_free and chunk_fault_ids != {0}:
                raise ValueError(f"{path.name} must contain only faultNumber=0 rows.")
            if not expected_fault_free and 0 in chunk_fault_ids:
                raise ValueError(f"{path.name} must contain only fault-labeled rows.")
            observed_fault_ids.update(chunk_fault_ids)

            values = frame.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float32)
            if not np.isfinite(values).all():
                raise ValueError(f"{path.name} contains missing or non-finite feature values.")

            selected = (
                (samples >= TRAINING_SAMPLE_START)
                & (samples <= TRAINING_SAMPLE_END)
                & ((samples % sample_stride == 0) | (samples == TRAINING_SAMPLE_END))
            )
            if not np.any(selected):
                continue
            sampled_rows += int(np.count_nonzero(selected))
            for fault_id in chunk_fault_ids:
                class_rows = selected & (fault_ids == fault_id)
                if not np.any(class_rows):
                    continue
                class_runs = run_ids[class_rows]
                class_samples = samples[class_rows]
                validation_run_mask = class_runs % VALIDATION_RUN_MODULUS == 0
                validation_mask = validation_run_mask & (class_samples == TRAINING_SAMPLE_END)
                training_mask = ~validation_run_mask
                validation_sample_count += int(np.count_nonzero(
                    validation_run_mask & (class_samples >= TRAINING_SAMPLE_START)
                ))
                all_run_ids.setdefault(fault_id, set()).update(int(value) for value in np.unique(run_ids[fault_ids == fault_id]))
                if np.any(training_mask):
                    train_run_ids.setdefault(fault_id, set()).update(int(value) for value in np.unique(class_runs[training_mask]))
                    train_features.append(values[class_rows][training_mask])
                    train_labels.append(fault_ids[class_rows][training_mask])
                if np.any(validation_mask):
                    validation_run_ids.setdefault(fault_id, set()).update(int(value) for value in np.unique(class_runs[validation_run_mask]))
                    validation_features.append(values[class_rows][validation_mask])
                    validation_labels.append(fault_ids[class_rows][validation_mask])

        if rows == 0:
            raise ValueError(f"{path.name} contains no data rows.")
        if not observed_fault_ids:
            raise ValueError(f"{path.name} contains no fault labels.")

        source_stats[path.name] = {
            "bytes": path.stat().st_size,
            "rows": rows,
            "sampledRows": sampled_rows,
            "validationWindowSamples": validation_sample_count,
            "faultIds": sorted(observed_fault_ids),
            "runsByFault": {fault_id: len(run_ids) for fault_id, run_ids in sorted(all_run_ids.items())},
            "trainingRunsByFault": {fault_id: len(run_ids) for fault_id, run_ids in sorted(train_run_ids.items())},
            "validationRunsByFault": {
                fault_id: len(run_ids) for fault_id, run_ids in sorted(validation_run_ids.items())
            },
        }

    if not train_features or not validation_features:
        raise ValueError("The grouped training split produced an empty training or validation set.")

    return (
        np.concatenate(train_features),
        np.concatenate(train_labels),
        np.concatenate(validation_features),
        np.concatenate(validation_labels),
        source_stats,
    )


def train_fault_classifier(
    normal_path: Path,
    fault_path: Path,
    artifact_path: Path,
    *,
    sample_stride: int = 10,
    chunk_size: int = 100_000,
    seed: int = 42,
    max_iter: int = 30,
    hidden_layer_sizes: tuple[int, ...] = (64, 32),
) -> dict[str, Any]:
    x_train, y_train, x_validation, y_validation, source_stats = _load_stratified_training_samples(
        normal_path,
        fault_path,
        sample_stride=sample_stride,
        chunk_size=chunk_size,
    )

    classes = np.unique(y_train)
    missing_validation_classes = sorted(set(int(value) for value in classes) - set(int(value) for value in np.unique(y_validation)))
    if missing_validation_classes:
        raise ValueError(f"Grouped validation split is missing fault classes: {missing_validation_classes}.")

    scaler = StandardScaler()
    x_train_scaled = scaler.fit_transform(x_train)
    x_validation_scaled = scaler.transform(x_validation)
    classifier = MLPClassifier(
        hidden_layer_sizes=hidden_layer_sizes,
        activation="relu",
        solver="adam",
        alpha=1e-4,
        batch_size=2048,
        learning_rate_init=1e-3,
        max_iter=max_iter,
        shuffle=True,
        random_state=seed,
        verbose=False,
    )
    with warnings.catch_warnings(record=True) as caught_warnings:
        warnings.simplefilter("always", ConvergenceWarning)
        classifier.fit(x_train_scaled, y_train)

    validation_probabilities = classifier.predict_proba(x_validation_scaled)
    validation_predictions = classifier.classes_[np.argmax(validation_probabilities, axis=1)]
    precision, recall, f1, support = precision_recall_fscore_support(
        y_validation,
        validation_predictions,
        labels=classifier.classes_,
        zero_division=0,
    )
    normal_class_index = int(np.flatnonzero(classifier.classes_ == 0)[0])
    validation_fault_scores = 1.0 - validation_probabilities[:, normal_class_index]
    validation_is_fault = y_validation != 0
    threshold_candidates = np.unique(np.concatenate(([0.0, 1.0], validation_fault_scores)))
    threshold_sweep = []
    for threshold in threshold_candidates:
        predicted_fault = validation_fault_scores >= threshold
        true_positive = int(np.count_nonzero(predicted_fault & validation_is_fault))
        false_positive = int(np.count_nonzero(predicted_fault & ~validation_is_fault))
        false_negative = int(np.count_nonzero(~predicted_fault & validation_is_fault))
        true_negative = int(np.count_nonzero(~predicted_fault & ~validation_is_fault))
        threshold_precision = true_positive / max(1, true_positive + false_positive)
        threshold_recall = true_positive / max(1, true_positive + false_negative)
        threshold_f1 = (
            0.0
            if threshold_precision + threshold_recall == 0
            else 2 * threshold_precision * threshold_recall / (threshold_precision + threshold_recall)
        )
        false_positive_rate = false_positive / max(1, false_positive + true_negative)
        threshold_sweep.append({
            "threshold": float(threshold),
            "precision": threshold_precision,
            "recall": threshold_recall,
            "f1": threshold_f1,
            "falsePositiveRate": false_positive_rate,
            "youdenJ": threshold_recall - false_positive_rate,
        })
    selected_threshold = select_fault_detection_threshold(threshold_sweep)
    layer_activations = [
        "relu" if index < len(classifier.coefs_) - 1 else "softmax"
        for index in range(len(classifier.coefs_))
    ]
    artifact: dict[str, Any] = {
        "formatVersion": 1,
        "modelType": "standardized_mlp_fault_classifier",
        "features": list(FEATURE_IDS),
        "classes": [int(value) for value in classifier.classes_],
        "decisionThreshold": selected_threshold["threshold"],
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
        },
        "layers": [
            {
                "weights": weights.tolist(),
                "biases": biases.tolist(),
                "activation": activation,
            }
            for weights, biases, activation in zip(classifier.coefs_, classifier.intercepts_, layer_activations)
        ],
        "training": {
            "datasetFiles": source_stats,
            "datasetSha256": {
                normal_path.name: sha256_file(normal_path),
                fault_path.name: sha256_file(fault_path),
            },
            "sampleStride": sample_stride,
            "trainingSampleWindow": [TRAINING_SAMPLE_START, TRAINING_SAMPLE_END],
            "validationRunRule": f"simulationRun % {VALIDATION_RUN_MODULUS} == 0, held out within each fault class",
            "seed": seed,
            "hiddenLayerSizes": list(hidden_layer_sizes),
            "epochs": int(classifier.n_iter_),
            "trainingRows": int(len(y_train)),
            "validationRows": int(len(y_validation)),
            "validationAccuracy": float(accuracy_score(y_validation, validation_predictions)),
            "validationMacroF1": float(np.mean(f1)),
            "validationFaultDetectionAtThreshold": selected_threshold,
            "thresholdSelectionObjective": "maximum Youden J (recall minus false-positive rate) over grouped validation runs",
            "validationThresholdSweep": threshold_sweep,
            "validationByFault": [
                {
                    "faultId": int(fault_id),
                    "support": int(class_support),
                    "precision": float(class_precision),
                    "recall": float(class_recall),
                    "f1": float(class_f1),
                }
                for fault_id, class_precision, class_recall, class_f1, class_support in zip(
                    classifier.classes_, precision, recall, f1, support
                )
            ],
            "convergenceWarning": any(
                issubclass(item.category, ConvergenceWarning) for item in caught_warnings
            ),
        },
    }

    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = artifact_path.with_suffix(f"{artifact_path.suffix}.tmp")
    temporary_path.write_text(json.dumps(artifact, separators=(",", ":")), encoding="utf-8")
    temporary_path.replace(artifact_path)
    return artifact


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train a grouped-split TEP supervised fault classifier from separate normal/fault CSV files."
    )
    parser.add_argument("--normal-training", type=Path, default=DEFAULT_NORMAL_TRAINING)
    parser.add_argument("--fault-training", type=Path, default=DEFAULT_FAULT_TRAINING)
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--sample-stride", type=int, default=1)
    parser.add_argument("--chunk-size", type=int, default=100_000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-iter", type=int, default=30)
    parser.add_argument(
        "--recalibrate-existing",
        action="store_true",
        help="Re-select the threshold from an artifact's stored validation sweep without retraining weights.",
    )
    args = parser.parse_args()

    if args.recalibrate_existing:
        artifact = recalibrate_fault_threshold(args.artifact)
        print(json.dumps(artifact["training"]["validationFaultDetectionAtThreshold"], indent=2))
        return

    artifact = train_fault_classifier(
        args.normal_training,
        args.fault_training,
        args.artifact,
        sample_stride=args.sample_stride,
        chunk_size=args.chunk_size,
        seed=args.seed,
        max_iter=args.max_iter,
    )
    training_summary = {
        key: value
        for key, value in artifact["training"].items()
        if key != "validationThresholdSweep"
    }
    print(json.dumps(training_summary, indent=2))


if __name__ == "__main__":
    main()
