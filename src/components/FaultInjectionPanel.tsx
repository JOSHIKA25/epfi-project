import React, { useState } from 'react';
import {
  AlertOctagon,
  Flame,
  Radio,
  Sliders,
  CheckCircle,
  Zap,
  Info,
  ShieldAlert,
} from 'lucide-react';
import { TEPFault } from '../types/index.js';

interface FaultInjectionPanelProps {
  faults: TEPFault[];
  activeFaults: TEPFault[];
  onInjectFault: (faultId: number, intensity: number) => void;
  onClearFault: (faultId?: number) => void;
}

export const FaultInjectionPanel: React.FC<FaultInjectionPanelProps> = ({
  faults,
  activeFaults,
  onInjectFault,
  onClearFault,
}) => {
  const [selectedIntensity, setSelectedIntensity] = useState<number>(1.0);
  const [selectedUnit, setSelectedUnit] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');

  const activeIds = new Set(activeFaults.map((f) => f.id));

  const filtered = faults.filter((f) => {
    if (selectedUnit !== 'all' && f.primaryUnit !== selectedUnit) return false;
    if (selectedSeverity !== 'all' && f.severity !== selectedSeverity) return false;
    return true;
  });

  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case 'critical':
        return 'bg-rose-950 text-rose-300 border-rose-700';
      case 'high':
        return 'bg-orange-950 text-orange-300 border-orange-700';
      case 'medium':
        return 'bg-amber-950 text-amber-300 border-amber-700';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="p-4 flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Control Banner */}
      <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 mb-4 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <AlertOctagon className="w-5 h-5 text-rose-400" />
            Tennessee Eastman Process - 21 Benchmark Faults Lab (Downs & Vogel)
          </h2>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Inject standardized process disturbances, step changes, actuator stiction, and catalyst deactivation to evaluate real-time AI detection and predictive maintenance.
          </p>
        </div>

        {/* Intensity and Master Clear */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
            <span className="text-xs font-semibold text-slate-400">Disturbance Intensity:</span>
            <input
              type="range"
              min="0.2"
              max="2.0"
              step="0.1"
              value={selectedIntensity}
              onChange={(e) => setSelectedIntensity(parseFloat(e.target.value))}
              className="w-24 accent-rose-500 cursor-pointer"
            />
            <span className="text-xs font-mono font-bold text-rose-400 w-10 text-right">
              {selectedIntensity.toFixed(1)}x
            </span>
          </div>

          <button
            onClick={() => onClearFault()}
            disabled={activeFaults.length === 0}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              activeFaults.length > 0
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-md'
                : 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed'
            }`}
          >
            <span>Clear All Active Faults</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 mb-3">
        <select
          value={selectedUnit}
          onChange={(e) => setSelectedUnit(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500"
        >
          <option value="all">All Affected Units</option>
          <option value="reactor">Reactor Exotherm / Jacket</option>
          <option value="condenser">Product Condenser</option>
          <option value="separator">Vapor-Liquid Separator</option>
          <option value="stripper">Stripping Column</option>
          <option value="compressor">Recycle Compressor</option>
          <option value="feed">Feed Stream Manifold</option>
        </select>

        <select
          value={selectedSeverity}
          onChange={(e) => setSelectedSeverity(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical Severity</option>
          <option value="high">High Severity</option>
          <option value="medium">Medium Severity</option>
          <option value="low">Low Severity</option>
        </select>

        <div className="ml-auto text-xs text-slate-400 font-mono">
          Active: <strong className="text-rose-400">{activeFaults.length}</strong> faults injected
        </div>
      </div>

      {/* Faults Cards Grid */}
      <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pr-1">
        {filtered.map((f) => {
          const isActive = activeIds.has(f.id);
          return (
            <div
              key={f.id}
              className={`p-3.5 rounded-xl border flex flex-col justify-between transition-all shadow-md ${
                isActive
                  ? 'bg-rose-950/40 border-rose-600 shadow-rose-950/40 ring-1 ring-rose-500'
                  : 'bg-slate-900/90 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div>
                {/* Card Header */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-slate-950 text-cyan-400 border border-slate-800">
                      {f.code}
                    </span>
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${getSeverityBadge(f.severity)}`}>
                      {f.severity}
                    </span>
                  </div>

                  <span className="text-[10px] text-slate-400 font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 capitalize">
                    {f.type}
                  </span>
                </div>

                {/* Fault Name */}
                <h3 className="text-sm font-bold text-white mb-1.5 leading-snug">{f.name}</h3>

                {/* Description & Mechanism */}
                <p className="text-xs text-slate-400 font-sans line-clamp-2 mb-2">
                  {f.description}
                </p>

                <div className="text-[11px] text-slate-300 bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 mb-2 font-sans">
                  <strong className="text-slate-400 font-mono text-[10px] block uppercase mb-0.5">Physical Mechanism:</strong>
                  {f.physicalMechanism}
                </div>

                {/* Key Sensors */}
                <div className="flex flex-wrap items-center gap-1 mb-3">
                  <span className="text-[10px] text-slate-500 font-mono">Sensors:</span>
                  {f.keySensors.map((sCode) => (
                    <span
                      key={sCode}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800"
                    >
                      {sCode}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono truncate max-w-[160px]" title={f.standardSop}>
                  {f.standardSop.split(':')[0]}
                </span>

                {isActive ? (
                  <button
                    onClick={() => onClearFault(f.id)}
                    className="px-3 py-1 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition cursor-pointer"
                  >
                    Clear Fault
                  </button>
                ) : (
                  <button
                    onClick={() => onInjectFault(f.id, selectedIntensity)}
                    className="px-3 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-200 border border-slate-700 hover:border-rose-700 transition cursor-pointer"
                  >
                    Inject Fault
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
