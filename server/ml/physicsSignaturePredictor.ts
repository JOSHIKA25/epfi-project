/**
 * Prototype fault scoring from hand-authored Tennessee Eastman process signatures.
 * Scores are relative and uncalibrated; this is not a trained or validated model.
 */

import { TEP_FAULTS, TEP_VARIABLES } from '../tep/tepConstants.ts';
import type { TelemetryPoint } from '../tep/tepSimulator.ts';

export interface FaultPrediction {
  faultId: number; // 0 = Normal, 1..21 = IDV(1..21)
  code: string;
  name: string;
  score: number; // Relative class score; not a calibrated probability
  isSupported: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  ttfMinutes: null;
}

export interface ModelValidationStatus {
  method: 'PHYSICS_SIGNATURE_HEURISTIC';
  status: 'UNVALIDATED';
  supportedFaultIds: number[];
}

export interface PredictionResult {
  timestamp: number;
  topPrediction: FaultPrediction;
  allPredictions: FaultPrediction[];
  modelValidation: ModelValidationStatus;
  estimatedTTFMinutes: null;
  riskLevel: 'LOW' | 'ELEVATED' | 'HIGH' | 'CRITICAL';
  windowFeatures: {
    featureName: string;
    value: number;
    slope: number;
    variance: number;
  }[];
}

export const SUPPORTED_FAULT_IDS = [1, 2, 4, 5, 6, 14, 16, 20, 21];

