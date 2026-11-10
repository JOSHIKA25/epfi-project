/**
 * Inference for the run-split, fault-free TEP MLP autoencoder artifact.
 */

import { readFileSync } from 'node:fs';
import { TEP_VARIABLES } from '../tep/tepConstants.ts';

export interface SensorAttribution {
  varId: string;
  code: string;
  name: string;
  unit: string;
  actual: number;
  reconstructed: number;
  squaredError: number;
  percentContribution: number;
  zScore: number;
  isOffending: boolean;
}

export interface AnomalyReport {
  timestamp: number;
  anomalyScore: number;
  threshold: number;
  speThreshold: number;
  thresholdMultiplier: number;
  thresholdPolicy: 'ROW_QUANTILE' | 'RUN_LEVEL_CALIBRATED';
  calibrationQuantile: number;
  trainingDataName: string;
  trainingRunCount: number;
  normalHoldoutFalseAlarmRate: number;
  isAnomalous: boolean;
  severity: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';
  speMetric: number;
  standardizedInputDistance: number;
  persistenceCount: number;
  topOffendingSensors: SensorAttribution[];
  attributions: SensorAttribution[];
}

interface DenseLayer {
  weights: number[][];
  biases: number[];
  activation: 'relu' | 'linear';
}

interface AutoencoderArtifact {
  formatVersion: 1;
  modelType: 'standardized_mlp_autoencoder';
  features: string[];
  scaler: {
    mean: number[];
    scale: number[];
  };
  layers: DenseLayer[];
  threshold: number;
  thresholdQuantile: number;
  perFeatureErrorThresholds: number[];
  training: {
    datasetName: string;
    faultIds: number[];
    trainingRuns: number;
    calibrationRuns: number;
    testRuns: number;
    normalHoldoutFalseAlarmRate: number;
    [key: string]: unknown;
  };
}

interface RunCalibrationArtifact {
  formatVersion: 1;
  method: 'run_level_persistence_multiplier';
  thresholdMultiplier: number;
  baseThreshold: number;
  datasetSha256: string;
  seed: number;
  calibrationRuns: number;
  targetRunFalseAlarmRate: number;
  heldOutRunFalseAlarmRate: number;
  heldOutFaultDetectionRate: number;
  note: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(
    (item) => typeof item === 'number' && Number.isFinite(item)
  );
}

function isDenseLayer(value: unknown): value is DenseLayer {
  if (!isRecord(value)) return false;
  const weights = value.weights;
  const biases = value.biases;
  const activation = value.activation;
  return Array.isArray(weights)
    && isFiniteNumberArray(biases)
    && weights.every((row) => isFiniteNumberArray(row) && row.length === biases.length)
    && (activation === 'relu' || activation === 'linear');
}

function isAutoencoderArtifact(value: unknown): value is AutoencoderArtifact {
  if (!isRecord(value) || value.formatVersion !== 1 || value.modelType !== 'standardized_mlp_autoencoder') {
    return false;
  }
  const expectedFeatures = [
    ...Array.from({ length: 27 }, (_, index) => `XMEAS_${index + 1}`),
    ...Array.from({ length: 11 }, (_, index) => `XMV_${index + 1}`),
  ];
  const features = value.features;
  const scaler = value.scaler;
  const layers = value.layers;
  const training = value.training;
  const threshold = value.threshold;
  const thresholdQuantile = value.thresholdQuantile;
  const featureThresholds = value.perFeatureErrorThresholds;

  if (
    !Array.isArray(features)
    || features.length !== expectedFeatures.length
    || features.some((feature, index) => feature !== expectedFeatures[index])
    || !isRecord(scaler)
    || !isFiniteNumberArray(scaler.mean)
    || !isFiniteNumberArray(scaler.scale)
    || scaler.mean.length !== features.length
    || scaler.scale.length !== features.length
    || scaler.scale.some((scale) => scale <= 0)
    || !Array.isArray(layers)
    || layers.length < 2
    || !layers.every(isDenseLayer)
    || !isRecord(training)
    || typeof training.datasetName !== 'string'
    || typeof training.trainingRuns !== 'number'
    || typeof training.calibrationRuns !== 'number'
    || typeof training.testRuns !== 'number'
    || typeof training.normalHoldoutFalseAlarmRate !== 'number'
    || typeof threshold !== 'number'
    || !Number.isFinite(threshold)
    || threshold <= 0
    || typeof thresholdQuantile !== 'number'
    || !Number.isFinite(thresholdQuantile)
    || !isFiniteNumberArray(featureThresholds)
    || featureThresholds.length !== features.length
  ) return false;

  let inputWidth = features.length;
  for (const layer of layers) {
    if (layer.weights.length !== inputWidth) return false;
    inputWidth = layer.biases.length;
  }
  return inputWidth === features.length;
}

function loadArtifact(): AutoencoderArtifact {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL('./artifacts/tep_autoencoder.json', import.meta.url), 'utf8')
  );
  if (!isAutoencoderArtifact(parsed)) {
    throw new Error('Invalid TEP autoencoder artifact: schema, weights, or calibration data are inconsistent.');
  }
  return parsed;
}

