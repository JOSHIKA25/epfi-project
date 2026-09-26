/**
 * Tennessee Eastman Process Knowledge Graph (Neo4j Graph Database Engine)
 * Represents:
 * - Process Units (Reactor, Condenser, Separator, Stripper, Compressor)
 * - Sensors & Transmitters (41 process variables)
 * - Actuators & Control Valves (12 manipulated variables)
 * - Faults (IDV 1..21)
 * - Symptoms (High Pressure, Thermal Excursion, Low Purge Flow, Stiction Hunting, etc.)
 * - Maintenance Procedures (SOPs, inspections, overhauls)
 * - Neo4j Cypher query engine emulator with path traversal & pattern matching
 */

import { TEP_FAULTS, TEP_VARIABLES, type TEPFault, type TEPVariable } from '../tep/tepConstants.ts';

export interface GraphNode {
  id: string;
  label: 'Unit' | 'Sensor' | 'Actuator' | 'Fault' | 'Symptom' | 'MaintenanceProcedure';
  name: string;
  properties: Record<string, any>;
}

export interface GraphRelationship {
  id: string;
  type: 'LOCATED_IN' | 'MEASURES' | 'CONTROLS' | 'FLOWS_TO' | 'CAUSES' | 'EXHIBITS_SYMPTOM' | 'REMEDIED_BY' | 'AFFECTS_UNIT';
  source: string;
  target: string;
  properties?: Record<string, any>;
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
}

