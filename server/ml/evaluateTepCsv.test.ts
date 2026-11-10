import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { evaluateTepCsvFiles } from './evaluateTepCsv.ts';
import { TEP_CLASSIFIER_FEATURES } from './tepFaultClassifier.ts';

const features = TEP_CLASSIFIER_FEATURES.map((feature) => feature.toLowerCase());
const header = ['faultNumber', 'simulationRun', 'sample', ...features].join(',');

function csvRow(faultId: number, runId: number, sample: number): string {
  return [
    faultId,
    runId,
    sample,
    ...features.map((feature) => (feature === 'xmeas_1' ? String(faultId) : '1')),
  ].join(',');
}

test('groups ordered CSV rows by run and scores each completed run once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tep-csv-eval-'));
  const filePath = join(directory, 'test.csv');
  try {
    await writeFile(
      filePath,
      [
        header,
        csvRow(0, 1, 1),
        csvRow(0, 1, 2),
        csvRow(6, 1, 1),
        csvRow(6, 1, 2),
      ].join('\n'),
    );

    const result = await evaluateTepCsvFiles([filePath], (history) => {
      assert.equal(history.length, 2);
      return history.at(-1)?.values.XMEAS_1 === 0 ? 0 : 6;
    });

    assert.equal(result.runCount, 2);
    assert.equal(result.accuracy, 1);
    assert.equal(result.faultDetection.truePositive, 1);
    assert.equal(result.faultDetection.trueNegative, 1);
    assert.equal(result.files[0].rows, 4);
    assert.equal(result.files[0].runs, 2);
    assert.deepEqual(result.files[0].faultIds, [0, 6]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a run that reappears after another run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tep-csv-eval-'));
  const filePath = join(directory, 'out-of-order.csv');
  try {
    await writeFile(
      filePath,
      [
        header,
        csvRow(0, 1, 1),
        csvRow(6, 1, 1),
        csvRow(0, 1, 2),
      ].join('\n'),
    );

    await assert.rejects(
      evaluateTepCsvFiles([filePath], () => 0),
      /not ordered contiguously/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
