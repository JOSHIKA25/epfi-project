import React, { useState } from 'react';
import { AlertTriangle, Check, ClipboardCheck, Clock3, LockKeyhole, MessageSquare, ShieldAlert } from 'lucide-react';
import type { AlarmReviewRecord, AuthRole, TEPFault, TEPVariable, TelemetryPoint } from '../types/index.js';

interface AlarmCenterProps {
  alarms: AlarmReviewRecord[];
  activeFaults: TEPFault[];
  variables: TEPVariable[];
  telemetry: TelemetryPoint | null;
  onClearFault: (faultId: number) => void;
  onOpenFaultLab: () => void;
  onOpenMaintenance: () => void;
  onCreateWorkOrder: (alarm: AlarmReviewRecord) => void;
  role: AuthRole;
  error: string | null;
  busyAlarmId: string | null;
  onAction: (alarm: AlarmReviewRecord, action: 'ACKNOWLEDGE' | 'RESOLVE' | 'REVIEW', note: string) => void;
}

const statusLabels: Record<AlarmReviewRecord['status'], string> = {
  ACTIVE: 'Active · needs attention',
  ACKNOWLEDGED: 'Seen · still active',
  CLEARED_PENDING_REVIEW: 'Reading normal · review and resolve',
  RESOLVED: 'Resolved',
  ARCHIVED: 'Archived by simulator reset',
};

