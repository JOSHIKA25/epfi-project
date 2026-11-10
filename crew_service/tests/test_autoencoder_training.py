import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from crew_service.train_autoencoder import (
    FEATURE_COLUMNS,
    split_run_ids,
    train_artifact,
)


class AutoencoderTrainingTests(unittest.TestCase):
    def test_run_split_is_disjoint_and_covers_all_runs(self) -> None:
        train_runs, calibration_runs, test_runs = split_run_ids(list(range(100)), seed=17)

        self.assertFalse(set(train_runs) & set(calibration_runs))
        self.assertFalse(set(train_runs) & set(test_runs))
        self.assertFalse(set(calibration_runs) & set(test_runs))
        self.assertEqual(set(train_runs + calibration_runs + test_runs), set(range(100)))

    def test_training_exports_calibrated_artifact_from_fault_free_data(self) -> None:
        rng = np.random.default_rng(12)
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            dataset_path = temporary_path / "normal.csv"
            artifact_path = temporary_path / "model.json"
            rows = []
            for run_id in range(6):
                for sample in range(20):
                    row = {
                        "faultNumber": 0,
                        "simulationRun": run_id,
                        "sample": sample,
                    }
                    row.update(
                        {
                            feature: float(rng.normal(index, 0.1))
                            for index, feature in enumerate(FEATURE_COLUMNS)
                        }
                    )
                    rows.append(row)
            pd.DataFrame(rows).to_csv(dataset_path, index=False)

            artifact = train_artifact(
                dataset_path,
                artifact_path,
                threshold_quantile=0.95,
                seed=7,
                max_iter=2,
            )

            self.assertTrue(artifact_path.is_file())
            self.assertEqual(artifact["modelType"], "standardized_mlp_autoencoder")
            self.assertEqual(artifact["features"], [feature.upper() for feature in FEATURE_COLUMNS])
            self.assertGreater(artifact["threshold"], 0)
            self.assertEqual(artifact["training"]["faultDetectionMetrics"], None)
            self.assertEqual(artifact["training"]["trainingRows"], 80)
            self.assertEqual(artifact["training"]["calibrationRows"], 20)
            self.assertEqual(artifact["training"]["testRows"], 20)
            self.assertTrue(np.isfinite(artifact["perFeatureErrorThresholds"]).all())

    def test_training_rejects_fault_labeled_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            dataset_path = temporary_path / "faulted.csv"
            rows = []
            for run_id in range(3):
                for sample in range(2):
                    row = {
                        "faultNumber": int(run_id == 2),
                        "simulationRun": run_id,
                        "sample": sample,
                    }
                    row.update({feature: 1.0 for feature in FEATURE_COLUMNS})
                    rows.append(row)
            pd.DataFrame(rows).to_csv(dataset_path, index=False)

            with self.assertRaisesRegex(ValueError, "fault-free normal data only"):
                train_artifact(dataset_path, temporary_path / "model.json", max_iter=1)


if __name__ == "__main__":
    unittest.main()
