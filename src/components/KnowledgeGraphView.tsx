import React, { useState, useEffect } from 'react';
import {
  Share2,
  Terminal,
  Play,
  RotateCcw,
  Search,
  Filter,
  Layers,
  Database,
  Info,
} from 'lucide-react';
import { KnowledgeGraphData, GraphNode, GraphRelationship } from '../types/index.js';
import { api } from '../services/api.js';

interface KnowledgeGraphViewProps {
  graphData: KnowledgeGraphData | null;
  activeFaultId?: number;
}

export const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({
  graphData,
  activeFaultId,
}) => {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [filterLabel, setFilterLabel] = useState<string>('all');
  const [cypherQuery, setCypherQuery] = useState<string>(
    "MATCH (f:Fault {id: 'IDV-4'})-[:CAUSES]->(s:Symptom)<-[:EXHIBITS_SYMPTOM]-(u:Unit) RETURN f, s, u"
  );
  const [cypherResult, setCypherResult] = useState<{
    results: any[];
    summary: string;
    executionTimeMs: number;
  } | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const sampleQueries = [
    {
      title: 'Active Fault Causal Chain',
      query: 'MATCH (f:Fault)-[:CAUSES]->(s:Symptom) RETURN f, s',
    },
    {
      title: 'Maintenance SOPs for Faults',
      query: 'MATCH (m:MaintenanceProcedure)-[:REMEDIED_BY]->(f:Fault) RETURN m, f',
    },
    {
      title: 'Sensors linked to Process Units',
      query: 'MATCH (s:Sensor)-[:LOCATED_IN]->(u:Unit) RETURN s, u',
    },
    {
      title: 'Unit Flow Diagram Topology',
      query: 'MATCH (u1:Unit)-[:FLOWS_TO]->(u2:Unit) RETURN u1, u2',
    },
  ];

  const handleExecuteCypher = async (q?: string) => {
    const queryToRun = q || cypherQuery;
    setIsExecuting(true);
    try {
      const res = await api.executeCypher(queryToRun);
      setCypherResult(res);
    } catch (err: any) {
      setCypherResult({
        results: [],
        summary: `Error executing query: ${err.message}`,
        executionTimeMs: 0,
      });
    } finally {
      setIsExecuting(false);
    }
  };

  useEffect(() => {
    handleExecuteCypher();
  }, []);

  const nodes = graphData?.nodes || [];
  const relationships = graphData?.relationships || [];

  const filteredNodes = nodes.filter((n) => {
    if (filterLabel === 'all') return true;
    return n.label === filterLabel;
  });

  const getNodeColor = (label: GraphNode['label']) => {
    switch (label) {
      case 'Unit':
        return '#06b6d4'; // Cyan
      case 'Fault':
        return '#f43f5e'; // Rose
      case 'Symptom':
        return '#f59e0b'; // Amber
      case 'MaintenanceProcedure':
        return '#10b981'; // Emerald
      case 'Actuator':
        return '#8b5cf6'; // Violet
      case 'Sensor':
        return '#3b82f6'; // Blue
      default:
        return '#94a3b8';
    }
  };

  return (
    <div className="p-4 flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100 gap-4">
      {/* Top Banner */}
      <div className="p-4 rounded-xl border bg-slate-900 border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Share2 className="w-5 h-5 text-cyan-400" />
            Tennessee Eastman Process Knowledge Graph (Neo4j Graph Engine)
          </h2>
          <p className="text-xs text-slate-400 font-sans mt-0.5 max-w-2xl">
            Ontological industrial representation mapping Process Units, Transmitters, Actuators, 21 TEP Faults, Root Causes, Symptoms, and Standard Operating Procedures.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
            Nodes: <strong className="text-cyan-400">{nodes.length}</strong>
          </div>
          <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
            Edges: <strong className="text-cyan-400">{relationships.length}</strong>
          </div>
          <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
            Database: <strong className="text-emerald-400">Neo4j v5.18</strong>
          </div>
        </div>
      </div>

      {/* Main Grid: Interactive Graph + Query Console */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1">
        {/* Interactive Visual Graph Canvas (2 Columns) */}
        <div className="lg:col-span-2 bg-slate-900 rounded-xl border border-slate-800 p-4 flex flex-col shadow-xl">
          {/* Controls & Filter */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-300">Filter Node Type:</span>
              <select
                value={filterLabel}
                onChange={(e) => setFilterLabel(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="all">All Entity Labels ({nodes.length})</option>
                <option value="Unit">Process Units</option>
                <option value="Fault">Faults (IDV 1-21)</option>
                <option value="Symptom">Plant Symptoms</option>
                <option value="MaintenanceProcedure">Maintenance SOPs</option>
                <option value="Sensor">Sensors (XMEAS)</option>
                <option value="Actuator">Actuators (XMV)</option>
              </select>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-cyan-400" /> Unit</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-400" /> Fault</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Symptom</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> SOP</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-400" /> Sensor</span>
            </div>
          </div>

          {/* SVG Graph Visualization */}
          <div className="relative flex-1 min-h-[360px] bg-slate-950 rounded-lg border border-slate-800 overflow-hidden flex items-center justify-center">
            <svg viewBox="0 0 800 450" className="w-full h-full select-none">
              {/* Edges / Links */}
              {relationships.slice(0, 45).map((rel, idx) => {
                const srcNode = nodes.find((n) => n.id === rel.source);
                const tgtNode = nodes.find((n) => n.id === rel.target);
                if (!srcNode || !tgtNode) return null;

                // Deterministic placement on 800x450 canvas
                const hash1 = srcNode.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
                const hash2 = tgtNode.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
                const x1 = 80 + (hash1 * 37) % 640;
                const y1 = 50 + (hash1 * 23) % 350;
                const x2 = 80 + (hash2 * 37) % 640;
                const y2 = 50 + (hash2 * 23) % 350;

                return (
                  <g key={rel.id || idx}>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="#334155"
                      strokeWidth="1.5"
                      strokeDasharray={rel.type === 'CAUSES' ? '4 2' : 'none'}
                    />
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 3}
                      fill="#64748b"
                      fontSize="8"
                      fontFamily="monospace"
                      textAnchor="middle"
                    >
                      {rel.type}
                    </text>
                  </g>
                );
              })}

              {/* Nodes */}
              {filteredNodes.slice(0, 35).map((node) => {
                const hash = node.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
                const cx = 80 + (hash * 37) % 640;
                const cy = 50 + (hash * 23) % 350;
                const color = getNodeColor(node.label);
                const isSelected = selectedNode?.id === node.id;

                return (
                  <g
                    key={node.id}
                    className="cursor-pointer transition-transform hover:scale-110"
                    onClick={() => setSelectedNode(node)}
                  >
                    <circle
                      cx={cx}
                      cy={cy}
                      r={node.label === 'Unit' ? 18 : 12}
                      fill={isSelected ? '#ffffff' : color}
                      fillOpacity={isSelected ? 1.0 : 0.85}
                      stroke={isSelected ? color : '#0f172a'}
                      strokeWidth={isSelected ? 3 : 1.5}
                    />
                    <text
                      x={cx}
                      y={cy + (node.label === 'Unit' ? 28 : 22)}
                      fill="#e2e8f0"
                      fontSize="9"
                      fontFamily="monospace"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {node.name.length > 16 ? node.name.slice(0, 14) + '...' : node.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Node Inspector Drawer */}
          {selectedNode && (
            <div className="mt-3 p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between text-xs font-mono">
              <div>
                <span className="text-slate-500 uppercase text-[10px] block font-bold">Selected Node:</span>
                <strong className="text-white text-sm">{selectedNode.name}</strong>{' '}
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-cyan-400 border border-slate-800">
                  (:{selectedNode.label})
                </span>
                <div className="text-slate-400 text-[11px] font-sans mt-0.5">
                  Properties: {JSON.stringify(selectedNode.properties)}
                </div>
              </div>

              <button
                onClick={() => setSelectedNode(null)}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          )}
        </div>

        {/* Neo4j Cypher Console & Pre-Built Queries (1 Column) */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex flex-col justify-between shadow-xl">
          <div>
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                Cypher Query Console
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">bolt://localhost:7687</span>
            </div>

            {/* Query Editor */}
            <div className="mb-3">
              <textarea
                value={cypherQuery}
                onChange={(e) => setCypherQuery(e.target.value)}
                rows={3}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 font-mono text-xs text-cyan-300 focus:outline-none focus:border-cyan-500"
              />
              <div className="flex items-center justify-between mt-2">
                <div className="flex flex-wrap gap-1">
                  {sampleQueries.map((sq, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setCypherQuery(sq.query);
                        handleExecuteCypher(sq.query);
                      }}
                      className="text-[10px] px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 cursor-pointer"
                    >
                      {sq.title}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => handleExecuteCypher()}
                  disabled={isExecuting}
                  className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1 transition shadow cursor-pointer ml-auto"
                >
                  <Play className="w-3 h-3" />
                  <span>Execute</span>
                </button>
              </div>
            </div>

            {/* Results Table */}
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 min-h-[160px] max-h-[220px] overflow-y-auto">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pb-1 mb-2 border-b border-slate-800">
                <span>{cypherResult?.summary || 'Execution Ready.'}</span>
                <span>{cypherResult?.executionTimeMs ? `${cypherResult.executionTimeMs} ms` : ''}</span>
              </div>

              {cypherResult?.results && cypherResult.results.length > 0 ? (
                <div className="space-y-1.5 text-xs font-mono">
                  {cypherResult.results.slice(0, 10).map((row, idx) => (
                    <div key={idx} className="p-1.5 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
                      {JSON.stringify(row)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500 text-xs font-sans text-center py-6">
                  No records returned or query in progress.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 font-sans">
            <span className="font-bold text-slate-300 block mb-1">Knowledge Graph Reasoning Rule:</span>
            Failure Diagnosis Agent queries causal pathways to validate whether candidate fault classes explain all offending sensor residual vectors.
          </div>
        </div>
      </div>
    </div>
  );
};
