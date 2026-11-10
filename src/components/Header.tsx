import React from 'react';
import {
  Activity,
  AlertTriangle,
  Play,
  Pause,
  RotateCcw,
  Clock,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';
import { TelemetryPoint, TEPFault, UnitHealthState } from '../types/index.js';

interface HeaderProps {
  telemetry: TelemetryPoint | null;
  unitHealth: UnitHealthState[];
  activeFaults: TEPFault[];
  anomalyScore: number;
  isSimulating: boolean;
  onToggleSimulate: () => void;
  onStepSimulate: () => void;
  onResetPlant: () => void;
    canOperateProcess: boolean;
  onClearFaults: () => void;
  onOpenCopilot: () => void;
  copilotOpen: boolean;
  workflowMode?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  telemetry,
  unitHealth,
  activeFaults,
  anomalyScore,
  isSimulating,
  onToggleSimulate,
  onStepSimulate,
  onResetPlant,
  canOperateProcess,
  onClearFaults,
  onOpenCopilot,
  copilotOpen,
  workflowMode = false,
}) => {
  const avgHealth = unitHealth.length > 0
    ? Math.round(unitHealth.reduce((acc, u) => acc + u.healthIndex, 0) / unitHealth.length)
    : 98;

  const hasAlarms = activeFaults.length > 0 || anomalyScore >= 100;
  const isEmergency = activeFaults.some((f) => f.severity === 'critical');

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-slate-100 px-4 py-2.5 select-none sticky top-0 z-30 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-lg shadow-md transition-colors ${
              isEmergency
                ? 'bg-rose-600 text-white animate-pulse'
                : hasAlarms
                ? 'bg-amber-500 text-slate-950'
                : 'bg-emerald-500 text-slate-950'
            }`}>
              <Activity className="w-5 h-5" />
            </div>
            {isSimulating && !workflowMode && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-cyan-400 ring-2 ring-slate-900 animate-ping" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold tracking-tight text-white text-base">
                IndustrialTwin <span className="text-cyan-400 font-mono text-xs px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/60">TEP-AI</span>
              </span>
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold border bg-amber-950/70 text-amber-200 border-amber-800/70"
              >
                {workflowMode ? 'TEP DATA WORKFLOW' : 'SIMULATED'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-500" />
                Step: <strong className="text-slate-200">{telemetry?.step ?? 0}</strong>
              </span>
              <span className="hidden sm:inline-block text-slate-600">•</span>
              <span className="hidden sm:inline-block">
                {isSimulating ? 'Running' : 'Paused'}
              </span>
            </div>
          </div>
        </div>

        {/* Live status belongs to the simulator view, not the dataset workflow. */}
        {!workflowMode && <div className="flex items-center gap-4">
          {/* Plant Health */}
          <div className="bg-slate-800/90 border border-slate-700/80 rounded-lg px-3 py-1.5 flex items-center gap-2.5">
            <div className="text-right">
              <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Plant health</div>
              <div className="text-sm font-mono font-bold flex items-center justify-end gap-1">
                <span className={avgHealth > 80 ? 'text-emerald-400' : avgHealth > 50 ? 'text-amber-400' : 'text-rose-400'}>
                  {avgHealth}%
                </span>
              </div>
            </div>
            <div className="w-9 h-9 rounded-full border-2 border-slate-700 flex items-center justify-center font-mono text-xs font-bold bg-slate-950">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center ${
                  avgHealth > 80 ? 'text-emerald-400' : avgHealth > 50 ? 'text-amber-400' : 'text-rose-400'
                }`}
              >
                {avgHealth}
              </div>
            </div>
          </div>

          {/* Anomaly SPE Score */}
          <div className="bg-slate-800/90 border border-slate-700/80 rounded-lg px-3 py-1.5 flex items-center gap-2.5">
            <div>
              <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Anomaly</div>
              <div className="text-sm font-mono font-bold flex items-center gap-1.5">
                <span className={anomalyScore >= 100 ? 'text-amber-400' : 'text-cyan-400'}>
                  {anomalyScore >= 100
                    ? `${(anomalyScore / 100).toFixed(1)}× limit`
                    : `${anomalyScore.toFixed(1)}% of limit`}
                </span>
              </div>
            </div>
            <div
              className={`p-1.5 rounded-md ${anomalyScore >= 100 ? 'bg-amber-950 text-amber-400' : 'bg-cyan-950 text-cyan-400'}`}
              title="This is SPE divided by its calibrated control limit. 100% equals the limit; values can exceed 100%. It is not a probability or bounded health score."
            >
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>

          {/* Active Fault Badge */}
          {activeFaults.length > 0 ? (
            <div className="bg-rose-950/80 border border-rose-700/80 text-rose-200 rounded-lg px-3 py-1.5 flex items-center gap-2 animate-pulse">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <div>
                <div className="text-[10px] font-bold text-rose-400 tracking-wider uppercase">Active Fault</div>
                <div className="text-xs font-mono font-bold">
                  {activeFaults.map((f) => f.code).join(', ')}
                </div>
              </div>
              {canOperateProcess && <button
                onClick={onClearFaults}
                className="ml-1 text-[10px] px-1.5 py-0.5 bg-rose-800 hover:bg-rose-700 text-white rounded font-medium cursor-pointer"
                title="Clear active fault disturbance"
              >
                Clear
              </button>}
            </div>
          ) : (
            <div className="hidden lg:flex items-center gap-1.5 bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 rounded-lg px-3 py-1.5 text-xs font-mono">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Plant Steady State (Nominal)</span>
            </div>
          )}
        </div>}

        {/* Simulation Controls & Assistant Triggers */}
        <div className="flex items-center gap-2">
          {/* Pause / Resume */}
          {!workflowMode && canOperateProcess && <button
            onClick={onToggleSimulate}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm cursor-pointer ${
              isSimulating
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white font-bold'
            }`}
            title={isSimulating ? 'Pause the simulated plant' : 'Resume the simulated plant'}
          >
            {isSimulating ? <Pause className="w-3.5 h-3.5 text-amber-300" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isSimulating ? 'Pause' : 'Resume'}</span>
          </button>}

          {/* Single Step */}
          {!workflowMode && canOperateProcess && <button
            onClick={onStepSimulate}
            title="Advance the simulation by one tick (use while paused)"
            disabled={isSimulating}
            className={`p-1.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 text-xs transition ${isSimulating ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-700 cursor-pointer'}`}
          >
            <Clock className="w-4 h-4" />
          </button>}

          {/* Reset Plant */}
          {!workflowMode && canOperateProcess && <button
            onClick={onResetPlant}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs flex items-center gap-1 transition cursor-pointer"
            title="Reset simulated telemetry and archive open alarm cards; keep audit history and work orders"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Reset</span>
          </button>}

          {!workflowMode && <div className="h-5 w-px bg-slate-800 mx-1 hidden sm:block" />}

          <button
            onClick={onOpenCopilot}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md transition cursor-pointer ${
              copilotOpen
                ? 'bg-cyan-500 text-slate-950 font-bold'
                : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white'
            }`}
            title="Open diagnosis assistant"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Assistant</span>
          </button>
        </div>
      </div>
    </header>
  );
};
