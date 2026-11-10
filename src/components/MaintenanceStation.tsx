import React, { useState } from 'react';
import {
  Wrench,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  AlertTriangle,
  Lock,
  Send,
  FileCheck,
  FileText,
  Play,
} from 'lucide-react';
import { AlarmReviewRecord, AuthRole, MaintenanceWorkOrder, N8nWebhookEvent, OrchestrationReport } from '../types/index.js';
import { api } from '../services/api.js';

interface MaintenanceStationProps {
  orders: MaintenanceWorkOrder[];
  alarms: AlarmReviewRecord[];
  onOrderUpdated: () => void;
  report: OrchestrationReport | null;
  analysisError: string | null;
  onRunAnalysis: () => Promise<void>;
  canReview: boolean;
  role: AuthRole;
}

export const MaintenanceStation: React.FC<MaintenanceStationProps> = ({
  orders,
  alarms,
  onOrderUpdated,
  report,
  analysisError,
  onRunAnalysis,
  canReview,
  role,
}) => {
  const [selectedNotes, setSelectedNotes] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [lastN8nEvent, setLastN8nEvent] = useState<N8nWebhookEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const historicalOrders = orders.filter((order) => ['REJECTED', 'CLOSED'].includes(order.status));
  const currentOrders = orders.filter((order) => !['REJECTED', 'CLOSED'].includes(order.status));
  const visibleOrders = showHistory ? orders : currentOrders;

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setErrorMessage(null);
    try {
      await onRunAnalysis();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not run the diagnostic analysis.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAction = async (orderId: string, action: 'APPROVE' | 'REJECT' | 'DISPATCH', triggerN8n: boolean = true) => {
    setIsProcessing(orderId);
    setErrorMessage(null);
    try {
      const notes = selectedNotes[orderId] || '';
      const res = await api.actOnWorkOrder(orderId, action, notes, triggerN8n);
      if (res.n8nEvent) {
        setLastN8nEvent(res.n8nEvent);
      }
      onOrderUpdated();
    } catch (err) {
      console.error('Error acting on work order:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Unable to update the work order.');
      onOrderUpdated();
    } finally {
      setIsProcessing(null);
    }
  };

  const handleRepairLifecycle = async (orderId: string, action: 'REPAIR_COMPLETE' | 'CLOSE') => {
    setIsProcessing(orderId);
    setErrorMessage(null);
    try {
      const notes = selectedNotes[orderId] || '';
      if (action === 'REPAIR_COMPLETE') await api.completeWorkOrderRepair(orderId, notes);
      else await api.closeWorkOrder(orderId, notes);
      setSelectedNotes((current) => ({ ...current, [orderId]: '' }));
      onOrderUpdated();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to update the maintenance lifecycle.');
      onOrderUpdated();
    } finally { setIsProcessing(null); }
  };

  const getPriorityBadge = (priority: MaintenanceWorkOrder['priority']) => {
    switch (priority) {
      case 'P1_CRITICAL':
        return 'bg-rose-950 text-rose-300 border-rose-700 animate-pulse';
      case 'P2_HIGH':
        return 'bg-orange-950 text-orange-300 border-orange-700';
      case 'P3_MEDIUM':
        return 'bg-amber-950 text-amber-300 border-amber-700';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="p-4 flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-white">Work orders</h2>
          <span className="text-xs text-slate-500">{role === 'ENGINEER' ? 'Review and approve' : role === 'TECHNICIAN' ? 'Complete assigned repairs' : role === 'ADMIN' ? 'Workflow overview' : 'Ticket status'}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-md bg-slate-950 px-2.5 py-1 text-amber-300">{orders.filter((o) => o.status === 'PROPOSED_PENDING_ENGINEER').length} awaiting review</span>
          <button onClick={() => setShowHistory((value) => !value)} className="rounded-md border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800">
            {showHistory ? 'Hide history' : `History (${historicalOrders.length})`}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-cyan-900/70 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-100">
        <strong>Handoff:</strong> Operator alarm alert is sent by n8n when a sensor alarm first appears. Engineer reviews the acknowledged alarm and approves its work order. Approval sends that order to the Technician through n8n; repair and Engineer closure finish the ticket. The Engineer sees the alarm in this app.
      </div>

      {/* n8n Notification Toast */}
      {lastN8nEvent && (
        <div className={`p-3 rounded-lg border text-xs font-mono flex items-center justify-between shadow-lg ${
          lastN8nEvent.status === 'FAILED'
            ? 'bg-rose-950/80 border-rose-700 text-rose-300'
            : lastN8nEvent.status === 'SIMULATED'
              ? 'bg-amber-950/80 border-amber-700 text-amber-300'
              : 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
        }`}>
          <div className="flex items-center gap-2">
            {lastN8nEvent.status === 'FAILED'
              ? <AlertTriangle className="w-4 h-4 text-rose-400" />
              : lastN8nEvent.status === 'SIMULATED'
                ? <AlertTriangle className="w-4 h-4 text-amber-400" />
                : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            <span>
              n8n {lastN8nEvent.status === 'FAILED' ? 'Dispatch Failed' : lastN8nEvent.status === 'SIMULATED' ? 'Dispatch Simulated' : 'Workflow Dispatched'}: <strong>{lastN8nEvent.responseMessage}</strong>
            </span>
          </div>
          <span className="text-[10px] opacity-80">{new Date(lastN8nEvent.timestamp).toLocaleTimeString()}</span>
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/60 px-3 py-2 text-xs text-rose-300">
          {errorMessage}
        </div>
      )}
      {analysisError && (
        <div role="alert" className="rounded-lg border border-amber-700 bg-amber-950/50 px-3 py-2 text-xs text-amber-100">
          Automatic ticket drafting could not complete: {analysisError} You can retry the diagnostic below after starting/configuring the CrewAI service.
        </div>
      )}

      {/* Work Orders List */}
      <div className="space-y-4 flex-1">
        {visibleOrders.length === 0 ? (
          <div className="p-8 bg-slate-900 rounded-xl border border-slate-800 text-center">
            <Wrench className="w-7 h-7 text-slate-500 mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-slate-200">{orders.length > 0 ? 'No active work orders' : 'No maintenance tickets have been created'}</h3>
            <p className="max-w-2xl mx-auto mt-2 text-xs leading-relaxed text-slate-400">
              {orders.length > 0 ? 'Closed and rejected records remain in history. Start a new incident from Fault Lab or Data Replay.' : 'This does not by itself mean the plant is healthy. Inject a fault in Fault Lab, then run the analysis here.'}
            </p>
            {report && (
              <div className="max-w-2xl mx-auto mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3 text-left text-xs">
                <div className="font-mono text-cyan-300">Latest diagnostic · {report.executionId}</div>
                <div className="mt-1 text-slate-300">{report.topPredictedFault.code}: {report.topPredictedFault.name} · {(report.topPredictedFault.score * 100).toFixed(1)}% relative model score</div>
                <div className="mt-1 text-slate-500">{report.maintenancePlan ? 'A ticket was drafted; refreshing the order list…' : 'No ticket was drafted for this run because the candidate did not meet the supported-fault threshold.'}</div>
              </div>
            )}
            <button
              onClick={() => void runAnalysis()}
              disabled={isAnalyzing}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-500 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              {isAnalyzing ? 'Analyzing telemetry…' : 'Run diagnostic analysis'}
            </button>
          </div>
        ) : (
          visibleOrders.map((wo) => {
            const isPending = wo.status === 'PROPOSED_PENDING_ENGINEER';
            const isApproved = wo.status === 'APPROVED';
            const isDispatched = wo.status === 'DISPATCHED_TO_TECHNICIAN' || wo.status === 'DISPATCHED_TO_N8N';
            const isRepairComplete = wo.status === 'REPAIR_COMPLETE';
            const isClosed = wo.status === 'CLOSED';
            const linkedFaultAlarms = wo.linkedAlarmId
              ? alarms.filter((alarm) => alarm.id === wo.linkedAlarmId)
              : wo.faultSource === 'SIMULATOR_INJECTION' && wo.simulatorFaultId
                ? alarms.filter((alarm) => alarm.sourceFaults.some((fault) => fault.id === wo.simulatorFaultId)
                  && !['RESOLVED', 'ARCHIVED'].includes(alarm.status))
                : [];
            const waitingForAlarm = Boolean(wo.linkedAlarmId && (linkedFaultAlarms.length === 0 || ['RESOLVED', 'ARCHIVED'].includes(linkedFaultAlarms[0].status)))
              || (wo.faultSource === 'SIMULATOR_INJECTION' && !wo.linkedAlarmId && Boolean(wo.simulatorFaultId) && linkedFaultAlarms.length === 0);
            const waitingForOperator = linkedFaultAlarms.some((alarm) => !alarm.acknowledgedBy);
            const approvalBlocked = waitingForAlarm || waitingForOperator;
            return (
              <div
                key={wo.id}
                className={`p-4 rounded-xl border bg-slate-900 transition shadow-lg ${
                  isPending ? 'border-slate-700' : isClosed ? 'border-emerald-900 opacity-80' : 'border-slate-800'
                }`}
              >
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-800 gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-bold font-mono text-cyan-400 px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                      {wo.id}
                    </span>
                    <span className={`text-[10px] font-bold font-mono px-2.5 py-0.5 rounded border uppercase ${getPriorityBadge(wo.priority)}`}>
                      {wo.priority.replace('_', ' ')}
                    </span>
                    <h3 className="text-sm font-bold text-white">
                      {wo.targetUnit} — {wo.targetComponent}
                    </h3>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-slate-400">
                      {wo.faultSource === 'SIMULATOR_INJECTION' ? (
                        <><strong className="text-cyan-300">Fault Lab scenario {wo.simulatorFaultId}</strong> · created {new Date(wo.timestamp).toLocaleString()}</>
                      ) : (
                        <>Model candidate · created {new Date(wo.timestamp).toLocaleString()}</>
                      )}
                    </span>
                    <span className={`px-2 py-0.5 rounded font-bold ${
                      ['APPROVED', 'DISPATCHED_TO_N8N', 'DISPATCHED_TO_TECHNICIAN', 'REPAIR_COMPLETE', 'CLOSED'].includes(wo.status)
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                        : wo.status === 'REJECTED'
                        ? 'bg-rose-950 text-rose-300 border border-rose-700'
                        : 'bg-amber-950 text-amber-300 border border-amber-700'
                    }`}>
                      {wo.status === 'DISPATCHED_TO_N8N' || wo.status === 'DISPATCHED_TO_TECHNICIAN' ? 'SENT TO TECHNICIAN' : wo.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                </div>

                {wo.faultSource === 'SIMULATOR_INJECTION' && linkedFaultAlarms.length > 0 && (
                  <div className="mb-3 rounded-lg border border-cyan-900/70 bg-cyan-950/20 px-3 py-2 text-xs">
                    <div className="mb-1 font-semibold text-cyan-200">Linked sensor alarm and Operator handoff</div>
                    {linkedFaultAlarms.map((alarm) => (
                      <div key={alarm.id} className="mt-1 text-slate-300">
                        <span className="font-mono text-cyan-300">{alarm.code}</span>
                        {' - '}{alarm.name} · {alarm.alarm} · {alarm.value.toFixed(2)} {alarm.unit}
                        <span className="text-slate-400"> · {alarm.acknowledgedBy ? `Acknowledged by ${alarm.acknowledgedBy}` : 'Waiting for Operator acknowledgement'}</span>
                        {alarm.note && <p className="mt-1 text-slate-400">Operator note: “{alarm.note}”</p>}
                      </div>
                    ))}
                  </div>
                )}

                <details className="group mb-3 rounded-lg border border-slate-800 bg-slate-950/60">
                  <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-300 marker:hidden">
                    <span className="text-cyan-300">+</span> Supporting details <span className="text-slate-500">- sensors, risk, graph and references</span>
                  </summary>
                  <div className="space-y-3 border-t border-slate-800 p-3">
                {/* Body Details */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-xs">
                  {/* Recommended Checks */}
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
                    <span className="text-[10px] font-mono text-slate-500 uppercase block font-bold mb-2">
                      Prescribed Physical Checks:
                    </span>
                    <ul className="space-y-1.5 text-slate-300 font-sans">
                      {wo.recommendedChecks.map((check, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <span className="text-cyan-400 font-bold">•</span>
                          <span>{check}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Spare Parts & LOTO */}
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
                    <span className="text-[10px] font-mono text-slate-500 uppercase block font-bold mb-2">
                      Required Spare Parts & Safety:
                    </span>
                    <div className="space-y-1.5 mb-3 font-mono text-[11px]">
                      {wo.requiredParts.length === 0 && <div className="text-slate-500">No parts estimate for this prototype ticket.</div>}
                      {wo.requiredParts.map((part, idx) => (
                        <div key={idx} className="flex justify-between text-slate-300">
                          <span>{part.partNumber} ({part.description})</span>
                          <strong className="text-cyan-400">x{part.quantity}</strong>
                        </div>
                      ))}
                    </div>

                    {wo.lockoutTagoutRequired && (
                      <div className="p-1.5 rounded bg-rose-950/60 border border-rose-800/60 text-rose-300 text-[10px] font-mono flex items-center gap-1.5">
                        <Lock className="w-3 h-3 text-rose-400" />
                        <span>Lockout-Tagout (LOTO) Mandatory Prior to Intervention</span>
                      </div>
                    )}
                  </div>

                  {/* Impact & SOP Reference */}
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex flex-col justify-between font-mono">
                    <div className="space-y-2">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block">Estimated Downtime</span>
                        <strong className="text-sm text-slate-200">{wo.estimatedDowntimeHours > 0 ? `${wo.estimatedDowntimeHours} hours` : 'Not estimated'}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block">Cost Avoidance</span>
                        <strong className="text-sm text-emerald-400 font-bold">
                          {wo.costAvoidanceUsd > 0 ? `$${wo.costAvoidanceUsd.toLocaleString()} USD` : 'Not estimated'}
                        </strong>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 font-sans">
                      <strong className="font-mono text-cyan-400 block mb-0.5">Fault reference (verify source):</strong>
                      {wo.applicableSop}
                    </div>
                  </div>
                </div>

                {(wo.assignedTechnician || wo.technicianNotes || wo.closureNotes) && (
                  <div className="mb-4 rounded-lg border border-violet-900/70 bg-violet-950/20 p-3 text-xs">
                    {wo.assignedTechnician && <p className="text-violet-200">Assigned technician: <strong>{wo.assignedTechnician}</strong></p>}
                    {wo.technicianNotes && <p className="mt-1 text-slate-300">Repair report: {wo.technicianNotes}</p>}
                    {wo.closedBy && <p className="mt-1 text-emerald-300">Closed by {wo.closedBy}{wo.closedAt ? ` · ${new Date(wo.closedAt).toLocaleString()}` : ''}{wo.closureNotes ? ` · ${wo.closureNotes}` : ''}</p>}
                  </div>
                )}

                {wo.riskBand && typeof wo.riskScore === 'number' && (
                  <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-xs">
                    <strong className="text-amber-200">Rule-based risk: {wo.riskBand} · {wo.riskScore}/100</strong>
                    <span className="text-slate-400">Severity + model score + process-unit criticality. Advisory benchmark score; engineer approval is required.</span>
                  </div>
                )}

                {wo.triage && (
                  <div className="mb-4 rounded-lg border border-violet-900/70 bg-violet-950/20 p-3 text-xs">
                    <strong className="text-violet-200">Engineer review queue · priority {wo.triage.reviewPriority}/100</strong>
                    <div className="mt-1 text-slate-300">Expected severity {wo.triage.expectedSeverity}/100 · model uncertainty {(wo.triage.uncertainty * 100).toFixed(1)}% ({wo.triage.uncertaintyBand})</div>
                    {wo.triage.evidenceGaps.length > 0 && <div className="mt-1 text-slate-400">Evidence gaps: {wo.triage.evidenceGaps.join(' · ')}</div>}
                    <div className="mt-1 text-[10px] text-amber-300">Scores are uncalibrated XGBoost outputs; queue order is advisory and does not approve or dispatch work.</div>
                  </div>
                )}

                {wo.modelEvidence && (
                  <div className="mb-4 rounded-lg border border-cyan-900/70 bg-cyan-950/10 p-3">
                    <div className="flex flex-wrap justify-between gap-2 text-[10px]">
                      <strong className="font-mono uppercase text-cyan-300">{wo.modelEvidence.model} · {wo.modelEvidence.explanationMethod} · TEP replay</strong>
                      <span className="text-slate-400">Fault score {(wo.modelEvidence.faultScore * 100).toFixed(1)}% · class score {(wo.modelEvidence.classConfidence * 100).toFixed(1)}%</span>
                    </div>
                    {wo.modelEvidence.replayFile && <p className="mt-1 text-[10px] text-slate-500">Source file: {wo.modelEvidence.replayFile}</p>}
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {wo.modelEvidence.topSensors.map((sensor) => (
                        <div key={sensor.sensor} className="flex justify-between gap-2 rounded bg-slate-950 px-2 py-1 text-[10px]">
                          <span className="text-slate-300">{sensor.sensor}{typeof sensor.actual === 'number' ? ` · ${sensor.actual.toFixed(2)} ${sensor.unit || ''}` : ''}</span>
                          <span className="font-mono text-cyan-300">SHAP {sensor.contribution >= 0 ? '+' : ''}{sensor.contribution.toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] text-slate-500">SHAP values show model contribution, not proof of physical cause.</p>
                  </div>
                )}

                {wo.impactAnalysis && (
                  <div className="mb-4 rounded-lg border border-violet-900/70 bg-violet-950/10 p-3 text-xs">
                    <strong className="text-violet-200">Graph impact review · {wo.impactAnalysis.graphSource === 'LOCAL_FALLBACK' ? 'local graph' : 'Neo4j'}</strong>
                    <p className="mt-1 text-slate-300">Primary unit: {wo.impactAnalysis.primaryUnit || wo.targetUnit}</p>
                    <p className="mt-1 text-slate-400">Connected units: {wo.impactAnalysis.connectedUnits.join(', ') || 'No connected unit recorded'}</p>
                    <p className="mt-1 text-slate-400">Linked sensors: {wo.impactAnalysis.linkedSensors.join(', ') || 'None listed'} · Unverified procedure references: {wo.impactAnalysis.linkedProcedures.join(', ') || 'None listed'}</p>
                    <p className="mt-2 text-[10px] text-amber-300">{wo.impactAnalysis.interpretation}</p>
                  </div>
                )}

                {(wo.sensorSnapshot?.length || wo.ragEvidence?.length || wo.attachedSop) ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
                    {wo.sensorSnapshot && wo.sensorSnapshot.length > 0 && (
                      <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="mb-2 text-[10px] font-mono font-bold uppercase text-slate-500">Sensor snapshot at draft time</div>
                        <div className="space-y-1.5">
                          {wo.sensorSnapshot.map((sensor) => (
                            <div key={sensor.code} className="flex flex-wrap justify-between gap-x-3 text-xs">
                              <span className="text-slate-300"><strong className="font-mono text-cyan-300">{sensor.code}</strong> {sensor.name}</span>
                              <span className="font-mono text-slate-400">{sensor.actual.toFixed(2)} {sensor.unit} · z {sensor.zScore.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {wo.lockoutTagoutRequired === null && (
                      <div className="p-1.5 rounded bg-amber-950/60 border border-amber-800/60 text-amber-200 text-[10px] font-mono flex items-center gap-1.5">
                        <Lock className="w-3 h-3" />
                        <span>LOTO status is not determined from this data; verify the approved site procedure before work.</span>
                      </div>
                    )}
                    {wo.ragEvidence && wo.ragEvidence.length > 0 && (
                      <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="mb-2 text-[10px] font-mono font-bold uppercase text-slate-500">Cited research context · not a site work instruction</div>
                        <div className="space-y-3">
                          {wo.ragEvidence.map((evidence, index) => (
                            <div key={`${evidence.title}-${evidence.section}-${index}`}>
                              <div className="text-xs font-semibold text-cyan-300">{evidence.title}</div>
                              <div className="text-[10px] text-slate-500">{evidence.section} · BM25/entity rank {evidence.relevance.toFixed(2)} · {evidence.sourceStatus?.replaceAll('_', ' ') || 'source status unknown'}</div>
                              {evidence.citation && evidence.sourceUrl && <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-400 hover:underline">{evidence.citation}</a>}
                              <p className="mt-1 text-xs leading-relaxed text-slate-300">{evidence.snippet}</p>
                            </div>
                          ))}
                        </div>
                        <p className="mt-2 border-t border-slate-800 pt-2 text-[10px] text-amber-300">These references describe the TEP benchmark; use current site-approved procedures for physical work.</p>
                      </div>
                    )}
                    {wo.attachedSop && (
                      <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/70">
                        <div className="mb-1 text-[10px] font-mono font-bold uppercase text-amber-300">Engineer-attached reference · {wo.attachedSop.sourceStatus?.replaceAll('_', ' ') || 'source status unknown'}</div>
                        <div className="text-xs font-semibold text-white">{wo.attachedSop.title}</div>
                        <div className="text-[10px] text-slate-400">{wo.attachedSop.section}</div>
                        {wo.attachedSop.citation && wo.attachedSop.sourceUrl && <a href={wo.attachedSop.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block text-[10px] text-cyan-300 hover:underline">{wo.attachedSop.citation}</a>}
                        <p className="mt-2 text-xs leading-relaxed text-slate-300">{wo.attachedSop.snippet}</p>
                      </div>
                    )}
                  </div>
                ) : null}

                  </div>
                </details>

                {/* Engineer Action Bar */}
                {isPending && canReview ? (
                  <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                    {wo.faultSource === 'SIMULATOR_INJECTION' && (
                      <div className={`w-full rounded-lg border px-3 py-2 text-xs ${approvalBlocked ? 'border-amber-800 bg-amber-950/30 text-amber-200' : 'border-emerald-800 bg-emerald-950/25 text-emerald-200'}`}>
                        {waitingForAlarm
                          ? 'Waiting for a linked sensor to cross its configured alarm limit; no Operator acknowledgement is available yet.'
                          : waitingForOperator
                            ? `Waiting for Operator acknowledgement: ${linkedFaultAlarms.filter((alarm) => !alarm.acknowledgedBy).map((alarm) => alarm.code).join(', ')}.`
                            : 'Operator has acknowledged the linked sensor alarm(s). Engineer approval is now enabled.'}
                      </div>
                    )}
                    <input
                      type="text"
                      placeholder="Engineer review notes (e.g., 'Inspected air supply regulator; confirmed 4.2 bar')..."
                      value={selectedNotes[wo.id] || ''}
                      onChange={(e) =>
                        setSelectedNotes({ ...selectedNotes, [wo.id]: e.target.value })
                      }
                      className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 flex-1 min-w-[240px] focus:outline-none focus:border-cyan-500 font-sans"
                    />

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAction(wo.id, 'REJECT')}
                        disabled={isProcessing === wo.id || (selectedNotes[wo.id] || '').trim().length < 10}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-300 border border-slate-700 hover:border-rose-700 text-xs font-semibold transition cursor-pointer"
                      >
                        Reject as False Alarm
                      </button>

                      <button
                        onClick={() => handleAction(wo.id, 'APPROVE', true)}
                        disabled={isProcessing === wo.id || approvalBlocked || (selectedNotes[wo.id] || '').trim().length < 10}
                        className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve & send to Technician</span>
                      </button>
                    </div>
                  </div>
                ) : isApproved && canReview ? (
                  <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-amber-300">Approved; awaiting n8n dispatch.</span>
                    <button
                      onClick={() => handleAction(wo.id, 'DISPATCH')}
                      disabled={isProcessing === wo.id}
                      className="px-4 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold flex items-center gap-1.5 transition shadow cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{isProcessing === wo.id ? 'Dispatching...' : 'Retry n8n Dispatch'}</span>
                    </button>
                  </div>
                ) : isDispatched && role === 'TECHNICIAN' ? (
                  <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-3">
                    <input type="text" placeholder="Describe repair performed and observed outcome (10+ characters)" value={selectedNotes[wo.id] || ''} onChange={(event) => setSelectedNotes((current) => ({ ...current, [wo.id]: event.target.value }))} className="min-w-[240px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
                    <button onClick={() => void handleRepairLifecycle(wo.id, 'REPAIR_COMPLETE')} disabled={isProcessing === wo.id || (selectedNotes[wo.id] || '').trim().length < 10} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Wrench className="h-3.5 w-3.5" />Record repair complete</button>
                  </div>
                ) : isRepairComplete && canReview ? (
                  <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-3">
                    <input type="text" placeholder="Engineer final review and closure note (10+ characters)" value={selectedNotes[wo.id] || ''} onChange={(event) => setSelectedNotes((current) => ({ ...current, [wo.id]: event.target.value }))} className="min-w-[240px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
                    <button onClick={() => void handleRepairLifecycle(wo.id, 'CLOSE')} disabled={isProcessing === wo.id || (selectedNotes[wo.id] || '').trim().length < 10} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" />Engineer close ticket</button>
                  </div>
                ) : (
                  <div className="pt-2 border-t border-slate-800/80 text-xs text-slate-400 font-sans flex items-center justify-between">
                    <span>
                      {isPending ? 'Engineer review required. Add evidence before approving or rejecting.' : isDispatched ? 'Work order sent after engineer approval. The assigned Technician records the repair here.' : isRepairComplete ? 'Technician reported completion. Engineer must review and close the ticket.' : <>Engineer review: <em>{wo.engineerNotes || 'Review recorded.'}</em></>}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">Audit Verified</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
