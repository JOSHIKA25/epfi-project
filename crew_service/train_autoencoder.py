from __future__ import annotations

import argparse
import hashlib
import json
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

PROJECT_ROOT = Path(__file__).resolve().parents[1]
FEATURE_COLUMNS_38 = tuple(
    [f"xmeas_{index}" for index in range(1, 28)]
    + [f"xmv_{index}" for index in range(1, 12)]
)
FEATURE_COLUMNS_52 = tuple(
    [f"xmeas_{index}" for index in range(1, 42)]
    + [f"xmv_{index}" for index in range(1, 12)]
)
# The benchmark research/replay path uses all 52 columns. FEATURE_COLUMNS_38
# remains available only for the legacy simplified simulator artifact.
FEATURE_COLUMNS = FEATURE_COLUMNS_52
FEATURE_IDS = tuple(column.upper() for column in FEATURE_COLUMNS)
DEFAULT_DATASET = PROJECT_ROOT / "TEP_FaultFree_Training.csv"
DEFAULT_ARTIFACT = PROJECT_ROOT / "server" / "ml" / "artifacts" / "tep_autoencoder_52.json"


def split_run_ids(run_ids: list[int], seed: int = 42) -> tuple[list[int], list[int], list[int]]:
    if len(run_ids) < 3:
        raise ValueError("At least three distinct simulation runs are required for grouped splitting.")

    shuffled = sorted(run_ids)
    random.Random(seed).shuffle(shuffled)
    train_count = max(1, int(len(shuffled) * 0.7))
    calibration_count = max(1, int(len(shuffled) * 0.15))
    if train_count + calibration_count >= len(shuffled):
        train_count = len(shuffled) - 2
        calibration_count = 1
    return (
        shuffled[:train_count],
        shuffled[train_count : train_count + calibration_count],
        shuffled[train_count + calibration_count :],
    )


def reconstruction_errors(
    model: MLPRegressor,
    scaler: StandardScaler,
    values: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    normalized = scaler.transform(values)
    reconstructed = model.predict(normalized)
    residuals = normalized - reconstructed
    return np.sum(np.square(residuals), axis=1), reconstructed, residuals


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def train_artifact(
    dataset_path: Path,
    artifact_path: Path,
    *,
    threshold_quantile: float = 0.995,
    seed: int = 42,
    max_iter: int = 100,
) -> dict[str, Any]:
    if not 0.9 < threshold_quantile < 1.0:
        raise ValueError("The calibration quantile must be greater than 0.90 and less than 1.0.")
    if not dataset_path.is_file():
        raise FileNotFoundError(f"Training dataset was not found: {dataset_path}")

    required_columns = ["faultNumber", "simulationRun", "sample", *FEATURE_COLUMNS]
    frame = pd.read_csv(dataset_path, usecols=required_columns)
    frame = frame.loc[:, required_columns]
    if frame.empty:
        raise ValueError("The training dataset contains no data rows.")
    if frame[required_columns].isna().any().any():
        raise ValueError("The training dataset contains missing metadata or sensor values.")
    if not np.isfinite(frame[required_columns].to_numpy(dtype=np.float64)).all():
        raise ValueError("The training dataset contains non-finite metadata or sensor values.")

    fault_ids = sorted(int(value) for value in frame["faultNumber"].unique())
    if fault_ids != [0]:
        raise ValueError(
            "This training command requires fault-free normal data only (faultNumber=0); "
            f"found fault IDs {fault_ids}."
        )

    run_ids = [int(value) for value in frame["simulationRun"].unique()]
    train_runs, calibration_runs, test_runs = split_run_ids(run_ids, seed)
    train_frame = frame[frame["simulationRun"].isin(train_runs)]
    calibration_frame = frame[frame["simulationRun"].isin(calibration_runs)]
    test_frame = frame[frame["simulationRun"].isin(test_runs)]

    train_values = train_frame.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float64)
    calibration_values = calibration_frame.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float64)
    test_values = test_frame.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float64)

    scaler = StandardScaler()
    train_scaled = scaler.fit_transform(train_values)
    model = MLPRegressor(
        hidden_layer_sizes=(32, 12, 32),
        activation="relu",
        solver="adam",
        alpha=1e-4,
        batch_size=1024,
        learning_rate_init=1e-3,
        max_iter=max_iter,
        tol=1e-4,
        n_iter_no_change=10,
        random_state=seed,
        verbose=True,
    )
    model.fit(train_scaled, train_scaled)

    calibration_errors, _, calibration_residuals = reconstruction_errors(
        model, scaler, calibration_values
    )
    test_errors, _, test_residuals = reconstruction_errors(model, scaler, test_values)
    threshold = float(np.quantile(calibration_errors, threshold_quantile, method="higher"))
    per_feature_thresholds = np.quantile(
        np.square(calibration_residuals), threshold_quantile, axis=0, method="higher"
    )
    test_false_alarm_rate = float(np.mean(test_errors >= threshold))

    layers = [
        {
            "weights": weights.tolist(),
            "biases": biases.tolist(),
            "activation": "relu" if index < len(model.coefs_) - 1 else "linear",
        }
        for index, (weights, biases) in enumerate(zip(model.coefs_, model.intercepts_))
    ]
    artifact: dict[str, Any] = {
        "formatVersion": 1,
        "modelType": "standardized_mlp_autoencoder",
        "features": list(FEATURE_IDS),
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
        },
        "layers": layers,
        "threshold": threshold,
        "thresholdQuantile": threshold_quantile,
        "perFeatureErrorThresholds": per_feature_thresholds.tolist(),
        "training": {
            "datasetName": dataset_path.name,
            "datasetSha256": sha256_file(dataset_path),
            "faultIds": fault_ids,
            "seed": seed,
            "hiddenLayerSizes": [32, 12, 32],
            "activation": "relu",
            "epochs": int(model.n_iter_),
            "trainingRuns": len(train_runs),
            "calibrationRuns": len(calibration_runs),
            "testRuns": len(test_runs),
            "trainingRows": len(train_frame),
            "calibrationRows": len(calibration_frame),
            "testRows": len(test_frame),
            "calibrationFalseAlarmRate": float(np.mean(calibration_errors >= threshold)),
            "normalHoldoutFalseAlarmRate": test_false_alarm_rate,
            "normalHoldoutMeanReconstructionError": float(np.mean(test_errors)),
            "normalHoldoutP95ReconstructionError": float(np.quantile(test_errors, 0.95)),
            "faultDetectionMetrics": None,
            "trainedAt": datetime.now(timezone.utc).isoformat(),
        },
    }

    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = artifact_path.with_suffix(f"{artifact_path.suffix}.tmp")
    temporary_path.write_text(json.dumps(artifact, separators=(",", ":")), encoding="utf-8")
    temporary_path.replace(artifact_path)
    return artifact


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train a run-split TEP normal-operation MLP autoencoder and calibrate its threshold."
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--threshold-quantile", type=float, default=0.995)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-iter", type=int, default=100)
    args = parser.parse_args()

    artifact = train_artifact(
        args.input,
        args.artifact,
        threshold_quantile=args.threshold_quantile,
        seed=args.seed,
        max_iter=args.max_iter,
    )
    training = artifact["training"]
    print(
        json.dumps(
            {
                "artifact": str(args.artifact.resolve()),
                "featureCount": len(artifact["features"]),
                "threshold": artifact["threshold"],
                "thresholdQuantile": artifact["thresholdQuantile"],
                "normalHoldoutFalseAlarmRate": training["normalHoldoutFalseAlarmRate"],
                "training": training,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
