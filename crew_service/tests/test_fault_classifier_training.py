import tempfile
import unittest
import json
from pathlib import Path

import numpy as np
import pandas as pd

from crew_service.train_autoencoder import FEATURE_COLUMNS
from crew_service.train_fault_classifier import (
    recalibrate_fault_threshold,
    select_fault_detection_threshold,
    train_fault_classifier,
)


class FaultClassifierTrainingTests(unittest.TestCase):
    def test_threshold_uses_grouped_validation_roc_operating_point(self) -> None:
        selected = select_fault_detection_threshold([
            {"threshold": 0.0, "precision": 0.5, "recall": 1.0, "falsePositiveRate": 1.0, "f1": 0.67, "youdenJ": 0.0},
            {"threshold": 0.6, "precision": 1.0, "recall": 1.0, "falsePositiveRate": 0.0, "f1": 1.0, "youdenJ": 1.0},
            {"threshold": 0.9, "precision": 1.0, "recall": 0.5, "falsePositiveRate": 0.0, "f1": 0.67, "youdenJ": 0.5},
        ])

        self.assertEqual(selected["threshold"], 0.6)

    def test_existing_artifact_threshold_can_be_recalibrated_without_retraining(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            artifact_path = Path(temporary_directory) / "classifier.json"
            artifact_path.write_text(json.dumps({
                "modelType": "standardized_mlp_fault_classifier",
                "decisionThreshold": 0.0,
                "training": {
                    "validationThresholdSweep": [
                        {"threshold": 0.0, "precision": 0.5, "recall": 1.0, "falsePositiveRate": 1.0, "f1": 0.67},
                        {"threshold": 0.6, "precision": 1.0, "recall": 1.0, "falsePositiveRate": 0.0, "f1": 1.0},
                    ],
                },
            }), encoding="utf-8")

            artifact = recalibrate_fault_threshold(artifact_path)

            self.assertEqual(artifact["decisionThreshold"], 0.6)
            self.assertEqual(artifact["training"]["validationFaultDetectionAtThreshold"]["youdenJ"], 1.0)
            self.assertIn("maximum Youden J", artifact["training"]["thresholdSelectionObjective"])

    def test_training_uses_grouped_run_split_and_exports_validation_metrics(self) -> None:
        rng = np.random.default_rng(8)
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            normal_path = directory / "normal.csv"
            fault_path = directory / "fault.csv"
            artifact_path = directory / "classifier.json"

            rows = []
            for run_id in range(1, 11):
                for sample in range(476, 501):
                    row = {
                        "faultNumber": 0,
                        "simulationRun": run_id,
                        "sample": sample,
                    }
                    row.update(
                        {
                            feature: float(rng.normal(0, 0.1))
                            for feature in FEATURE_COLUMNS
                        }
                    )
                    rows.append(row)
            pd.DataFrame(rows).to_csv(normal_path, index=False)

            rows = []
            for run_id in range(1, 11):
                for sample in range(476, 501):
                    row = {
                        "faultNumber": 1,
                        "simulationRun": run_id,
                        "sample": sample,
                    }
                    row.update(
                        {
                            feature: float(rng.normal(3, 0.1))
                            for feature in FEATURE_COLUMNS
                        }
                    )
                    rows.append(row)
            pd.DataFrame(rows).to_csv(fault_path, index=False)

            artifact = train_fault_classifier(
                normal_path,
                fault_path,
                artifact_path,
                sample_stride=1,
                chunk_size=25,
                max_iter=3,
                hidden_layer_sizes=(8,),
            )

            self.assertTrue(artifact_path.is_file())
            self.assertEqual(artifact["modelType"], "standardized_mlp_fault_classifier")
            self.assertEqual(artifact["classes"], [0, 1])
            self.assertEqual(artifact["training"]["trainingRows"], 400)
            self.assertEqual(artifact["training"]["validationRows"], 4)
            self.assertEqual(
                artifact["training"]["datasetFiles"]["normal.csv"]["validationWindowSamples"],
                50,
            )
            self.assertEqual(artifact["training"]["datasetFiles"]["normal.csv"]["validationRunsByFault"], {0: 2})
            self.assertEqual(artifact["training"]["datasetFiles"]["fault.csv"]["validationRunsByFault"], {1: 2})
            self.assertIn("validationMacroF1", artifact["training"])

    def test_training_rejects_fault_labels_in_normal_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            normal_path = directory / "normal.csv"
            fault_path = directory / "fault.csv"
            rows = []
            for fault_id in (0, 1):
                for run_id in range(1, 6):
                    row = {
                        "faultNumber": fault_id,
                        "simulationRun": run_id,
                        "sample": 10,
                    }
                    row.update({feature: 1.0 for feature in FEATURE_COLUMNS})
                    rows.append(row)
            pd.DataFrame(rows).to_csv(normal_path, index=False)
            pd.DataFrame(rows[5:]).to_csv(fault_path, index=False)

            with self.assertRaisesRegex(ValueError, "must contain only faultNumber=0"):
                train_fault_classifier(
                    normal_path,
                    fault_path,
                    directory / "classifier.json",
                    sample_stride=1,
                    max_iter=1,
                )


if __name__ == "__main__":
    unittest.main()
