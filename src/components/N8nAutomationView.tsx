import React, { useState, useEffect } from 'react';
import {
  Workflow,
  Send,
  CheckCircle2,
  Clock,
  Layers,
  AlertTriangle,
  FileText,
  Bell,
  RefreshCw,
} from 'lucide-react';
import { N8nWebhookEvent } from '../types/index.js';
import { api } from '../services/api.js';

export const N8nAutomationView: React.FC = () => {
  const [webhookUrl, setWebhookUrl] = useState<string>(
    'https://n8n.internal.plant-ops.local/webhook/tep-predictive-maintenance'
  );
  const [history, setHistory] = useState<N8nWebhookEvent[]>([]);
  const [isDispatching, setIsDispatching] = useState<string | null>(null);

  const loadHistory = async () => {
    try {
      const res = await api.fetchN8nHistory();
      setHistory(res.events || []);
    } catch (err) {
      console.error('Error loading n8n history:', err);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleTrigger = async (
    type: 'MAINTENANCE_WORK_ORDER' | 'CRITICAL_ALARM' | 'SHIFT_REPORT'
  ) => {
    setIsDispatching(type);
    try {
      let payload: Record<string, any> = {};
      if (type === 'MAINTENANCE_WORK_ORDER') {
        payload = {
          targetEquipment: 'Reactor Cooling Water Jacket Valve XMV-10',
          priority: 'P1_CRITICAL',
          workOrderCode: 'WO-SAP-89210',
          assignedTeam: 'Instrumentation & Actuators Crew A',
        };
      } else if (type === 'CRITICAL_ALARM') {
        payload = {
          channel: '#plant-control-room',
          severity: 'CRITICAL',
          alertTitle: 'IDV-4 Exothermic Reactor Temperature Excursion',
          readings: 'XMEAS(9)=128.4 °C, XMEAS(21)=104.2 °C',
        };
      } else {
        payload = {
          reportPeriod: 'Shift 2 (15:00 - 23:00)',
          plantHealthAverage: '94.2%',
          totalAlarmsLogged: 2,
          openWorkOrders: 1,
        };
      }

      await api.dispatchN8n(type, payload, webhookUrl);
      await loadHistory();
    } catch (err) {
      console.error('Error triggering n8n webhook:', err);
    } finally {
      setIsDispatching(null);
    }
  };

  return (
    <div className="p-4 flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100 gap-4">
      {/* Top Banner */}
      <div className="p-4 rounded-xl border bg-slate-900 border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
              External Automation Hub
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded font-bold font-mono bg-orange-950 text-orange-300 border border-orange-700">
              n8n Node Integration
            </span>
          </div>
          <h2 className="text-base font-bold text-white mt-1 flex items-center gap-2">
            <Workflow className="w-5 h-5 text-orange-400" />
            n8n Process Automation & Webhook Dispatcher
          </h2>
          <p className="text-xs text-slate-400 font-sans mt-0.5 max-w-2xl">
            Integrates the Tennessee Eastman Digital Twin with enterprise ERP systems (SAP PM, IBM Maximo), team incident escalation (PagerDuty, Slack), and automated shift reports.
          </p>
        </div>

        <button
          onClick={loadHistory}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs flex items-center gap-1.5 transition cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh History</span>
        </button>
      </div>

      {/* Webhook Configuration */}
      <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 flex flex-col gap-2">
        <label className="text-xs font-bold text-slate-300 font-mono">
          n8n Webhook Target Endpoint URL:
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
          />
        </div>
        <p className="text-[11px] text-slate-500 font-sans">
          Requests dispatch JSON payloads containing event ID, plant telemetry snapshot, AI predictions, and engineer audit sign-off.
        </p>
      </div>

      {/* Standard Pre-Configured Workflows */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Workflow 1: Work Order Dispatch */}
        <div className="p-4 rounded-xl border bg-slate-900 border-slate-800 flex flex-col justify-between shadow-md">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
                <FileText className="w-4 h-4" />
              </span>
              <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                ERP Sync
              </span>
            </div>
            <h3 className="text-sm font-bold text-white mb-1">SAP / Maximo Work Order Dispatch</h3>
            <p className="text-xs text-slate-400 font-sans mb-3">
              Generates an approved maintenance work ticket in SAP PM, allocates spare parts from warehouse inventory, and notifies the shift lead.
            </p>
          </div>

          <button
            onClick={() => handleTrigger('MAINTENANCE_WORK_ORDER')}
            disabled={isDispatching === 'MAINTENANCE_WORK_ORDER'}
            className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {isDispatching === 'MAINTENANCE_WORK_ORDER' ? 'Dispatching...' : 'Trigger ERP Webhook'}
            </span>
          </button>
        </div>

        {/* Workflow 2: Critical Incident Alert */}
        <div className="p-4 rounded-xl border bg-slate-900 border-slate-800 flex flex-col justify-between shadow-md">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="p-2 rounded-lg bg-rose-950 text-rose-400 border border-rose-800">
                <Bell className="w-4 h-4" />
              </span>
              <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                Escalation
              </span>
            </div>
            <h3 className="text-sm font-bold text-white mb-1">PagerDuty & Slack Emergency Alert</h3>
            <p className="text-xs text-slate-400 font-sans mb-3">
              Posts formatted telemetry snapshots and SHAP explanations to #plant-control-room and triggers on-call process engineer escalation.
            </p>
          </div>

          <button
            onClick={() => handleTrigger('CRITICAL_ALARM')}
            disabled={isDispatching === 'CRITICAL_ALARM'}
            className="w-full py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>
              {isDispatching === 'CRITICAL_ALARM' ? 'Triggering...' : 'Dispatch Alert Webhook'}
            </span>
          </button>
        </div>

        {/* Workflow 3: Shift Handover Report */}
        <div className="p-4 rounded-xl border bg-slate-900 border-slate-800 flex flex-col justify-between shadow-md">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="p-2 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800">
                <Clock className="w-4 h-4" />
              </span>
              <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                PDF / JSON
              </span>
            </div>
            <h3 className="text-sm font-bold text-white mb-1">Shift Handover Reliability Report</h3>
            <p className="text-xs text-slate-400 font-sans mb-3">
              Compiles digital twin mean KPIs, cumulative anomaly counts, open maintenance tasks, and emails PDF report to plant management.
            </p>
          </div>

          <button
            onClick={() => handleTrigger('SHIFT_REPORT')}
            disabled={isDispatching === 'SHIFT_REPORT'}
            className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>
              {isDispatching === 'SHIFT_REPORT' ? 'Compiling...' : 'Dispatch Report Webhook'}
            </span>
          </button>
        </div>
      </div>

      {/* Dispatched Webhooks Execution History */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex-1 flex flex-col shadow-xl">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 pb-2 mb-3 border-b border-slate-800">
          <Clock className="w-4 h-4 text-cyan-400" />
          Dispatched n8n Webhook Execution Logs
        </h3>

        {history.length > 0 ? (
          <div className="space-y-2 overflow-y-auto pr-1">
            {history.map((evt) => (
              <div
                key={evt.id}
                className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-bold text-cyan-400">{evt.id}</span>
                  <span className="text-slate-400 px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                    {evt.workflowType}
                  </span>
                  <span className="text-slate-300 font-sans text-xs">{evt.responseMessage}</span>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      evt.status === 'DELIVERED'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                        : 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                    }`}
                  >
                    HTTP {evt.httpStatus} ({evt.status})
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500 text-xs font-sans">
            No external webhooks triggered yet. Click one of the buttons above to test the n8n automation pipeline.
          </div>
        )}
      </div>
    </div>
  );
};
