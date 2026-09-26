/**
 * Frontend Type Definitions for Tennessee Eastman Process Digital Twin
 */

export interface TEPVariable {
  id: string;
  code: string;
  name: string;
  unit: string;
  nominal: number;
  min: number;
  max: number;
  lowWarn: number;
  highWarn: number;
  lowTrip: number;
  highTrip: number;
  category: 'feed' | 'reactor' | 'condenser' | 'separator' | 'stripper' | 'compressor' | 'product';
  type: 'measurement' | 'actuator' | 'composition';
  description: string;
}

export interface TEPFault {
  id: number;
  code: string;
  name: string;
  type: 'Step' | 'Random' | 'Slow Drift' | 'Stiction' | 'Unknown / Fouling';
  primaryUnit: 'reactor' | 'condenser' | 'separator' | 'stripper' | 'compressor' | 'feed';
  description: string;
  physicalMechanism: string;
  keySensors: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  standardSop: string;
}

export interface TelemetryPoint {
  timestamp: number;
  step: number;
  values: Record<string, number>;
  alarms: Record<string, 'NORMAL' | 'WARN_LOW' | 'WARN_HIGH' | 'TRIP_LOW' | 'TRIP_HIGH'>;
  activeFaults: number[];
  faultIntensity: number;
}

export interface UnitHealthState {
  unit: string;
  name: string;
  healthIndex: number;
  status: 'OPTIMAL' | 'STABLE' | 'DEGRADED' | 'CRITICAL';
  activeAlarmsCount: number;
  anomalyScore: number;
  temperature: number;
  pressure: number;
  level?: number;
}

export interface SensorAttribution {
  varId: string;
  code: string;
  name: string;
  unit: string;
  actual: number;
  reconstructed: number;
  squaredError: number;
  percentContribution: number;
  zScore: number;
  isOffending: boolean;
}

export interface AnomalyReport {
  timestamp: number;
  anomalyScore: number;
  threshold: number;
  isAnomalous: boolean;
  severity: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';
  speMetric: number;
  t2Metric: number;
  persistenceCount: number;
  topOffendingSensors: SensorAttribution[];
  attributions: SensorAttribution[];
}

export interface FaultPrediction {
  faultId: number;
  code: string;
  name: string;
  probability: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  ttfMinutes: number;
}

export interface ModelComparison {
  xgboost: {
    predictedFault: string;
    faultId: number;
    confidence: number;
    latencyMs: number;
    rocAuc: number;
  };
  gru: {
    predictedFault: string;
    faultId: number;
    confidence: number;
    latencyMs: number;
    rocAuc: number;
  };
  agreement: boolean;
  modelConfidenceRatio: number;
  sequenceTemporalTrend: 'STABLE' | 'ACCELERATING' | 'DIVERGING' | 'DECAYING';
}

export interface PredictionResult {
  timestamp: number;
  topPrediction: FaultPrediction;
  allPredictions: FaultPrediction[];
  comparison: ModelComparison;
  estimatedTTFMinutes: number;
  riskLevel: 'LOW' | 'ELEVATED' | 'HIGH' | 'CRITICAL';
  windowFeatures: {
    featureName: string;
    value: number;
    slope: number;
    variance: number;
  }[];
}

export interface ShapFeatureContribution {
  featureId: string;
  code: string;
  name: string;
  unit: string;
  currentValue: number;
  nominalValue: number;
  shapValue: number;
  direction: 'increases_risk' | 'decreases_risk';
  percentImpact: number;
  physicalInterpretation: string;
}

export interface ShapExplanation {
  timestamp: number;
  targetFaultCode: string;
  targetFaultName: string;
  targetFaultId: number;
  baseValue: number;
  outputValue: number;
  topContributions: ShapFeatureContribution[];
  summaryText: string;
}

export interface GraphNode {
  id: string;
  label: 'Unit' | 'Sensor' | 'Actuator' | 'Fault' | 'Symptom' | 'MaintenanceProcedure';
  name: string;
  properties: Record<string, any>;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
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

export interface RAGDocumentChunk {
  id: string;
  documentTitle: string;
  section: string;
  category: 'process_spec' | 'fault_physics' | 'maintenance_sop' | 'safety_limits' | 'instrumentation';
  content: string;
  keywords: string[];
  applicableFaults?: number[];
  applicableSensors?: string[];
}

export interface RAGSearchResult {
  chunk: RAGDocumentChunk;
  score: number;
  matchedKeywords: string[];
}

export interface MaintenanceWorkOrder {
  id: string;
  timestamp: number;
  priority: 'P1_CRITICAL' | 'P2_HIGH' | 'P3_MEDIUM' | 'P4_ROUTINE';
  targetUnit: string;
  targetComponent: string;
  faultHypothesis: string;
  confidence: number;
  status: 'PROPOSED_PENDING_ENGINEER' | 'APPROVED' | 'REJECTED' | 'DISPATCHED_TO_N8N';
  recommendedChecks: string[];
  requiredParts: { partNumber: string; description: string; quantity: number }[];
  lockoutTagoutRequired: boolean;
  estimatedDowntimeHours: number;
  costAvoidanceUsd: number;
  applicableSop: string;
  engineerNotes?: string;
}

export interface AgentExecutionLog {
  agentName: string;
  role: string;
  timestamp: number;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'WARNING';
  thought: string;
  actionTaken: string;
  outputSummary: string;
}

export interface OrchestrationReport {
  executionId: string;
  timestamp: number;
  processHealthStatus: 'OPTIMAL' | 'STABLE' | 'DEGRADED' | 'CRITICAL';
  plantHealthIndex: number;
  overallAnomalyScore: number;
  topPredictedFault: {
    faultId: number;
    code: string;
    name: string;
    probability: number;
    severity: string;
    ttfMinutes: number;
  };
  diagnosisHypotheses: {
    rank: number;
    faultCode: string;
    faultName: string;
    confidence: number;
    evidenceChain: string[];
    affectedSubsystems: string[];
  }[];
  shapAttributionSummary: string;
  knowledgeGraphSubgraph: KnowledgeGraphData;
  ragEvidence: {
    title: string;
    section: string;
    snippet: string;
    relevance: number;
  }[];
  maintenancePlan: MaintenanceWorkOrder;
  agentLogs: AgentExecutionLog[];
}

export interface N8nWebhookEvent {
  id: string;
  workflowType: 'MAINTENANCE_WORK_ORDER' | 'CRITICAL_ALARM' | 'SHIFT_REPORT';
  timestamp: number;
  endpointUrl: string;
  status: 'DELIVERED' | 'SIMULATED' | 'FAILED';
  httpStatus: number;
  payload: Record<string, any>;
  responseMessage: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  groundingSources?: {
    type: 'TELEMETRY' | 'XAI_SHAP' | 'KNOWLEDGE_GRAPH' | 'RAG_DOC' | 'PREDICTION';
    title: string;
    details: string;
  }[];
}
