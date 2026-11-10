import React, { useState, useEffect, useRef } from 'react';
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
  Download,
} from 'lucide-react';
import { KnowledgeGraphData, GraphNode, GraphRelationship, KnowledgeGraphHealth, KnowledgeGraphQueryId, TelemetryPoint } from '../types/index.js';
import { api } from '../services/api.js';
import { createKnowledgeGraphCsv, KNOWLEDGE_EXPORT_NOTICE } from '../services/knowledgeExports.js';

interface KnowledgeGraphViewProps {
  graphData: KnowledgeGraphData | null;
  activeFaultId?: number;
  telemetry: TelemetryPoint | null;
}

export const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({
  graphData,
  activeFaultId,
  telemetry,
}) => {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const [filterLabel, setFilterLabel] = useState<string>('all');
  const [focusedFaultNodeId, setFocusedFaultNodeId] = useState(activeFaultId ? `FAULT_${activeFaultId}` : '');
  const [selectedQuery, setSelectedQuery] = useState<KnowledgeGraphQueryId>('fault-evidence-links');
  const [graphHealth, setGraphHealth] = useState<KnowledgeGraphHealth | null>(null);
  const [cypherResult, setCypherResult] = useState<{
    results: any[];
    summary: string;
    executionTimeMs: number;
  } | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: 2000, height: 900 });
  const dragStart = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);

  const downloadGraph = (format: 'json' | 'csv') => {
    if (!graphData) return;
    const content = format === 'json'
      ? JSON.stringify({
          title: 'Tennessee Eastman Process Knowledge Graph',
          exportedAt: new Date().toISOString(),
          sourceStatus: graphHealth?.status === 'connected'
            ? 'Neo4j graph with cited benchmark labels; candidate topology and fault mappings still require review.'
            : 'In-memory graph with cited benchmark labels; candidate topology and fault mappings still require review.',
          notice: KNOWLEDGE_EXPORT_NOTICE,
          ...graphData,
        }, null, 2)
      : createKnowledgeGraphCsv(graphData);
    const mimeType = format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8';
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `tep-research-knowledge-graph.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const sampleQueries = [
    {
      id: 'fault-evidence-links' as const,
      title: 'Fault-Related Evidence Links',
    },
    {
      id: 'fault-source-provenance' as const,
      title: 'Fault Labels and Unit Mapping Provenance',
    },
    {
      id: 'sensors-by-unit' as const,
      title: 'Sensors linked to Process Units',
    },
    {
      id: 'unit-flow' as const,
      title: 'Unit Flow Diagram Topology',
    },
  ];

  const handleExecuteQuery = async (queryId = selectedQuery) => {
    setIsExecuting(true);
    try {
      const res = await api.executeKnowledgeGraphQuery(queryId);
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
    void api.fetchKnowledgeGraphHealth()
      .then(setGraphHealth)
      .catch((error) => setGraphHealth({
        configured: false,
        status: 'error',
        database: 'neo4j',
        nodeCount: 0,
        relationshipCount: 0,
        error: error instanceof Error ? error.message : 'Failed to check Neo4j connection.',
      }));
    void handleExecuteQuery();
  }, []);

  const nodes = graphData?.nodes || [];
  const relationships = graphData?.relationships || [];
  const graphQuality = React.useMemo(() => {
    const faultLinks = relationships.filter((relationship) => relationship.type === 'ASSOCIATED_WITH');
    const unverifiedLinks = faultLinks.filter((relationship) => relationship.properties?.evidenceStatus === 'UNVERIFIED_BENCHMARK_MAPPING').length;
    const staleCausalLinks = relationships.filter((relationship) => relationship.type === ('CAUSES' as GraphRelationship['type'])).length;
    const presentTags = new Set(nodes.filter((node) => node.label === 'Sensor' || node.label === 'Actuator').map((node) => node.id));
    const expectedBenchmarkTags = [
      ...Array.from({ length: 41 }, (_, index) => `XMEAS_${index + 1}`),
      ...Array.from({ length: 11 }, (_, index) => `XMV_${index + 1}`),
    ];
    const missingBenchmarkTags = expectedBenchmarkTags.filter((tag) => !presentTags.has(tag));
    const extraAppTags = [...presentTags].filter((tag) => !expectedBenchmarkTags.includes(tag));
    const danglingFaultLinks = faultLinks.filter((relationship) => !presentTags.has(relationship.target)).length;
    return { faultLinks: faultLinks.length, unverifiedLinks, danglingFaultLinks, staleCausalLinks, nodeCount: new Set(nodes.map((node) => node.id)).size, missingBenchmarkTags, extraAppTags };
  }, [nodes, relationships]);

  useEffect(() => setFocusedFaultNodeId(activeFaultId ? `FAULT_${activeFaultId}` : ''), [activeFaultId]);

  const activeFaultNodeId = activeFaultId ? `FAULT_${activeFaultId}` : null;
  const faultNeighborhood = new Set<string>();
  const activeFaultSensors = new Set<string>();
  if (focusedFaultNodeId) {
    faultNeighborhood.add(focusedFaultNodeId);
    const primaryUnits = new Set<string>();
    relationships.forEach((rel) => {
      if (rel.source === focusedFaultNodeId) {
        faultNeighborhood.add(rel.target);
        if (rel.type === 'ASSOCIATED_WITH') activeFaultSensors.add(rel.target);
        if (rel.type === 'AFFECTS_UNIT') primaryUnits.add(rel.target);
      }
      if (rel.target === focusedFaultNodeId) faultNeighborhood.add(rel.source);
    });
    const inspectionUnits = new Set(primaryUnits);
    relationships.forEach((rel) => {
      if (rel.type === 'FLOWS_TO' && (primaryUnits.has(rel.source) || primaryUnits.has(rel.target))) {
        inspectionUnits.add(rel.source);
        inspectionUnits.add(rel.target);
      }
    });
    for (const unitId of inspectionUnits) faultNeighborhood.add(unitId);
    relationships.forEach((rel) => {
      if (rel.type === 'LOCATED_IN' && inspectionUnits.has(rel.target)) faultNeighborhood.add(rel.source);
    });
  }
  const labelFilteredNodes = nodes.filter((n) => filterLabel === 'all' || n.label === filterLabel);
  const filteredNodes = labelFilteredNodes.filter((node) =>
    !focusedFaultNodeId || faultNeighborhood.has(node.id)
  );
  const visibleNodeIds = new Set(filteredNodes.map((node) => node.id));
  const visibleRelationships = relationships
    .filter((rel) => visibleNodeIds.has(rel.source) && visibleNodeIds.has(rel.target))
    .slice(0, 500);

  const entityOrder: GraphNode['label'][] = ['Unit', 'Fault', 'Sensor', 'Actuator', 'Symptom', 'MaintenanceProcedure'];
  const graphPositions = new Map<string, { x: number; y: number }>();
  const columnX: Record<GraphNode['label'], number> = {
    Unit: 150, Fault: 560, Sensor: 1030, Actuator: 1480, Symptom: 1840, MaintenanceProcedure: 1840,
  };
  let graphHeight = 620;
  for (const label of entityOrder) {
    const group = filteredNodes.filter((node) => node.label === label).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    graphHeight = Math.max(graphHeight, group.length * 44 + 100);
    group.forEach((node, index) => graphPositions.set(node.id, { x: columnX[label], y: 55 + index * 44 }));
  }
  useEffect(() => {
    setViewBox({ x: 0, y: 0, width: 2000, height: graphHeight });
  }, [graphHeight]);

  const resetGraphView = () => setViewBox({ x: 0, y: 0, width: 2000, height: graphHeight });
  const zoomGraph = (factor: number) => setViewBox((current) => {
    const width = Math.max(360, Math.min(2200, current.width * factor));
    const height = graphHeight * width / 2000;
    return { x: current.x + (current.width - width) / 2, y: current.y + (current.height - height) / 2, width, height };
  });
  const handleGraphWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - bounds.left) / bounds.width;
    const py = (event.clientY - bounds.top) / bounds.height;
    const factor = event.deltaY < 0 ? 0.85 : 1.18;
    setViewBox((current) => {
      const width = Math.max(360, Math.min(2200, current.width * factor));
      const height = graphHeight * width / 2000;
      const focalX = current.x + px * current.width;
      const focalY = current.y + py * current.height;
      return { x: focalX - px * width, y: focalY - py * height, width, height };
    });
  };

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
            Impact analysis graph
          </h2>
          <p className="text-xs text-slate-400 font-sans mt-0.5">Units, faults, and related sensors</p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
            Nodes: <strong className="text-cyan-400">{nodes.length}</strong>
          </div>
          <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
            Edges: <strong className="text-cyan-400">{relationships.length}</strong>
          </div>
          <div className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
            Neo4j:{' '}
            <strong className={graphHealth?.status === 'connected' ? 'text-emerald-300' : 'text-amber-300'}>
              {graphHealth?.status === 'connected'
                ? `Connected (${graphHealth.database})`
                : graphHealth?.status === 'error'
                  ? 'Connection error'
                  : graphHealth?.status === 'connecting'
                    ? 'Connecting'
                    : 'Not configured'}
            </strong>
          </div>
          <button
            onClick={() => downloadGraph('json')}
            disabled={!graphData}
            className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 disabled:opacity-50 text-cyan-300 flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> JSON
          </button>
          <button
            onClick={() => downloadGraph('csv')}
            disabled={!graphData}
            className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 disabled:opacity-50 text-cyan-300 flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Edges CSV
          </button>
        </div>
      </div>

      {graphHealth?.status === 'connected' ? (
        <div className="px-3 py-2 text-xs text-emerald-300">Neo4j connected</div>
      ) : (
        <div className="px-3 py-2 text-xs text-amber-300">Neo4j disconnected - local graph shown</div>
      )}
      <div className="px-3 py-2 text-xs text-slate-400">Select a fault to view related units and sensors. Sensor colors show current alarm state.</div>

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
                <option value="Sensor">Sensors (XMEAS)</option>
                <option value="Actuator">Actuators (XMV)</option>
              </select>
              <label className="text-xs text-slate-400" htmlFor="kg-fault-focus">Incident focus</label>
              <select
                id="kg-fault-focus"
                value={focusedFaultNodeId}
                onChange={(event) => {
                  setFocusedFaultNodeId(event.target.value);
                  setSelectedRelationshipId(null);
                  setSelectedNode(null);
                }}
                className="max-w-[260px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-cyan-200"
              >
                <option value="">Full graph</option>
                {nodes.filter((node) => node.label === 'Fault').map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.id === activeFaultNodeId ? 'ACTIVE · ' : ''}{node.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <span className="mr-1 text-[10px] text-slate-500">Scroll to zoom · drag to pan</span>
              <button onClick={() => zoomGraph(0.8)} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-cyan-200" aria-label="Zoom in">+</button>
              <button onClick={() => zoomGraph(1.25)} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-cyan-200" aria-label="Zoom out">−</button>
              <button onClick={resetGraphView} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300">Reset view</button>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-cyan-400" /> Unit</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-400" /> Fault</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-400" /> Sensor</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Normal</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Warning</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Trip</span>
            </div>
          </div>

          {/* SVG Graph Visualization */}
          <div className="relative flex-1 min-h-[520px] bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
            <svg
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              className="w-full h-full select-none cursor-grab active:cursor-grabbing"
              onWheel={handleGraphWheel}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                dragStart.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: viewBox.x, y: viewBox.y };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = dragStart.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                setViewBox((current) => ({
                  ...current,
                  x: drag.x - ((event.clientX - drag.clientX) / bounds.width) * current.width,
                  y: drag.y - ((event.clientY - drag.clientY) / bounds.height) * current.height,
                }));
              }}
              onPointerUp={() => { dragStart.current = null; }}
              onPointerCancel={() => { dragStart.current = null; }}
            >
              <rect x={0} y={0} width={2000} height={graphHeight} fill="#020617" />
              <defs>
                <filter id="kg-neon-glow" x="-100%" y="-100%" width="300%" height="300%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <marker id="kg-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="#64748b" />
                </marker>
                <marker id="kg-arrow-selected" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="#e879f9" />
                </marker>
              </defs>
              {entityOrder.map((label) => {
                const group = filteredNodes.filter((node) => node.label === label);
                if (!group.length) return null;
                const x = columnX[label];
                return <text key={`column-${label}`} x={x} y={28} fill="#94a3b8" fontSize="16" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle">{label}</text>;
              })}
              {/* Edges / Links */}
              {visibleRelationships.map((rel, idx) => {
                const source = graphPositions.get(rel.source);
                const target = graphPositions.get(rel.target);
                if (!source || !target) return null;
                const relationshipId = rel.id || `${rel.source}-${rel.type}-${rel.target}-${idx}`;
                const isSelected = selectedRelationshipId === relationshipId;
                const isActiveFaultLink = rel.type === 'ASSOCIATED_WITH' && focusedFaultNodeId === rel.source;

                return (
                  <g key={relationshipId}>
                    <line
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={isSelected ? '#e879f9' : isActiveFaultLink ? '#c084fc' : '#475569'}
                      strokeWidth={isSelected ? '4' : isActiveFaultLink ? '2.5' : '1.4'}
                      strokeDasharray={rel.type === 'ASSOCIATED_WITH' ? '4 2' : 'none'}
                      markerEnd={isSelected ? 'url(#kg-arrow-selected)' : 'url(#kg-arrow)'}
                      filter={isSelected ? 'url(#kg-neon-glow)' : undefined}
                      className="cursor-pointer"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedRelationshipId(relationshipId);
                        setSelectedNode(null);
                      }}
                    />
                    <line
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke="transparent"
                      strokeWidth="14"
                      className="cursor-pointer"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedRelationshipId(relationshipId);
                        setSelectedNode(null);
                      }}
                    />
                  </g>
                );
              })}

              {/* Nodes */}
              {filteredNodes.map((node) => {
                const position = graphPositions.get(node.id);
                if (!position) return null;
                const { x: cx, y: cy } = position;
                const alarm = node.label === 'Sensor' ? telemetry?.alarms[node.id] : undefined;
                const alarmColor = alarm?.startsWith('TRIP') ? '#f43f5e'
                  : alarm?.startsWith('WARN') ? '#f59e0b'
                    : alarm === 'NORMAL' ? '#10b981' : undefined;
                const color = alarmColor ?? getNodeColor(node.label);
                const isSelected = selectedNode?.id === node.id;
                const isActiveFault = node.id === activeFaultNodeId;
                const isFocusedFault = node.id === focusedFaultNodeId;
                const isAssociatedSensor = activeFaultSensors.has(node.id);
                const isSelectedRelationshipNode = visibleRelationships.some((rel, index) =>
                  (rel.id || `${rel.source}-${rel.type}-${rel.target}-${index}`) === selectedRelationshipId
                    && (rel.source === node.id || rel.target === node.id)
                );
                const liveValue = node.label === 'Sensor' ? telemetry?.values[node.id] : undefined;
                const nominal = Number(node.properties.nominal);
                const deviation = Number.isFinite(liveValue) && Number.isFinite(nominal) ? liveValue! - nominal : null;

                return (
                  <g
                    key={node.id}
                    className="cursor-pointer transition-transform hover:scale-110"
                    onClick={() => setSelectedNode(node)}
                  >
                    <circle
                      cx={cx}
                      cy={cy}
                      r={node.label === 'Unit' ? 16 : 11}
                      fill={isSelected ? '#ffffff' : color}
                      fillOpacity={isSelected ? 1.0 : 0.85}
                      stroke={isSelectedRelationshipNode ? '#e879f9' : isSelected ? '#ffffff' : isFocusedFault || isActiveFault || isAssociatedSensor ? '#c084fc' : '#0f172a'}
                      strokeWidth={isSelectedRelationshipNode ? 4 : isSelected || isFocusedFault || isActiveFault || isAssociatedSensor ? 3 : 1.5}
                      filter={isSelectedRelationshipNode ? 'url(#kg-neon-glow)' : undefined}
                    />
                    <text
                      x={cx + 20}
                      y={cy + 4}
                      fill="#e2e8f0"
                      fontSize="12"
                      fontFamily="monospace"
                      fontWeight="bold"
                      textAnchor="start"
                    >
                      {node.name}
                    </text>
                    {node.label === 'Sensor' && Number.isFinite(liveValue) && (
                      <text x={cx + 20} y={cy + 19} fill="#cbd5e1" fontSize="10" fontFamily="monospace" textAnchor="start">
                        {liveValue!.toFixed(2)} {deviation !== null ? `(${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)})` : ''}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {selectedRelationshipId && (() => {
            const selectedRelationship = visibleRelationships.find((rel, index) =>
              (rel.id || `${rel.source}-${rel.type}-${rel.target}-${index}`) === selectedRelationshipId
            );
            if (!selectedRelationship) return null;
            const source = nodes.find((node) => node.id === selectedRelationship.source);
            const target = nodes.find((node) => node.id === selectedRelationship.target);
            return (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-fuchsia-500/70 bg-fuchsia-950/30 px-3 py-2 text-xs">
                <span className="text-fuchsia-200">
                  Selected link: <strong>{source?.name ?? selectedRelationship.source}</strong>
                  {' → '}<strong>{target?.name ?? selectedRelationship.target}</strong>
                  <span className="ml-2 font-mono text-fuchsia-300">{selectedRelationship.type}</span>
                </span>
                <button onClick={() => setSelectedRelationshipId(null)} className="rounded border border-fuchsia-700 px-2 py-1 text-fuchsia-200 hover:bg-fuchsia-900/50">Clear</button>
              </div>
            );
          })()}

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
                {selectedNode.label === 'Sensor' && telemetry && Number.isFinite(telemetry.values[selectedNode.id]) && (
                  <div className="mt-1 text-[11px] text-cyan-200">
                    Live: {telemetry.values[selectedNode.id].toFixed(3)} {String(selectedNode.properties.unit ?? '')} · nominal {Number(selectedNode.properties.nominal).toFixed(3)} · {telemetry.alarms[selectedNode.id] ?? 'UNKNOWN'}
                  </div>
                )}
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

        {/* Named, read-only graph queries (1 Column) */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex flex-col justify-between shadow-xl">
          <div>
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                Read-only Graph Queries
              </h3>
              <span className={`text-[10px] font-mono ${graphHealth?.status === 'connected' ? 'text-emerald-300' : 'text-amber-300'}`}>
                {graphHealth?.status === 'connected' ? 'Neo4j' : 'Local graph'}
              </span>
            </div>

            <div className="mb-3">
              <label htmlFor="kg-query" className="block text-xs text-slate-400 mb-1.5">
                Choose a supported query
              </label>
              <select
                id="kg-query"
                value={selectedQuery}
                onChange={(event) => setSelectedQuery(event.target.value as KnowledgeGraphQueryId)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-cyan-300 focus:outline-none focus:border-cyan-500"
              >
                {sampleQueries.map((query) => (
                  <option key={query.id} value={query.id}>{query.title}</option>
                ))}
              </select>
              <div className="flex items-center justify-between mt-2">
                <button
                  onClick={() => void handleExecuteQuery()}
                  disabled={isExecuting}
                  className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1 transition shadow cursor-pointer ml-auto"
                >
                  <Play className="w-3 h-3" />
                  <span>Run query</span>
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
            <span className="font-bold text-slate-300 block mb-1">Safe named queries:</span>
            The server executes only these fixed, read-only query templates; browser input is never treated as raw Cypher.
          </div>
        </div>
      </div>
    </div>
  );
};
