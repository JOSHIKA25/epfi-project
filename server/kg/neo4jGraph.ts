/**
 * Tennessee Eastman Process Knowledge Graph (Neo4j Graph Database Engine)
 * Represents:
 * - Process Units (Reactor, Condenser, Separator, Stripper, Compressor)
 * - Sensors & Transmitters (41 process variables)
 * - Actuators & Control Valves (12 manipulated variables)
 * - Faults (IDV 1..21)
 * - Symptoms (High Pressure, Thermal Excursion, Low Purge Flow, Stiction Hunting, etc.)
 * - Source-tagged benchmark labels and analyst-review associations (no SOPs are seeded)
 * - Neo4j-backed graph persistence with an offline local prototype mode
 */

import { TEP_FAULTS, TEP_VARIABLES } from '../tep/tepConstants.ts';
import neo4j, { type Driver } from 'neo4j-driver';

export interface GraphNode {
  id: string;
  label: 'Unit' | 'Sensor' | 'Actuator' | 'Fault' | 'Symptom' | 'MaintenanceProcedure';
  name: string;
  properties: Record<string, any>;
}

export interface GraphRelationship {
  id: string;
  type: 'LOCATED_IN' | 'MEASURES' | 'CONTROLS' | 'FLOWS_TO' | 'ASSOCIATED_WITH' | 'EXHIBITS_SYMPTOM' | 'HAS_UNVERIFIED_REFERENCE' | 'AFFECTS_UNIT';
  source: string;
  target: string;
  properties?: Record<string, any>;
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
}

export type KnowledgeGraphQueryId =
  | 'fault-evidence-links'
  | 'fault-source-provenance'
  | 'sensors-by-unit'
  | 'unit-flow';

export interface KnowledgeGraphHealth {
  configured: boolean;
  status: 'not_configured' | 'connecting' | 'connected' | 'error';
  database: string;
  nodeCount: number;
  relationshipCount: number;
  error?: string;
}

const NODE_LABELS: GraphNode['label'][] = [
  'Unit',
  'Sensor',
  'Actuator',
  'Fault',
  'Symptom',
  'MaintenanceProcedure',
];

const RELATIONSHIP_TYPES: GraphRelationship['type'][] = [
  'LOCATED_IN',
  'MEASURES',
  'CONTROLS',
  'FLOWS_TO',
  'ASSOCIATED_WITH',
  'EXHIBITS_SYMPTOM',
  'HAS_UNVERIFIED_REFERENCE',
  'AFFECTS_UNIT',
];

const QUERY_CYPHER: Record<KnowledgeGraphQueryId, string> = {
  'fault-evidence-links': `
    MATCH (f:Fault {app: 'tep-digital-twin'})-[r:ASSOCIATED_WITH]->(e)
    WHERE e.app = 'tep-digital-twin' AND NOT e:DeprecatedResearchPlaceholder
    RETURN {fault: f.name, relatedEntity: e.name, relationship: type(r), associationKind: r.associationKind, evidenceStatus: r.evidenceStatus, interpretation: r.interpretation} AS result
    ORDER BY f.id
    LIMIT 100`,
  'fault-source-provenance': `
    MATCH (f:Fault {app: 'tep-digital-twin'})
    OPTIONAL MATCH (f)-[:AFFECTS_UNIT]->(u:Unit {app: 'tep-digital-twin'})
    RETURN {fault: f.name, faultId: f.faultId, benchmarkLabelStatus: f.evidenceStatus, sourceNote: f.sourceStatus, citation: f.sourceCitation, sourceUrl: f.sourceUrl, mappedUnit: u.name, unitMappingStatus: 'REQUIRES_SOURCE_REVIEW'} AS result
    ORDER BY f.id`,
  'sensors-by-unit': `
    MATCH (s:Sensor {app: 'tep-digital-twin'})-[:LOCATED_IN]->(u:Unit)
    WHERE u.app = 'tep-digital-twin'
    RETURN {sensor: s.name, code: s.code, unit: u.name} AS result
    ORDER BY u.id, s.id
    LIMIT 100`,
  'unit-flow': `
    MATCH (u1:Unit {app: 'tep-digital-twin'})-[r:FLOWS_TO]->(u2:Unit)
    WHERE u2.app = 'tep-digital-twin'
    RETURN {from: u1.name, to: u2.name, stream: r.stream} AS result
    ORDER BY u1.id`,
};

