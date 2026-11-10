"""Extract a single labeled held-out TEP run as a replay-only CSV.

The exported file intentionally omits faultNumber and simulationRun so the
application prediction does not receive benchmark labels or identifiers.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from crew_service.train_autoencoder import FEATURE_COLUMNS_52, PROJECT_ROOT


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=PROJECT_ROOT / "faulty_testing.csv")
    parser.add_argument("--output", type=Path, default=PROJECT_ROOT / "public" / "demo" / "tep_fault_replay.csv")
    parser.add_argument("--fault-id", type=int, default=10)
    parser.add_argument("--run-id", type=int, default=1)
    args = parser.parse_args()

    columns = ["faultNumber", "simulationRun", "sample", *FEATURE_COLUMNS_52]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.unlink(missing_ok=True)
    rows_written = 0
    for chunk in pd.read_csv(args.input, usecols=columns, chunksize=100_000, low_memory=False):
        selected = chunk.loc[
            (chunk["faultNumber"] == args.fault_id) & (chunk["simulationRun"] == args.run_id),
            ["sample", *FEATURE_COLUMNS_52],
        ]
        if selected.empty:
            continue
        selected = selected.sort_values("sample")
        selected = selected.rename(columns={"sample": "timestamp"})
        selected.to_csv(args.output, mode="a", index=False, header=rows_written == 0)
        rows_written += len(selected)

    if rows_written != 960:
        args.output.unlink(missing_ok=True)
        raise RuntimeError(f"Expected one 960-sample TEP test run; extracted {rows_written} rows.")
    print(f"Wrote {rows_written} unlabeled replay rows to {args.output} ({args.output.stat().st_size:,} bytes).")


if __name__ == "__main__":
    main()
