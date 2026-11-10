"""Load the trained TEP XGBoost model and return prediction plus TreeSHAP evidence."""

from __future__ import annotations

import json
import joblib
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import shap
import xgboost as xgb

from .train_xgboost_classifier import (
    FEATURE_COLUMNS,
    WINDOW_SIZE,
    _window_features,
)
from .alarm_time_pipeline_experiment import persistent_alarm, score_detector

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVING_DIR = PROJECT_ROOT / "outputs" / "alarm_time_pipeline_52_delay250_internal_holdout_fallback" / "serving_model"


@lru_cache(maxsize=1)
def _load_model() -> tuple[xgb.XGBClassifier, dict[str, Any], shap.TreeExplainer]:
    metadata_path = SERVING_DIR / "metadata.json"
    if not metadata_path.is_file():
        raise FileNotFoundError("Train the XGBoost model before requesting predictions.")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("modelType") != "tep_alarm_time_xgboost":
        raise ValueError("Unsupported TEP classifier artifact.")
    if metadata.get("featureColumns") != [column.upper() for column in FEATURE_COLUMNS]:
        raise ValueError("Alarm-time classifier feature schema does not match the 52-variable replay service.")
    model_path = SERVING_DIR / "classifier.json"
    if not model_path.is_file():
        raise FileNotFoundError(f"XGBoost model file is missing: {model_path.name}")
    model = xgb.XGBClassifier()
    model.load_model(model_path)
    explainer = shap.TreeExplainer(model)
    return model, metadata, explainer


def _read_window(history: list[dict[str, Any]]) -> np.ndarray:
    if len(history) < WINDOW_SIZE:
        raise ValueError(f"At least {WINDOW_SIZE} consecutive telemetry samples are required.")
    selected = history[-WINDOW_SIZE:]
    rows: list[list[float]] = []
    for sample_index, sample in enumerate(selected):
        values = sample.get("values", sample)
        if not isinstance(values, dict):
            raise ValueError(f"Telemetry sample {sample_index} has no values mapping.")
        row = []
        for column in FEATURE_COLUMNS:
            key = column.upper()
            value = values.get(key, values.get(column))
            if not isinstance(value, (int, float)) or not np.isfinite(value):
                raise ValueError(f"Telemetry sample {sample_index} is missing finite {key}.")
            row.append(float(value))
        rows.append(row)
    return _window_features(np.asarray(rows, dtype=np.float32))[None, :]


def _tree_shap_vector(explainer: shap.TreeExplainer, matrix: np.ndarray, class_index: int) -> np.ndarray:
    raw = explainer.shap_values(matrix, check_additivity=False)
    if isinstance(raw, list):
        return np.asarray(raw[class_index])[0]
    values = np.asarray(raw)
    if values.ndim == 3:
        if values.shape[0] == 1 and values.shape[2] > class_index:
            return values[0, :, class_index]
        if values.shape[0] > class_index and values.shape[1] == 1:
            return values[class_index, 0, :]
    if values.ndim == 2 and values.shape[0] == 1:
        return values[0]
    raise ValueError(f"Unexpected TreeSHAP result shape: {values.shape}.")


def predict_with_explanation(history: list[dict[str, Any]]) -> dict[str, Any]:
    model, metadata, explainer = _load_model()
    matrix = _read_window(history)
    probabilities = model.predict_proba(matrix)[0]
    class_ids = [int(value) for value in metadata["classes"]]
    if len(probabilities) != len(class_ids):
        raise ValueError("Model output classes do not match the artifact metadata.")
    best_index = int(np.argmax(probabilities))
    fault_id = class_ids[best_index]
    class_confidence = float(probabilities[best_index])
    selected_index = best_index

    values = _tree_shap_vector(explainer, matrix, selected_index)
    names = metadata["features"]
    by_sensor: dict[str, float] = {}
    feature_rows = []
    for name, contribution in zip(names, values):
        sensor = name.split("__", 1)[1]
        score = float(contribution)
        by_sensor[sensor] = by_sensor.get(sensor, 0.0) + score
        feature_rows.append({"feature": name, "contribution": score})
    top_features = sorted(feature_rows, key=lambda row: abs(row["contribution"]), reverse=True)[:12]
    top_sensors = sorted(
        ({"sensor": sensor, "contribution": value} for sensor, value in by_sensor.items()),
        key=lambda row: abs(row["contribution"]),
        reverse=True,
    )[:8]
    ranked = sorted(
        ({"faultId": fault_id_value, "score": float(probabilities[index])}
         for index, fault_id_value in enumerate(class_ids)),
        key=lambda item: item["score"], reverse=True,
    )
    return {
        "model": "XGBoost",
        "status": "FAULT_CANDIDATE",
        "faultId": fault_id,
        "candidateFaultId": fault_id,
        "code": f"IDV-{fault_id:02d}",
        "faultScore": 1.0,
        "classConfidence": class_confidence,
        "faultDecisionThreshold": 0.0,
        "classConfidenceThreshold": 0.0,
        "probabilities": ranked,
        "windowSize": WINDOW_SIZE,
        "explanationMethod": "TreeSHAP",
        "explanationOutput": "class output contributions from the trained XGBoost model",
        "topFeatures": top_features,
        "topSensors": top_sensors,
        "validation": {
            "status": "ALARM_TIME_CLASSIFIER_VALIDATION",
            "faultDetectionRate": metadata.get("heldOutEvaluation", {}).get("fdr", 0.0),
            "falseAlarmRate": metadata.get("heldOutEvaluation", {}).get("far", 0.0),
        },
    }


