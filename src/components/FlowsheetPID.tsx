import React, { useState } from 'react';
import {
  Activity,
  Flame,
  Gauge,
  Thermometer,
  Wind,
  Layers,
  Info,
  CheckCircle,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { TelemetryPoint, TEPVariable, UnitHealthState, TEPFault } from '../types/index.js';

interface FlowsheetPIDProps {
  telemetry: TelemetryPoint | null;
  unitHealth: UnitHealthState[];
  activeFaults: TEPFault[];
  variables: TEPVariable[];
  onSelectVariable?: (variableId: string) => void;
  onInjectPresetFault?: (faultId: number) => void;
}

export const FlowsheetPID: React.FC<FlowsheetPIDProps> = ({
  telemetry,
  unitHealth,
  activeFaults,
  variables,
  onSelectVariable,
  onInjectPresetFault,
}) => {
  const [selectedUnit, setSelectedUnit] = useState<string | null>('reactor');
  const values = telemetry?.values || {};
  const alarms = telemetry?.alarms || {};

  // Find unit health states
  const reactorHealth = unitHealth.find((u) => u.unit === 'reactor');
  const condenserHealth = unitHealth.find((u) => u.unit === 'condenser');
  const separatorHealth = unitHealth.find((u) => u.unit === 'separator');
  const stripperHealth = unitHealth.find((u) => u.unit === 'stripper');
  const compressorHealth = unitHealth.find((u) => u.unit === 'compressor');

  const getAlarmColor = (varId: string) => {
    const al = alarms[varId];
    if (al === 'TRIP_HIGH' || al === 'TRIP_LOW') return 'text-rose-400 bg-rose-950/80 border-rose-600 animate-pulse';
    if (al === 'WARN_HIGH' || al === 'WARN_LOW') return 'text-amber-400 bg-amber-950/80 border-amber-600';
    return 'text-cyan-300 bg-slate-900/90 border-slate-700';
  };

  const getUnitStatusBorder = (state?: UnitHealthState) => {
    if (!state) return 'border-slate-700';
    if (state.status === 'CRITICAL') return 'border-rose-500 shadow-rose-900/50 shadow-lg animate-pulse ring-1 ring-rose-500';
    if (state.status === 'DEGRADED') return 'border-amber-500 shadow-amber-900/40 shadow-md';
    return 'border-slate-700/80 hover:border-cyan-500/80';
  };

  return (
    <div className="flex flex-col xl:flex-row gap-4 h-full p-4 overflow-y-auto">
      {/* Main Flowsheet Canvas */}
      <div className="flex-1 bg-slate-950 rounded-xl border border-slate-800 p-4 flex flex-col relative overflow-hidden shadow-2xl">
        {/* Canvas Toolbar & Legend */}
        <div className="flex flex-wrap items-center justify-between pb-3 mb-2 border-b border-slate-800/80 gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              Tennessee Eastman Process (TEP) - Supervisory P&ID Diagram
            </h2>
            <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
              Interactive SCADA Mimic
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
              <span>Gaseous Stream</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span>Liquid Stream</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span>Cooling Water</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <span>Steam Reboiler</span>
            </div>
          </div>
        </div>

        {/* SVG Process Diagram */}
        <div className="relative w-full aspect-[16/9] min-h-[460px] bg-slate-950/90 rounded-lg border border-slate-900 overflow-hidden flex items-center justify-center select-none">
          <svg
            viewBox="0 0 1000 560"
            className="w-full h-full text-slate-300 font-mono text-[11px]"
          >
            <defs>
              {/* Stream Gradients */}
              <linearGradient id="gasGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.8" />
              </linearGradient>
              <linearGradient id="liqGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#2563eb" />
              </linearGradient>
              <linearGradient id="coolGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>

              {/* Arrow Marker */}
              <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 8 5 L 0 9 z" fill="#06b6d4" />
              </marker>
              <marker id="arrowLiq" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 8 5 L 0 9 z" fill="#38bdf8" />
              </marker>
              <marker id="arrowSteam" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 8 5 L 0 9 z" fill="#f59e0b" />
              </marker>
            </defs>

            {/* --- PIPING LINES --- */}
            {/* Feed Stream 1 (A) */}
            <path d="M 40 80 L 140 80 L 140 180" fill="none" stroke="#22d3ee" strokeWidth="2.5" strokeDasharray="6 3" />
            {/* Feed Stream 2 (D) */}
            <path d="M 40 120 L 120 120 L 120 180" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeDasharray="6 3" />
            {/* Feed Stream 3 (E) */}
            <path d="M 40 160 L 100 160 L 100 180" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeDasharray="6 3" />
            {/* Feed Stream 4 (A & C) */}
            <path d="M 40 200 L 170 200" fill="none" stroke="#22d3ee" strokeWidth="3" markerEnd="url(#arrow)" />

            {/* Stream 6: Combined Feed into Reactor */}
            <path d="M 170 200 L 220 200 L 220 230" fill="none" stroke="#22d3ee" strokeWidth="4" markerEnd="url(#arrow)" />

            {/* Stream 7: Reactor Overhead Vapor to Condenser */}
            <path d="M 330 220 L 410 220 L 410 160" fill="none" stroke="#22d3ee" strokeWidth="3.5" markerEnd="url(#arrow)" />

            {/* Condenser to Separator */}
            <path d="M 490 160 L 540 160 L 540 210" fill="none" stroke="#38bdf8" strokeWidth="3.5" markerEnd="url(#arrowLiq)" />

            {/* Separator Overhead (Stream 8) to Recycle Compressor */}
            <path d="M 540 180 L 540 90 L 370 90" fill="none" stroke="#22d3ee" strokeWidth="3" markerEnd="url(#arrow)" />

            {/* Recycle Return into Reactor Feed */}
            <path d="M 300 90 L 190 90 L 190 200" fill="none" stroke="#22d3ee" strokeWidth="3" strokeDasharray="5 3" />

            {/* Purge Line Stream 9 */}
            <path d="M 460 90 L 460 45 L 530 45" fill="none" stroke="#f59e0b" strokeWidth="2.5" markerEnd="url(#arrow)" />

            {/* Stream 10: Separator Underflow to Stripper */}
            <path d="M 540 370 L 540 400 L 680 400 L 680 280" fill="none" stroke="#38bdf8" strokeWidth="3" markerEnd="url(#arrowLiq)" />

            {/* Stripper Steam Supply */}
            <path d="M 640 440 L 720 440" fill="none" stroke="#f59e0b" strokeWidth="3" markerEnd="url(#arrowSteam)" />

            {/* Stripper Bottoms Product (Stream 11) */}
            <path d="M 730 420 L 730 480 L 920 480" fill="none" stroke="#38bdf8" strokeWidth="4" markerEnd="url(#arrowLiq)" />

            {/* Reactor Cooling Water Jacket Loop */}
            <path d="M 210 390 L 210 430 L 290 430 L 290 390" fill="none" stroke="#10b981" strokeWidth="3" strokeDasharray="4 2" />

            {/* --- PROCESS UNITS --- */}

            {/* 1. CHEMICAL REACTOR (CSTR) */}
            <g
              className="cursor-pointer transition-transform hover:scale-[1.01]"
              onClick={() => setSelectedUnit('reactor')}
            >
              {/* Outer Cooling Jacket */}
              <rect x="215" y="210" width="110" height="175" rx="20" fill="#0f172a" stroke="#10b981" strokeWidth="2.5" strokeDasharray="6 3" />
              {/* Vessel Body */}
              <rect
                x="225"
                y="220"
                width="90"
                height="155"
                rx="18"
                fill="#1e293b"
                stroke={reactorHealth?.status === 'CRITICAL' ? '#f43f5e' : reactorHealth?.status === 'DEGRADED' ? '#f59e0b' : '#38bdf8'}
                strokeWidth={selectedUnit === 'reactor' ? 3 : 2}
              />
              {/* Liquid Holdup Level */}
              <rect
                x="227"
                y={373 - (values['XMEAS_8'] || 75) * 1.5}
                width="86"
                height={(values['XMEAS_8'] || 75) * 1.5}
                rx="4"
                fill="#0284c7"
                fillOpacity="0.45"
              />
              {/* Agitator Impeller */}
              <line x1="270" y1="210" x2="270" y2="330" stroke="#94a3b8" strokeWidth="3" />
              <ellipse cx="270" cy="330" rx="22" ry="6" fill="#64748b" />

              {/* Vessel Label */}
              <text x="270" y="240" textAnchor="middle" fill="#f8fafc" fontWeight="bold" fontSize="12">
                REACTOR
              </text>
              <text x="270" y="254" textAnchor="middle" fill="#94a3b8" fontSize="10">
                CSTR (140 m³)
              </text>

              {/* Agitator Motor */}
              <rect x="258" y="195" width="24" height="15" rx="3" fill="#475569" stroke="#94a3b8" />
              <text x="270" y="206" textAnchor="middle" fill="#f8fafc" fontSize="8">
                M
              </text>
            </g>

            {/* 2. PRODUCT CONDENSER */}
            <g
              className="cursor-pointer transition-transform hover:scale-[1.01]"
              onClick={() => setSelectedUnit('condenser')}
            >
              <rect
                x="410"
                y="120"
                width="80"
                height="80"
                rx="8"
                fill="#1e293b"
                stroke={condenserHealth?.status === 'CRITICAL' ? '#f43f5e' : condenserHealth?.status === 'DEGRADED' ? '#f59e0b' : '#38bdf8'}
                strokeWidth={selectedUnit === 'condenser' ? 3 : 2}
              />
              {/* Tube Bundle Lines */}
              <line x1="420" y1="140" x2="480" y2="140" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" />
              <line x1="420" y1="160" x2="480" y2="160" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" />
              <line x1="420" y1="180" x2="480" y2="180" stroke="#10b981" strokeWidth="2" strokeDasharray="4 2" />
              <text x="450" y="135" textAnchor="middle" fill="#f8fafc" fontWeight="bold" fontSize="11">
                CONDENSER
              </text>
            </g>

            {/* 3. VAPOR-LIQUID SEPARATOR */}
            <g
              className="cursor-pointer transition-transform hover:scale-[1.01]"
              onClick={() => setSelectedUnit('separator')}
            >
              <rect
                x="505"
                y="210"
                width="70"
                height="150"
                rx="24"
                fill="#1e293b"
                stroke={separatorHealth?.status === 'CRITICAL' ? '#f43f5e' : separatorHealth?.status === 'DEGRADED' ? '#f59e0b' : '#38bdf8'}
                strokeWidth={selectedUnit === 'separator' ? 3 : 2}
              />
              {/* Liquid boot */}
              <rect
                x="507"
                y={358 - (values['XMEAS_12'] || 50) * 1.4}
                width="66"
                height={(values['XMEAS_12'] || 50) * 1.4}
                rx="12"
                fill="#0284c7"
                fillOpacity="0.5"
              />
              <text x="540" y="245" textAnchor="middle" fill="#f8fafc" fontWeight="bold" fontSize="11">
                SEPARATOR
              </text>
              <text x="540" y="260" textAnchor="middle" fill="#94a3b8" fontSize="9">
                Flash Vessel
              </text>
            </g>

            {/* 4. RECYCLE GAS COMPRESSOR */}
            <g
              className="cursor-pointer transition-transform hover:scale-[1.01]"
              onClick={() => setSelectedUnit('compressor')}
            >
              <polygon
                points="310,70 370,85 370,115 310,130"
                fill="#1e293b"
                stroke={compressorHealth?.status === 'CRITICAL' ? '#f43f5e' : compressorHealth?.status === 'DEGRADED' ? '#f59e0b' : '#38bdf8'}
                strokeWidth={selectedUnit === 'compressor' ? 3 : 2}
              />
              <text x="340" y="103" textAnchor="middle" fill="#f8fafc" fontWeight="bold" fontSize="10">
                COMP
              </text>
            </g>

            {/* 5. STRIPPING COLUMN */}
            <g
              className="cursor-pointer transition-transform hover:scale-[1.01]"
              onClick={() => setSelectedUnit('stripper')}
            >
              <rect
                x="690"
                y="200"
                width="80"
                height="220"
                rx="15"
                fill="#1e293b"
                stroke={stripperHealth?.status === 'CRITICAL' ? '#f43f5e' : stripperHealth?.status === 'DEGRADED' ? '#f59e0b' : '#38bdf8'}
                strokeWidth={selectedUnit === 'stripper' ? 3 : 2}
              />
              {/* Trays */}
              {[240, 270, 300, 330, 360, 390].map((y, idx) => (
                <line key={idx} x1="700" y1={y} x2="760" y2={y} stroke="#64748b" strokeWidth="1.5" strokeDasharray="3 2" />
              ))}
              <text x="730" y="225" textAnchor="middle" fill="#f8fafc" fontWeight="bold" fontSize="11">
                STRIPPER
              </text>
              <text x="730" y="238" textAnchor="middle" fill="#94a3b8" fontSize="9">
                12 Trays
              </text>
            </g>

            {/* --- ON-SCREEN INSTRUMENT TELEMETRY LABELS --- */}

            {/* XMEAS_9: Reactor Temp */}
            <g transform="translate(190, 270)">
              <rect x="0" y="0" width="85" height="30" rx="5" fill="#020617" stroke="#334155" />
              <text x="6" y="13" fill="#94a3b8" fontSize="9">XMEAS(9) Temp</text>
              <text x="6" y="25" fill="#38bdf8" fontWeight="bold" fontSize="11">
                {values['XMEAS_9']?.toFixed(1) ?? '120.4'} °C
              </text>
            </g>

            {/* XMEAS_7: Reactor Pressure */}
            <g transform="translate(190, 305)">
              <rect x="0" y="0" width="85" height="30" rx="5" fill="#020617" stroke="#334155" />
              <text x="6" y="13" fill="#94a3b8" fontSize="9">XMEAS(7) Press</text>
              <text x="6" y="25" fill="#38bdf8" fontWeight="bold" fontSize="11">
                {values['XMEAS_7']?.toFixed(0) ?? '2705'} kPa
              </text>
            </g>

            {/* XMV_10: Reactor Coolant Valve */}
            <g transform="translate(250, 440)">
              <rect x="0" y="0" width="85" height="30" rx="5" fill="#020617" stroke="#334155" />
              <text x="6" y="13" fill="#10b981" fontSize="9">XMV(10) Cool Vlv</text>
              <text x="6" y="25" fill="#10b981" fontWeight="bold" fontSize="11">
                {values['XMV_10']?.toFixed(1) ?? '41.1'} %
              </text>
            </g>

            {/* XMEAS_11: Separator Temp */}
            <g transform="translate(585, 230)">
              <rect x="0" y="0" width="85" height="30" rx="5" fill="#020617" stroke="#334155" />
              <text x="6" y="13" fill="#94a3b8" fontSize="9">XMEAS(11) Temp</text>
              <text x="6" y="25" fill="#38bdf8" fontWeight="bold" fontSize="11">
                {values['XMEAS_11']?.toFixed(1) ?? '80.1'} °C
              </text>
            </g>

            {/* XMEAS_10: Purge Rate */}
            <g transform="translate(480, 15)">
              <rect x="0" y="0" width="95" height="30" rx="5" fill="#020617" stroke="#334155" />
              <text x="6" y="13" fill="#f59e0b" fontSize="9">XMEAS(10) Purge</text>
              <text x="6" y="25" fill="#f59e0b" fontWeight="bold" fontSize="11">
                {values['XMEAS_10']?.toFixed(3) ?? '0.337'} kscmh
              </text>
            </g>

            {/* XMEAS_20: Compressor Work */}
            <g transform="translate(300, 135)">
              <rect x="0" y="0" width="85" height="30" rx="5" fill="#020617" stroke="#334155" />
              <text x="6" y="13" fill="#94a3b8" fontSize="9">XMEAS(20) Power</text>
              <text x="6" y="25" fill="#38bdf8" fontWeight="bold" fontSize="11">
                {values['XMEAS_20']?.toFixed(0) ?? '341'} kW
              </text>
            </g>

            {/* XMEAS_29: Finished Product Purity */}
            <g transform="translate(830, 440)">
              <rect x="0" y="0" width="110" height="35" rx="5" fill="#020617" stroke="#10b981" />
              <text x="6" y="14" fill="#10b981" fontSize="9" fontWeight="bold">XMEAS(29) Product G</text>
              <text x="6" y="29" fill="#10b981" fontWeight="bold" fontSize="13">
                {values['XMEAS_29']?.toFixed(1) ?? '53.8'} mol %
              </text>
            </g>

            {/* Stream 1 Feed Badge */}
            <g transform="translate(10, 65)">
              <text x="0" y="10" fill="#94a3b8" fontSize="9">Stream 1 (A)</text>
              <text x="0" y="22" fill="#22d3ee" fontWeight="bold" fontSize="10">{values['XMEAS_1']?.toFixed(3)} kscmh</text>
            </g>
            {/* Stream 4 Feed Badge */}
            <g transform="translate(10, 220)">
              <text x="0" y="10" fill="#94a3b8" fontSize="9">Stream 4 (A+C)</text>
              <text x="0" y="22" fill="#22d3ee" fontWeight="bold" fontSize="10">{values['XMEAS_4']?.toFixed(2)} kscmh</text>
            </g>
          </svg>
        </div>

        {/* Quick Fault Scenarios Bar */}
        <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-400 font-semibold flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            Quick Benchmark Scenarios:
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onInjectPresetFault?.(4)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-300 border border-slate-700 hover:border-rose-700 text-xs transition cursor-pointer"
            >
              IDV(4) Cooling Loss
            </button>
            <button
              onClick={() => onInjectPresetFault?.(14)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-amber-950 hover:text-amber-300 text-slate-300 border border-slate-700 hover:border-amber-700 text-xs transition cursor-pointer"
            >
              IDV(14) Valve Stiction
            </button>
            <button
              onClick={() => onInjectPresetFault?.(2)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-cyan-950 hover:text-cyan-300 text-slate-300 border border-slate-700 hover:border-cyan-700 text-xs transition cursor-pointer"
            >
              IDV(2) Inerts Influx
            </button>
            <button
              onClick={() => onInjectPresetFault?.(6)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-300 border border-slate-700 hover:border-rose-700 text-xs transition cursor-pointer"
            >
              IDV(6) Feed A Loss
            </button>
            <button
              onClick={() => onInjectPresetFault?.(16)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-purple-950 hover:text-purple-300 text-slate-300 border border-slate-700 hover:border-purple-700 text-xs transition cursor-pointer"
            >
              IDV(16) Condenser Fouling
            </button>
          </div>
        </div>
      </div>

      {/* Side Unit Diagnostic Inspector */}
      <div className="w-full xl:w-80 flex flex-col gap-3">
        {/* Selected Unit Health Card */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
            <div>
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Unit Diagnostic Node</div>
              <h3 className="text-base font-bold text-white capitalize">{selectedUnit} System</h3>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
                selectedUnit === 'reactor' && reactorHealth?.status === 'CRITICAL'
                  ? 'bg-rose-950 text-rose-300 border border-rose-700'
                  : 'bg-slate-800 text-cyan-400 border border-slate-700'
              }`}
            >
              {selectedUnit === 'reactor' ? `${reactorHealth?.healthIndex ?? 95}% Health` : 'Operational'}
            </span>
          </div>

          {/* Unit Key Metrics */}
          {selectedUnit === 'reactor' && (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Reactor Temp XMEAS(9):</span>
                <strong className="font-mono text-cyan-300">{values['XMEAS_9']?.toFixed(1) ?? '120.4'} °C</strong>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Reactor Press XMEAS(7):</span>
                <strong className="font-mono text-cyan-300">{values['XMEAS_7']?.toFixed(0) ?? '2705'} kPa</strong>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Jacket Outlet XMEAS(21):</span>
                <strong className="font-mono text-emerald-400">{values['XMEAS_21']?.toFixed(1) ?? '94.6'} °C</strong>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Cooling Valve XMV(10):</span>
                <strong className="font-mono text-emerald-400">{values['XMV_10']?.toFixed(1) ?? '41.1'} %</strong>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Liquid Level XMEAS(8):</span>
                <strong className="font-mono text-blue-400">{values['XMEAS_8']?.toFixed(1) ?? '75.0'} %</strong>
              </div>
            </div>
          )}

          {selectedUnit === 'separator' && (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Separator Temp XMEAS(11):</span>
                <strong className="font-mono text-cyan-300">{values['XMEAS_11']?.toFixed(1) ?? '80.1'} °C</strong>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Separator Press XMEAS(13):</span>
                <strong className="font-mono text-cyan-300">{values['XMEAS_13']?.toFixed(0) ?? '2633'} kPa</strong>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Boot Level XMEAS(12):</span>
                <strong className="font-mono text-blue-400">{values['XMEAS_12']?.toFixed(1) ?? '50.0'} %</strong>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Underflow XMEAS(14):</span>
                <strong className="font-mono text-blue-400">{values['XMEAS_14']?.toFixed(2) ?? '25.16'} m³/h</strong>
              </div>
            </div>
          )}

          {selectedUnit === 'stripper' && (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Tray Temp XMEAS(18):</span>
                <strong className="font-mono text-cyan-300">{values['XMEAS_18']?.toFixed(1) ?? '65.7'} °C</strong>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Reboiler Steam XMEAS(19):</span>
                <strong className="font-mono text-amber-400">{values['XMEAS_19']?.toFixed(1) ?? '230.5'} kg/h</strong>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Product G Purity XMEAS(29):</span>
                <strong className="font-mono text-emerald-400">{values['XMEAS_29']?.toFixed(1) ?? '53.8'} mol %</strong>
              </div>
            </div>
          )}

          {selectedUnit === 'compressor' && (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Recycle Gas XMEAS(5):</span>
                <strong className="font-mono text-cyan-300">{values['XMEAS_5']?.toFixed(2) ?? '26.89'} kscmh</strong>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Purge Rate XMEAS(10):</span>
                <strong className="font-mono text-amber-400">{values['XMEAS_10']?.toFixed(3) ?? '0.337'} kscmh</strong>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Motor Work XMEAS(20):</span>
                <strong className="font-mono text-cyan-300">{values['XMEAS_20']?.toFixed(0) ?? '341'} kW</strong>
              </div>
            </div>
          )}

          {selectedUnit === 'condenser' && (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Cooling Outlet XMEAS(22):</span>
                <strong className="font-mono text-emerald-400">{values['XMEAS_22']?.toFixed(1) ?? '77.3'} °C</strong>
              </div>
              <div className="flex justify-between p-2 rounded bg-slate-950/70 border border-slate-800/80">
                <span className="text-slate-400">Cooling Valve XMV(11):</span>
                <strong className="font-mono text-emerald-400">{values['XMV_11']?.toFixed(1) ?? '18.1'} %</strong>
              </div>
            </div>
          )}
        </div>

        {/* Plant Subsystem Health Summary */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2.5 flex items-center justify-between">
            <span>Plant Subsystems</span>
            <span className="text-slate-400 text-[10px]">5 Unit Operations</span>
          </h4>
          <div className="space-y-2">
            {unitHealth.map((u) => (
              <div
                key={u.unit}
                onClick={() => setSelectedUnit(u.unit)}
                className={`p-2 rounded-lg border flex items-center justify-between text-xs cursor-pointer transition ${
                  selectedUnit === u.unit ? 'bg-slate-800 border-cyan-500' : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="font-semibold text-white">{u.name}</div>
                  <div className="text-[10px] text-slate-400 flex items-center gap-2">
                    <span>Temp: {u.temperature.toFixed(1)}°C</span>
                    <span>Press: {u.pressure.toFixed(0)} kPa</span>
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`font-mono font-bold ${
                      u.healthIndex > 80 ? 'text-emerald-400' : u.healthIndex > 50 ? 'text-amber-400' : 'text-rose-400'
                    }`}
                  >
                    {u.healthIndex}%
                  </span>
                  <div className="text-[10px] text-slate-500">{u.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
