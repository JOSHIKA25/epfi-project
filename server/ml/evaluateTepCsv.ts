import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { physicsSignaturePredictor } from './physicsSignaturePredictor.ts';
import { TEP_CLASSIFIER_FEATURES } from './tepFaultClassifier.ts';
import type { TelemetryPoint } from '../tep/tepSimulator.ts';

const FEATURE_IDS = TEP_CLASSIFIER_FEATURES;
const WINDOW_SIZE = 25;

export interface TepCsvFileSummary {
  file: string;
  bytes: number;
  sha256: string;
  rows: number;
  runs: number;
  faultIds: number[];
}

export interface TepCsvEvaluation {
  model: string;
  evaluation: 'per-run end-of-run classification';
  provenance: 'unverified';
  runCount: number;
  accuracy: number;
  macroF1: number;
  faultDetection: {
    normalRuns: number;
    faultRuns: number;
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
    falseNegative: number;
    precision: number;
    recall: number;
    f1: number;
    falsePositiveRate: number;
  };
  thresholdCalibration?: {
    threshold: number;
    objective: string;
    selectedOn: string;
  };
  classes: {
    faultId: number;
    support: number;
    predicted: number;
    precision: number;
    recall: number;
    f1: number;
  }[];
  files: TepCsvFileSummary[];
  note: string;
}

interface RunPrediction {
  actualFaultId: number;
  predictedFaultId: number;
}

type PredictFault = (history: TelemetryPoint[]) => number;

function parseInteger(value: string | undefined, label: string, lineNumber: number): number {
  const parsed = Number(value);
  if (value === undefined || value.trim() === '' || !Number.isInteger(parsed)) {
    throw new Error(`CSV line ${lineNumber} has an invalid ${label}.`);
  }
  return parsed;
}

function scorePredictions(predictions: RunPrediction[]): Omit<TepCsvEvaluation, 'files' | 'note' | 'evaluation' | 'provenance' | 'model' | 'thresholdCalibration'> {
  if (predictions.length === 0) {
    throw new Error('The testing CSV files contain no complete simulation runs.');
  }

  const classIds = new Set<number>();
  const actualCounts = new Map<number, number>();
  const predictedCounts = new Map<number, number>();
  const truePositives = new Map<number, number>();
  let correct = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  for (const prediction of predictions) {
    const actualIsFault = prediction.actualFaultId !== 0;
    const predictedIsFault = prediction.predictedFaultId !== 0;
    if (actualIsFault && predictedIsFault) truePositive += 1;
    else if (!actualIsFault && predictedIsFault) falsePositive += 1;
    else if (!actualIsFault && !predictedIsFault) trueNegative += 1;
    else falseNegative += 1;

    classIds.add(prediction.actualFaultId);
    classIds.add(prediction.predictedFaultId);
    actualCounts.set(
      prediction.actualFaultId,
      (actualCounts.get(prediction.actualFaultId) ?? 0) + 1,
    );
    predictedCounts.set(
      prediction.predictedFaultId,
      (predictedCounts.get(prediction.predictedFaultId) ?? 0) + 1,
    );
    if (prediction.actualFaultId === prediction.predictedFaultId) {
      correct += 1;
      truePositives.set(
        prediction.actualFaultId,
        (truePositives.get(prediction.actualFaultId) ?? 0) + 1,
      );
    }
  }

  const classes = [...classIds].sort((left, right) => left - right).map((faultId) => {
    const truePositive = truePositives.get(faultId) ?? 0;
    const predicted = predictedCounts.get(faultId) ?? 0;
    const support = actualCounts.get(faultId) ?? 0;
    const precision = predicted === 0 ? 0 : truePositive / predicted;
    const recall = support === 0 ? 0 : truePositive / support;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { faultId, support, predicted, precision, recall, f1 };
  });
  const faultPrecision = truePositive + falsePositive === 0
    ? 0
    : truePositive / (truePositive + falsePositive);
  const faultRecall = truePositive + falseNegative === 0
    ? 0
    : truePositive / (truePositive + falseNegative);

  return {
    runCount: predictions.length,
    accuracy: correct / predictions.length,
    macroF1: classes.reduce((sum, item) => sum + item.f1, 0) / classes.length,
    faultDetection: {
      normalRuns: trueNegative + falsePositive,
      faultRuns: truePositive + falseNegative,
      truePositive,
      falsePositive,
      trueNegative,
      falseNegative,
      precision: faultPrecision,
      recall: faultRecall,
      f1: faultPrecision + faultRecall === 0
        ? 0
        : 2 * faultPrecision * faultRecall / (faultPrecision + faultRecall),
      falsePositiveRate: falsePositive / Math.max(1, trueNegative + falsePositive),
    },
    classes,
  };
}

