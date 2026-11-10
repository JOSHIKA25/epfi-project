import React, { useState } from 'react';
import {
  Layers,
  Play,
  RotateCcw,
  CheckCircle2,
  Clock,
  Activity,
  Bot,
  ShieldCheck,
  TrendingUp,
  Sparkles,
  Share2,
  Wrench,
  ArrowDown,
} from 'lucide-react';
import { OrchestrationReport, UnitAgentAssessment } from '../types/index.js';
import { api } from '../services/api.js';

interface CrewAIBoardProps {
  orchestrationReport: OrchestrationReport | null;
  unitAgents: UnitAgentAssessment[];
  unitAgentsError?: string | null;
  initialError?: string | null;
  onRefreshOrchestration: (report: OrchestrationReport) => void | Promise<void>;
}

export const CrewAIBoard: React.FC<CrewAIBoardProps> = ({
  orchestrationReport,
  unitAgents,
  unitAgentsError,
  initialError,
  onRefreshOrchestration,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleRunMission = async () => {
    setIsRunning(true);
    setErrorMessage(null);
    try {
      const report = await api.runCrewAI();
      await onRefreshOrchestration(report);
    } catch (err) {
      console.error('Error running CrewAI mission:', err);
      setErrorMessage(err instanceof Error ? err.message : 'CrewAI mission failed.');
    } finally {
      setIsRunning(false);
    }
  };

  const agentCards = [
    {
      name: 'Process Health Agent',
      role: 'Telemetry & Anomaly Monitor',
      icon: ShieldCheck,
      color: 'border-cyan-500 text-cyan-400 bg-cyan-950/20',
      goal: 'Continuously analyze 38 verified shared-channel autoencoder residuals, multi-window persistence, and plant subsystem health indices.',
      tools: ['Telemetry Context', 'Anomaly Report', 'Unit Health Assessment'],
    },
    {
      name: 'Failure Prediction Agent',
      role: 'Predictive Model Review',
      icon: TrendingUp,
      color: 'border-purple-500 text-purple-400 bg-purple-950/20',
      goal: 'Review the local fault estimate and supplied risk indicators without changing model outputs.',
      tools: ['Prediction Context', 'Risk Review', 'Evidence Summary'],
    },
    {
      name: 'Explainable AI (XAI) Agent',
      role: 'Heuristic Sensor Attribution Analyst',
      icon: Sparkles,
      color: 'border-amber-500 text-amber-400 bg-amber-950/20',
      goal: 'Summarize the available attribution evidence without adding unsupported physical causes.',
      tools: ['Relative Attribution Summary', 'Sensor Deviation Context', 'Evidence Review'],
    },
    {
      name: 'Failure Diagnosis Agent',
      role: 'Knowledge Graph Reasoning Analyst',
      icon: Share2,
      color: 'border-blue-500 text-blue-400 bg-blue-950/20',
      goal: 'Synthesize predictions, XAI evidence, and the process-graph subgraph into traceable hypotheses.',
      tools: ['Prediction Context', 'Graph Subgraph', 'Evidence Synthesis'],
    },
    {
      name: 'Maintenance Action Agent',
      role: 'Prescriptive Maintenance & SOP Specialist',
      icon: Wrench,
      color: 'border-emerald-500 text-emerald-400 bg-emerald-950/20',
      goal: 'Draft safe, engineer-reviewable inspection checks grounded in retrieved process documentation.',
      tools: ['Retrieved SOP Evidence', 'Safety Review', 'Work Order Draft'],
    },
  ];

  const getUnitAgentStatusClass = (status: UnitAgentAssessment['status']) => {
    if (status === 'URGENT_REVIEW') return 'border-rose-800 bg-rose-950/50 text-rose-300';
    if (status === 'ATTENTION') return 'border-amber-800 bg-amber-950/50 text-amber-300';
    if (status === 'REVIEW') return 'border-sky-800 bg-sky-950/40 text-sky-300';
    return 'border-emerald-800 bg-emerald-950/40 text-emerald-300';
  };

  const getDigitalGateClass = (gate: UnitAgentAssessment['digitalGate']) => (
    gate === 'HOLD_REVIEW'
      ? 'border-rose-800 bg-rose-950/50 text-rose-300'
      : 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
  );

  return (
    <div className="p-4 flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100 gap-4">
      {/* Top Banner */}
      <div className="p-4 rounded-xl border bg-slate-900 border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
              Agent Orchestration Framework
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded font-bold font-mono bg-indigo-950 text-indigo-300 border border-indigo-700">
              {orchestrationReport?.agentExecutionMode === 'CREWAI_REMOTE' ? 'Remote CrewAI · LLM' : 'Local sequential pipeline · no external LLM'}
            </span>
          </div>
          <h2 className="text-base font-bold text-white mt-1 flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            Event-Driven Unit Agent Board
          </h2>
          <p className="text-xs text-slate-400 font-sans mt-0.5 max-w-2xl">
            Local monitors check every unit. A meaningful deviation starts agents in process order: Reactor → Condenser → Separator, then the Stripper liquid branch and Compressor recycle branch. Every stage passes a clear or flagged report forward; the Plant Coordinator checks the whole-plant picture. Remote chains are cooldown-limited.
          </p>
        </div>

        {/* Action Button */}
        <button
          onClick={handleRunMission}
          disabled={isRunning}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-xs flex items-center gap-2 transition shadow-lg cursor-pointer"
        >
          {isRunning ? (
            <Activity className="w-4 h-4 animate-spin text-white" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          <span>{isRunning ? 'Orchestrating Agents...' : 'Run Multi-Agent Mission'}</span>
        </button>
      </div>

      {(errorMessage || initialError) && (
        <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/60 px-3 py-2 text-xs text-rose-300">
          {errorMessage || initialError}
        </div>
      )}

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white">Per-Unit Telemetry Monitors</h3>
            <p className="mt-1 text-[11px] text-slate-400">
              Independent, rule-based monitors for the five simulated process units. Status mirrors existing simulator health/alarm logic; these are not control agents.
            </p>
          </div>
          <span className="rounded border border-amber-800 bg-amber-950/50 px-2 py-1 text-[10px] font-mono text-amber-300">
            SIMULATED DATA · ADVISORY ONLY
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
          {unitAgents.map((agent) => (
            <article key={agent.unit} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-white">{agent.unitName}</h4>
                  <p className="text-[10px] text-slate-500">{agent.agentName}</p>
                </div>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] font-mono ${getUnitAgentStatusClass(agent.status)}`}>
                  {agent.status}
                </span>
              </div>
              <div className={`mb-2 rounded border px-2 py-1 text-[9px] font-mono ${getDigitalGateClass(agent.digitalGate)}`}>
                DIGITAL REVIEW: {agent.digitalGate === 'HOLD_REVIEW' ? 'HOLD / OPERATOR REVIEW' : 'READY'}
              </div>
              {agent.upstreamUnits.length > 0 && (
                <p className="mb-2 text-[9px] text-slate-500">
                  Depends on: {agent.upstreamUnits.join(', ')}
                </p>
              )}
              {agent.blockedByUnits.length > 0 && (
                <p className="mb-2 text-[10px] text-rose-300">
                  Review held by: {agent.blockedByUnits.join(', ')}
                </p>
              )}
              <p className="mb-2 text-[10px] text-slate-400">
                Health {agent.healthIndex === null ? 'unavailable' : `${agent.healthIndex}%`}
                {' · '}{agent.activeAlarmsCount} active alarm(s)
              </p>
              {agent.dataQuality === 'INCOMPLETE' && (
                <p className="mb-2 text-[10px] text-amber-300">
                  Missing/unusable: {agent.missingChannels.join(', ')}
                </p>
              )}
              <div className="space-y-1">
                {agent.observations.slice(0, 4).map((observation) => (
                  <div key={observation.channelId} className="flex justify-between gap-2 text-[10px] font-mono">
                    <span className="text-slate-400">{observation.channelId}</span>
                    <span className={observation.alarm === 'NORMAL' ? 'text-cyan-300' : 'text-amber-300'}>
                      {observation.value === null ? 'Unavailable' : observation.value.toFixed(2)}
                      {' · '}{observation.alarm}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 border-t border-slate-800 pt-2 text-[10px] leading-snug text-slate-400">
                {agent.recommendation}
              </p>
              <p className="mt-2 text-[9px] text-slate-600">
                Snapshot: {new Date(agent.telemetryTimestamp).toLocaleTimeString()}
              </p>
            </article>
          ))}
          {unitAgents.length === 0 && (
            <p className="col-span-full rounded border border-slate-800 p-3 text-xs text-slate-500">
              {unitAgentsError || 'Unit monitor assessments are not available yet.'}
            </p>
          )}
        </div>
      </section>

      {/* Agents Pipeline Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {agentCards.map((agent, idx) => {
          const Icon = agent.icon;
          const log = orchestrationReport?.agentLogs.find((l) => l.agentName.includes(agent.name.split(' ')[0]));
          const status = isRunning ? 'RUNNING' : log?.status ?? 'PENDING';

          return (
            <div
              key={idx}
              className={`p-3.5 rounded-xl border flex flex-col justify-between shadow-md transition-all ${agent.color}`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span
                    className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${
                      status === 'RUNNING'
                        ? 'bg-amber-950 text-amber-300 border-amber-700 animate-pulse'
                        : status === 'SUCCESS'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                          : status === 'WARNING'
                            ? 'bg-rose-950 text-rose-300 border-rose-800'
                            : 'bg-slate-900 text-slate-400 border-slate-700'
                    }`}
                  >
                    {status}
                  </span>
                </div>

                <h3 className="text-xs font-bold text-white leading-tight mb-1">{agent.name}</h3>
                <div className="text-[10px] text-slate-400 font-mono mb-2">{agent.role}</div>

                <p className="text-[11px] text-slate-300 font-sans leading-snug mb-3">
                  {agent.goal}
                </p>
              </div>

              {/* Tools list */}
              <div className="pt-2 border-t border-slate-800/80">
                <span className="text-[9px] font-mono text-slate-500 uppercase block mb-1">Equipped Tools:</span>
                <div className="flex flex-wrap gap-1">
                  {agent.tools.map((tool, tIdx) => (
                    <span
                      key={tIdx}
                      className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-950 text-slate-400 border border-slate-800"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Agent Execution Logs */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-xl flex-1 flex flex-col">
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-400" />
            CrewAI Agent Execution Logs
          </h3>
          <span className="text-xs font-mono text-slate-400">
            Execution ID: <strong className="text-slate-200">{orchestrationReport?.executionId || 'CREW-IDLE'}</strong>
          </span>
        </div>

        {orchestrationReport?.agentLogs && orchestrationReport.agentLogs.length > 0 ? (
          <div className="space-y-3 overflow-y-auto pr-1">
            {orchestrationReport.agentLogs.map((log, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono"
              >
                <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-900">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-indigo-300">
                      Step {idx + 1}: {log.agentName}
                    </span>
                    <span className="text-[11px] text-slate-400">({log.role})</span>
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                <div className="mb-2">
                  <span className="text-[10px] text-slate-500 uppercase block font-bold">Agent Thought:</span>
                  <p className="text-slate-300 font-sans text-xs mt-0.5">{log.thought}</p>
                </div>

                <div className="mb-2">
                  <span className="text-[10px] text-slate-500 uppercase block font-bold">Action Executed:</span>
                  <span className="text-cyan-400 font-mono text-xs">{log.actionTaken}</span>
                </div>

                <div className="p-2 rounded bg-slate-900 border border-slate-800/80 text-[11px] font-sans text-emerald-300">
                  <strong className="font-mono text-emerald-400 uppercase text-[10px] block mb-0.5">Synthesized Output:</strong>
                  {log.outputSummary}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-500 text-xs font-sans">
            No agent report yet. Significant unit alerts trigger focused analysis automatically; the button above can run the full diagnostic mission manually.
          </div>
        )}
      </div>
    </div>
  );
};
