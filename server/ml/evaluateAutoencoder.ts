import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AutoencoderDetector } from './autoencoder.ts';
import type { TelemetryPoint } from '../tep/tepSimulator.ts';

export interface LabeledTelemetrySample {
  faultId: number;
  history: TelemetryPoint[];
}

export interface FaultDetectionSummary {
  faultId: number;
  support: number;
  detected: number;
  detectionDelaySeconds: number[];
  detectionRate: number;
  totalFalseNegatives: number;
}

export interface ThresholdSweepPoint {
  multiplier: number;
  threshold: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
  falseAlarmRate: number;
}

export interface AutoencoderEvaluationResult {
  model: 'AUTOENCODER';
  validationStatus: 'UNVALIDATED';
  sampleCount: number;
  normalSamples: number;
  faultSamples: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  falseAlarmRate: number;
  averageDetectionDelaySeconds: number;
  medianDetectionDelaySeconds: number;
  maxDetectionDelaySeconds: number;
  perFault: FaultDetectionSummary[];
  thresholdSweep: ThresholdSweepPoint[];
  note: string;
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function detectionDelaySeconds(history: TelemetryPoint[], thresholdMultiplier: number): number | null {
  if (history.length === 0) {
    return null;
  }

  const detector = new AutoencoderDetector();
  let anomalyTimestamp: number | null = null;

  for (const point of history) {
    const report = detector.analyze(point.values);
    if (report.speMetric >= report.speThreshold * thresholdMultiplier && anomalyTimestamp === null) {
      anomalyTimestamp = point.timestamp;
    }
  }

  if (anomalyTimestamp === null) {
    return null;
  }

  const startTimestamp = history[0].timestamp;
  const usesMilliseconds = Math.abs(startTimestamp) > 1e12 || Math.abs(anomalyTimestamp) > 1e12;
  const scale = usesMilliseconds ? 1000 : 1;
  return Math.max(0, (anomalyTimestamp - startTimestamp) / scale);
}

function summarizeThresholdSweep(
  samples: LabeledTelemetrySample[],
  thresholdMultipliers: number[],
): ThresholdSweepPoint[] {
  const normalCount = samples.filter((sample) => sample.faultId === 0).length;
  const faultCount = samples.filter((sample) => sample.faultId !== 0).length;

  return thresholdMultipliers.map((multiplier) => {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;

    for (const sample of samples) {
      const delay = detectionDelaySeconds(sample.history, multiplier);
      const predictedAnomaly = delay !== null;
      const labelIsFault = sample.faultId !== 0;

      if (labelIsFault) {
        if (predictedAnomaly) truePositive += 1;
        else falseNegative += 1;
      } else if (predictedAnomaly) {
        falsePositive += 1;
      }
    }

    const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
    const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    const falseAlarmRate = normalCount === 0 ? 0 : falsePositive / normalCount;

    return {
      multiplier,
      threshold: Number((multiplier * 100).toFixed(2)),
      truePositive,
      falsePositive,
      falseNegative,
      precision,
      recall,
      f1,
      falseAlarmRate,
    };
  });
}

export interface EvaluateAutoencoderOptions {
  thresholdMultipliers?: number[];
}

export function evaluateLabeledSamples(
  samples: LabeledTelemetrySample[],
  options: EvaluateAutoencoderOptions = {},
): AutoencoderEvaluationResult {
  if (samples.length === 0) {
    throw new Error('At least one labeled telemetry sample is required.');
  }

  const defaultMultipliers = [0.75, 1, 1.25, 1.5, 2];
  const thresholdMultipliers = options.thresholdMultipliers && options.thresholdMultipliers.length > 0
    ? [...new Set(options.thresholdMultipliers)].sort((left, right) => left - right)
    : defaultMultipliers;

  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let faultSamples = 0;
  let normalSamples = 0;
  const detectionDelays: number[] = [];
  const perFaultMap = new Map<number, { support: number; detected: number; delays: number[]; falseNegatives: number }>();

  for (const sample of samples) {
    const labelIsFault = sample.faultId !== 0;
    const delay = detectionDelaySeconds(sample.history, 1);
    const predictedAnomaly = delay !== null;

    if (labelIsFault) {
      faultSamples += 1;
      const stats = perFaultMap.get(sample.faultId) ?? { support: 0, detected: 0, delays: [], falseNegatives: 0 };
      stats.support += 1;
      if (predictedAnomaly) {
        stats.detected += 1;
        stats.delays.push(delay ?? 0);
        truePositive += 1;
        detectionDelays.push(delay ?? 0);
      } else {
        stats.falseNegatives += 1;
        falseNegative += 1;
      }
      perFaultMap.set(sample.faultId, stats);
    } else {
      normalSamples += 1;
      if (predictedAnomaly) {
        falsePositive += 1;
      } else {
        trueNegative += 1;
      }
    }
  }

  const precision = truePositive + falsePositive === 0
    ? 0
    : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0
    ? 0
    : truePositive / (truePositive + falseNegative);
  const f1 = precision + recall === 0
    ? 0
    : (2 * precision * recall) / (precision + recall);
  const accuracy = samples.length === 0 ? 0 : (truePositive + trueNegative) / samples.length;
  const falseAlarmRate = normalSamples === 0 ? 0 : falsePositive / normalSamples;

  const perFault = Array.from(perFaultMap.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([faultId, stats]) => ({
      faultId,
      support: stats.support,
      detected: stats.detected,
      detectionDelaySeconds: [...stats.delays].sort((left, right) => left - right),
      detectionRate: stats.support === 0 ? 0 : stats.detected / stats.support,
      totalFalseNegatives: stats.falseNegatives,
    }));

  return {
    model: 'AUTOENCODER',
    validationStatus: 'UNVALIDATED',
    sampleCount: samples.length,
    normalSamples,
    faultSamples,
    accuracy,
    precision,
    recall,
    f1,
    falseAlarmRate,
    averageDetectionDelaySeconds: detectionDelays.length === 0 ? 0 : detectionDelays.reduce((sum, value) => sum + value, 0) / detectionDelays.length,
    medianDetectionDelaySeconds: median(detectionDelays),
    maxDetectionDelaySeconds: detectionDelays.length === 0 ? 0 : Math.max(...detectionDelays),
    perFault,
    thresholdSweep: summarizeThresholdSweep(samples, thresholdMultipliers),
    note: 'Binary anomaly detection metrics are calculated over fault-vs-normal labels. Fault IDs are treated as sample labels, not as learned class labels. Threshold sweeps report how sensitivity/false alarms change as the calibrated anomaly threshold is scaled.',
  };
}

function parseMultiplierList(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const numbers = value.split(',').map((entry) => Number(entry.trim())).filter((entry) => Number.isFinite(entry));
  if (numbers.length === 0) {
    throw new Error('Threshold multipliers must be a comma-separated list of positive numbers.');
  }
  return numbers;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inputPath = args[0];
  const thresholdValue = args.includes('--threshold-multipliers')
    ? args[args.indexOf('--threshold-multipliers') + 1]
    : undefined;

  if (!inputPath) {
    throw new Error('Usage: npm run evaluate:autoencoder -- <held-out-dataset.json> [--threshold-multipliers 0.75,1,1.25,1.5,2]');
  }

  const content = await readFile(inputPath, 'utf8');
  const samples = parseSamples(JSON.parse(content) as unknown);
  const result = evaluateLabeledSamples(samples, {
    thresholdMultipliers: parseMultiplierList(thresholdValue),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Autoencoder evaluation failed.';
    console.error(message);
    process.exitCode = 1;
  });
}
