import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TEP_CLASSIFIER_FEATURES = [
  ...Array.from({ length: 27 }, (_, index) => `XMEAS_${index + 1}`),
  ...Array.from({ length: 11 }, (_, index) => `XMV_${index + 1}`),
];

interface ClassifierLayer {
  weights: number[][];
  biases: number[];
  activation: 'relu' | 'softmax';
}

interface ClassifierArtifact {
  formatVersion: 1;
  modelType: 'standardized_mlp_fault_classifier';
  features: string[];
  classes: number[];
  decisionThreshold: number;
  scaler: {
    mean: number[];
    scale: number[];
  };
  layers: ClassifierLayer[];
}

export interface TEPFaultClassification {
  faultId: number;
  faultScore: number;
  decisionThreshold: number;
  probabilities: { faultId: number; score: number }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(
    (item) => typeof item === 'number' && Number.isFinite(item),
  );
}

function isFiniteNumberMatrix(value: unknown): value is number[][] {
  return Array.isArray(value) && value.every(isFiniteNumberArray);
}

function isActivation(value: unknown): value is ClassifierLayer['activation'] {
  return value === 'relu' || value === 'softmax';
}

function parseArtifact(value: unknown): ClassifierArtifact {
  if (!isRecord(value) || value.formatVersion !== 1 || value.modelType !== 'standardized_mlp_fault_classifier') {
    throw new Error('Invalid TEP fault classifier artifact header.');
  }
  const features = value.features;
  const classes = value.classes;
  const scaler = value.scaler;
  const layers = value.layers;
  if (
    !Array.isArray(features)
    || features.length !== TEP_CLASSIFIER_FEATURES.length
    || features.some((feature, index) => feature !== TEP_CLASSIFIER_FEATURES[index])
    || !Array.isArray(classes)
    || classes.length < 2
    || classes.some((faultId, index) =>
      typeof faultId !== 'number'
      || !Number.isInteger(faultId)
      || faultId < 0
      || faultId > 20
      || (index > 0 && faultId <= (classes[index - 1] as number)),
    )
    || !isRecord(scaler)
    || typeof value.decisionThreshold !== 'number'
    || !Number.isFinite(value.decisionThreshold)
    || value.decisionThreshold < 0
    || value.decisionThreshold > 1
    || !isFiniteNumberArray(scaler.mean)
    || !isFiniteNumberArray(scaler.scale)
    || scaler.mean.length !== features.length
    || scaler.scale.length !== features.length
    || scaler.scale.some((scale) => scale <= 0)
    || !Array.isArray(layers)
    || layers.length < 2
  ) {
    throw new Error('Invalid TEP fault classifier artifact schema or feature list.');
  }

  let inputWidth = features.length;
  const parsedLayers: ClassifierLayer[] = [];
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    const weights = isRecord(layer) ? layer.weights : undefined;
    const biases = isRecord(layer) ? layer.biases : undefined;
    const activation = isRecord(layer) ? layer.activation : undefined;
    if (
      !isFiniteNumberMatrix(weights)
      || !isFiniteNumberArray(biases)
      || !weights.every((row) => row.length === biases.length)
      || weights.length !== inputWidth
      || !isActivation(activation)
      || (index === layers.length - 1 ? activation !== 'softmax' : activation !== 'relu')
    ) {
      throw new Error(`Invalid TEP fault classifier layer ${index}.`);
    }
    parsedLayers.push({
      weights,
      biases,
      activation,
    });
    inputWidth = layer.biases.length;
  }

  if (inputWidth !== classes.length) {
    throw new Error('TEP fault classifier output width does not match its class labels.');
  }

  return {
    formatVersion: 1,
    modelType: 'standardized_mlp_fault_classifier',
    features,
    classes: [...classes] as number[],
    decisionThreshold: value.decisionThreshold,
    scaler: { mean: scaler.mean, scale: scaler.scale },
    layers: parsedLayers,
  };
}

function softmax(values: number[]): number[] {
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

export class TEPFaultClassifier {
  private readonly artifact: ClassifierArtifact;
  public readonly decisionThreshold: number;

  constructor(artifactPath = fileURLToPath(new URL('./artifacts/tep_fault_classifier.json', import.meta.url))) {
    this.artifact = parseArtifact(JSON.parse(readFileSync(artifactPath, 'utf8')) as unknown);
    this.decisionThreshold = this.artifact.decisionThreshold;
  }

  public classify(values: Record<string, number>): TEPFaultClassification {
    let activations = this.artifact.features.map((feature, index) => {
      const value = values[feature];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Fault classifier input is missing a finite ${feature} value.`);
      }
      return (value - this.artifact.scaler.mean[index]) / this.artifact.scaler.scale[index];
    });

    for (const layer of this.artifact.layers) {
      const outputs = layer.biases.map((bias, outputIndex) => {
        let value = bias;
        for (let inputIndex = 0; inputIndex < activations.length; inputIndex += 1) {
          value += activations[inputIndex] * layer.weights[inputIndex][outputIndex];
        }
        return value;
      });
      activations = layer.activation === 'relu'
        ? outputs.map((value) => Math.max(0, value))
        : softmax(outputs);
    }

    const probabilities = this.artifact.classes.map((faultId, index) => ({
      faultId,
      score: activations[index],
    }));
    const normalScore = probabilities.find((item) => item.faultId === 0)?.score;
    if (normalScore === undefined) {
      throw new Error('TEP fault classifier artifact has no normal class (fault ID 0).');
    }
    const faultScore = 1 - normalScore;
    const topFaultPrediction = probabilities
      .filter((item) => item.faultId !== 0)
      .reduce((best, candidate) => candidate.score > best.score ? candidate : best);
    const faultId = faultScore < this.artifact.decisionThreshold
      ? 0
      : topFaultPrediction.faultId;
    return {
      faultId,
      faultScore,
      decisionThreshold: this.artifact.decisionThreshold,
      probabilities,
    };
  }
}