const artifact = loadArtifact();
const runCalibrationEnabled = process.env.TEP_AE_APPLY_RUN_CALIBRATION === 'true';
let thresholdMultiplier = 1;
if (runCalibrationEnabled) {
  const calibration: RunCalibrationArtifact = JSON.parse(
    readFileSync(new URL('./artifacts/tep_run_calibration.json', import.meta.url), 'utf8')
  );
  if (
    calibration.formatVersion !== 1
    || calibration.method !== 'run_level_persistence_multiplier'
    || !Number.isFinite(calibration.thresholdMultiplier)
    || calibration.thresholdMultiplier <= 0
    || calibration.baseThreshold !== artifact.threshold
    || calibration.datasetSha256 !== artifact.training.datasetSha256
    || calibration.seed !== artifact.training.seed
    || calibration.calibrationRuns !== artifact.training.calibrationRuns
  ) {
    throw new Error('Run-level autoencoder calibration does not match the loaded model artifact.');
  }
  thresholdMultiplier = calibration.thresholdMultiplier;
}
const effectiveThreshold = artifact.threshold * thresholdMultiplier;
const variableById = new Map(TEP_VARIABLES.map((variable) => [variable.id, variable]));

function reconstruct(normalizedValues: number[]): number[] {
  let activation = normalizedValues;
  for (const layer of artifact.layers) {
    const next = layer.biases.map((bias, outputIndex) => {
      let value = bias;
      for (let inputIndex = 0; inputIndex < activation.length; inputIndex += 1) {
        value += activation[inputIndex] * layer.weights[inputIndex][outputIndex];
      }
      return layer.activation === 'relu' ? Math.max(0, value) : value;
    });
    activation = next;
  }
  return activation;
}

export class AutoencoderDetector {
  private persistenceCounter = 0;

  public analyze(telemetryValues: Record<string, number>): AnomalyReport {
    const actualValues = artifact.features.map((featureId) => {
      const value = telemetryValues[featureId];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Autoencoder input is missing a finite ${featureId} value.`);
      }
      return value;
    });
    const normalizedValues = actualValues.map(
      (value, index) => (value - artifact.scaler.mean[index]) / artifact.scaler.scale[index]
    );
    const reconstructedNormalized = reconstruct(normalizedValues);
    const errors = normalizedValues.map((value, index) =>
      (value - reconstructedNormalized[index]) ** 2
    );
    const speMetric = errors.reduce((sum, error) => sum + error, 0);
    const anomalyScore = (100 * speMetric) / effectiveThreshold;
    const thresholdExceeded = speMetric >= effectiveThreshold;
    if (thresholdExceeded) {
      this.persistenceCounter += 1;
    } else {
      this.persistenceCounter = 0;
    }
    // The offline run-calibration experiment defines an alarm as two
    // consecutive row-threshold violations within a run. Preserve the historic
    // single-row behavior unless calibrated mode is explicitly enabled.
    const isAnomalous = runCalibrationEnabled
      ? this.persistenceCounter >= 2
      : thresholdExceeded;

    const totalError = Math.max(Number.EPSILON, speMetric);
    const attributions = artifact.features.map((featureId, index) => {
      const variable = variableById.get(featureId);
      if (!variable) {
        throw new Error(`Autoencoder feature ${featureId} is not defined in the TEP variable catalog.`);
      }
      return {
        varId: featureId,
        code: variable.code,
        name: variable.name,
        unit: variable.unit,
        actual: Number(actualValues[index].toFixed(4)),
        reconstructed: Number(
          (reconstructedNormalized[index] * artifact.scaler.scale[index] + artifact.scaler.mean[index])
            .toFixed(4)
        ),
        squaredError: Number(errors[index].toFixed(6)),
        percentContribution: Number(((errors[index] / totalError) * 100).toFixed(2)),
        zScore: Number(normalizedValues[index].toFixed(3)),
        isOffending: errors[index] >= artifact.perFeatureErrorThresholds[index],
      };
    }).sort((left, right) => right.squaredError - left.squaredError);

    return {
      timestamp: Date.now(),
      anomalyScore: Number(anomalyScore.toFixed(1)),
      threshold: 100,
      speThreshold: Number(effectiveThreshold.toFixed(6)),
      thresholdMultiplier,
      thresholdPolicy: runCalibrationEnabled ? 'RUN_LEVEL_CALIBRATED' : 'ROW_QUANTILE',
      calibrationQuantile: artifact.thresholdQuantile,
      trainingDataName: artifact.training.datasetName,
      trainingRunCount: artifact.training.trainingRuns,
      normalHoldoutFalseAlarmRate: artifact.training.normalHoldoutFalseAlarmRate,
      isAnomalous,
      severity: isAnomalous ? 'WARNING' : 'NORMAL',
      speMetric: Number(speMetric.toFixed(6)),
      standardizedInputDistance: Number(
        Math.sqrt(normalizedValues.reduce((sum, value) => sum + value * value, 0)).toFixed(3)
      ),
      persistenceCount: this.persistenceCounter,
      topOffendingSensors: attributions.slice(0, 5),
      attributions,
    };
  }

  public resetPersistence(): void {
    this.persistenceCounter = 0;
  }
}

export const autoencoderDetector = new AutoencoderDetector();
