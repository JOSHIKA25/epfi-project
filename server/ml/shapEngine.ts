/**
 * Prototype sensor attribution based on deviations and hand-authored fault signatures.
 * These values are not SHAP values and do not explain a trained model.
 */

import { TEP_FAULTS, TEP_VARIABLES, type TEPFault, type TEPVariable } from '../tep/tepConstants.ts';
import type { PredictionResult } from './physicsSignaturePredictor.ts';
import type { AnomalyReport } from './autoencoder.ts';

export interface ShapFeatureContribution {
  featureId: string;
  code: string;
  name: string;
  unit: string;
  currentValue: number;
  nominalValue: number;
  shapValue: number; // Signed heuristic attribution, not a Shapley value
  direction: 'increases_risk' | 'decreases_risk';
  percentImpact: number;
  physicalInterpretation: string;
}

export interface ShapExplanation {
  timestamp: number;
  targetFaultCode: string;
  targetFaultName: string;
  targetFaultId: number;
  topContributions: ShapFeatureContribution[];
  summaryText: string;
}

export class ShapEngine {
  public explainPrediction(
    prediction: PredictionResult,
    anomaly: AnomalyReport,
    telemetryValues: Record<string, number>
  ): ShapExplanation {
    const topPred = prediction.topPrediction;
    const isNormal = topPred.faultId === 0;

    const contributions: ShapFeatureContribution[] = [];

    // Identify fault metadata
    const faultMeta = TEP_FAULTS.find((f) => f.id === topPred.faultId);
    const keySensors = faultMeta ? faultMeta.keySensors : ['XMEAS_9', 'XMEAS_7', 'XMEAS_21', 'XMV_10', 'XMEAS_10', 'XMEAS_11'];

    // Combine key fault sensors and top offending sensors from autoencoder
    const candidates = new Set<string>([...keySensors, ...anomaly.topOffendingSensors.map((s) => s.varId)]);

    let totalAbsShap = 0;

    candidates.forEach((varId) => {
      const vMeta = TEP_VARIABLES.find((v) => v.id === varId);
      if (!vMeta) return;

      const current = telemetryValues[varId] ?? vMeta.nominal;
      const nominal = vMeta.nominal;
      const dev = current - nominal;
      const devPercent = (dev / Math.max(0.1, Math.abs(nominal))) * 100;

      let shapVal = 0;

      if (isNormal) {
        shapVal = -Number((0.15 + Math.min(0.1, Math.abs(devPercent) * 0.005)).toFixed(2));
      } else {
        // Under fault condition, calculate marginal contribution based on physics relevance
        const isDirectKey = keySensors.includes(varId);
        const weight = isDirectKey ? 1.6 : 0.7;
        const normalizedDev = Math.abs(devPercent) / 10.0;
        shapVal = Number((normalizedDev * 0.45 * weight).toFixed(2));

        // Invert sign if feature is buffering or suppressing the fault
        if (Math.abs(devPercent) < 2.0) {
          shapVal = -Number((0.15 + Math.min(0.1, Math.abs(devPercent) * 0.005)).toFixed(2));
        }
      }

      totalAbsShap += Math.abs(shapVal);

      // Generate physical interpretation
      let interpretation = '';
      if (Math.abs(devPercent) < 2.0) {
        interpretation = `${vMeta.name} is tracking nominal setpoint within normal bounds (dev ${devPercent.toFixed(1)}%), exerting stabilizing influence.`;
      } else if (dev > 0) {
        interpretation = `${vMeta.name} is elevated (+${dev.toFixed(2)} ${vMeta.unit}, +${devPercent.toFixed(1)}%), exceeding control threshold and indicating thermal/mass accumulation.`;
      } else {
        interpretation = `${vMeta.name} is depressed (${dev.toFixed(2)} ${vMeta.unit}, ${devPercent.toFixed(1)}%), signaling flow restriction or supply starvation.`;
      }

      contributions.push({
        featureId: varId,
        code: vMeta.code,
        name: vMeta.name,
        unit: vMeta.unit,
        currentValue: Number(current.toFixed(2)),
        nominalValue: vMeta.nominal,
        shapValue: shapVal,
        direction: shapVal >= 0 ? 'increases_risk' : 'decreases_risk',
        percentImpact: 0, // filled below
        physicalInterpretation: interpretation,
      });
    });

    // Calculate percent impact
    const safeTotal = Math.max(0.001, totalAbsShap);
    contributions.forEach((c) => {
      c.percentImpact = Number(((Math.abs(c.shapValue) / safeTotal) * 100).toFixed(1));
    });

    // Sort descending by absolute SHAP value
    contributions.sort((a, b) => Math.abs(b.shapValue) - Math.abs(a.shapValue));

    // Generate executive summary text
    const topPositive = contributions.filter((c) => c.shapValue > 0).slice(0, 3);
    let summaryText = '';
    if (isNormal) {
      summaryText = 'Heuristic sensor attribution found no strong supported fault signature. This is not a validated model explanation.';
    } else {
      const featureNames = topPositive.map((c) => `${c.code} (${c.name})`).join(', ');
      summaryText = `The rule-based score for ${topPred.code} (${topPred.name}) is associated with relative sensor deviations in: ${featureNames}. These heuristic attributions are not SHAP values or causal evidence.`;
    }

    return {
      timestamp: Date.now(),
      targetFaultCode: topPred.code,
      targetFaultName: topPred.name,
      targetFaultId: topPred.faultId,
      topContributions: contributions.slice(0, 8),
      summaryText,
    };
  }
}

export const shapEngine = new ShapEngine();
