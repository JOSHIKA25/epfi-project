import React, { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCircle2, Clock, RefreshCw, Send, Workflow, XCircle } from 'lucide-react';
import type { N8nWebhookEvent } from '../types/index.js';
import { api } from '../services/api.js';

const FLOW_EVENTS = new Set<N8nWebhookEvent['workflowType']>([
  'CRITICAL_ALARM',
  'MAINTENANCE_WORK_ORDER',
]);

export const N8nAutomationView: React.FC = () => {
  const [history, setHistory] = useState<N8nWebhookEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.fetchN8nHistory();
      setHistory((result.events ?? []).filter((event) => FLOW_EVENTS.has(event.workflowType)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load notification history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    const interval = window.setInterval(() => void loadHistory(), 5000);
    return () => window.clearInterval(interval);
  }, [loadHistory]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-slate-950 p-4 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-orange-300">
            <Workflow className="h-4 w-4" /> n8n notifications
          </p>
          <h1 className="mt-1 text-lg font-bold text-white">Incident notification history</h1>
          <p className="mt-1 max-w-3xl text-xs text-slate-400">
            Notifications are sent by the incident workflow. There are no manual sample dispatches on this page.
          </p>
        </div>
        <button
          onClick={() => void loadHistory()}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      <section className="grid gap-3 md:grid-cols-2">
        <article className="rounded-xl border border-amber-900/70 bg-amber-950/20 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
            <Bell className="h-4 w-4" /> Alarm detected → Operator
          </div>
          <p className="mt-2 text-xs text-slate-400">Sent when a new alarm is raised. Event type: <code>CRITICAL_ALARM</code>.</p>
        </article>
        <article className="rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-200">
            <Send className="h-4 w-4" /> Engineer approval → Technician
          </div>
          <p className="mt-2 text-xs text-slate-400">Sent only after the Engineer approves a linked work order. Event type: <code>MAINTENANCE_WORK_ORDER</code>.</p>
        </article>
      </section>

      <aside className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-400">
        Both events use the server’s <code>N8N_WEBHOOK_URL</code>. Set it to the active workflow’s <strong className="text-slate-200">Production URL</strong>, then restart the app server. In n8n, route the incoming <code>workflowType</code> to the matching notification action.
        <span className="mt-1 block text-slate-500">A 404 usually means the webhook path is wrong or the workflow is not active. HTTP success means n8n accepted the request; verify the notification node in Executions.</span>
      </aside>

      {error && <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}

      <section className="min-h-48 flex-1 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex items-center gap-2 border-b border-slate-800 pb-2 text-sm font-semibold text-white">
          <Clock className="h-4 w-4 text-cyan-300" /> Automatic dispatch history
        </div>
        {history.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">No alarm or approved work-order notifications have been recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((event) => {
              const accepted = event.status === 'DELIVERED';
              const simulated = event.status === 'SIMULATED';
              return (
                <article key={event.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-500">{event.id}</span>
                      <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-cyan-200">{event.workflowType}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-300">{event.responseMessage}</p>
                    {event.httpStatus === 404 && <p className="mt-1 text-[11px] text-amber-300">Check that N8N_WEBHOOK_URL is the active Production URL for this workflow, then restart the app.</p>}
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold ${accepted ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300' : simulated ? 'border-amber-800 bg-amber-950/40 text-amber-300' : 'border-rose-800 bg-rose-950/40 text-rose-300'}`}>
                    {accepted ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {simulated ? 'SIMULATED' : accepted ? `HTTP ${event.httpStatus} · ACCEPTED` : `HTTP ${event.httpStatus} · FAILED`}
                  </span>
                </article>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-500">Use n8n Executions to confirm the Gmail, Slack, or technician notification node actually ran.</p>
      </section>
    </div>
  );
};
