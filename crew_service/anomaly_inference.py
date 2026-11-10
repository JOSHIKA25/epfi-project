"""Score a benchmark CSV telemetry history with the trained PCA and MLP detectors."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from .train_autoencoder import FEATURE_COLUMNS, PROJECT_ROOT

PCA_ARTIFACT = PROJECT_ROOT / "server" / "ml" / "artifacts" / "tep_pca_detector_52.json"
AE_ARTIFACT = PROJECT_ROOT / "server" / "ml" / "artifacts" / "tep_autoencoder_52.json"


def _read_features(history: list[dict[str, Any]]) -> np.ndarray:
    if not history:
        raise ValueError("Provide at least one telemetry sample.")
    rows = []
    for index, sample in enumerate(history):
        values = sample.get("values", sample)
        if not isinstance(values, dict):
            raise ValueError(f"Sample {index} has no values mapping.")
        row = []
        for column in FEATURE_COLUMNS:
            value = values.get(column.upper(), values.get(column))
            if not isinstance(value, (int, float)) or not np.isfinite(value):
                raise ValueError(f"Sample {index} is missing finite {column.upper()}.")
            row.append(float(value))
        rows.append(row)
    return np.asarray(rows, dtype=np.float64)


def _score_pca(values: np.ndarray) -> dict[str, Any] | None:
    if not PCA_ARTIFACT.is_file():
        return None
    artifact = json.loads(PCA_ARTIFACT.read_text(encoding="utf-8"))
    if artifact.get("modelType") != "standardized_pca_t2_spe_detector":
        raise ValueError("Unsupported PCA artifact.")
    if artifact.get("features") != [column.upper() for column in FEATURE_COLUMNS]:
        raise ValueError("PCA feature mapping does not match this service.")
    scaler = artifact["scaler"]
    pca = artifact["pca"]
    scaled = (values - np.asarray(scaler["mean"])) / np.asarray(scaler["scale"])
    centered = scaled - np.asarray(pca["mean"])
    components = np.asarray(pca["components"])
    scores = centered @ components.T
    t2 = np.sum(np.square(scores) / np.asarray(pca["explainedVariance"]), axis=1)
    reconstruction = np.asarray(pca["mean"]) + scores @ components
    spe = np.sum(np.square(centered - reconstruction), axis=1)
    limits = artifact["limits"]
    alarms = (t2 > float(limits["t2"])) | (spe > float(limits["spe"]))
    streak = 0
    for alarm in alarms:
        streak = streak + 1 if alarm else 0
    return {
        "method": "PCA T2/SPE",
        "status": "READY",
        "t2": float(t2[-1]),
        "t2Limit": float(limits["t2"]),
        "spe": float(spe[-1]),
        "speLimit": float(limits["spe"]),
        "consecutiveViolations": int(streak),
        "persistenceRequired": int(limits["persistenceConsecutiveSamples"]),
        "isAnomalous": bool(streak >= int(limits["persistenceConsecutiveSamples"])),
        "calibrationQuantile": float(limits["quantile"]),
    }


def _score_autoencoder(values: np.ndarray) -> dict[str, Any] | None:
    if not AE_ARTIFACT.is_file():
        return None
    artifact = json.loads(AE_ARTIFACT.read_text(encoding="utf-8"))
    if artifact.get("modelType") != "standardized_mlp_autoencoder":
        raise ValueError("Unsupported autoencoder artifact.")
    scaler = artifact["scaler"]
    scaled = (values - np.asarray(scaler["mean"])) / np.asarray(scaler["scale"])
    activation = scaled
    for layer in artifact["layers"]:
        activation = activation @ np.asarray(layer["weights"]) + np.asarray(layer["biases"])
        if layer["activation"] == "relu":
            activation = np.maximum(activation, 0)
    errors = np.sum(np.square(scaled - activation), axis=1)
    threshold = float(artifact["threshold"])
    streak = 0
    for error in errors:
        streak = streak + 1 if error > threshold else 0
    return {
        "method": "MLP autoencoder reconstruction error",
        "status": "READY",
        "reconstructionError": float(errors[-1]),
        "threshold": threshold,
        "consecutiveViolations": int(streak),
        "persistenceRequired": 2,
        "isAnomalous": bool(streak >= 2),
    }


def compare_detectors(history: list[dict[str, Any]]) -> dict[str, Any]:
    if len(history) > 10_000:
        raise ValueError("At most 10,000 replay samples can be scored per request.")
    values = _read_features(history)
    return {
        "source": "IMPORTED_TEP_CSV_REPLAY",
        "sampleCount": len(values),
        "pca": _score_pca(values),
        "autoencoder": _score_autoencoder(values),
        "note": "Statistical anomaly evidence only; scores do not identify a fault or represent plant safety limits.",
    }
