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
import { OrchestrationReport, AgentExecutionLog } from '../types/index.js';
import { api } from '../services/api.js';

interface CrewAIBoardProps {
  orchestrationReport: OrchestrationReport | null;
  onRefreshOrchestration: (report: OrchestrationReport) => void;
}

export const CrewAIBoard: React.FC<CrewAIBoardProps> = ({
  orchestrationReport,
  onRefreshOrchestration,
}) => {
  const [isRunning, setIsRunning] = useState(false);

  const handleRunMission = async () => {
    setIsRunning(true);
    try {
      const report = await api.runCrewAI();
      onRefreshOrchestration(report);
    } catch (err) {
      console.error('Error running CrewAI mission:', err);
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
      goal: 'Continuously analyze 41-sensor autoencoder residuals, multi-window persistence, and plant subsystem health indices.',
      tools: ['Autoencoder SPE Evaluator', 'Mahalanobis T² Metric', 'Persistence Tracker'],
    },
    {
      name: 'Failure Prediction Agent',
      role: 'XGBoost & Recurrent Predictive Specialist',
      icon: TrendingUp,
      color: 'border-purple-500 text-purple-400 bg-purple-950/20',
      goal: 'Predict upcoming fault classes (IDV 1..21) and estimate Time-To-Failure (TTF) from rolling sensor feature vectors.',
      tools: ['XGBoost Multi-Class Trees', 'GRU Temporal Sequence Model', 'Sliding Window Extractor'],
    },
    {
      name: 'Explainable AI (XAI) Agent',
      role: 'SHAP & Residual Attribution Explainer',
      icon: Sparkles,
      color: 'border-amber-500 text-amber-400 bg-amber-950/20',
      goal: 'Attribute mathematical decision weights to physical sensor deviations using TreeSHAP Shapley values and reconstruction errors.',
      tools: ['TreeSHAP Engine', 'Waterfall Constructor', 'Thermodynamic Translator'],
    },
    {
      name: 'Failure Diagnosis Agent',
      role: 'Knowledge Graph Reasoning Analyst',
      icon: Share2,
      color: 'border-blue-500 text-blue-400 bg-blue-950/20',
      goal: 'Synthesize ML predictions, XAI evidence, and Neo4j topological paths to generate ranked, evidence-based fault hypotheses.',
      tools: ['Neo4j Cypher Traversal', 'Causal Pathway Validator', 'Topological Mapper'],
    },
    {
      name: 'Maintenance Action Agent',
      role: 'Prescriptive Maintenance & SOP Specialist',
      icon: Wrench,
      color: 'border-emerald-500 text-emerald-400 bg-emerald-950/20',
      goal: 'Query TEP RAG engineering corpus to compile engineer-reviewable work orders, safety LOTO protocols, and spare parts.',
      tools: ['RAG Vector Search', 'Downs & Vogel Manual', 'Work Order Dispatcher'],
    },
  ];

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
              CrewAI Hierarchical Pipeline
            </span>
          </div>
          <h2 className="text-base font-bold text-white mt-1 flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            Autonomous Multi-Agent Coordination Board
          </h2>
          <p className="text-xs text-slate-400 font-sans mt-0.5 max-w-2xl">
            Coordinates 5 specialized industrial AI agents in a structured pipeline: Telemetry & Health → Prediction → SHAP XAI → Knowledge Graph Diagnosis → RAG Prescriptive Maintenance.
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

      {/* Agents Pipeline Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {agentCards.map((agent, idx) => {
          const Icon = agent.icon;
          const log = orchestrationReport?.agentLogs.find((l) => l.agentName.includes(agent.name.split(' ')[0]));
          const status = isRunning ? 'RUNNING' : log ? log.status : 'SUCCESS';

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
                        : 'bg-emerald-950 text-emerald-300 border-emerald-800'
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

      {/* Live Agent Thought Logs & Reasoning Stream */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-xl flex-1 flex flex-col">
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-400" />
            CrewAI Agent Thought Processes & Execution Logs
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
            Click "Run Multi-Agent Mission" to trigger the CrewAI orchestrator across live telemetry.
          </div>
        )}
      </div>
    </div>
  );
};
