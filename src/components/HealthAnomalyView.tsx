import React from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Activity,
  Layers,
} from 'lucide-react';
import { AnomalyReport, UnitHealthState } from '../types/index.js';

interface HealthAnomalyViewProps {
  anomalyReport: AnomalyReport | null;
  unitHealth: UnitHealthState[];
  onSelectVariable?: (variableId: string) => void;
}

export const HealthAnomalyView: React.FC<HealthAnomalyViewProps> = ({
  anomalyReport,
  unitHealth,
  onSelectVariable,
}) => {
  if (!anomalyReport) {
    return (
      <div className="p-8 text-center text-slate-400 font-mono">
        <Activity className="w-8 h-8 mx-auto mb-2 animate-spin text-cyan-400" />
        Evaluating Autoencoder anomaly models...
      </div>
    );
  }

  const {
    anomalyScore,
    speThreshold,
    isAnomalous,
    speMetric,
    standardizedInputDistance,
    persistenceCount,
    topOffendingSensors,
    attributions,
  } = anomalyReport;

  return (
    <div className="p-4 flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100 gap-4">
      {/* Top Banner: Process Health Agent Assessment */}
      <div className="p-4 rounded-xl border bg-slate-900 border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-xl shadow-lg ${
              isAnomalous ? 'bg-amber-500 text-slate-950' : 'bg-emerald-500 text-slate-950'
            }`}
          >
            {isAnomalous ? <ShieldAlert className="w-6 h-6" /> : <ShieldCheck className="w-6 h-6" />}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                Anomaly check
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-bold font-mono border ${
                  isAnomalous ? 'bg-amber-950 text-amber-300 border-amber-700' : 'bg-emerald-950 text-emerald-300 border-emerald-700'
                }`}
              >
                {isAnomalous ? 'ABOVE LIMIT' : 'WITHIN LIMIT'}
              </span>
            </div>
            <h2 className="text-lg font-bold text-white mt-0.5">
              {isAnomalous
                ? `Reconstruction error is ${(anomalyScore / 100).toFixed(1)}x the calibrated limit`
                : 'Within calibrated limit'}
            </h2>
            <p className="text-xs text-slate-400 font-sans mt-0.5">SPE {speMetric.toFixed(2)} / limit {speThreshold.toFixed(2)} - ratio {(anomalyScore / 100).toFixed(2)}x</p>
          </div>
        </div>

        {/* Persistence & Statistical Metrics */}
        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="bg-slate-950 px-3 py-2 rounded-lg border border-slate-800 text-center min-w-[100px]">
            <span className="text-[10px] text-slate-500 block uppercase">SPE Residual</span>
            <strong className="text-base text-cyan-400 font-bold">{speMetric.toFixed(1)}</strong>
          </div>

          <div className="bg-slate-950 px-3 py-2 rounded-lg border border-slate-800 text-center min-w-[100px]">
            <span className="text-[10px] text-slate-500 block uppercase">Input distance</span>
            <strong className="text-base text-cyan-400 font-bold">{standardizedInputDistance.toFixed(2)}</strong>
          </div>

          <div className="bg-slate-950 px-3 py-2 rounded-lg border border-slate-800 text-center min-w-[120px]">
            <span className="text-[10px] text-slate-500 block uppercase">Persistence</span>
            <strong className={`text-base font-bold ${persistenceCount > 5 ? 'text-rose-400' : 'text-slate-300'}`}>
              {persistenceCount} windows
            </strong>
          </div>
        </div>
      </div>

      {/* Grid: Offending Sensors Attribution & Unit Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1">
        {/* Offending Sensors Attribution Breakdown (2 Columns) */}
        <div className="lg:col-span-2 bg-slate-900 rounded-xl border border-slate-800 p-4 flex flex-col">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                Top sensor contributions
              </h3>
            </div>
            <span className="text-xs font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
              Top 8
            </span>
          </div>

          {/* Attribution Bars */}
          <div className="space-y-2.5 overflow-y-auto pr-1">
            {attributions.slice(0, 8).map((attr, idx) => (
              <div
                key={attr.varId}
                onClick={() => onSelectVariable?.(attr.varId)}
                className={`p-2.5 rounded-lg border cursor-pointer transition ${
                  attr.isOffending
                    ? 'bg-rose-950/20 border-rose-800/80 hover:border-rose-600'
                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5 font-mono text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-bold text-white px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-cyan-400">
                      {attr.code}
                    </span>
                    <span className="text-slate-200 truncate">{attr.name}</span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-slate-400">
                      Actual: <strong className="text-white">{attr.actual}</strong> {attr.unit}
                    </span>
                    <span className="text-slate-500">
                      (Recon: {attr.reconstructed})
                    </span>
                    <span className="font-bold text-rose-400 w-14 text-right">
                      {attr.percentContribution}%
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      attr.isOffending ? 'bg-gradient-to-r from-amber-500 to-rose-500' : 'bg-cyan-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(3, attr.percentContribution))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Subsystems Health Status Breakdown (1 Column) */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2 pb-2 mb-3 border-b border-slate-800">
              <Layers className="w-4 h-4 text-cyan-400" />
              Subsystem Health Indices
            </h3>

            <div className="space-y-3">
              {unitHealth.map((u) => (
                <div key={u.unit} className="p-3 rounded-lg bg-slate-950/80 border border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white">{u.name}</span>
                    <span
                      className={`text-xs font-mono font-bold ${
                        u.healthIndex > 80 ? 'text-emerald-400' : u.healthIndex > 50 ? 'text-amber-400' : 'text-rose-400'
                      }`}
                    >
                      {u.healthIndex}% Health
                    </span>
                  </div>

                  <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden mb-2">
                    <div
                      className={`h-full transition-all duration-500 ${
                        u.healthIndex > 80 ? 'bg-emerald-500' : u.healthIndex > 50 ? 'bg-amber-500' : 'bg-rose-500'
                      }`}
                      style={{ width: `${u.healthIndex}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <span>Temp: {u.temperature.toFixed(1)}°C</span>
                    <span>Press: {u.pressure.toFixed(0)} kPa</span>
                    <span>Alarms: <strong className={u.activeAlarmsCount > 0 ? 'text-rose-400' : 'text-slate-500'}>{u.activeAlarmsCount}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
