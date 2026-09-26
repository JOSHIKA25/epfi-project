import React from 'react';
import {
  Activity,
  AlertTriangle,
  Play,
  RotateCcw,
  Zap,
  Bot,
  Layers,
  Radio,
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
  onClearFaults: () => void;
  onOpenCrewAI: () => void;
  onOpenCopilot: () => void;
  copilotOpen: boolean;
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
  onClearFaults,
  onOpenCrewAI,
  onOpenCopilot,
  copilotOpen,
}) => {
  const avgHealth = unitHealth.length > 0
    ? Math.round(unitHealth.reduce((acc, u) => acc + u.healthIndex, 0) / unitHealth.length)
    : 98;

  const hasAlarms = activeFaults.length > 0 || anomalyScore > 35;
  const isEmergency = anomalyScore > 75 || activeFaults.some((f) => f.severity === 'critical');

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
            {isSimulating && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-cyan-400 ring-2 ring-slate-900 animate-ping" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold tracking-tight text-white text-base">
                IndustrialTwin <span className="text-cyan-400 font-mono text-xs px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/60">TEP-AI</span>
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-mono font-medium border bg-slate-800 text-slate-300 border-slate-700">
                Downs & Vogel (1993)
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-500" />
                Step: <strong className="text-slate-200">{telemetry?.step ?? 0}</strong>
              </span>
              <span className="hidden sm:inline-block text-slate-600">•</span>
              <span className="hidden sm:inline-block">
                Variables: <strong className="text-slate-200">41 Continuous & GC</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Live Status Gauges */}
        <div className="flex items-center gap-4">
          {/* Plant Health */}
          <div className="bg-slate-800/90 border border-slate-700/80 rounded-lg px-3 py-1.5 flex items-center gap-2.5">
            <div className="text-right">
              <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Plant Health</div>
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
              <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Autoencoder SPE</div>
              <div className="text-sm font-mono font-bold flex items-center gap-1.5">
                <span className={anomalyScore > 60 ? 'text-rose-400' : anomalyScore > 35 ? 'text-amber-400' : 'text-cyan-400'}>
                  {anomalyScore.toFixed(1)}%
                </span>
                <span className="text-[10px] text-slate-500 font-normal">/ 35% lim</span>
              </div>
            </div>
            <div className={`p-1.5 rounded-md ${anomalyScore > 60 ? 'bg-rose-950 text-rose-400' : anomalyScore > 35 ? 'bg-amber-950 text-amber-400' : 'bg-cyan-950 text-cyan-400'}`}>
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
              <button
                onClick={onClearFaults}
                className="ml-1 text-[10px] px-1.5 py-0.5 bg-rose-800 hover:bg-rose-700 text-white rounded font-medium cursor-pointer"
                title="Clear active fault disturbance"
              >
                Clear
              </button>
            </div>
          ) : (
            <div className="hidden lg:flex items-center gap-1.5 bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 rounded-lg px-3 py-1.5 text-xs font-mono">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Plant Steady State (Nominal)</span>
            </div>
          )}
        </div>

        {/* Simulation Controls & Assistant Triggers */}
        <div className="flex items-center gap-2">
          {/* Pause / Resume */}
          <button
            onClick={onToggleSimulate}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm cursor-pointer ${
              isSimulating
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white font-bold'
            }`}
            title={isSimulating ? 'Pause simulation tick' : 'Start simulation tick'}
          >
            {isSimulating ? <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isSimulating ? 'Simulating' : 'Start'}</span>
          </button>

          {/* Single Step */}
          <button
            onClick={onStepSimulate}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs transition cursor-pointer"
            title="Advance 1 Step (1 sec)"
          >
            <Clock className="w-4 h-4" />
          </button>

          {/* Reset Plant */}
          <button
            onClick={onResetPlant}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs flex items-center gap-1 transition cursor-pointer"
            title="Reset all 41 TEP variables to nominal steady state"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <div className="h-5 w-px bg-slate-800 mx-1 hidden sm:block" />

          {/* CrewAI Orchestration Trigger */}
          <button
            onClick={onOpenCrewAI}
            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md transition cursor-pointer"
            title="Run hierarchical CrewAI Multi-Agent orchestrator"
          >
            <Layers className="w-3.5 h-3.5 text-violet-200" />
            <span className="hidden md:inline">CrewAI</span> Orchestrator
          </button>

          {/* Gemini AI Copilot */}
          <button
            onClick={onOpenCopilot}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md transition cursor-pointer ${
              copilotOpen
                ? 'bg-cyan-500 text-slate-950 font-bold'
                : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white'
            }`}
            title="Open Gemini AI Natural Language Plant Reasoning Copilot"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Gemini AI</span>
          </button>
        </div>
      </div>
    </header>
  );
};