export class PhysicsSignaturePredictor {
  public predict(history: TelemetryPoint[]): PredictionResult {
    if (history.length === 0) {
      return this.fallbackNormal();
    }

    const currentPoint = history[history.length - 1];
    const window = history.slice(-Math.min(25, history.length));
    const vals = currentPoint.values;

    // --- 1. FEATURE EXTRACTION ACROSS SLIDING SENSOR WINDOW ---
    const keySensors = ['XMEAS_1', 'XMEAS_4', 'XMEAS_7', 'XMEAS_9', 'XMEAS_10', 'XMEAS_11', 'XMEAS_13', 'XMEAS_20', 'XMEAS_21', 'XMV_6', 'XMV_10', 'XMV_11'];
    const extractedFeatures: { featureName: string; value: number; slope: number; variance: number }[] = [];

    for (const sensorId of keySensors) {
      const series = window.map((p) => p.values[sensorId] ?? 0);
      const n = series.length;
      const mean = series.reduce((a, b) => a + b, 0) / Math.max(1, n);
      const variance = series.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(1, n);

      // Linear regression slope dy/dt
      let slope = 0;
      if (n > 2) {
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (let i = 0; i < n; i++) {
          sumX += i;
          sumY += series[i];
          sumXY += i * series[i];
          sumXX += i * i;
        }
        slope = (n * sumXY - sumX * sumY) / Math.max(0.001, n * sumXX - sumX * sumX);
      }

      const vMeta = TEP_VARIABLES.find((v) => v.id === sensorId);
      extractedFeatures.push({
        featureName: vMeta?.code || sensorId,
        value: Number(series[n - 1].toFixed(2)),
        slope: Number(slope.toFixed(3)),
        variance: Number(variance.toFixed(3)),
      });
    }

    // --- 2. Hand-authored process-signature scores ---
    const scores: Record<number, number> = { 0: 1.0 }; // Fault 0 = Normal
    for (let i = 1; i <= 21; i++) {
      scores[i] = 0.02; // Relative baseline score
    }

    // Evaluate signature patterns
    const rTemp = vals['XMEAS_9'] || 120.4;
    const rPress = vals['XMEAS_7'] || 2705.0;
    const rCoolWaterOut = vals['XMEAS_21'] || 94.6;
    const rCoolValve = vals['XMV_10'] || 41.1;
    const cCoolValve = vals['XMV_11'] || 18.1;
    const sepTemp = vals['XMEAS_11'] || 80.1;
    const purgeValve = vals['XMV_6'] || 40.1;
    const aFlow = vals['XMEAS_1'] || 0.2505;
    const stream4Flow = vals['XMEAS_4'] || 9.3477;
    const stream4Valve = vals['XMV_4'] || 61.3;
    const compWork = vals['XMEAS_20'] || 341.4;

    // Signature 1: IDV(4) - Reactor cooling water inlet step
    if (rCoolWaterOut > 98.0 && rCoolValve > 50.0 && rTemp > 122.0) {
      scores[4] += (rCoolWaterOut - 94.6) * 1.8 + (rCoolValve - 41.1) * 0.12;
    }

    // Signature 2: IDV(14) - Reactor cooling valve stiction (oscillation)
    const coolingVar = extractedFeatures.find((f) => f.featureName === 'XMV(10)')?.variance || 0;
    if (coolingVar > 1.2 && Math.abs(rTemp - 120.4) > 1.5) {
      scores[14] += coolingVar * 3.5 + 4.0;
    }

    // Signature 3: IDV(6) - A Feed loss
    if (aFlow < 0.15) {
      scores[6] += (0.2505 - aFlow) * 60.0 + 5.0;
    }

    // Signature 4: IDV(1) & IDV(2) - Stream 4 composition step
    if (purgeValve > 46.0 && rPress > 2750.0) {
      scores[2] += (rPress - 2705.0) * 0.08 + (purgeValve - 40.1) * 0.3;
    }
    if (Math.abs(stream4Flow - 9.3477) > 0.6) {
      scores[1] += Math.abs(stream4Flow - 9.3477) * 4.2;
    }

    // Signature 5: IDV(5) & IDV(16) - Condenser disturbances
    if (sepTemp > 84.0 && cCoolValve > 25.0) {
      scores[5] += (sepTemp - 80.1) * 1.8;
      scores[16] += (cCoolValve - 18.1) * 0.35 + (sepTemp - 80.1) * 1.2;
    }

    // Signature 6: IDV(20) - Compressor surge
    const compVar = extractedFeatures.find((f) => f.featureName === 'XMEAS(20)')?.variance || 0;
    if (compVar > 30.0 || Math.abs(compWork - 341.4) > 25.0) {
      scores[20] += compVar * 0.15 + Math.abs(compWork - 341.4) * 0.12;
    }

    // Signature 7: IDV(21) - Stream 4 valve fixed
    if (Math.abs(stream4Valve - 61.3) < 0.1 && Math.abs(stream4Flow - 9.3477) > 0.8) {
      scores[21] += Math.abs(stream4Flow - 9.3477) * 5.0;
    }

    // If no strong fault signature, normal gets high weight
    const maxFaultScore = Math.max(...Object.entries(scores).filter(([k]) => k !== '0').map(([, v]) => v));
    if (maxFaultScore < 0.8) {
      scores[0] = 12.0;
    } else {
      scores[0] = 0.05;
    }

    // Softmax normalization
    const expScores: Record<number, number> = {};
    let expSum = 0;
    for (const [k, v] of Object.entries(scores)) {
      const ev = Math.exp(Math.min(20, v));
      expScores[Number(k)] = ev;
      expSum += ev;
    }

    const predictions: FaultPrediction[] = [];
    // Normal state
    const pNormal = Number((expScores[0] / expSum).toFixed(3));
    predictions.push({
      faultId: 0,
      code: 'NORMAL',
      name: 'Normal Operating Condition',
      score: pNormal,
      isSupported: true,
      severity: 'low',
      ttfMinutes: null,
    });

    // 21 TEP Faults
    for (const f of TEP_FAULTS) {
      const p = Number(((expScores[f.id] || 0.001) / expSum).toFixed(3));
      predictions.push({
        faultId: f.id,
        code: f.code,
        name: f.name,
        score: p,
        isSupported: SUPPORTED_FAULT_IDS.includes(f.id),
        severity: f.severity,
        ttfMinutes: null,
      });
    }

    predictions.sort((a, b) => b.score - a.score);
    const topPrediction = predictions[0];

    let riskLevel: 'LOW' | 'ELEVATED' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (topPrediction.faultId !== 0) {
      if (topPrediction.score > 0.75 || topPrediction.severity === 'critical') riskLevel = 'CRITICAL';
      else if (topPrediction.score > 0.5) riskLevel = 'HIGH';
      else if (topPrediction.score > 0.25) riskLevel = 'ELEVATED';
    }

    return {
      timestamp: Date.now(),
      topPrediction,
      allPredictions: predictions,
      modelValidation: {
        method: 'PHYSICS_SIGNATURE_HEURISTIC',
        status: 'UNVALIDATED',
        supportedFaultIds: [...SUPPORTED_FAULT_IDS],
      },
      estimatedTTFMinutes: null,
      riskLevel,
      windowFeatures: extractedFeatures,
    };
  }

  private fallbackNormal(): PredictionResult {
    const normalPred: FaultPrediction = {
      faultId: 0,
      code: 'NORMAL',
      name: 'Normal Operating Condition',
      score: 1,
      isSupported: true,
      severity: 'low',
      ttfMinutes: null,
    };

    return {
      timestamp: Date.now(),
      topPrediction: normalPred,
      allPredictions: [normalPred],
      modelValidation: {
        method: 'PHYSICS_SIGNATURE_HEURISTIC',
        status: 'UNVALIDATED',
        supportedFaultIds: [...SUPPORTED_FAULT_IDS],
      },
      estimatedTTFMinutes: null,
      riskLevel: 'LOW',
      windowFeatures: [],
    };
  }
}

export const physicsSignaturePredictor = new PhysicsSignaturePredictor();
