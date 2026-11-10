import { TEP_VARIABLES } from './tepConstants.ts';

export type BenchmarkSignalMapping =
  | {
      status: 'used_for_normal_training';
      datasetColumn: string;
      reason: string;
    }
  | {
      status: 'excluded_semantic_mismatch';
      datasetColumn: string;
      reason: string;
    }
  | {
      status: 'not_available_in_training_data';
      datasetColumn: null;
      reason: string;
    };

const normalTrainingFeatures = new Set([
  ...Array.from({ length: 27 }, (_, index) => `XMEAS_${index + 1}`),
  ...Array.from({ length: 11 }, (_, index) => `XMV_${index + 1}`),
]);

const semanticMismatches = new Set(['XMEAS_28', 'XMEAS_29']);

export const TEP_DATA_PROFILE = {
  mode: 'simulated',
  simulator: 'Simplified Tennessee Eastman Process research simulator',
  livePlantConnected: false,
  currentTelemetryChannelCount: TEP_VARIABLES.length,
  trainingDataset: {
    name: 'TEP_FaultFree_Training.csv',
    labelScope: 'fault-free normal operation only',
    sourceAndLicenseVerified: false,
    autoencoderFeatureCount: normalTrainingFeatures.size,
    faultLabeledEvaluationAvailable: true,
  },
  supervisedFaultTrainingDataset: 'faulty_training.csv',
  heldOutTestingDatasets: ['fault_free_testing.csv', 'faulty_testing.csv'],
  supervisedFaultClassesAvailable: Array.from({ length: 20 }, (_, index) => index + 1),
  benchmarkChannelsNotModeled: [
    ...Array.from({ length: 12 }, (_, index) => `XMEAS_${index + 30}`),
  ],
  simulatorChannelsNotPresentInLocalDataset: ['XMV_12'],
  limitations: [
    'Simulator dynamics are simplified and are not a validated executable model of a real plant.',
    'Autoencoder features are limited to the normal-operation training channels listed per signal.',
    'The active hand-authored predictor is unvalidated; the supervised test candidate missed fault classes and is not production-ready.',
    'No live industrial telemetry source is connected.',
  ],
} as const;

export function getBenchmarkSignalMapping(id: string): BenchmarkSignalMapping {
  const prefix = id.startsWith('XMEAS_') ? 'xmeas' : 'xmv';
  const number = Number(id.slice(id.indexOf('_') + 1));
  const datasetColumn = `${prefix}_${number}`;

  if (normalTrainingFeatures.has(id)) {
    return {
      status: 'used_for_normal_training',
      datasetColumn,
      reason: 'Included in the normal-only autoencoder feature set; this does not validate the simulator dynamics.',
    };
  }

  if (semanticMismatches.has(id)) {
    return {
      status: 'excluded_semantic_mismatch',
      datasetColumn,
      reason: 'The current simulator catalog meaning is documented as different from this training-data column.',
    };
  }

  return {
    status: 'not_available_in_training_data',
    datasetColumn: null,
    reason: 'This channel is not included in the local fault-free training dataset or the trained autoencoder.',
  };
}

export const TEP_VARIABLES_WITH_DATA_PROFILE = TEP_VARIABLES.map((variable) => ({
  ...variable,
  benchmarkMapping: getBenchmarkSignalMapping(variable.id),
}));
