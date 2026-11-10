import assert from 'node:assert/strict';
import test from 'node:test';
import { TEP_VARIABLES } from './tepConstants.ts';
import {
  getBenchmarkSignalMapping,
  TEP_DATA_PROFILE,
  TEP_VARIABLES_WITH_DATA_PROFILE,
} from './tepDataProfile.ts';

test('data profile distinguishes the simulator from live plant data', () => {
  assert.equal(TEP_DATA_PROFILE.mode, 'simulated');
  assert.equal(TEP_DATA_PROFILE.livePlantConnected, false);
  assert.equal(TEP_DATA_PROFILE.currentTelemetryChannelCount, TEP_VARIABLES.length);
  assert.equal(TEP_DATA_PROFILE.trainingDataset.autoencoderFeatureCount, 38);
  assert.equal(TEP_DATA_PROFILE.trainingDataset.faultLabeledEvaluationAvailable, false);
});

test('only the documented 38 normal-operation channels enter autoencoder training', () => {
  const trained = TEP_VARIABLES_WITH_DATA_PROFILE.filter(
    (variable) => variable.benchmarkMapping.status === 'used_for_normal_training',
  );

  assert.equal(trained.length, 38);
  assert.equal(
    trained.filter((variable) => variable.benchmarkMapping.status === 'used_for_normal_training').length,
    TEP_DATA_PROFILE.trainingDataset.autoencoderFeatureCount,
  );
});

test('catalog mismatches and unavailable training columns remain excluded', () => {
  assert.equal(getBenchmarkSignalMapping('XMEAS_28').status, 'excluded_semantic_mismatch');
  assert.equal(getBenchmarkSignalMapping('XMEAS_29').status, 'excluded_semantic_mismatch');
  assert.equal(getBenchmarkSignalMapping('XMV_12').status, 'not_available_in_training_data');
  assert.equal(getBenchmarkSignalMapping('XMEAS_1').datasetColumn, 'xmeas_1');
});
