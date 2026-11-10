"""Compare row-quantile alarms with run-level calibrated PCA and MLP-AE alarms.

This is a research evaluation script. It writes only under outputs/ and does not
change the detector artifacts used by the web application.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

try:  # Support both `python -m crew_service...` and direct script execution.
    from .train_autoencoder import (
        DEFAULT_DATASET,
        FEATURE_COLUMNS,
        PROJECT_ROOT,
        sha256_file,
        split_run_ids,
    )
except ImportError:  # `python crew_service/run_level_calibration_experiment.py`
    from train_autoencoder import (
        DEFAULT_DATASET,
        FEATURE_COLUMNS,
        PROJECT_ROOT,
        sha256_file,
        split_run_ids,
    )

META = ["faultNumber", "simulationRun", "sample"]
AE_ARTIFACT = PROJECT_ROOT / "server" / "ml" / "artifacts" / "tep_autoencoder.json"
DEFAULT_OUTPUT = PROJECT_ROOT / "outputs" / "run_level_calibration"


def load_autoencoder(path: Path) -> tuple[dict[str, Any], Any]:
    artifact = json.loads(path.read_text(encoding="utf-8"))
    if artifact.get("modelType") != "standardized_mlp_autoencoder":
        raise ValueError(f"Unexpected autoencoder artifact: {path}")
    mean = np.asarray(artifact["scaler"]["mean"], dtype=np.float64)
    scale = np.asarray(artifact["scaler"]["scale"], dtype=np.float64)
    layers = artifact["layers"]

    def score(values: np.ndarray) -> np.ndarray:
        normalized = (values.astype(np.float64) - mean) / scale
        activation = normalized
        for layer in layers:
            activation = activation @ np.asarray(layer["weights"], dtype=np.float64)
            activation += np.asarray(layer["biases"], dtype=np.float64)
            if layer["activation"] == "relu":
                activation = np.maximum(activation, 0)
        return np.sum(np.square(normalized - activation), axis=1)

    return artifact, score


def pca_scores(scaler: StandardScaler, pca: PCA, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    scaled = scaler.transform(values)
    projected = pca.transform(scaled)
    t2 = np.sum(np.square(projected) / pca.explained_variance_[None, :], axis=1)
    residual = scaled - pca.inverse_transform(projected)
    spe = np.sum(np.square(residual), axis=1)
    return t2, spe


def read_frame(path: Path, feature_columns: tuple[str, ...] = FEATURE_COLUMNS) -> pd.DataFrame:
    required = [*META, *feature_columns]
    frame = pd.read_csv(path, usecols=required, low_memory=False)
    if frame.empty or frame[required].isna().any().any():
        raise ValueError(f"{path.name} is empty or has missing required values")
    if not np.isfinite(frame[required].to_numpy(dtype=np.float64)).all():
        raise ValueError(f"{path.name} contains non-finite required values")
    return frame


def run_scores(
    frame: pd.DataFrame,
    pca_score: Any,
    ae_score: Any,
    feature_columns: tuple[str, ...] = FEATURE_COLUMNS,
) -> dict[tuple[int, int], dict[str, Any]]:
    values = frame.loc[:, feature_columns].to_numpy(dtype=np.float64)
    t2, spe = pca_score(values)
    ae = ae_score(values)
    meta = frame.loc[:, META].to_numpy(dtype=np.int64)
    scored = pd.DataFrame({
        "fault": meta[:, 0], "run": meta[:, 1], "sample": meta[:, 2],
        "t2": t2, "spe": spe, "ae": ae,
    })
    result: dict[tuple[int, int], dict[str, Any]] = {}
    for (fault_id, run_id), group in scored.groupby(["fault", "run"], sort=False):
        group = group.sort_values("sample")
        samples = group["sample"].to_numpy(dtype=np.int64)
        if len(samples) > 1 and not np.all(np.diff(samples) == 1):
            raise ValueError(f"Samples are missing or non-contiguous in run {fault_id}:{run_id}")
        result[(int(fault_id), int(run_id))] = {
            "faultId": int(fault_id), "runId": int(run_id),
            "samples": samples,
            "t2": group["t2"].to_numpy(dtype=np.float64),
            "spe": group["spe"].to_numpy(dtype=np.float64),
            "ae": group["ae"].to_numpy(dtype=np.float64),
        }
    return result


def persistence_alarm(scores: np.ndarray, threshold: float, persistence: int) -> np.ndarray:
    over = scores > threshold
    alarms = np.zeros(len(over), dtype=bool)
    streak = 0
    for index, is_over in enumerate(over):
        streak = streak + 1 if is_over else 0
        if streak >= persistence:
            alarms[index] = True
    return alarms


def critical_run_score(scores: np.ndarray, persistence: int) -> float:
    """Largest threshold that would still produce a persistent alarm in a run."""
    if len(scores) < persistence:
        return float("-inf")
    # For persistence=2, the maximum over adjacent pairs of their lower score.
    # General persistence uses the minimum score in each consecutive window.
    critical = float("-inf")
    for start in range(0, len(scores) - persistence + 1):
        critical = max(critical, float(np.min(scores[start : start + persistence])))
    return critical


def calibrated_threshold(run_stats: list[float], target_far: float) -> tuple[float, int]:
    if not run_stats:
        raise ValueError("No normal calibration runs available")
    allowed = math.floor(target_far * len(run_stats))
    # Alarm uses strict >. The (allowed+1)-th largest run score therefore
    # yields no more than `allowed` calibration false-alarm runs (ties can lower it).
    ordered = sorted(run_stats, reverse=True)
    index = min(allowed, len(ordered) - 1)
    return float(ordered[index]), allowed


def wilson_interval(successes: int, total: int, z: float = 1.96) -> list[float] | None:
    if total <= 0:
        return None
    proportion = successes / total
    denominator = 1.0 + z * z / total
    center = (proportion + z * z / (2.0 * total)) / denominator
    half_width = z * math.sqrt(
        proportion * (1.0 - proportion) / total + z * z / (4.0 * total * total)
    ) / denominator
    return [max(0.0, center - half_width), min(1.0, center + half_width)]


def method_scores(run: dict[str, Any], limits: dict[str, float], method: str) -> np.ndarray:
    if method == "pca":
        return np.maximum(run["t2"] / limits["t2"], run["spe"] / limits["spe"])
    ae_ratio = run["ae"] / limits["ae"]
    if method == "autoencoder":
        return ae_ratio
    if method == "fusion_max":
        pca_ratio = np.maximum(run["t2"] / limits["t2"], run["spe"] / limits["spe"])
        return np.maximum(pca_ratio, ae_ratio)
    raise ValueError(f"Unsupported method: {method}")


def calibration_run_stats(
    runs: dict[tuple[int, int], dict[str, Any]], limits: dict[str, float],
    method: str, persistence: int,
) -> list[float]:
    stats = []
    for run in runs.values():
        if run["faultId"] == 0:
            stats.append(critical_run_score(method_scores(run, limits, method), persistence))
    return stats


def summarize(
    runs: dict[tuple[int, int], dict[str, Any]], limits: dict[str, float],
    method: str, threshold: float, onset_sample: int, persistence: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    normal = [run for run in runs.values() if run["faultId"] == 0]
    faulty = [run for run in runs.values() if run["faultId"] != 0]
    normal_alarm_runs = 0
    normal_alarm_samples = 0
    normal_samples = 0
    normal_raw_violations = 0
    pre_onset_alarm_runs = 0
    detected_runs = 0
    fault_alarm_samples = 0
    post_onset_samples = 0
    fault_raw_violations = 0
    delays: list[int] = []
    rows: list[dict[str, Any]] = []

    for run in runs.values():
        scores = method_scores(run, limits, method)
        alarms = persistence_alarm(scores, threshold, persistence)
        samples = run["samples"]
        if run["faultId"] == 0:
            normal_alarm_runs += int(bool(alarms.any()))
            normal_alarm_samples += int(alarms.sum())
            normal_samples += len(alarms)
            normal_raw_violations += int((scores > threshold).sum())
            first_alarm = int(samples[np.flatnonzero(alarms)[0]]) if alarms.any() else None
            detected_at = None
            pre_alarm = False
        else:
            pre = samples < onset_sample
            post = samples >= onset_sample
            pre_alarm = bool(alarms[pre].any())
            pre_onset_alarm_runs += int(pre_alarm)
            post_alarms = alarms & post
            post_onset_samples += int(post.sum())
            fault_alarm_samples += int(post_alarms.sum())
            fault_raw_violations += int(((scores > threshold) & post).sum())
            first_alarm = int(samples[np.flatnonzero(post_alarms)[0]]) if post_alarms.any() else None
            detected_at = first_alarm
            detected_runs += int(detected_at is not None)
            if detected_at is not None:
                delays.append(detected_at - onset_sample)
        rows.append({
            "method": method, "threshold": threshold,
            "faultId": run["faultId"], "simulationRun": run["runId"],
            "isNormal": run["faultId"] == 0,
            "preOnsetFalseAlarm": pre_alarm,
            "detectedAfterOnset": detected_at is not None,
            "firstRelevantAlarmSample": first_alarm,
            "delaySamples": (detected_at - onset_sample) if detected_at is not None else None,
            "sampleCount": len(samples),
        })

    per_fault = []
    for fault_id in sorted({run["faultId"] for run in faulty}):
        subset = [row for row in rows if row["faultId"] == fault_id]
        n_detected = sum(row["detectedAfterOnset"] for row in subset)
        per_fault.append({
            "faultId": fault_id, "runs": len(subset), "detectedRuns": n_detected,
            "faultDetectionRate": n_detected / max(1, len(subset)),
        })

    report = {
        "method": method,
        "threshold": threshold,
        "evaluationUnit": "whole simulation run; persistent alarm requires consecutive violations",
        "normalRuns": len(normal),
        "normalRunsWithFalseAlarm": normal_alarm_runs,
        "normalRunFalseAlarmRate": normal_alarm_runs / max(1, len(normal)),
        "normalRunFalseAlarmRateWilson95": wilson_interval(normal_alarm_runs, len(normal)),
        "normalPersistentAlarmSampleRate": normal_alarm_samples / max(1, normal_samples),
        "normalRawThresholdViolationRate": normal_raw_violations / max(1, normal_samples),
        "faultRuns": len(faulty),
        "faultRunsDetectedAfterOnset": detected_runs,
        "faultDetectionRate": detected_runs / max(1, len(faulty)),
        "faultDetectionRateWilson95": wilson_interval(detected_runs, len(faulty)),
        "faultSamplesAlarmedAfterOnsetRate": fault_alarm_samples / max(1, post_onset_samples),
        "faultRawThresholdViolationRateAfterOnset": fault_raw_violations / max(1, post_onset_samples),
        "faultRunsWithPreOnsetAlarm": pre_onset_alarm_runs,
        "assumedFaultOnsetSample": onset_sample,
        "meanDetectionDelaySamples": float(np.mean(delays)) if delays else None,
        "medianDetectionDelaySamples": float(np.median(delays)) if delays else None,
        "detectedRunsUsedForDelay": len(delays),
        "perFault": per_fault,
    }
    return report, rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--normal-training", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--normal-testing", type=Path, default=PROJECT_ROOT / "fault_free_testing.csv")
    parser.add_argument("--fault-testing", type=Path, default=PROJECT_ROOT / "faulty_testing.csv")
    parser.add_argument("--autoencoder-artifact", type=Path, default=AE_ARTIFACT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--row-quantile", type=float, default=0.995)
    parser.add_argument("--target-run-far", type=float, default=0.05)
    parser.add_argument("--persistence", type=int, default=2)
    parser.add_argument("--onset-sample", type=int, default=161)
    args = parser.parse_args()

    if not 0.0 < args.target_run_far < 0.5:
        raise ValueError("Target run FAR must be between 0 and 0.5")
    if not 0.9 < args.row_quantile < 1.0:
        raise ValueError("Row quantile must be between 0.90 and 1.0")

    normal_train = read_frame(args.normal_training)
    if sorted(normal_train["faultNumber"].unique().tolist()) != [0]:
        raise ValueError("The model-fit dataset must contain only faultNumber=0")
    train_ids, calibration_ids, holdout_ids = split_run_ids(
        normal_train["simulationRun"].astype(int).unique().tolist(), args.seed
    )
    train = normal_train[normal_train["simulationRun"].isin(train_ids)]
    calibration = normal_train[normal_train["simulationRun"].isin(calibration_ids)]
    holdout = normal_train[normal_train["simulationRun"].isin(holdout_ids)]

    scaler = StandardScaler().fit(train.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float64))
    pca = PCA(n_components=0.95, svd_solver="full").fit(
        scaler.transform(train.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float64))
    )
    pca_score = lambda values: pca_scores(scaler, pca, values)
    ae_artifact, ae_score = load_autoencoder(args.autoencoder_artifact)

    # Fail closed if this comparison would mix a different model-training split.
    expected_hash = sha256_file(args.normal_training)
    ae_training = ae_artifact.get("training", {})
    if ae_training.get("datasetSha256") != expected_hash:
        raise ValueError("Autoencoder artifact was trained from a different normal-training CSV")
    if ae_training.get("seed") != args.seed or ae_training.get("trainingRuns") != len(train_ids):
        raise ValueError("Autoencoder training split metadata does not match this experiment")
    if ae_training.get("calibrationRuns") != len(calibration_ids):
        raise ValueError("Autoencoder calibration split metadata does not match this experiment")

    cal_runs = run_scores(calibration, pca_score, ae_score)
    holdout_runs = run_scores(holdout, pca_score, ae_score)
    normal_test = read_frame(args.normal_testing)
    fault_test = read_frame(args.fault_testing)
    test_runs = run_scores(pd.concat([normal_test, fault_test], ignore_index=True), pca_score, ae_score)

    pca_cal_t2, pca_cal_spe = pca_score(calibration.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float64))
    ae_cal_errors = ae_score(calibration.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float64))
    limits = {
        "t2": float(np.quantile(pca_cal_t2, args.row_quantile, method="higher")),
        "spe": float(np.quantile(pca_cal_spe, args.row_quantile, method="higher")),
        "ae": float(ae_artifact["threshold"]),
    }

    reports: list[dict[str, Any]] = []
    run_rows: list[dict[str, Any]] = []
    thresholds: dict[str, dict[str, Any]] = {}
    for method in ("pca", "autoencoder", "fusion_max"):
        cal_stats = calibration_run_stats(cal_runs, limits, method, args.persistence)
        multiplier, allowed_false_runs = calibrated_threshold(cal_stats, args.target_run_far)
        cal_report, _ = summarize(cal_runs, limits, method, multiplier, args.onset_sample, args.persistence)
        holdout_report, holdout_rows = summarize(holdout_runs, limits, method, multiplier, args.onset_sample, args.persistence)
        test_report, test_rows = summarize(test_runs, limits, method, multiplier, args.onset_sample, args.persistence)
        baseline_threshold = 1.0
        baseline_cal, _ = summarize(cal_runs, limits, method, baseline_threshold, args.onset_sample, args.persistence)
        baseline_holdout, baseline_holdout_rows = summarize(holdout_runs, limits, method, baseline_threshold, args.onset_sample, args.persistence)
        baseline_test, baseline_test_rows = summarize(test_runs, limits, method, baseline_threshold, args.onset_sample, args.persistence)
        thresholds[method] = {
            "rowLevelReferenceLimits": (
                limits if method in ("pca", "fusion_max")
                else {"ae": limits["ae"]}
            ),
            "runLevelMultiplier": multiplier,
            "targetCalibrationRunFar": args.target_run_far,
            "allowedFalseAlarmRunsInCalibration": allowed_false_runs,
            "calibrationRunCount": len(cal_stats),
            "achievedCalibrationFalseAlarmRuns": cal_report["normalRunsWithFalseAlarm"],
            "achievedCalibrationRunFar": cal_report["normalRunFalseAlarmRate"],
        }
        reports.extend([
            {"split": "baseline_calibration", **baseline_cal},
            {"split": "run_calibrated_calibration", **cal_report},
            {"split": "baseline_normal_holdout", **baseline_holdout},
            {"split": "run_calibrated_normal_holdout", **holdout_report},
            {"split": "baseline_heldout_test", **baseline_test},
            {"split": "run_calibrated_heldout_test", **test_report},
        ])
        for rows, split_name in (
            (baseline_holdout_rows, "baseline_normal_holdout"),
            (holdout_rows, "run_calibrated_normal_holdout"),
            (baseline_test_rows, "baseline_heldout_test"),
            (test_rows, "run_calibrated_heldout_test"),
        ):
            for row in rows:
                run_rows.append({"split": split_name, **row})

    output = {
        "experiment": "Run-level false-alarm calibration of normal-only PCA and MLP autoencoder",
        "claimStatus": "experimental candidate; not a validated novelty claim",
        "configuration": {
            "normalTrainingCsv": str(args.normal_training),
            "normalTestingCsv": str(args.normal_testing),
            "faultTestingCsv": str(args.fault_testing),
            "normalTrainingSha256": expected_hash,
            "seed": args.seed,
            "featureCount": len(FEATURE_COLUMNS),
            "features": [column.upper() for column in FEATURE_COLUMNS],
            "pcaComponents": int(pca.n_components_),
            "rowQuantileForReferenceLimits": args.row_quantile,
            "targetRunFalseAlarmRate": args.target_run_far,
            "persistenceConsecutiveSamples": args.persistence,
            "faultOnsetSampleAssumption": args.onset_sample,
            "trainRuns": len(train_ids), "calibrationRuns": len(calibration_ids),
            "independentNormalHoldoutRuns": len(holdout_ids),
            "normalTestRuns": int(normal_test[["faultNumber", "simulationRun"]].drop_duplicates().shape[0]),
            "faultTestRuns": int(fault_test[["faultNumber", "simulationRun"]].drop_duplicates().shape[0]),
        },
        "thresholds": thresholds,
        "results": reports,
        "limitations": [
            "The run-level threshold is calibrated on only the available normal calibration runs; FAR resolution is coarse.",
            "The target is an empirical calibration target, not a guarantee on future runs.",
            "Fault onset is assumed from the dataset convention and should be verified for this exact CSV release.",
            "The 38-feature models are not an exact reproduction of papers using all 52 TEP variables.",
            "Fusion is a simple maximum of normalized anomaly scores, not a learned fusion model.",
            "TEP is simulated data and results do not establish plant performance.",
            "Use separate reviewed fault ground truth before describing sensor rankings as root causes.",
        ],
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    json_path = args.output_dir / "results.json"
    csv_path = args.output_dir / "run_results.csv"
    json_path.write_text(json.dumps(output, indent=2, allow_nan=False), encoding="utf-8")
    with csv_path.open("w", newline="", encoding="utf-8") as target:
        if run_rows:
            writer = csv.DictWriter(target, fieldnames=list(run_rows[0].keys()))
            writer.writeheader()
            writer.writerows(run_rows)
    print(json.dumps({"results": str(json_path), "perRunResults": str(csv_path), "summary": reports}, indent=2))


if __name__ == "__main__":
    main()
