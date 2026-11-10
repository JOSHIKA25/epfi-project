import assert from 'node:assert/strict';
import test from 'node:test';
import { TEP_VARIABLES } from '../tep/tepConstants.ts';
import type { TelemetryPoint } from '../tep/tepSimulator.ts';
import { PhysicsSignaturePredictor } from './physicsSignaturePredictor.ts';
import { evaluateLabeledSamples } from './evaluatePhysicsSignatureModel.ts';

function createTelemetry(overrides: Record<string, number> = {}, activeFaults: number[] = []): TelemetryPoint {
  return {
    timestamp: 1,
    step: 1,
    values: {
      ...Object.fromEntries(TEP_VARIABLES.map((variable) => [variable.id, variable.nominal])),
      ...overrides,
    },
    alarms: {},
    activeFaults,
    faultIntensity: 1,
  };
}

test('fault scoring is independent of simulator ground-truth labels', () => {
  const predictor = new PhysicsSignaturePredictor();
  const telemetryWithoutLabel = createTelemetry(
    { XMEAS_9: 130, XMEAS_21: 110, XMV_10: 80 },
    []
  );
  const telemetryWithLabel = createTelemetry(
    { XMEAS_9: 130, XMEAS_21: 110, XMV_10: 80 },
    [4]
  );

  const withoutLabel = predictor.predict([telemetryWithoutLabel]);
  const withLabel = predictor.predict([telemetryWithLabel]);

  assert.deepEqual(withoutLabel.allPredictions, withLabel.allPredictions);
  assert.equal(withoutLabel.topPrediction.faultId, 4);
});

test('scores are deterministic and explicitly unvalidated', () => {
  const predictor = new PhysicsSignaturePredictor();
  const telemetry = createTelemetry();
  const first = predictor.predict([telemetry]);
  const second = predictor.predict([telemetry]);

  assert.deepEqual(first.allPredictions, second.allPredictions);
  assert.equal(first.modelValidation.status, 'UNVALIDATED');
  assert.equal(first.estimatedTTFMinutes, null);
  assert.ok(Math.abs(first.allPredictions.reduce((sum, prediction) => sum + prediction.score, 0) - 1) < 0.01);
});

test('fault classes without a implemented signature are not marked supported', () => {
  const prediction = new PhysicsSignaturePredictor().predict([createTelemetry()]);
  const unsupported = prediction.allPredictions.find((candidate) => candidate.faultId === 3);

  assert.equal(unsupported?.isSupported, false);
  assert.ok(prediction.modelValidation.supportedFaultIds.includes(4));
  assert.ok(!prediction.modelValidation.supportedFaultIds.includes(3));
});

test('held-out evaluation reports accuracy, macro-F1, and unsupported labels', () => {
  const histories = [1, 2, 3, 4].map(() => [createTelemetry()]);
  let predictionIndex = 0;
  const predictedIds = [1, 2, 2, 1];
  const result = evaluateLabeledSamples(
    [
      { faultId: 1, history: histories[0] },
      { faultId: 1, history: histories[1] },
      { faultId: 2, history: histories[2] },
      { faultId: 3, history: histories[3] },
    ],
    () => ({
      faultId: predictedIds[predictionIndex++],
      code: '',
      name: '',
      score: 0,
      isSupported: true,
      severity: 'low',
      ttfMinutes: null,
    })
  );

  assert.equal(result.sampleCount, 4);
  assert.equal(result.accuracy, 0.5);
  assert.equal(result.unsupportedFaultSamples, 1);
  assert.equal(result.validationStatus, 'UNVALIDATED');
  assert.ok(Math.abs(result.macroF1 - (0.5 + 2 / 3 + 0) / 3) < 1e-10);
});
