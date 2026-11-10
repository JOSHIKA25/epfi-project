"""Fit a normal-only PCA detector and compare it with the existing MLP autoencoder."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from .train_autoencoder import FEATURE_COLUMNS, PROJECT_ROOT, sha256_file, split_run_ids

DEFAULT_ARTIFACT = PROJECT_ROOT / "server" / "ml" / "artifacts" / "tep_pca_detector_52.json"
AE_ARTIFACT = PROJECT_ROOT / "server" / "ml" / "artifacts" / "tep_autoencoder_52.json"
META = ["faultNumber", "simulationRun", "sample"]


def _pca_scores(scaler: StandardScaler, pca: PCA, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    scaled = scaler.transform(values)
    scores = pca.transform(scaled)
    t2 = np.sum(np.square(scores) / pca.explained_variance_[None, :], axis=1)
    reconstructed = pca.inverse_transform(scores)
    spe = np.sum(np.square(scaled - reconstructed), axis=1)
    return t2, spe


def _make_autoencoder_score(artifact_path: Path) -> tuple[Callable[[np.ndarray], np.ndarray], float] | None:
    if not artifact_path.is_file():
        return None
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    if artifact.get("modelType") != "standardized_mlp_autoencoder":
        return None
    mean = np.asarray(artifact["scaler"]["mean"], dtype=np.float64)
    scale = np.asarray(artifact["scaler"]["scale"], dtype=np.float64)
    layers = artifact["layers"]

    def score(values: np.ndarray) -> np.ndarray:
        activation = (values.astype(np.float64) - mean) / scale
        for layer in layers:
            activation = activation @ np.asarray(layer["weights"]) + np.asarray(layer["biases"])
            if layer["activation"] == "relu":
                activation = np.maximum(activation, 0)
        return np.sum(np.square((values.astype(np.float64) - mean) / scale - activation), axis=1)

    return score, float(artifact["threshold"])


def _evaluate_files(
    paths: list[Path],
    *,
    chunk_size: int,
    score: Callable[[np.ndarray], tuple[np.ndarray, np.ndarray]],
    t2_limit: float,
    spe_limit: float,
    ae_score: Callable[[np.ndarray], np.ndarray] | None,
    ae_limit: float | None,
    persistence: int,
    onset_sample: int,
) -> dict[str, Any]:
    # Per-run state is small, while CSV rows are processed in bounded chunks.
    states: dict[tuple[int, int], dict[str, Any]] = {}
    sample_counts = {"pca": {"normal": 0, "falseAlarms": 0, "fault": 0, "detected": 0},
                     "autoencoder": {"normal": 0, "falseAlarms": 0, "fault": 0, "detected": 0}}
    usecols = [*META, *FEATURE_COLUMNS]
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(f"Evaluation CSV not found: {path}")
        for frame in pd.read_csv(path, usecols=usecols, chunksize=chunk_size, low_memory=False):
            if frame.empty:
                continue
            meta = frame.loc[:, META].to_numpy(dtype=np.float64)
            values = frame.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float32)
            if not np.isfinite(meta).all() or not np.isfinite(values).all():
                raise ValueError(f"Missing or invalid values found in {path.name}.")
            fault_ids = meta[:, 0].astype(np.int32)
            run_ids = meta[:, 1].astype(np.int64)
            samples = meta[:, 2].astype(np.int64)
            t2, spe = score(values)
            ae_errors = ae_score(values) if ae_score is not None else None
            for row, fault_id, run_id, sample in zip(range(len(frame)), fault_ids, run_ids, samples):
                key = (int(fault_id), int(run_id))
                state = states.setdefault(key, {
                    "faultId": int(fault_id), "runId": int(run_id), "samples": 0,
                    "pcaStreak": 0, "pcaLastSample": None, "pcaDetectedAt": None,
                    "aeStreak": 0, "aeLastSample": None, "aeDetectedAt": None,
                })
                state["samples"] += 1
                pca_alarm = bool(t2[row] > t2_limit or spe[row] > spe_limit)
                _advance_state(state, "pca", int(sample), pca_alarm, persistence)
                if int(fault_id) == 0:
                    sample_counts["pca"]["normal"] += 1
                    sample_counts["pca"]["falseAlarms"] += int(pca_alarm)
                else:
                    sample_counts["pca"]["fault"] += 1
                    sample_counts["pca"]["detected"] += int(pca_alarm)

                if ae_errors is not None and ae_limit is not None:
                    ae_alarm = bool(ae_errors[row] > ae_limit)
                    _advance_state(state, "ae", int(sample), ae_alarm, persistence)
                    if int(fault_id) == 0:
                        sample_counts["autoencoder"]["normal"] += 1
                        sample_counts["autoencoder"]["falseAlarms"] += int(ae_alarm)
                    else:
                        sample_counts["autoencoder"]["fault"] += 1
                        sample_counts["autoencoder"]["detected"] += int(ae_alarm)

    if not states:
        raise ValueError("No complete evaluation data was read.")
    return _summarize_runs(states, sample_counts, ae_score is not None, onset_sample)


def _advance_state(state: dict[str, Any], prefix: str, sample: int, alarm: bool, persistence: int) -> None:
    last_sample = state[f"{prefix}LastSample"]
    streak = state[f"{prefix}Streak"]
    streak = streak + 1 if alarm and (last_sample is None or sample == last_sample + 1) else (1 if alarm else 0)
    state[f"{prefix}Streak"] = streak
    state[f"{prefix}LastSample"] = sample
    if streak >= persistence and state[f"{prefix}DetectedAt"] is None:
        state[f"{prefix}DetectedAt"] = sample


def _summarize_runs(states: dict[tuple[int, int], dict[str, Any]], sample_counts: dict[str, Any], has_ae: bool, onset: int) -> dict[str, Any]:
    reports: dict[str, Any] = {}
    for name, prefix in (("pca", "pca"), ("autoencoder", "ae")):
        if name == "autoencoder" and not has_ae:
            continue
        normal = [state for state in states.values() if state["faultId"] == 0]
        faulty = [state for state in states.values() if state["faultId"] != 0]
        false_alarms = sum(state[f"{prefix}DetectedAt"] is not None for state in normal)
        detected = [state for state in faulty if state[f"{prefix}DetectedAt"] is not None]
        delays = [state[f"{prefix}DetectedAt"] - onset for state in detected if state[f"{prefix}DetectedAt"] >= onset]
        per_fault = []
        for fault_id in sorted({state["faultId"] for state in faulty}):
            subset = [state for state in faulty if state["faultId"] == fault_id]
            count_detected = sum(state[f"{prefix}DetectedAt"] is not None for state in subset)
            per_fault.append({
                "faultId": fault_id,
                "runs": len(subset),
                "detectedRuns": count_detected,
                "faultDetectionRate": count_detected / max(1, len(subset)),
            })
        sc = sample_counts[name]
        reports[name] = {
            "evaluationUnit": "whole simulation run; alarm requires consecutive sample violations",
            "runs": len(states),
            "normalRuns": len(normal),
            "faultRuns": len(faulty),
            "detectedFaultRuns": len(detected),
            "faultDetectionRate": len(detected) / max(1, len(faulty)),
            "falseAlarmRuns": false_alarms,
            "falseAlarmRate": false_alarms / max(1, len(normal)),
            "sampleLevelFaultDetectionRate": sc["detected"] / max(1, sc["fault"]),
            "sampleLevelFalseAlarmRate": sc["falseAlarms"] / max(1, sc["normal"]),
            "faultOnsetSampleAssumption": onset,
            "meanDetectionDelaySamplesAfterOnset": float(np.mean(delays)) if delays else None,
            "perFault": per_fault,
        }
    return reports


def train_and_evaluate(
    normal_training: Path,
    normal_testing: Path,
    fault_testing: Path,
    artifact_path: Path,
    *,
    calibration_quantile: float = 0.995,
    seed: int = 42,
    chunk_size: int = 100_000,
    persistence: int = 2,
    fault_onset_sample: int = 160,
) -> dict[str, Any]:
    if not 0.9 < calibration_quantile < 1.0:
        raise ValueError("Calibration quantile must be between 0.90 and 1.0.")
    if persistence < 1:
        raise ValueError("Persistence must be at least one sample.")
    required = ["faultNumber", "simulationRun", "sample", *FEATURE_COLUMNS]
    frame = pd.read_csv(normal_training, usecols=required, low_memory=False)
    if frame.empty or frame.isna().any().any():
        raise ValueError("Normal training CSV is empty or contains missing values.")
    if sorted(int(value) for value in frame["faultNumber"].unique()) != [0]:
        raise ValueError("PCA training requires fault-free data only (faultNumber=0).")
    train_runs, calibration_runs, normal_holdout_runs = split_run_ids(
        [int(value) for value in frame["simulationRun"].unique()], seed
    )
    train_frame = frame[frame["simulationRun"].isin(train_runs)]
    calibration_frame = frame[frame["simulationRun"].isin(calibration_runs)]
    holdout_frame = frame[frame["simulationRun"].isin(normal_holdout_runs)]
    scaler = StandardScaler().fit(train_frame.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float64))
    pca = PCA(n_components=0.95, svd_solver="full")
    pca.fit(scaler.transform(train_frame.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float64)))
    cal_t2, cal_spe = _pca_scores(scaler, pca, calibration_frame.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float64))
    holdout_t2, holdout_spe = _pca_scores(scaler, pca, holdout_frame.loc[:, FEATURE_COLUMNS].to_numpy(dtype=np.float64))
    t2_limit = float(np.quantile(cal_t2, calibration_quantile, method="higher"))
    spe_limit = float(np.quantile(cal_spe, calibration_quantile, method="higher"))
    ae = _make_autoencoder_score(AE_ARTIFACT)
    pca_score = lambda values: _pca_scores(scaler, pca, values)
    evaluation = _evaluate_files(
        [normal_testing, fault_testing], chunk_size=chunk_size, score=pca_score,
        t2_limit=t2_limit, spe_limit=spe_limit,
        ae_score=ae[0] if ae else None, ae_limit=ae[1] if ae else None,
        persistence=persistence, onset_sample=fault_onset_sample,
    )
    artifact: dict[str, Any] = {
        "formatVersion": 1,
        "modelType": "standardized_pca_t2_spe_detector",
        "features": [column.upper() for column in FEATURE_COLUMNS],
        "scaler": {"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()},
        "pca": {
            "mean": pca.mean_.tolist(),
            "components": pca.components_.tolist(),
            "explainedVariance": pca.explained_variance_.tolist(),
            "explainedVarianceRatio": pca.explained_variance_ratio_.tolist(),
        },
        "limits": {"t2": t2_limit, "spe": spe_limit, "quantile": calibration_quantile,
                   "persistenceConsecutiveSamples": persistence},
        "training": {
            "dataset": normal_training.name,
            "datasetSha256": sha256_file(normal_training),
            "seed": seed,
            "trainingRuns": len(train_runs),
            "calibrationRuns": len(calibration_runs),
            "normalHoldoutRuns": len(normal_holdout_runs),
            "trainingRows": len(train_frame),
            "calibrationRows": len(calibration_frame),
            "normalHoldoutRows": len(holdout_frame),
            "normalHoldoutT2FalseAlarmRate": float(np.mean(holdout_t2 > t2_limit)),
            "normalHoldoutSPEFalseAlarmRate": float(np.mean(holdout_spe > spe_limit)),
            "faultOnsetSampleAssumption": fault_onset_sample,
        },
        "evaluation": evaluation,
        "sourceAndLicense": "User-provided TEP CSV; citation/license confirmation pending.",
        "limitations": [
            "PCA T2/SPE flags unusual telemetry; it does not identify the fault class.",
            "Limits are calibrated on normal simulation runs, not site alarm limits.",
            "Fault-onset sample is an explicit benchmark assumption and must match this dataset version.",
            "TEP is simulated benchmark data and does not validate performance on a physical plant.",
        ],
    }
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    temp = artifact_path.with_suffix(artifact_path.suffix + ".tmp")
    temp.write_text(json.dumps(artifact, indent=2, allow_nan=False), encoding="utf-8")
    temp.replace(artifact_path)
    return {"artifactPath": str(artifact_path), **artifact}


def main() -> None:
    parser = argparse.ArgumentParser(description="Train PCA T2/SPE limits and compare against the TEP MLP autoencoder.")
    parser.add_argument("--normal-training", type=Path, default=PROJECT_ROOT / "TEP_FaultFree_Training.csv")
    parser.add_argument("--normal-testing", type=Path, default=PROJECT_ROOT / "fault_free_testing.csv")
    parser.add_argument("--fault-testing", type=Path, default=PROJECT_ROOT / "faulty_testing.csv")
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--quantile", type=float, default=0.995)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--chunk-size", type=int, default=100_000)
    parser.add_argument("--persistence", type=int, default=2)
    parser.add_argument("--fault-onset-sample", type=int, default=160)
    args = parser.parse_args()
    report = train_and_evaluate(
        args.normal_training, args.normal_testing, args.fault_testing, args.artifact,
        calibration_quantile=args.quantile, seed=args.seed, chunk_size=args.chunk_size,
        persistence=args.persistence, fault_onset_sample=args.fault_onset_sample,
    )
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
