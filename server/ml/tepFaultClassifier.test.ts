import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TEP_CLASSIFIER_FEATURES, TEPFaultClassifier } from './tepFaultClassifier.ts';

function artifact() {
  const firstLayerWeights = TEP_CLASSIFIER_FEATURES.map(() => [0, 0]);
  firstLayerWeights[0] = [1, 0];
  return {
    formatVersion: 1,
    modelType: 'standardized_mlp_fault_classifier',
    features: TEP_CLASSIFIER_FEATURES,
    classes: [0, 1],
    decisionThreshold: 0.6,
    scaler: {
      mean: TEP_CLASSIFIER_FEATURES.map(() => 0),
      scale: TEP_CLASSIFIER_FEATURES.map(() => 1),
    },
    layers: [
      {
        weights: firstLayerWeights,
        biases: [0, 0],
        activation: 'relu',
      },
      {
        weights: [[-1, 1], [0, 0]],
        biases: [0, 0],
        activation: 'softmax',
      },
    ],
  };
}

test('classifier loads the exported MLP and returns normalized fault scores', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tep-fault-classifier-'));
  const artifactPath = join(directory, 'classifier.json');
  try {
    await writeFile(artifactPath, JSON.stringify(artifact()));
    const classifier = new TEPFaultClassifier(artifactPath);
    const result = classifier.classify(
      Object.fromEntries(TEP_CLASSIFIER_FEATURES.map((feature) => [
        feature,
        feature === 'XMEAS_1' ? 2 : 0,
      ])),
    );

    assert.equal(result.faultId, 1);
    assert.equal(result.probabilities.length, 2);
    assert.ok(Math.abs(result.probabilities.reduce((sum, item) => sum + item.score, 0) - 1) < 1e-12);
    assert.equal(classifier.classify(
      Object.fromEntries(TEP_CLASSIFIER_FEATURES.map((feature) => [feature, 0])),
    ).faultId, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('classifier rejects missing or invalid telemetry inputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tep-fault-classifier-'));
  const artifactPath = join(directory, 'classifier.json');
  try {
    await writeFile(artifactPath, JSON.stringify(artifact()));
    const classifier = new TEPFaultClassifier(artifactPath);
    assert.throws(() => classifier.classify({}), /missing a finite XMEAS_1 value/);
    assert.throws(() => classifier.classify({ XMEAS_1: Number.NaN }), /missing a finite XMEAS_1 value/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
