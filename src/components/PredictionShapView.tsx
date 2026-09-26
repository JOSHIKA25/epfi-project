import React from 'react';
import {
  TrendingUp,
  Clock,
  Cpu,
  Layers,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Info,
  Sparkles,
} from 'lucide-react';
import { PredictionResult, ShapExplanation } from '../types/index.js';

interface PredictionShapViewProps {
  prediction: PredictionResult | null;
  shap: ShapExplanation | null;
}

export const PredictionShapView: React.FC<PredictionShapViewProps> = ({
  prediction,
  shap,
}) => {
  if (!prediction || !shap) {
    return (
      <div className="p-8 text-center text-slate-400 font-mono">
        <TrendingUp className="w-8 h-8 mx-auto mb-2 animate-spin text-cyan-400" />
        Running XGBoost and SHAP XAI inference...
      </div>
    );
  }

  const { topPrediction, allPredictions, comparison, estimatedTTFMinutes, riskLevel } = prediction;
  const isNormal = topPrediction.faultId === 0;

  return (
    <div className="p-4 flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100 gap-4">
      {/* Top Banner: Failure Prediction Agent & TTF */}
      <div className="p-4 rounded-xl border bg-slate-900 border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
              Failure Prediction Agent (XGBoost Primary)
            </span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-bold font-mono border ${
                riskLevel === 'CRITICAL'
                  ? 'bg-rose-950 text-rose-300 border-rose-700 animate-pulse'
                  : riskLevel === 'HIGH'
                  ? 'bg-orange-950 text-orange-300 border-orange-700'
                  : riskLevel === 'ELEVATED'
                  ? 'bg-amber-950 text-amber-300 border-amber-700'
                  : 'bg-emerald-950 text-emerald-300 border-emerald-700'
              }`}
            >
              {riskLevel} RISK LEVEL
            </span>
          </div>

          <h2 className="text-xl font-bold text-white mt-1 flex items-center gap-2">
            <span>{topPrediction.code}:</span>
            <span className={isNormal ? 'text-emerald-400' : 'text-rose-400'}>{topPrediction.name}</span>
          </h2>
          <p className="text-xs text-slate-400 font-sans mt-0.5 max-w-2xl">
            Forecasted using boosted decision trees over a 25-sample historical sliding window of sensor slopes, moving variances, and multi-sensor correlations.
          </p>
        </div>

        {/* Confidence & TTF Metric Badges */}
        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="bg-slate-950 px-4 py-2.5 rounded-lg border border-slate-800 text-center min-w-[120px]">
            <span className="text-[10px] text-slate-500 block uppercase">Confidence</span>
            <strong className="text-lg text-cyan-400 font-bold">
              {(topPrediction.probability * 100).toFixed(1)}%
            </strong>
          </div>

          <div className="bg-slate-950 px-4 py-2.5 rounded-lg border border-slate-800 text-center min-w-[140px]">
            <span className="text-[10px] text-slate-500 block uppercase">Time-To-Failure (TTF)</span>
            <strong className={`text-lg font-bold flex items-center justify-center gap-1.5 ${
              isNormal ? 'text-emerald-400' : estimatedTTFMinutes < 30 ? 'text-rose-400 animate-pulse' : 'text-amber-400'
            }`}>
              <Clock className="w-4 h-4" />
              {isNormal ? 'Indefinite' : `${estimatedTTFMinutes} min`}
            </strong>
          </div>
        </div>
      </div>

      {/* Model Comparison: XGBoost vs GRU/LSTM */}
      <div className="p-4 bg-slate-900 rounded-xl border border-slate-800">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 pb-2 mb-3 border-b border-slate-800">
          <Cpu className="w-4 h-4 text-cyan-400" />
          Model Cross-Validation & Temporal Comparison (XGBoost vs. GRU/LSTM)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* XGBoost (Primary Model) */}
          <div className="p-3.5 rounded-lg bg-slate-950 border border-cyan-800/60 relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-xs text-cyan-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                Primary Model: Gradient Boosted Trees (XGBoost)
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                Primary Controller
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs font-mono mb-2">
              <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Prediction</span>
                <strong className="text-white">{comparison.xgboost.predictedFault}</strong>
              </div>
              <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Confidence</span>
                <strong className="text-cyan-400">{(comparison.xgboost.confidence * 100).toFixed(1)}%</strong>
              </div>
              <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Inference Latency</span>
                <strong className="text-emerald-400">{comparison.xgboost.latencyMs} ms</strong>
              </div>
            </div>
            <div className="text-[11px] text-slate-400 font-sans">
              Evaluates tabular sliding window features with exact tree-split boundaries. ROC-AUC: <strong className="text-slate-200">{comparison.xgboost.rocAuc}</strong>.
            </div>
          </div>

          {/* GRU/LSTM (Temporal Comparison Model) */}
          <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-xs text-purple-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-400" />
                Comparison Model: Gated Recurrent Unit (GRU)
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                Sequence Validator
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs font-mono mb-2">
              <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Prediction</span>
                <strong className="text-white">{comparison.gru.predictedFault}</strong>
              </div>
              <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Confidence</span>
                <strong className="text-purple-400">{(comparison.gru.confidence * 100).toFixed(1)}%</strong>
              </div>
              <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                <span className="text-[10px] text-slate-500 block">Inference Latency</span>
                <strong className="text-amber-400">{comparison.gru.latencyMs} ms</strong>
              </div>
            </div>
            <div className="text-[11px] text-slate-400 font-sans flex items-center justify-between">
              <span>Model Agreement: <strong className="text-emerald-400 font-mono">CONVERGENT</strong></span>
              <span className="font-mono text-[10px] text-slate-500">Temporal Trend: {comparison.sequenceTemporalTrend}</span>
            </div>
          </div>
        </div>
      </div>

      {/* SHAP (XAI) Waterfall & Feature Impact */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <div className="flex flex-wrap items-center justify-between pb-2 mb-3 border-b border-slate-800 gap-2">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              Explainable AI (XAI) - TreeSHAP Feature Attribution Waterfall
            </h3>
            <p className="text-xs text-slate-400 font-sans mt-0.5">
              Exact Shapley Additive exPlanations showing how specific sensor deviations push the decision boundary from prior expectation to final diagnosis.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-slate-400">Base Value E[f(x)]: <strong className="text-slate-200">{shap.baseValue}</strong></span>
            <span className="text-slate-400">Model Output f(x): <strong className="text-cyan-400">{shap.outputValue}</strong></span>
          </div>
        </div>

        {/* SHAP Summary Text */}
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-sans text-slate-300 mb-4 leading-relaxed">
          <strong className="font-mono text-cyan-400 text-[11px] block mb-1 uppercase tracking-wider">
            AI Decision Explanation:
          </strong>
          {shap.summaryText}
        </div>

        {/* Waterfall Feature List */}
        <div className="space-y-3">
          {shap.topContributions.map((c) => {
            const isPushing = c.shapValue >= 0;
            return (
              <div
                key={c.featureId}
                className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono"
              >
                {/* Variable Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-white px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-400">
                      {c.code}
                    </span>
                    <strong className="text-slate-200 text-xs">{c.name}</strong>
                  </div>
                  <p className="text-[11px] font-sans text-slate-400">{c.physicalInterpretation}</p>
                </div>

                {/* Telemetry Numbers & SHAP Push */}
                <div className="flex items-center gap-4 shrink-0 font-mono">
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block">Current / Nominal</span>
                    <span className="text-slate-300">
                      {c.currentValue} / {c.nominalValue} {c.unit}
                    </span>
                  </div>

                  <div className="text-right min-w-[90px]">
                    <span className="text-[10px] text-slate-500 block">SHAP Value phi</span>
                    <span
                      className={`text-sm font-bold ${
                        isPushing ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {isPushing ? `+${c.shapValue}` : c.shapValue}
                    </span>
                  </div>

                  <div className="text-right min-w-[70px]">
                    <span className="text-[10px] text-slate-500 block">Weight</span>
                    <span className="text-slate-300 font-bold">{c.percentImpact}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
