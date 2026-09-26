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
} from 'lucide-react';
import { MaintenanceWorkOrder, N8nWebhookEvent } from '../types/index.js';
import { api } from '../services/api.js';

interface MaintenanceStationProps {
  orders: MaintenanceWorkOrder[];
  onOrderUpdated: () => void;
}

export const MaintenanceStation: React.FC<MaintenanceStationProps> = ({
  orders,
  onOrderUpdated,
}) => {
  const [selectedNotes, setSelectedNotes] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [lastN8nEvent, setLastN8nEvent] = useState<N8nWebhookEvent | null>(null);

  const handleAction = async (orderId: string, action: 'APPROVE' | 'REJECT', triggerN8n: boolean = true) => {
    setIsProcessing(orderId);
    try {
      const notes = selectedNotes[orderId] || '';
      const res = await api.actOnWorkOrder(orderId, action, notes, triggerN8n);
      if (res.n8nEvent) {
        setLastN8nEvent(res.n8nEvent);
      }
      onOrderUpdated();
    } catch (err) {
      console.error('Error acting on work order:', err);
    } finally {
      setIsProcessing(null);
    }
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
      {/* Top Banner */}
      <div className="p-4 rounded-xl border bg-slate-900 border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
              Human-In-The-Loop Decision Station
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded font-bold font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
              Reliability Engineering Review
            </span>
          </div>
          <h2 className="text-base font-bold text-white mt-1 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-cyan-400" />
            Engineer-Reviewable Maintenance Priorities & Work Orders
          </h2>
          <p className="text-xs text-slate-400 font-sans mt-0.5 max-w-2xl">
            Synthesizes Machine Health, XGBoost predictions, SHAP attribution, Knowledge Graph causality, and RAG SOPs. A human reliability engineer maintains final authority before dispatching maintenance crews or triggering n8n automation.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="px-3 py-1.5 rounded-lg bg-slate-950 text-amber-400 border border-slate-800 font-bold">
            Pending Orders: {orders.filter((o) => o.status === 'PROPOSED_PENDING_ENGINEER').length}
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-slate-950 text-emerald-400 border border-slate-800 font-bold">
            Approved: {orders.filter((o) => o.status === 'APPROVED' || o.status === 'DISPATCHED_TO_N8N').length}
          </span>
        </div>
      </div>

      {/* n8n Notification Toast */}
      {lastN8nEvent && (
        <div className="p-3 rounded-lg bg-emerald-950/80 border border-emerald-700 text-emerald-300 text-xs font-mono flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>
              n8n Workflow Dispatched: <strong>{lastN8nEvent.responseMessage}</strong>
            </span>
          </div>
          <span className="text-[10px] text-emerald-500">{new Date(lastN8nEvent.timestamp).toLocaleTimeString()}</span>
        </div>
      )}

      {/* Work Orders List */}
      <div className="space-y-4 flex-1">
        {orders.length === 0 ? (
          <div className="p-12 text-center bg-slate-900 rounded-xl border border-slate-800 text-slate-500 font-sans text-xs">
            No work orders currently pending. The plant is operating within normal boundaries.
          </div>
        ) : (
          orders.map((wo) => {
            const isPending = wo.status === 'PROPOSED_PENDING_ENGINEER';
            return (
              <div
                key={wo.id}
                className={`p-4 rounded-xl border bg-slate-900 transition shadow-lg ${
                  isPending ? 'border-slate-700' : 'border-slate-800 opacity-85'
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
                      Confidence: <strong className="text-cyan-400">{(wo.confidence * 100).toFixed(1)}%</strong>
                    </span>
                    <span className={`px-2 py-0.5 rounded font-bold ${
                      wo.status === 'APPROVED' || wo.status === 'DISPATCHED_TO_N8N'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                        : wo.status === 'REJECTED'
                        ? 'bg-rose-950 text-rose-300 border border-rose-700'
                        : 'bg-amber-950 text-amber-300 border border-amber-700'
                    }`}>
                      {wo.status}
                    </span>
                  </div>
                </div>

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
                        <strong className="text-sm text-slate-200">{wo.estimatedDowntimeHours} hours</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase block">Cost Avoidance</span>
                        <strong className="text-sm text-emerald-400 font-bold">
                          ${wo.costAvoidanceUsd.toLocaleString()} USD
                        </strong>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 font-sans">
                      <strong className="font-mono text-cyan-400 block mb-0.5">SOP Reference:</strong>
                      {wo.applicableSop}
                    </div>
                  </div>
                </div>

                {/* Engineer Action Bar */}
                {isPending ? (
                  <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
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
                        disabled={isProcessing === wo.id}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-300 border border-slate-700 hover:border-rose-700 text-xs font-semibold transition cursor-pointer"
                      >
                        Reject as False Alarm
                      </button>

                      <button
                        onClick={() => handleAction(wo.id, 'APPROVE', true)}
                        disabled={isProcessing === wo.id}
                        className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition shadow cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve & Dispatch via n8n</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pt-2 border-t border-slate-800/80 text-xs text-slate-400 font-sans flex items-center justify-between">
                    <span>
                      Engineer Sign-off: <em>{wo.engineerNotes || 'Approved by reliability engineer on duty.'}</em>
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