function normalizeNeo4jValue(value: any): any {
  if (neo4j.isInt(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(normalizeNeo4jValue);
  if (value && typeof value === 'object') {
    if (value.properties && value.labels) {
      return {
        id: normalizeNeo4jValue(value.properties.id),
        labels: value.labels,
        properties: normalizeNeo4jValue(value.properties),
      };
    }
    if (value.type && value.startNodeElementId !== undefined) {
      return {
        type: value.type,
        properties: normalizeNeo4jValue(value.properties),
      };
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, normalizeNeo4jValue(nestedValue)])
    );
  }
  return value;
}

export class TEPKnowledgeGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private relationships: GraphRelationship[] = [];
  private driver: Driver | null = null;
  private connectionStatus: KnowledgeGraphHealth['status'] = 'not_configured';
  private connectionError?: string;
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    this.buildGraph();
  }

  private getConfiguredCredentials(): { uri: string; username: string; password: string; database: string } | null {
    const uri = process.env.NEO4J_URI?.trim();
    const username = process.env.NEO4J_USERNAME?.trim();
    const password = process.env.NEO4J_PASSWORD;
    if (!uri && !username && !password) return null;
    if (!uri || !username || !password) {
      throw new Error('Neo4j configuration is incomplete. Set NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD.');
    }
    return { uri, username, password, database: process.env.NEO4J_DATABASE?.trim() || 'neo4j' };
  }

  public async initialize(): Promise<void> {
    const credentials = this.getConfiguredCredentials();
    if (!credentials) {
      this.connectionStatus = 'not_configured';
      return;
    }
    if (this.connectionStatus === 'connected' && this.driver) return;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = this.connectAndSeed(credentials).finally(() => {
      this.connectionPromise = null;
    });
    return this.connectionPromise;
  }

  private async connectAndSeed(credentials: { uri: string; username: string; password: string; database: string }): Promise<void> {
    this.connectionStatus = 'connecting';
    this.connectionError = undefined;
    try {
      if (!this.driver) {
        this.driver = neo4j.driver(
          credentials.uri,
          neo4j.auth.basic(credentials.username, credentials.password),
          {
            maxConnectionPoolSize: 10,
            connectionTimeout: 5000,
            maxTransactionRetryTime: 10000,
          }
        );
      }
      await this.driver.verifyConnectivity();
      await this.seedGraph(credentials.database);
      this.connectionStatus = 'connected';
    } catch (error) {
      this.connectionStatus = 'error';
      this.connectionError = error instanceof Error ? error.message : 'Unknown Neo4j connection error.';
      throw new Error(`Neo4j connection or graph initialization failed: ${this.connectionError}`);
    }
  }

  private async seedGraph(database: string): Promise<void> {
    if (!this.driver) throw new Error('Neo4j driver is not initialized.');

    const session = this.driver.session({ database });
    try {
      for (const label of NODE_LABELS) {
        const constraintName = `tep_${label.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}_app_id_unique`;
        await session.run(
          `CREATE CONSTRAINT ${constraintName} IF NOT EXISTS FOR (n:${label}) REQUIRE (n.app, n.id) IS UNIQUE`
        );
      }

      const nodesByLabel = new Map<GraphNode['label'], GraphNode[]>();
      for (const node of this.getLocalGraph().nodes) {
        const group = nodesByLabel.get(node.label) || [];
        group.push(node);
        nodesByLabel.set(node.label, group);
      }

      await session.executeWrite(async (transaction) => {
        // Rebuild only relationships generated by this application's current graph
        // catalog. Older generated IDs can survive MERGE-based seeding when a
        // mapping changes, leaving stale fault-to-unit and tag-to-unit links.
        // Preserve custom relationships that do not use the app's rel_ ID prefix.
        await transaction.run(
          `MATCH (source {app: 'tep-digital-twin'})-[r]->(target {app: 'tep-digital-twin'})
           WHERE type(r) IN $relationshipTypes AND r.id STARTS WITH 'rel_'
           DELETE r`,
          { relationshipTypes: RELATIONSHIP_TYPES }
        );
        // Migrate only this application's seeded links: they are benchmark
        // associations, not experimentally established physical causality.
        await transaction.run(`
          MATCH (f:Fault {app: 'tep-digital-twin'})-[r:CAUSES]->(e {app: 'tep-digital-twin'})
          WHERE e:Sensor OR e:Actuator OR e:Symptom
          DELETE r
        `);
        await transaction.run(`
          MATCH (p:MaintenanceProcedure {app: 'tep-digital-twin'})-[r:REMEDIED_BY]->(f:Fault {app: 'tep-digital-twin'})
          DELETE r
        `);
        // Archive only the legacy app-seeded placeholder SOP/symptom entities.
        // Keep records recoverable, but hide them from active graph reads.
        await transaction.run(`
          MATCH (n {app: 'tep-digital-twin'})
          WHERE (n:MaintenanceProcedure AND n.id STARTS WITH 'SOP_')
             OR (n:Symptom AND n.id STARTS WITH 'SYMP_')
          SET n:DeprecatedResearchPlaceholder
        `);
        for (const [label, nodes] of nodesByLabel) {
          await transaction.run(
            `UNWIND $nodes AS row
             MERGE (n:${label} {app: 'tep-digital-twin', id: row.id})
             SET n.name = row.name, n += row.properties`,
            {
              nodes: nodes.map((node) => ({
                id: node.id,
                name: node.name,
                properties: node.properties,
              })),
            }
          );
        }

        const relationshipsByType = new Map<GraphRelationship['type'], GraphRelationship[]>();
        for (const relationship of this.getLocalGraph().relationships) {
          if (!RELATIONSHIP_TYPES.includes(relationship.type)) {
            throw new Error(`Unsupported relationship type in graph seed: ${relationship.type}`);
          }
          const group = relationshipsByType.get(relationship.type) || [];
          group.push(relationship);
          relationshipsByType.set(relationship.type, group);
        }

        for (const [type, relationships] of relationshipsByType) {
          await transaction.run(
            `UNWIND $relationships AS row
             MATCH (source {app: 'tep-digital-twin', id: row.source})
             MATCH (target {app: 'tep-digital-twin', id: row.target})
             MERGE (source)-[r:${type} {id: row.id}]->(target)
             SET r += row.properties`,
            {
              relationships: relationships.map((relationship) => ({
                id: relationship.id,
                source: relationship.source,
                target: relationship.target,
                properties: relationship.properties || {},
              })),
            }
          );
        }
      });
    } finally {
      await session.close();
    }
  }

  public async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
    this.connectionStatus = 'not_configured';
  }

  public async getHealth(): Promise<KnowledgeGraphHealth> {
    let credentials: ReturnType<TEPKnowledgeGraph['getConfiguredCredentials']>;
    try {
      credentials = this.getConfiguredCredentials();
    } catch (error) {
      return {
        configured: Boolean(
          process.env.NEO4J_URI?.trim() ||
          process.env.NEO4J_USERNAME?.trim() ||
          process.env.NEO4J_PASSWORD
        ),
        status: 'error',
        database: process.env.NEO4J_DATABASE || 'neo4j',
        nodeCount: 0,
        relationshipCount: 0,
        error: error instanceof Error ? error.message : 'Invalid Neo4j configuration.',
      };
    }

    if (!credentials) {
      return {
        configured: false,
        status: 'not_configured',
        database: 'neo4j',
        nodeCount: this.nodes.size,
        relationshipCount: this.relationships.length,
      };
    }

    if (this.connectionStatus === 'connected' && this.driver) {
      try {
        const session = this.driver.session({ database: credentials.database });
        try {
          const result = await session.run(
            `MATCH (n {app: 'tep-digital-twin'})
             WHERE NOT n:DeprecatedResearchPlaceholder
             OPTIONAL MATCH (n)-[r]->(m {app: 'tep-digital-twin'})
             WHERE NOT m:DeprecatedResearchPlaceholder
             RETURN count(DISTINCT n) AS nodes, count(DISTINCT r) AS relationships`
          );
          return {
            configured: true,
            status: 'connected',
            database: credentials.database,
            nodeCount: result.records[0]?.get('nodes').toNumber() ?? 0,
            relationshipCount: result.records[0]?.get('relationships').toNumber() ?? 0,
          };
        } finally {
          await session.close();
        }
      } catch (error) {
        this.connectionStatus = 'error';
        this.connectionError = error instanceof Error ? error.message : 'Unknown Neo4j health-check error.';
      }
    }

    return {
      configured: true,
      status: this.connectionStatus,
      database: credentials.database,
      nodeCount: 0,
      relationshipCount: 0,
      error: this.connectionError,
    };
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
        properties: { ...u, evidenceStatus: 'ILLUSTRATIVE_TEP_TOPOLOGY', sourceStatus: 'Verify process connections against a cited TEP source.' },
      });
    });

    // Unit Flow relationships
    const topologyEvidence = { evidenceStatus: 'BENCHMARK_TOPOLOGY_CANDIDATE', sourceCitation: 'Downs & Vogel (1993), DOI 10.1016/0098-1354(93)80018-i', verificationNote: 'Process arrangement is described by the cited benchmark paper; confirm individual stream naming against the specific diagram/source used.' };
    this.addRel('UNIT_FEED', 'UNIT_REACTOR', 'FLOWS_TO', { stream: 'Stream 6 (Combined Feed)', ...topologyEvidence });
    this.addRel('UNIT_REACTOR', 'UNIT_CONDENSER', 'FLOWS_TO', { stream: 'Stream 7 (Effluent Gas/Vapor)', ...topologyEvidence });
    this.addRel('UNIT_CONDENSER', 'UNIT_SEPARATOR', 'FLOWS_TO', { stream: 'Condenser Discharge', ...topologyEvidence });
    this.addRel('UNIT_SEPARATOR', 'UNIT_STRIPPER', 'FLOWS_TO', { stream: 'Stream 10 (Liquid Underflow)', ...topologyEvidence });
    this.addRel('UNIT_SEPARATOR', 'UNIT_COMPRESSOR', 'FLOWS_TO', { stream: 'Stream 8 (Recycle Gas)', ...topologyEvidence });
    this.addRel('UNIT_COMPRESSOR', 'UNIT_REACTOR', 'FLOWS_TO', { stream: 'Recycle Loop Return', ...topologyEvidence });

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
          evidenceStatus: 'LOCAL_TELEMETRY_PROFILE',
          thresholdStatus: 'UNVALIDATED_FOR_PLANT_USE',
        },
      });

      // Unit affiliation
      let targetUnit = 'UNIT_FEED';
      if (v.category === 'reactor') targetUnit = 'UNIT_REACTOR';
      else if (v.category === 'condenser') targetUnit = 'UNIT_CONDENSER';
      else if (v.category === 'separator') targetUnit = 'UNIT_SEPARATOR';
      else if (v.category === 'stripper') targetUnit = 'UNIT_STRIPPER';
      else if (v.category === 'compressor') targetUnit = 'UNIT_COMPRESSOR';
      else if (v.category === 'product') targetUnit = 'UNIT_STRIPPER';

      this.addRel(v.id, targetUnit, 'LOCATED_IN', { evidenceStatus: 'LOCAL_TEP_TAG_MAPPING', sourceStatus: 'Confirm tag-to-unit mapping against the cited dataset documentation.' });
      if (isActuator) {
        this.addRel(v.id, targetUnit, 'CONTROLS');
      } else {
        this.addRel(v.id, targetUnit, 'MEASURES');
      }
    }

    // 3. Fault labels and analyst-review associations
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
          evidenceStatus: f.id <= 20 ? 'SECONDARY_SOURCE_BENCHMARK_FAULT_LABEL' : 'LOCAL_APP_LABEL_UNVERIFIED',
          sourceStatus: f.id <= 20
            ? 'Published benchmark catalog candidate; confirm wording and class coverage against the exact local CSV release.'
            : 'App-defined IDV 21 label; the cited 1–20 fault catalog does not establish this class.',
          sourceCitation: f.id <= 20 ? 'Zhang, J., Luo, W., & Dai, Y. (2021). Integrated Diagnostic Framework for Process and Sensor Faults in Chemical Industry. Sensors, 21(3), 822. DOI: 10.3390/s21030822.' : null,
          sourceUrl: f.id <= 20 ? 'https://doi.org/10.3390/s21030822' : null,
        },
      });

      // Target unit
      let unitId = 'UNIT_FEED';
      if (f.primaryUnit === 'reactor') unitId = 'UNIT_REACTOR';
      else if (f.primaryUnit === 'condenser') unitId = 'UNIT_CONDENSER';
      else if (f.primaryUnit === 'separator') unitId = 'UNIT_SEPARATOR';
      else if (f.primaryUnit === 'stripper') unitId = 'UNIT_STRIPPER';
      else if (f.primaryUnit === 'compressor') unitId = 'UNIT_COMPRESSOR';

      this.addRel(faultNodeId, unitId, 'AFFECTS_UNIT', { evidenceStatus: 'FAULT_PRIMARY_UNIT_MAPPING_UNVERIFIED', interpretation: 'Benchmark fault-to-unit mapping for review; validate against the exact source.' });

      // Key Sensors
      f.keySensors.forEach((sId) => {
        if (this.nodes.has(sId)) {
          this.addRel(faultNodeId, sId, 'ASSOCIATED_WITH', { associationKind: 'benchmark_key_sensor', evidenceStatus: 'UNVERIFIED_BENCHMARK_MAPPING', interpretation: 'Association for analyst review; not a causal claim.' });
        }
      });

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

  private getLocalGraph(): KnowledgeGraphData {
    return {
      nodes: Array.from(this.nodes.values()),
      relationships: this.relationships,
    };
  }

  public async getFullGraph(): Promise<KnowledgeGraphData> {
    const credentials = this.getConfiguredCredentials();
    if (!credentials) return this.getLocalGraph();
    try {
      await this.initialize();
      if (!this.driver) return this.getLocalGraph();
      const session = this.driver.session({ database: credentials.database });
      try {
      const result = await session.run(
        `MATCH (n {app: 'tep-digital-twin'})
         WHERE NOT n:DeprecatedResearchPlaceholder
         OPTIONAL MATCH (n)-[r]->(m {app: 'tep-digital-twin'})
         WHERE NOT m:DeprecatedResearchPlaceholder
         RETURN collect(DISTINCT {id: n.id, name: n.name, label: labels(n)[0], properties: properties(n)}) AS nodes,
                collect(DISTINCT CASE WHEN r IS NULL THEN null ELSE {
                  id: r.id, type: type(r), source: startNode(r).id, target: endNode(r).id, properties: properties(r)
                } END) AS relationships`
      );
      const row = result.records[0];
      const nodes = (row?.get('nodes') || [])
        .filter(Boolean)
        .map((node: any) => normalizeNeo4jValue(node) as GraphNode);
      const relationships = (row?.get('relationships') || [])
        .filter(Boolean)
        .map((relationship: any) => normalizeNeo4jValue(relationship) as GraphRelationship);
      return { nodes, relationships };
      } finally {
        await session.close();
      }
    } catch (error) {
      console.warn('[KnowledgeGraph] Neo4j read failed; using the local TEP graph for this request.', error instanceof Error ? error.message : error);
      return this.getLocalGraph();
    }
  }

  public async getSubgraphForFault(faultId: number): Promise<KnowledgeGraphData> {
    const graph = await this.getFullGraph();
    const faultNodeId = `FAULT_${faultId}`;
    const connectedNodeIds = new Set<string>([faultNodeId]);

    // 1-hop and 2-hop traversal
    const rels1 = graph.relationships.filter((r) => r.source === faultNodeId || r.target === faultNodeId);
    rels1.forEach((r) => {
      connectedNodeIds.add(r.source);
      connectedNodeIds.add(r.target);
    });

    const rels2 = graph.relationships.filter(
      (r) => connectedNodeIds.has(r.source) || connectedNodeIds.has(r.target)
    );
    rels2.forEach((r) => {
      if (r.type === 'ASSOCIATED_WITH' || r.type === 'LOCATED_IN' || r.type === 'MEASURES') {
        connectedNodeIds.add(r.source);
        connectedNodeIds.add(r.target);
      }
    });

    const finalRels = graph.relationships.filter(
      (r) => connectedNodeIds.has(r.source) && connectedNodeIds.has(r.target)
    );

    const finalNodes = Array.from(connectedNodeIds)
      .map((id) => graph.nodes.find((node) => node.id === id))
      .filter((n): n is GraphNode => Boolean(n));

    return {
      nodes: finalNodes,
      relationships: finalRels,
    };
  }

  public async getImpactAnalysisForFault(faultId: number): Promise<{
    fault: string;
    primaryUnit: string | null;
    connectedUnits: string[];
    linkedSensors: string[];
    linkedProcedures: string[];
    interpretation: string;
    graphSource: 'NEO4J' | 'LOCAL_FALLBACK';
  }> {
    let graphSource: 'NEO4J' | 'LOCAL_FALLBACK' = 'NEO4J';
    let graph: KnowledgeGraphData;
    try {
      graph = await this.getFullGraph();
      if (!this.driver || this.connectionStatus !== 'connected') graphSource = 'LOCAL_FALLBACK';
    } catch {
      graph = this.getLocalGraph();
      graphSource = 'LOCAL_FALLBACK';
    }
    const faultIdKey = `FAULT_${faultId}`;
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const fault = nodeById.get(faultIdKey);
    if (!fault || fault.label !== 'Fault') throw new Error(`Fault ${faultId} is not present in the process graph.`);

    const primaryUnitIds = graph.relationships
      .filter((relationship) => relationship.type === 'AFFECTS_UNIT' && relationship.source === faultIdKey)
      .map((relationship) => relationship.target);
    const connectedUnitIds = new Set(primaryUnitIds);
    // Flow edges identify connected process neighbors for review, not material-level fault causality.
    for (const relationship of graph.relationships) {
      if (relationship.type !== 'FLOWS_TO') continue;
      if (primaryUnitIds.includes(relationship.source)) connectedUnitIds.add(relationship.target);
      if (primaryUnitIds.includes(relationship.target)) connectedUnitIds.add(relationship.source);
    }
    const linkedSensors = graph.relationships
      .filter((relationship) => relationship.type === 'ASSOCIATED_WITH' && relationship.source === faultIdKey && relationship.properties?.associationKind === 'benchmark_key_sensor')
      .map((relationship) => nodeById.get(relationship.target))
      .filter((node): node is GraphNode => Boolean(node && (node.label === 'Sensor' || node.label === 'Actuator')))
      .map((node) => node.properties.code || node.name);
    const linkedProcedures = graph.relationships
      .filter((relationship) => relationship.type === 'HAS_UNVERIFIED_REFERENCE' && relationship.source === faultIdKey)
      .map((relationship) => nodeById.get(relationship.target)?.name)
      .filter((name): name is string => Boolean(name));

    return {
      fault: fault.name,
      primaryUnit: primaryUnitIds.map((id) => nodeById.get(id)?.name).find(Boolean) || null,
      connectedUnits: Array.from(connectedUnitIds).map((id) => nodeById.get(id)?.name).filter((name): name is string => Boolean(name)),
      linkedSensors,
      linkedProcedures,
      interpretation: 'Graph connectivity is an impact-review aid. It does not establish causal fault propagation or an approved operating procedure.',
      graphSource,
    };
  }

  public async executeNamedQuery(
    queryId: KnowledgeGraphQueryId
  ): Promise<{ results: any[]; summary: string; executionTimeMs: number }> {
    const startTime = performance.now();
    const credentials = this.getConfiguredCredentials();
    let results: any[];
    let summary: string;

    if (credentials) {
      await this.initialize();
      if (!this.driver) throw new Error('Neo4j driver is not initialized.');
      const session = this.driver.session({ database: credentials.database });
      try {
        const result = await session.run(QUERY_CYPHER[queryId]);
        results = result.records.map((record) => normalizeNeo4jValue(record.get('result')));
      } finally {
        await session.close();
      }
      summary = `Neo4j returned ${results.length} rows for "${queryId}".`;
    } else {
      const graph = this.getLocalGraph();
      const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
      if (queryId === 'fault-evidence-links') {
        results = graph.relationships
          .filter((relationship) => relationship.type === 'ASSOCIATED_WITH')
          .map((relationship) => ({
            fault: nodeById.get(relationship.source)?.name || relationship.source,
            relatedEntity: nodeById.get(relationship.target)?.name || relationship.target,
            relationship: relationship.type,
            associationKind: relationship.properties?.associationKind,
            evidenceStatus: relationship.properties?.evidenceStatus,
          }));
      } else if (queryId === 'fault-source-provenance') {
        results = graph.nodes
          .filter((node) => node.label === 'Fault')
          .map((fault) => {
            const unit = graph.relationships.find((relationship) => relationship.source === fault.id && relationship.type === 'AFFECTS_UNIT');
            return {
              fault: fault.name,
              faultId: fault.properties.faultId,
              benchmarkLabelStatus: fault.properties.evidenceStatus,
              sourceNote: fault.properties.sourceStatus,
              citation: fault.properties.sourceCitation,
              sourceUrl: fault.properties.sourceUrl,
              mappedUnit: unit ? nodeById.get(unit.target)?.name : undefined,
              unitMappingStatus: 'REQUIRES_SOURCE_REVIEW',
            };
          });
      } else if (queryId === 'sensors-by-unit') {
        results = graph.relationships
          .filter((relationship) => relationship.type === 'LOCATED_IN' && nodeById.get(relationship.source)?.label === 'Sensor')
          .map((relationship) => ({
            sensor: nodeById.get(relationship.source)?.name,
            code: nodeById.get(relationship.source)?.properties.code,
            unit: nodeById.get(relationship.target)?.name,
          }));
      } else {
        results = graph.relationships
          .filter((relationship) => relationship.type === 'FLOWS_TO')
          .map((relationship) => ({
            from: nodeById.get(relationship.source)?.name,
            to: nodeById.get(relationship.target)?.name,
            stream: relationship.properties?.stream,
          }));
      }
      summary = `Local prototype graph returned ${results.length} rows for "${queryId}".`;
    }

    return {
      results,
      summary,
      executionTimeMs: Number((performance.now() - startTime).toFixed(2)),
    };
  }
}

export const tepKnowledgeGraph = new TEPKnowledgeGraph();
