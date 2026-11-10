import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AutoencoderDetector } from './autoencoder.ts';
import { evaluateLabeledSamples } from './evaluateAutoencoder.ts';

interface AutoencoderArtifactMetadata {
  features: string[];
  scaler: {
    mean: number[];
    scale: number[];
  };
}

const artifact: AutoencoderArtifactMetadata = JSON.parse(
  readFileSync(new URL('./artifacts/tep_autoencoder.json', import.meta.url), 'utf8')
);
const representativeTelemetry = Object.fromEntries(
  artifact.features.map((feature, index) => [feature, artifact.scaler.mean[index]])
);

test('autoencoder returns finite scores and calibrated training metadata', () => {
  const report = new AutoencoderDetector().analyze(representativeTelemetry);

  assert.equal(report.attributions.length, 38);
  assert.equal(report.calibrationQuantile, 0.995);
  assert.ok(report.trainingRunCount > 0);
  assert.ok(Number.isFinite(report.speMetric));
  assert.ok(Number.isFinite(report.speThreshold));
  assert.ok(Number.isFinite(report.normalHoldoutFalseAlarmRate));
});

test('autoencoder rejects telemetry missing a model feature', () => {
  assert.throws(
    () => new AutoencoderDetector().analyze({}),
    /Autoencoder input is missing a finite XMEAS_1 value/
  );
});

test('autoencoder evaluator detects faulted telemetry while keeping normal runs clean', () => {
  const trainedArtifact: AutoencoderArtifactMetadata = JSON.parse(
    readFileSync(new URL('./artifacts/tep_autoencoder.json', import.meta.url), 'utf8')
  );

  const normalValues = Object.fromEntries(
    trainedArtifact.features.map((feature: string, index: number) => [feature, trainedArtifact.scaler.mean[index]])
  );
  const anomalousValues = Object.fromEntries(
    trainedArtifact.features.map((feature: string, index: number) => [feature, trainedArtifact.scaler.mean[index] + trainedArtifact.scaler.scale[index] * 8])
  );

  const samples = [
    {
      faultId: 0,
      history: Array.from({ length: 4 }, (_, index) => ({
        timestamp: index * 10,
        step: index,
        values: normalValues,
        alarms: {},
        activeFaults: [],
        faultIntensity: 1,
      })),
    },
    {
      faultId: 1,
      history: Array.from({ length: 4 }, (_, index) => ({
        timestamp: index * 10,
        step: index,
        values: index < 2 ? normalValues : anomalousValues,
        alarms: {},
        activeFaults: [],
        faultIntensity: 1,
      })),
    },
  ];

  const evaluation = evaluateLabeledSamples(samples as any);

  assert.equal(evaluation.sampleCount, 2);
  assert.equal(evaluation.normalSamples, 1);
  assert.equal(evaluation.faultSamples, 1);
  assert.equal(evaluation.falseAlarmRate, 0);
  assert.equal(evaluation.recall, 1);
  assert.ok(evaluation.averageDetectionDelaySeconds >= 0);
  assert.ok(evaluation.perFault.some((entry) => entry.faultId === 1 && entry.detected === 1));
  assert.equal(evaluation.thresholdSweep.length, 5);
  assert.deepEqual(
    evaluation.thresholdSweep.map((entry) => entry.multiplier),
    [0.75, 1, 1.25, 1.5, 2]
  );
});
