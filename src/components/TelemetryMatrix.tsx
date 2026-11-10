import React, { useEffect, useState } from 'react';
import {
  Sliders,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { TelemetryPoint, TEPVariable } from '../types/index.js';

interface TelemetryMatrixProps {
  variables: TEPVariable[];
  telemetry: TelemetryPoint | null;
  onSetActuator: (actuatorId: string, value: number) => void;
  selectedVariableId?: string | null;
}

export const TelemetryMatrix: React.FC<TelemetryMatrixProps> = ({
  variables,
  telemetry,
  onSetActuator,
  selectedVariableId,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [alarmsOnly, setAlarmsOnly] = useState(false);

  const values = telemetry?.values || {};
  const alarms = telemetry?.alarms || {};

  useEffect(() => {
    if (!selectedVariableId) return;
    const selectedVariable = variables.find((variable) => variable.id === selectedVariableId);
    if (!selectedVariable) return;
    setSearchTerm(selectedVariable.code);
    setUnitFilter('all');
    setTypeFilter('all');
    setAlarmsOnly(false);
  }, [selectedVariableId, variables]);

  const filtered = variables.filter((v) => {
    // Search
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const match =
        v.code.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q);
      if (!match) return false;
    }

    // Unit filter
    if (unitFilter !== 'all' && v.category !== unitFilter) return false;

    // Type filter
    if (typeFilter !== 'all' && v.type !== typeFilter) return false;

    // Alarms only
    if (alarmsOnly) {
      const al = alarms[v.id];
      if (!al || al === 'NORMAL') return false;
    }

    return true;
  });

  return (
    <div className="p-4 flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 p-3 bg-slate-900 rounded-xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Search Input */}
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search variable code or name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Unit Filter */}
          <select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Subsystems (5 Units)</option>
            <option value="reactor">Chemical Reactor</option>
            <option value="condenser">Product Condenser</option>
            <option value="separator">Vapor-Liquid Separator</option>
            <option value="stripper">Stripping Column</option>
            <option value="compressor">Recycle Compressor</option>
            <option value="feed">Feed System</option>
            <option value="product">Product Streams</option>
          </select>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Variable Types</option>
            <option value="measurement">Measurements (XMEAS 1-22)</option>
            <option value="actuator">Manipulated Actuators (XMV 1-12)</option>
            <option value="composition">Sampled Quality GC (XMEAS 23-29)</option>
          </select>

          {/* Alarms Toggle */}
          <button
            onClick={() => setAlarmsOnly(!alarmsOnly)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition border cursor-pointer ${
              alarmsOnly
                ? 'bg-rose-950 text-rose-300 border-rose-700'
                : 'bg-slate-950 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Alarms Only</span>
          </button>
        </div>

        <div className="text-xs font-mono text-slate-400">
          Showing <strong className="text-white">{filtered.length}</strong> of{' '}
          <strong className="text-white">{variables.length}</strong> process variables
        </div>
      </div>

      {/* Variables Table */}
      <div className="flex-1 overflow-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-xl">
        <table className="w-full text-left text-xs text-slate-300 font-mono">
          <thead className="bg-slate-900 sticky top-0 text-[11px] text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800 z-10">
            <tr>
              <th className="py-2.5 px-3">Code</th>
              <th className="py-2.5 px-3">Variable Name & Description</th>
              <th className="py-2.5 px-3">Category</th>
              <th className="py-2.5 px-3 text-right">Current Value</th>
              <th className="py-2.5 px-3 text-right">Nominal</th>
              <th className="py-2.5 px-3 text-right">Deviation</th>
              <th className="py-2.5 px-3 text-center">Alarm Envelope</th>
              <th className="py-2.5 px-3 text-center">Status</th>
              <th className="py-2.5 px-3 text-center">Actuator Override</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {filtered.map((v) => {
              const current = values[v.id] ?? v.nominal;
              const nominal = v.nominal;
              const dev = current - nominal;
              const devPercent = ((dev / Math.max(0.1, Math.abs(nominal))) * 100).toFixed(1);
              const alarm = alarms[v.id] || 'NORMAL';

              const isAlarm = alarm !== 'NORMAL';
              const isTrip = alarm === 'TRIP_HIGH' || alarm === 'TRIP_LOW';

              return (
                <tr
                  key={v.id}
                  className={`hover:bg-slate-800/60 transition ${
                    v.id === selectedVariableId ? 'ring-1 ring-inset ring-cyan-500 bg-cyan-950/20' :
                    isTrip
                      ? 'bg-rose-950/20'
                      : isAlarm
                      ? 'bg-amber-950/15'
                      : ''
                  }`}
                >
                  {/* Code */}
                  <td className="py-2 px-3 font-bold text-white whitespace-nowrap">
                    <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-cyan-400">
                      {v.code}
                    </span>
                  </td>

                  {/* Name */}
                  <td className="py-2 px-3 max-w-xs">
                    <div className="font-semibold text-slate-200">{v.name}</div>
                    <div className="text-[10px] text-slate-500 font-sans truncate">{v.description}</div>
                  </td>

                  {/* Category */}
                  <td className="py-2 px-3 capitalize text-slate-400">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-950 border border-slate-800">
                      {v.category}
                    </span>
                  </td>

                  {/* Current Value */}
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    <span
                      className={`text-sm font-bold ${
                        isTrip
                          ? 'text-rose-400 font-extrabold'
                          : isAlarm
                          ? 'text-amber-400'
                          : 'text-cyan-300'
                      }`}
                    >
                      {current.toFixed(v.nominal < 2 ? 3 : 1)}
                    </span>{' '}
                    <span className="text-[10px] text-slate-500">{v.unit}</span>
                  </td>

                  {/* Nominal Setpoint */}
                  <td className="py-2 px-3 text-right text-slate-400 whitespace-nowrap">
                    {nominal.toFixed(v.nominal < 2 ? 3 : 1)} {v.unit}
                  </td>

                  {/* Deviation */}
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    <span
                      className={`flex items-center justify-end gap-1 ${
                        Math.abs(Number(devPercent)) > 15
                          ? 'text-rose-400 font-semibold'
                          : Math.abs(Number(devPercent)) > 5
                          ? 'text-amber-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {dev > 0 ? <TrendingUp className="w-3 h-3 text-rose-400" /> : <TrendingDown className="w-3 h-3 text-cyan-400" />}
                      {dev > 0 ? `+${devPercent}%` : `${devPercent}%`}
                    </span>
                  </td>

                  {/* Envelope (lowWarn / highWarn) */}
                  <td className="py-2 px-3 text-center whitespace-nowrap text-[10px] text-slate-500">
                    [{v.lowWarn} - {v.highWarn}]
                  </td>

                  {/* Status Badge */}
                  <td className="py-2 px-3 text-center whitespace-nowrap">
                    {alarm === 'NORMAL' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/70 text-emerald-400 border border-emerald-800/80">
                        NORMAL
                      </span>
                    ) : isTrip ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-700 animate-pulse">
                        {alarm}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950 text-amber-300 border border-amber-700">
                        {alarm}
                      </span>
                    )}
                  </td>

                  {/* Actuator Override Slider */}
                  <td className="py-2 px-3 text-center">
                    {v.type === 'actuator' ? (
                      <div className="flex items-center gap-2 justify-center">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="0.5"
                          value={current}
                          onChange={(e) => onSetActuator(v.id, parseFloat(e.target.value))}
                          className="w-20 accent-cyan-400 cursor-pointer"
                        />
                        <span className="text-[10px] font-bold text-cyan-400 w-8 text-right">
                          {current.toFixed(0)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-600 text-[10px]">Sensor Readout</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