export async function evaluateTepCsvFiles(
  paths: string[],
  predict: PredictFault = (history) => physicsSignaturePredictor.predict(history).topPrediction.faultId,
  model = 'PHYSICS_SIGNATURE_HEURISTIC',
  thresholdCalibration?: TepCsvEvaluation['thresholdCalibration'],
): Promise<TepCsvEvaluation> {
  if (paths.length === 0) {
    throw new Error('Provide at least one held-out testing CSV file.');
  }

  const runPredictions: RunPrediction[] = [];
  const fileSummaries: TepCsvFileSummary[] = [];

  for (const filePath of paths) {
    const fileStat = await stat(filePath);
    const input = createReadStream(filePath);
    const hash = createHash('sha256');
    input.on('data', (chunk: string | Buffer) => hash.update(chunk));
    const lines = createInterface({ input, crlfDelay: Infinity });
    let headerIndexes: Map<string, number> | null = null;
    let lineNumber = 0;
    let rowCount = 0;
    let runCount = 0;
    let activeRunKey: string | null = null;
    let activeFaultId: number | null = null;
    let previousSample: number | null = null;
    let history: TelemetryPoint[] = [];
    const completedRuns = new Set<string>();
    const fileFaultIds = new Set<number>();

    const finishRun = () => {
      if (activeRunKey === null || activeFaultId === null || history.length === 0) return;
      const predictedFaultId = predict(history);
      if (!Number.isInteger(predictedFaultId) || predictedFaultId < 0 || predictedFaultId > 21) {
        throw new Error(`Predictor returned invalid fault ID ${predictedFaultId}.`);
      }
      runPredictions.push({ actualFaultId: activeFaultId, predictedFaultId });
      completedRuns.add(activeRunKey);
      runCount += 1;
    };

    for await (const rawLine of lines) {
      lineNumber += 1;
      const line = lineNumber === 1 ? rawLine.replace(/^\uFEFF/, '') : rawLine;
      if (line.trim() === '') continue;

      const fields = line.split(',');
      if (headerIndexes === null) {
        headerIndexes = new Map(fields.map((column, index) => [column.trim().toLowerCase(), index]));
        const requiredColumns = ['faultnumber', 'simulationrun', 'sample', ...FEATURE_IDS.map((id) => id.toLowerCase())];
        const missingColumns = requiredColumns.filter((column) => !headerIndexes?.has(column));
        if (missingColumns.length > 0) {
          throw new Error(`${filePath} is missing required columns: ${missingColumns.join(', ')}.`);
        }
        continue;
      }

      if (fields.length !== headerIndexes.size) {
        throw new Error(`CSV line ${lineNumber} has ${fields.length} fields; expected ${headerIndexes.size}.`);
      }
      if (fields.some((field) => field.includes('"'))) {
        throw new Error(`CSV line ${lineNumber} uses quoted fields; only the numeric TEP CSV format is supported.`);
      }

      const getColumn = (column: string) => fields[headerIndexes?.get(column) ?? -1];
      const faultId = parseInteger(getColumn('faultnumber'), 'faultNumber', lineNumber);
      const simulationRun = parseInteger(getColumn('simulationrun'), 'simulationRun', lineNumber);
      const sample = parseInteger(getColumn('sample'), 'sample', lineNumber);
      if (faultId < 0 || faultId > 21 || sample < 0) {
        throw new Error(`CSV line ${lineNumber} contains an out-of-range faultNumber or sample.`);
      }

      const runKey = `${faultId}:${simulationRun}`;
      if (activeRunKey !== runKey) {
        finishRun();
        if (completedRuns.has(runKey)) {
          throw new Error(`${filePath} is not ordered contiguously by faultNumber and simulationRun.`);
        }
        activeRunKey = runKey;
        activeFaultId = faultId;
        previousSample = null;
        history = [];
      }
      if (previousSample !== null && sample <= previousSample) {
        throw new Error(`${filePath} has non-increasing sample values in run ${runKey}.`);
      }
      previousSample = sample;
      fileFaultIds.add(faultId);
      rowCount += 1;

      const values: Record<string, number> = {};
      for (const featureId of FEATURE_IDS) {
        const rawValue = getColumn(featureId.toLowerCase());
        const numericValue = Number(rawValue);
        if (rawValue === undefined || rawValue.trim() === '' || !Number.isFinite(numericValue)) {
          throw new Error(`CSV line ${lineNumber} has an invalid value for ${featureId}.`);
        }
        values[featureId] = numericValue;
      }
      history.push({
        timestamp: sample,
        step: sample,
        values,
        alarms: {},
        activeFaults: [],
        faultIntensity: 1,
      });
      if (history.length > WINDOW_SIZE) history.shift();
    }

    finishRun();
    lines.close();
    fileSummaries.push({
      file: filePath,
      bytes: fileStat.size,
      sha256: hash.digest('hex'),
      rows: rowCount,
      runs: runCount,
      faultIds: [...fileFaultIds].sort((left, right) => left - right),
    });
  }

  const scored = scorePredictions(runPredictions);
  return {
    model,
    evaluation: 'per-run end-of-run classification',
    provenance: 'unverified',
    ...scored,
    ...(thresholdCalibration ? { thresholdCalibration } : {}),
    files: fileSummaries,
    note: 'Each simulation run is classified once using its final 25 samples. Testing files are not used for training or threshold selection. Dataset source/license and fault-onset timing were not independently verified; results do not establish production performance or detection delay.',
  };
}

async function main(): Promise<void> {
  const paths: string[] = [];
  let model = 'heuristic';
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--model') {
      const value = args[index + 1];
      if (value !== 'heuristic' && value !== 'supervised') {
        throw new Error('The --model option must be heuristic or supervised.');
      }
      model = value;
      index += 1;
    } else {
      paths.push(args[index]);
    }
  }

  if (model === 'supervised') {
    const { TEPFaultClassifier } = await import('./tepFaultClassifier.ts');
    const classifier = new TEPFaultClassifier();
    const result = await evaluateTepCsvFiles(
      paths,
      (history) => classifier.classify(history[history.length - 1].values).faultId,
      'SUPERVISED_MLP_TEP',
      {
        threshold: classifier.decisionThreshold,
        objective: 'maximum Youden J (recall minus false-positive rate) on grouped training validation runs',
        selectedOn: 'Every fifth simulationRun in training files; held-out testing files were not used.',
      },
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const result = await evaluateTepCsvFiles(paths);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'TEP CSV evaluation failed.');
    process.exitCode = 1;
  });
}