export const AlarmCenter: React.FC<AlarmCenterProps> = ({ alarms, activeFaults, variables, telemetry, onClearFault, onOpenFaultLab, onOpenMaintenance, onCreateWorkOrder, role, error, busyAlarmId, onAction }) => {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const openAlarms = alarms.filter((alarm) => !['RESOLVED', 'ARCHIVED'].includes(alarm.status));
  const [showHistory, setShowHistory] = useState(false);
  const visibleAlarms = showHistory ? alarms : openAlarms;
  const isReviewer = role === 'ENGINEER' || role === 'ADMIN';

  return (
    <section className="h-full overflow-y-auto bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold"><AlertTriangle className="h-5 w-5 text-amber-400" />Alarm review</h1>
            <p className="mt-1 text-xs text-slate-400">Operator acknowledges · Engineer reviews · Resolve after readings return to normal</p>
          </div>
          <button onClick={() => setShowHistory((value) => !value)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800">
            {showHistory ? 'Show current only' : `Show history (${alarms.length - openAlarms.length})`}
          </button>
          <div className="rounded-lg border border-amber-800/70 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            {openAlarms.length} open · {alarms.length} recorded
          </div>
        </header>

        <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-400">
          New sensor alarms send an Operator alert through n8n automatically. Check <span className="text-cyan-300">Review &amp; dispatch → Notifications</span> for delivery status.
        </div>

        {error && <div className="rounded-lg border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-200">{error}</div>}

        {activeFaults.length > 0 && (
          <section className="space-y-3 rounded-xl border border-violet-800/70 bg-violet-950/15 p-4">
            <div>
              <h2 className="font-bold text-violet-100">Active Fault Lab scenarios</h2>
            </div>
            {activeFaults.map((fault) => (
              <article key={fault.id} className="rounded-lg border border-violet-900/70 bg-slate-950/80 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-white">{fault.code} · {fault.name}</div>
                  <span className="rounded bg-violet-950 px-2 py-0.5 text-[10px] text-violet-200">Affects {fault.primaryUnit}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{fault.physicalMechanism}</p>
                <p className="mt-1 text-[10px] text-violet-300">To recover this demo scenario, clear the injected IDV, then use Step once while paused (or Resume). The sensor alarm stays open until its reading is normal.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => onClearFault(fault.id)} className="rounded border border-violet-800 px-2.5 py-1 text-[10px] font-semibold text-violet-200 hover:bg-violet-950/60">Clear simulated fault</button>
                  <button onClick={onOpenMaintenance} className="rounded border border-cyan-800 px-2.5 py-1 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-950/60">Open maintenance workflow</button>
                  <button onClick={onOpenFaultLab} className="rounded border border-slate-700 px-2.5 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-800">Back to Fault Lab</button>
                </div>
                <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {fault.keySensors.map((channelId) => {
                    const variable = variables.find((item) => item.id === channelId);
                    const value = telemetry?.values[channelId];
                    const alarm = telemetry?.alarms[channelId] ?? 'UNAVAILABLE';
                    const abnormal = alarm !== 'NORMAL' && alarm !== 'UNAVAILABLE';
                    const nominalOffset = typeof value === 'number' && variable && Math.abs(variable.nominal) > 1e-9
                      ? ((value - variable.nominal) / Math.abs(variable.nominal)) * 100
                      : null;
                    return (
                      <div key={channelId} className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-[10px] ${abnormal ? alarm.startsWith('TRIP') ? 'border-rose-800 bg-rose-950/40' : 'border-amber-800 bg-amber-950/30' : 'border-slate-800 bg-slate-900'}`}>
                        <span className="truncate text-slate-300">{variable?.code ?? channelId} · {variable?.name ?? 'Mapped channel'}</span>
                        <span className={abnormal ? alarm.startsWith('TRIP') ? 'shrink-0 text-rose-300' : 'shrink-0 text-amber-300' : 'shrink-0 text-slate-400'}>
                          {value === undefined ? 'No reading' : `${value.toFixed(2)} ${variable?.unit ?? ''}`}
                          {nominalOffset !== null && <span className="ml-1 text-cyan-300" title="Percent offset from catalog nominal; this is not the alarm threshold">(delta nominal {nominalOffset >= 0 ? '+' : ''}{nominalOffset.toFixed(2)}%)</span>}
                          {' · '}{alarm === 'NORMAL' ? 'NORMAL' : alarm}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </section>
        )}

        {visibleAlarms.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
            <p className="text-sm text-slate-300">{alarms.length > 0 ? 'No unresolved alarms. Older resolved records are in history.' : 'No sensor threshold alarm has been recorded yet.'}</p>
            <button onClick={onOpenFaultLab} className="mt-3 rounded-lg border border-violet-800 px-3 py-2 text-xs text-violet-200 hover:bg-violet-950/60">Open Fault Lab</button>
          </div>
        ) : visibleAlarms.map((alarm) => {
          const isTrip = alarm.alarm.startsWith('TRIP');
          const note = notes[alarm.id] ?? '';
          const busy = busyAlarmId === alarm.id;
          return (
            <article key={alarm.id} className={`rounded-xl border bg-slate-900 p-4 ${isTrip && !['RESOLVED', 'ARCHIVED'].includes(alarm.status) ? 'border-rose-700/80' : 'border-slate-800'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 rounded-lg p-2 ${isTrip ? 'bg-rose-950 text-rose-300' : 'bg-amber-950 text-amber-300'}`}>
                    {isTrip ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                  </div>
                  <div>
                    <h2 className="font-bold text-white">{alarm.name} <span className="font-mono text-cyan-300">({alarm.code})</span></h2>
                    <p className="mt-1 text-sm text-slate-400 capitalize">{alarm.category} · {alarm.value.toFixed(2)} {alarm.unit} · {alarm.alarm}</p>
                    {(alarm.sourceFaults ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(alarm.sourceFaults ?? []).map((fault) => (
                          <span key={fault.id} title={alarm.source === 'TEP_CSV_REPLAY'
                            ? `XGBoost candidate, not ground truth. Key channels: ${fault.keySensors.join(', ')}`
                            : `Known simulated cause. Key channels: ${fault.keySensors.join(', ')}`}
                            className="rounded border border-violet-800/80 bg-violet-950/50 px-2 py-0.5 text-[10px] text-violet-200">
                            {alarm.source === 'TEP_CSV_REPLAY' ? 'Model candidate' : ''} IDV({fault.id}) {fault.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-xs text-slate-500">First seen {new Date(alarm.firstSeenAt).toLocaleString()} · Last seen {new Date(alarm.lastSeenAt).toLocaleString()}</p>
                    {alarm.source === 'TEP_CSV_REPLAY' && <p className="mt-1 text-[10px] font-mono text-cyan-400">Held-out benchmark replay · not live plant telemetry</p>}
                  </div>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${alarm.status === 'RESOLVED' ? 'border-emerald-800 bg-emerald-950/60 text-emerald-300' : alarm.status === 'ARCHIVED' ? 'border-slate-700 bg-slate-800 text-slate-300' : isTrip ? 'border-rose-800 bg-rose-950/60 text-rose-200' : 'border-amber-800 bg-amber-950/60 text-amber-200'}`}>
                  {alarm.source === 'TEP_CSV_REPLAY' && alarm.status === 'CLEARED_PENDING_REVIEW' ? 'Repair reported · engineer close' : statusLabels[alarm.status]}
                </span>
              </div>

              {alarm.acknowledgedBy && <p className="mt-3 text-xs text-slate-400">Acknowledged by {alarm.acknowledgedBy}</p>}
              {alarm.modelDiagnosis && (
                <div className="mt-3 rounded-lg border border-cyan-900/70 bg-slate-950/80 p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-cyan-200">Benchmark diagnosis candidate: IDV({alarm.modelDiagnosis.candidateFaultId})</strong>
                    <span className="text-slate-400">XGBoost class score {(alarm.modelDiagnosis.classConfidence * 100).toFixed(1)}% · sample {alarm.modelDiagnosis.firstAlarmSampleIndex + 1}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">TreeSHAP model contributions for the same incident window; these do not prove physical cause.</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {alarm.modelDiagnosis.topSensors.slice(0, 5).map((item) => (
                      <span key={item.sensor} className="rounded border border-slate-700 px-2 py-1 font-mono text-[10px] text-slate-300">
                        {item.sensor.replace('_', '(')}) {item.contribution >= 0 ? '+' : ''}{item.contribution.toFixed(3)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {alarm.acknowledgedBy && !['RESOLVED', 'ARCHIVED'].includes(alarm.status) && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-cyan-900/70 bg-cyan-950/20 px-3 py-2 text-xs">
                  <span className="flex-1 text-cyan-100">Next: Engineer creates the work order for this acknowledged alarm.</span>
                  {(role === 'ENGINEER' || role === 'ADMIN') && <button disabled={busy} onClick={() => onCreateWorkOrder(alarm)} className="rounded-md bg-cyan-600 px-3 py-1.5 font-semibold text-slate-950 hover:bg-cyan-500 disabled:opacity-50">{busy ? 'Creating…' : 'Create linked work order'}</button>}
                  {role === 'OPERATOR' && <button onClick={onOpenMaintenance} className="rounded-md border border-cyan-800 px-3 py-1.5 text-cyan-200 hover:bg-cyan-950/50">View handoff status</button>}
                </div>
              )}
              {alarm.reviewedBy && <p className="mt-1 text-xs text-cyan-300">Reviewed by {alarm.reviewedBy}</p>}
              {alarm.resolvedBy && <p className="mt-1 text-xs text-emerald-300">{alarm.status === 'ARCHIVED' ? 'Archived by' : 'Resolved by'} {alarm.resolvedBy}</p>}
              {alarm.note && <p className="mt-2 rounded-lg border border-slate-800 bg-slate-950 p-2 text-sm text-slate-300"><MessageSquare className="mr-1 inline h-3.5 w-3.5" />Latest note: {alarm.note}</p>}

              {!['RESOLVED', 'ARCHIVED'].includes(alarm.status) && role !== 'TECHNICIAN' && (
                <div className="mt-4 flex flex-col gap-2 border-t border-slate-800 pt-3 sm:flex-row">
                  <textarea
                    value={note}
                    onChange={(event) => setNotes((current) => ({ ...current, [alarm.id]: event.target.value }))}
                    rows={2}
                    placeholder={role === 'OPERATOR' ? 'Required: what did you observe or check?' : 'Required for review/resolution: evidence checked, findings, and corrective action'}
                    className="min-h-14 min-w-0 flex-1 resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
                  />
                  {role === 'OPERATOR' && !alarm.acknowledgedBy && (
                    <button disabled={busy || note.trim().length < 3} onClick={() => onAction(alarm, 'ACKNOWLEDGE', note)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                      <Check className="h-4 w-4" /> Acknowledge
                    </button>
                  )}
                  {isReviewer ? (
                    <button disabled={busy || note.trim().length < 10} onClick={() => onAction(alarm, 'REVIEW', note)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-800 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-950/50 disabled:cursor-not-allowed disabled:opacity-50">
                      <ClipboardCheck className="h-4 w-4" /> Save review
                    </button>
                  ) : role === 'OPERATOR' ? (
                    <span className="self-center text-[10px] text-slate-500"><LockKeyhole className="mr-1 inline h-3 w-3" />Engineer/admin login is required to save a technical review.</span>
                  ) : null}
                  {role === 'OPERATOR' && alarm.source === 'TEP_CSV_REPLAY' ? (
                    <span className="self-center text-[10px] text-slate-500">Engineer closes the replay alarm after the Technician reports repair.</span>
                  ) : role === 'OPERATOR' ? (
                    <button
                      disabled={busy || alarm.status !== 'CLEARED_PENDING_REVIEW' || !alarm.acknowledgedBy || note.trim().length < 3}
                      onClick={() => onAction(alarm, 'RESOLVE', note)}
                      title={alarm.status !== 'CLEARED_PENDING_REVIEW' ? 'The sensor must return to normal before the incident can be resolved' : !alarm.acknowledgedBy ? 'Acknowledge this alarm first' : 'Add a resolution note'}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Clock3 className="h-4 w-4" /> {alarm.source === 'TEP_CSV_REPLAY' ? 'Close repaired replay' : alarm.status === 'CLEARED_PENDING_REVIEW' && alarm.acknowledgedBy ? 'Resolve with note' : 'Resolve after clear'}
                    </button>
                  ) : (
                    <button
                      disabled={busy || alarm.status !== 'CLEARED_PENDING_REVIEW' || note.trim().length < 10}
                      onClick={() => onAction(alarm, 'RESOLVE', note)}
                      title={alarm.status !== 'CLEARED_PENDING_REVIEW' ? 'The sensor must return to normal before resolution' : 'Write a complete review note to resolve'}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Clock3 className="h-4 w-4" /> {alarm.source === 'TEP_CSV_REPLAY' ? 'Engineer close' : alarm.status === 'CLEARED_PENDING_REVIEW' ? 'Resolve with review' : 'Resolve after clear'}
                    </button>
                  )}
                  {role === 'OPERATOR' && alarm.status === 'CLEARED_PENDING_REVIEW' && !alarm.acknowledgedBy && <span className="self-center text-[10px] text-amber-300">Acknowledge this event first; then resolve it.</span>}
                </div>
              )}
              {!['RESOLVED', 'ARCHIVED'].includes(alarm.status) && role === 'TECHNICIAN' && (
                <p className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500">Technician role can review alarms but does not acknowledge, resolve, or change alarm records.</p>
              )}
            </article>
          );
        })}
        <p className="pb-3 text-xs text-slate-500">Reset Plant archives open alarms without deleting their notes or audit history. Resolved and archived records are available through Show history. These are benchmark/simulator events, not real plant alarms.</p>
      </div>
    </section>
  );
};
