import React from 'react';
import { Sparkles, TrendingUp } from 'lucide-react';
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
        Waiting for telemetry and heuristic analysis...
      </div>
    );
  }

  const { topPrediction, riskLevel } = prediction;
  const isNormal = topPrediction.faultId === 0;

  return (
    <div className="p-4 flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100 gap-4">
      <div className="p-4 rounded-xl border bg-slate-900 border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
              Fault estimate + sensor attribution
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded font-bold font-mono bg-amber-950 text-amber-300 border border-amber-700">
              HEURISTIC
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-bold font-mono border ${
              riskLevel === 'CRITICAL'
                ? 'bg-rose-950 text-rose-300 border-rose-700'
                : riskLevel === 'HIGH'
                  ? 'bg-orange-950 text-orange-300 border-orange-700'
                  : riskLevel === 'ELEVATED'
                    ? 'bg-amber-950 text-amber-300 border-amber-700'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}>
              {riskLevel} risk
            </span>
          </div>

          <h2 className="text-xl font-bold text-white mt-1 flex items-center gap-2">
            <span>{topPrediction.code}:</span>
            <span className={isNormal ? 'text-emerald-400' : 'text-rose-400'}>{topPrediction.name}</span>
          </h2>
          <p className="text-xs text-slate-400 font-sans mt-0.5 max-w-2xl">
            Process signature estimate · engineer review required
          </p>
        </div>

        <div className="bg-slate-950 px-4 py-2.5 rounded-lg border border-slate-800 text-center min-w-[140px]">
          <span className="text-[10px] text-slate-500 block uppercase">Relative score</span>
          <strong className="text-lg text-cyan-400 font-bold">
            {(topPrediction.score * 100).toFixed(1)}%
          </strong>
        </div>
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <div className="pb-2 mb-3 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            Sensor attribution
          </h3>
          <p className="text-xs text-slate-400 font-sans mt-0.5">Relative sensor deviations</p>
        </div>

        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-sans text-slate-300 mb-4 leading-relaxed">
          <strong className="font-mono text-cyan-400 text-[11px] block mb-1 uppercase tracking-wider">
            Summary
          </strong>
          {shap.summaryText}
        </div>

        <div className="space-y-3">
          {shap.topContributions.map((contribution) => {
            const isPushing = contribution.shapValue >= 0;
            return (
              <div
                key={contribution.featureId}
                className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-white px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-400">
                      {contribution.code}
                    </span>
                    <strong className="text-slate-200 text-xs">{contribution.name}</strong>
                  </div>
                  <p className="text-[11px] font-sans text-slate-400">{contribution.physicalInterpretation}</p>
                </div>

                <div className="flex items-center gap-4 shrink-0 font-mono">
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block">Current / Nominal</span>
                    <span className="text-slate-300">
                      {contribution.currentValue} / {contribution.nominalValue} {contribution.unit}
                    </span>
                  </div>
                  <div className="text-right min-w-[90px]">
                    <span className="text-[10px] text-slate-500 block">Heuristic score</span>
                    <span className={`text-sm font-bold ${isPushing ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {isPushing ? `+${contribution.shapValue}` : contribution.shapValue}
                    </span>
                  </div>
                  <div className="text-right min-w-[70px]">
                    <span className="text-[10px] text-slate-500 block">Relative weight</span>
                    <span className="text-slate-300 font-bold">{contribution.percentImpact}%</span>
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