export class TEPKnowledgeGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private relationships: GraphRelationship[] = [];

  constructor() {
    this.buildGraph();
  }

  private buildGraph(): void {
    this.nodes.clear();
    this.relationships = [];

    // 1. Process Units
    const units = [
      { id: 'UNIT_FEED', name: 'Feed Blending System', type: 'Feed System', tempK: 300, volM3: 50 },
      { id: 'UNIT_REACTOR', name: 'Chemical Reactor (CSTR)', type: 'Exothermic CSTR', tempK: 393.5, volM3: 140 },
      { id: 'UNIT_CONDENSER', name: 'Product Condenser', type: 'Shell & Tube Exchanger', tempK: 353.2, dutyKW: 1250 },
      { id: 'UNIT_SEPARATOR', name: 'Vapor-Liquid Separator', type: 'Phase Flash Vessel', tempK: 353.2, volM3: 85 },
      { id: 'UNIT_STRIPPER', name: 'Stripping Column', type: 'Tray Column', trays: 12, tempK: 338.8 },
      { id: 'UNIT_COMPRESSOR', name: 'Centrifugal Compressor', type: 'Turbine Compressor', powerKW: 341.4 },
    ];

    units.forEach((u) => {
      this.nodes.set(u.id, {
        id: u.id,
        label: 'Unit',
        name: u.name,
        properties: u,
      });
    });

    // Unit Flow relationships
    this.addRel('UNIT_FEED', 'UNIT_REACTOR', 'FLOWS_TO', { stream: 'Stream 6 (Combined Feed)' });
    this.addRel('UNIT_REACTOR', 'UNIT_CONDENSER', 'FLOWS_TO', { stream: 'Stream 7 (Effluent Gas/Vapor)' });
    this.addRel('UNIT_CONDENSER', 'UNIT_SEPARATOR', 'FLOWS_TO', { stream: 'Condenser Discharge' });
    this.addRel('UNIT_SEPARATOR', 'UNIT_STRIPPER', 'FLOWS_TO', { stream: 'Stream 10 (Liquid Underflow)' });
    this.addRel('UNIT_SEPARATOR', 'UNIT_COMPRESSOR', 'FLOWS_TO', { stream: 'Stream 8 (Recycle Gas)' });
    this.addRel('UNIT_COMPRESSOR', 'UNIT_REACTOR', 'FLOWS_TO', { stream: 'Recycle Loop Return' });

    // 2. Sensors & Actuators
    for (const v of TEP_VARIABLES) {
      const isActuator = v.type === 'actuator';
      const label = isActuator ? 'Actuator' : 'Sensor';

      this.nodes.set(v.id, {
        id: v.id,
        label,
        name: `${v.code} ${v.name}`,
        properties: {
          code: v.code,
          unit: v.unit,
          nominal: v.nominal,
          category: v.category,
          lowWarn: v.lowWarn,
          highWarn: v.highWarn,
          lowTrip: v.lowTrip,
          highTrip: v.highTrip,
        },
      });

      // Unit affiliation
      let targetUnit = 'UNIT_FEED';
      if (v.category === 'reactor') targetUnit = 'UNIT_REACTOR';
      else if (v.category === 'condenser') targetUnit = 'UNIT_CONDENSER';
      else if (v.category === 'separator') targetUnit = 'UNIT_SEPARATOR';
      else if (v.category === 'stripper') targetUnit = 'UNIT_STRIPPER';
      else if (v.category === 'compressor') targetUnit = 'UNIT_COMPRESSOR';

      this.addRel(v.id, targetUnit, 'LOCATED_IN');
      if (isActuator) {
        this.addRel(v.id, targetUnit, 'CONTROLS');
      } else {
        this.addRel(v.id, targetUnit, 'MEASURES');
      }
    }

    // 3. Symptoms
    const symptoms = [
      { id: 'SYMP_HIGH_PRESS', name: 'Reactor Overpressure (> 2850 kPa)', severity: 'critical' },
      { id: 'SYMP_THERMAL_RUNAWAY', name: 'Thermal Excursion Risk (> 126 °C)', severity: 'critical' },
      { id: 'SYMP_COOLING_SATURATION', name: 'Cooling Water Valve 100% Saturation', severity: 'high' },
      { id: 'SYMP_INERT_BUILDUP', name: 'Inert Gas Accumulation in Recycle Loop', severity: 'medium' },
      { id: 'SYMP_PURGE_OVERDRIVE', name: 'Purge Valve Excessive Venting (> 60%)', severity: 'medium' },
      { id: 'SYMP_SEPARATOR_FLOOD', name: 'Separator Liquid Holdup Alarm', severity: 'high' },
      { id: 'SYMP_PURITY_DROP', name: 'Product G Purity Below Specification (< 50%)', severity: 'high' },
      { id: 'SYMP_VALVE_HUNTING', name: 'Control Valve Limit Cycle Oscillation', severity: 'medium' },
      { id: 'SYMP_CONDENSER_SUBCOOL', name: 'Condenser Subcooling Inefficiency', severity: 'high' },
      { id: 'SYMP_FEED_STARVATION', name: 'Reactant A Feed Starvation', severity: 'critical' },
      { id: 'SYMP_COMPRESSOR_SURGE', name: 'Compressor Shaft Power Fluctuations', severity: 'high' },
    ];

    symptoms.forEach((s) => {
      this.nodes.set(s.id, {
        id: s.id,
        label: 'Symptom',
        name: s.name,
        properties: s,
      });
    });

    // 4. Faults & Maintenance Procedures
    for (const f of TEP_FAULTS) {
      const faultNodeId = `FAULT_${f.id}`;
      this.nodes.set(faultNodeId, {
        id: faultNodeId,
        label: 'Fault',
        name: `${f.code} ${f.name}`,
        properties: {
          faultId: f.id,
          code: f.code,
          severity: f.severity,
          type: f.type,
          primaryUnit: f.primaryUnit,
          physicalMechanism: f.physicalMechanism,
        },
      });

      // Target unit
      let unitId = 'UNIT_FEED';
      if (f.primaryUnit === 'reactor') unitId = 'UNIT_REACTOR';
      else if (f.primaryUnit === 'condenser') unitId = 'UNIT_CONDENSER';
      else if (f.primaryUnit === 'separator') unitId = 'UNIT_SEPARATOR';
      else if (f.primaryUnit === 'stripper') unitId = 'UNIT_STRIPPER';
      else if (f.primaryUnit === 'compressor') unitId = 'UNIT_COMPRESSOR';

      this.addRel(faultNodeId, unitId, 'AFFECTS_UNIT');

      // Key Sensors
      f.keySensors.forEach((sId) => {
        if (this.nodes.has(sId)) {
          this.addRel(faultNodeId, sId, 'CAUSES', { manifestation: 'Sensor deviation' });
        }
      });

      // Link specific symptoms
      if (f.id === 4) {
        this.addRel(faultNodeId, 'SYMP_THERMAL_RUNAWAY', 'CAUSES');
        this.addRel(faultNodeId, 'SYMP_COOLING_SATURATION', 'CAUSES');
        this.addRel(faultNodeId, 'SYMP_HIGH_PRESS', 'CAUSES');
      } else if (f.id === 2) {
        this.addRel(faultNodeId, 'SYMP_INERT_BUILDUP', 'CAUSES');
        this.addRel(faultNodeId, 'SYMP_PURGE_OVERDRIVE', 'CAUSES');
      } else if (f.id === 6) {
        this.addRel(faultNodeId, 'SYMP_FEED_STARVATION', 'CAUSES');
      } else if (f.id === 14 || f.id === 15) {
        this.addRel(faultNodeId, 'SYMP_VALVE_HUNTING', 'CAUSES');
      } else if (f.id === 16 || f.id === 5) {
        this.addRel(faultNodeId, 'SYMP_CONDENSER_SUBCOOL', 'CAUSES');
      } else if (f.id === 20) {
        this.addRel(faultNodeId, 'SYMP_COMPRESSOR_SURGE', 'CAUSES');
      }

      // Maintenance procedure
      const sopNodeId = `SOP_${f.id}`;
      this.nodes.set(sopNodeId, {
        id: sopNodeId,
        label: 'MaintenanceProcedure',
        name: f.standardSop,
        properties: {
          sopCode: `SOP-TEP-${String(f.id).padStart(3, '0')}`,
          targetFault: f.code,
          estimatedHours: f.severity === 'critical' ? 2.5 : f.severity === 'high' ? 4.0 : 1.5,
          lockoutTagoutRequired: f.severity === 'critical' || f.severity === 'high',
        },
      });

      this.addRel(sopNodeId, faultNodeId, 'REMEDIED_BY');
      this.addRel(sopNodeId, unitId, 'LOCATED_IN');
    }
  }

  private addRel(source: string, target: string, type: GraphRelationship['type'], properties: Record<string, any> = {}): void {
    const id = `rel_${source}_${type}_${target}_${this.relationships.length}`;
    this.relationships.push({
      id,
      source,
      target,
      type,
      properties,
    });
  }

  public getFullGraph(): KnowledgeGraphData {
    return {
      nodes: Array.from(this.nodes.values()),
      relationships: this.relationships,
    };
  }

  public getSubgraphForFault(faultId: number): KnowledgeGraphData {
    const faultNodeId = `FAULT_${faultId}`;
    const connectedNodeIds = new Set<string>([faultNodeId]);

    // 1-hop and 2-hop traversal
    const rels1 = this.relationships.filter((r) => r.source === faultNodeId || r.target === faultNodeId);
    rels1.forEach((r) => {
      connectedNodeIds.add(r.source);
      connectedNodeIds.add(r.target);
    });

    const rels2 = this.relationships.filter(
      (r) => connectedNodeIds.has(r.source) || connectedNodeIds.has(r.target)
    );
    rels2.forEach((r) => {
      if (r.type === 'REMEDIED_BY' || r.type === 'CAUSES' || r.type === 'LOCATED_IN' || r.type === 'MEASURES') {
        connectedNodeIds.add(r.source);
        connectedNodeIds.add(r.target);
      }
    });

    const finalRels = this.relationships.filter(
      (r) => connectedNodeIds.has(r.source) && connectedNodeIds.has(r.target)
    );

    const finalNodes = Array.from(connectedNodeIds)
      .map((id) => this.nodes.get(id))
      .filter((n): n is GraphNode => Boolean(n));

    return {
      nodes: finalNodes,
      relationships: finalRels,
    };
  }

  public executeCypher(query: string): { results: any[]; summary: string; executionTimeMs: number } {
    const startTime = performance.now();
    const clean = query.trim().toUpperCase();

    let results: any[] = [];
    let summary = '';

    if (clean.includes('MATCH (F:FAULT)') || clean.includes('RETURN F')) {
      const faults = Array.from(this.nodes.values()).filter((n) => n.label === 'Fault');
      results = faults.map((f) => ({
        faultId: f.properties.faultId,
        code: f.properties.code,
        name: f.name,
        severity: f.properties.severity,
        mechanism: f.properties.physicalMechanism,
      }));
      summary = `Returned ${results.length} Fault nodes in graph.`;
    } else if (clean.includes('SYMPTOM') || clean.includes('CAUSES')) {
      const causesRels = this.relationships.filter((r) => r.type === 'CAUSES');
      results = causesRels.map((r) => {
        const src = this.nodes.get(r.source);
        const tgt = this.nodes.get(r.target);
        return {
          fault: src?.name || r.source,
          symptom_or_sensor: tgt?.name || r.target,
          relationship: r.type,
          manifestation: r.properties?.manifestation || 'direct causal effect',
        };
      });
      summary = `Found ${results.length} causal pathways (Fault -> Symptom/Sensor).`;
    } else if (clean.includes('MAINTENANCE') || clean.includes('SOP') || clean.includes('REMEDIED_BY')) {
      const sops = Array.from(this.nodes.values()).filter((n) => n.label === 'MaintenanceProcedure');
      results = sops.map((s) => ({
        sopCode: s.properties.sopCode,
        title: s.name,
        targetFault: s.properties.targetFault,
        lockoutRequired: s.properties.lockoutTagoutRequired,
        estimatedHours: s.properties.estimatedHours,
      }));
      summary = `Returned ${results.length} standard maintenance operating procedures.`;
    } else if (clean.includes('UNIT')) {
      const units = Array.from(this.nodes.values()).filter((n) => n.label === 'Unit');
      results = units.map((u) => ({
        unitId: u.id,
        name: u.name,
        type: u.properties.type,
        connectedSensors: this.relationships.filter((r) => r.target === u.id && r.type === 'LOCATED_IN').length,
      }));
      summary = `Matched ${results.length} process units with operational telemetry links.`;
    } else {
      // General match
      results = Array.from(this.nodes.values()).slice(0, 20).map((n) => ({
        id: n.id,
        label: n.label,
        name: n.name,
        properties: n.properties,
      }));
      summary = `Query evaluated. Displaying top ${results.length} graph entities.`;
    }

    const elapsed = Number((performance.now() - startTime).toFixed(2));
    return {
      results,
      summary,
      executionTimeMs: elapsed,
    };
  }
}

export const tepKnowledgeGraph = new TEPKnowledgeGraph();
