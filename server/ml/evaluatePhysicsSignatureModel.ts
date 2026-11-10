import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  physicsSignaturePredictor,
  SUPPORTED_FAULT_IDS,
  type FaultPrediction,
} from './physicsSignaturePredictor.ts';
import type { TelemetryPoint } from '../tep/tepSimulator.ts';

export interface LabeledTelemetrySample {
  faultId: number;
  history: TelemetryPoint[];
}

export interface FaultClassMetrics {
  faultId: number;
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface PhysicsSignatureEvaluation {
  model: 'PHYSICS_SIGNATURE_HEURISTIC';
  validationStatus: 'UNVALIDATED';
  sampleCount: number;
  accuracy: number;
  macroF1: number;
  unsupportedFaultSamples: number;
  perClass: FaultClassMetrics[];
  note: string;
}

export function evaluateLabeledSamples(
  samples: LabeledTelemetrySample[],
  predict: (history: TelemetryPoint[]) => FaultPrediction = (history) =>
    physicsSignaturePredictor.predict(history).topPrediction
): PhysicsSignatureEvaluation {
  if (samples.length === 0) {
    throw new Error('At least one labeled telemetry sample is required.');
  }

  const supportedFaultIds = new Set([0, ...SUPPORTED_FAULT_IDS]);

  const confusion = new Map<number, Map<number, number>>();
  const actualCounts = new Map<number, number>();
  const predictedCounts = new Map<number, number>();
  let correct = 0;
  let unsupportedFaultSamples = 0;

  for (const sample of samples) {
    if (!Number.isInteger(sample.faultId) || sample.faultId < 0 || sample.faultId > 21) {
      throw new Error(`Invalid TEP fault ID: ${sample.faultId}. Expected an integer from 0 to 21.`);
    }
    if (sample.history.length === 0) {
      throw new Error(`Fault ${sample.faultId} sample has no telemetry history.`);
    }

    const predictedFaultId = predict(sample.history).faultId;
    const row = confusion.get(sample.faultId) || new Map<number, number>();
    row.set(predictedFaultId, (row.get(predictedFaultId) || 0) + 1);
    confusion.set(sample.faultId, row);
    actualCounts.set(sample.faultId, (actualCounts.get(sample.faultId) || 0) + 1);
    predictedCounts.set(predictedFaultId, (predictedCounts.get(predictedFaultId) || 0) + 1);
    if (predictedFaultId === sample.faultId) correct += 1;
    if (sample.faultId !== 0 && !supportedFaultIds.has(sample.faultId)) {
      unsupportedFaultSamples += 1;
    }
  }

  const perClass = Array.from(actualCounts.keys()).sort((a, b) => a - b).map((faultId) => {
    const truePositive = confusion.get(faultId)?.get(faultId) || 0;
    const support = actualCounts.get(faultId) || 0;
    const falsePositive = (predictedCounts.get(faultId) || 0) - truePositive;
    const precision = truePositive / Math.max(1, truePositive + falsePositive);
    const recall = truePositive / support;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { faultId, support, precision, recall, f1 };
  });

  return {
    model: 'PHYSICS_SIGNATURE_HEURISTIC',
    validationStatus: 'UNVALIDATED',
    sampleCount: samples.length,
    accuracy: correct / samples.length,
    macroF1: perClass.reduce((sum, metrics) => sum + metrics.f1, 0) / perClass.length,
    unsupportedFaultSamples,
    perClass,
    note: 'Metrics are meaningful only when these samples are a held-out set representative of deployment data.',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAlarmState(value: unknown): value is TelemetryPoint['alarms'][string] {
  return value === 'NORMAL' ||
    value === 'WARN_LOW' ||
    value === 'WARN_HIGH' ||
    value === 'TRIP_LOW' ||
    value === 'TRIP_HIGH';
}

function parseTelemetryPoint(value: unknown, rowNumber: number): TelemetryPoint {
  if (
    !isRecord(value) ||
    typeof value.timestamp !== 'number' ||
    !Number.isFinite(value.timestamp) ||
    typeof value.step !== 'number' ||
    !Number.isFinite(value.step) ||
    !isRecord(value.values) ||
    !isRecord(value.alarms) ||
    !Array.isArray(value.activeFaults) ||
    typeof value.faultIntensity !== 'number' ||
    !Number.isFinite(value.faultIntensity)
  ) {
    throw new Error(`Dataset row ${rowNumber} contains an invalid telemetry point.`);
  }

  const values: Record<string, number> = {};
  for (const [sensorId, sensorValue] of Object.entries(value.values)) {
    if (typeof sensorValue !== 'number' || !Number.isFinite(sensorValue)) {
      throw new Error(`Dataset row ${rowNumber} has a non-numeric sensor value for ${sensorId}.`);
    }
    values[sensorId] = sensorValue;
  }

  const alarms: TelemetryPoint['alarms'] = {};
  for (const [sensorId, alarm] of Object.entries(value.alarms)) {
    if (!isAlarmState(alarm)) {
      throw new Error(`Dataset row ${rowNumber} has an invalid alarm state for ${sensorId}.`);
    }
    alarms[sensorId] = alarm;
  }

  const activeFaults = value.activeFaults.map((faultId) => {
    if (typeof faultId !== 'number' || !Number.isInteger(faultId) || faultId < 0 || faultId > 21) {
      throw new Error(`Dataset row ${rowNumber} contains an invalid active-fault value.`);
    }
    return faultId;
  });

  return {
    timestamp: value.timestamp,
    step: value.step,
    values,
    alarms,
    activeFaults,
    faultIntensity: value.faultIntensity,
  };
}

function parseSamples(value: unknown): LabeledTelemetrySample[] {
  if (!Array.isArray(value)) {
    throw new Error('Dataset must be a JSON array of { faultId, history } samples.');
  }

  return value.map((sample, index) => {
    if (!isRecord(sample) || typeof sample.faultId !== 'number' || !Number.isInteger(sample.faultId) ||
      sample.faultId < 0 || sample.faultId > 21 || !Array.isArray(sample.history)) {
      throw new Error(`Dataset row ${index + 1} must contain an integer faultId and telemetry history.`);
    }
    return {
      faultId: sample.faultId,
      history: sample.history.map((point) => parseTelemetryPoint(point, index + 1)),
    };
  });
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('Usage: npm run evaluate:model -- <held-out-dataset.json>');
  }

  const content = await readFile(inputPath, 'utf8');
  const samples = parseSamples(JSON.parse(content) as unknown);
  const result = evaluateLabeledSamples(samples);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Model evaluation failed.';
    console.error(message);
    process.exitCode = 1;
  });
}