def detect_then_diagnose(history: list[dict[str, Any]], *, final_replay: bool = False) -> dict[str, Any]:
    """Find the first persistent AE alarm, then classify its configured evidence window."""
    if not history:
        raise ValueError("Provide telemetry history from one TEP run.")
    metadata_path = SERVING_DIR / "metadata.json"
    detector_path = SERVING_DIR / "detector.joblib"
    if not metadata_path.is_file() or not detector_path.is_file():
        raise FileNotFoundError("Train the 52-variable alarm-time pipeline before running replay diagnosis.")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("featureSet") != "52":
        raise ValueError("The live replay bundle is not configured for all 52 TEP variables.")
    detector = joblib.load(detector_path)
    values = []
    for index, sample in enumerate(history):
        row = sample.get("values", sample)
        values.append([float(row.get(column.upper(), row.get(column))) for column in FEATURE_COLUMNS])
    matrix = np.asarray(values, dtype=np.float64)
    if not np.isfinite(matrix).all():
        raise ValueError("Replay contains missing or non-finite values among the 52 TEP variables.")
    scores = score_detector(matrix, detector)["ae"]
    alarms = persistent_alarm(scores, float(metadata["autoencoderThreshold"]), int(metadata["persistence"]))
    positions = np.flatnonzero(alarms)
    if not len(positions):
        return {
            "status": "NO_PERSISTENT_ALARM", "featureCount": len(FEATURE_COLUMNS),
            "sampleCount": len(history), "threshold": float(metadata["autoencoderThreshold"]),
            "latestScore": float(scores[-1]), "firstAlarmIndex": None, "diagnosis": None,
        }
    alarm_index = int(positions[0])
    if alarm_index + 1 < WINDOW_SIZE:
        return {
            "status": "ALARM_WINDOW_UNAVAILABLE", "featureCount": len(FEATURE_COLUMNS),
            "sampleCount": len(history), "threshold": float(metadata["autoencoderThreshold"]),
            "latestScore": float(scores[alarm_index]), "firstAlarmIndex": alarm_index,
            "diagnosis": None,
        }
    diagnosis_delay = max(0, int(metadata.get("diagnosisDelaySamples", 0)))
    diagnosis_end = alarm_index + diagnosis_delay
    delay_fallback = diagnosis_end >= len(history) and final_replay
    if diagnosis_end >= len(history) and not final_replay:
        return {
            "status": "DIAGNOSIS_PENDING", "featureCount": len(FEATURE_COLUMNS),
            "sampleCount": len(history), "threshold": float(metadata["autoencoderThreshold"]),
            "latestScore": float(scores[-1]), "firstAlarmIndex": alarm_index,
            "alarmScore": float(scores[alarm_index]), "persistenceRequired": int(metadata["persistence"]),
            "diagnosisDelaySamples": diagnosis_delay,
            "diagnosisReadyAtIndex": diagnosis_end,
            "diagnosis": None,
        }
    if delay_fallback:
        diagnosis_end = len(history) - 1
    if diagnosis_end + 1 < WINDOW_SIZE:
        return {
            "status": "ALARM_WINDOW_UNAVAILABLE", "featureCount": len(FEATURE_COLUMNS),
            "sampleCount": len(history), "threshold": float(metadata["autoencoderThreshold"]),
            "latestScore": float(scores[-1]), "firstAlarmIndex": alarm_index,
            "alarmScore": float(scores[alarm_index]), "persistenceRequired": int(metadata["persistence"]),
            "diagnosisDelaySamples": diagnosis_delay, "diagnosis": None,
        }
    diagnosis = predict_with_explanation(history[:diagnosis_end + 1])
    return {
        "status": "PERSISTENT_ALARM", "featureCount": len(FEATURE_COLUMNS),
        "sampleCount": len(history), "threshold": float(metadata["autoencoderThreshold"]),
        "firstAlarmIndex": alarm_index, "alarmScore": float(scores[alarm_index]),
        "persistenceRequired": int(metadata["persistence"]),
        "diagnosisDelaySamples": diagnosis_delay,
        "diagnosisDelayFallback": delay_fallback,
        "diagnosisReadyAtIndex": diagnosis_end,
        "windowStartIndex": diagnosis_end - WINDOW_SIZE + 1, "windowEndIndex": diagnosis_end,
        "diagnosis": diagnosis,
    }
