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
  benchmarkMapping?: {
    status:
      | 'used_for_normal_training'
      | 'excluded_semantic_mismatch'
      | 'not_available_in_training_data';
    datasetColumn: string | null;
    reason: string;
  };
}

export interface TEPDataProfile {
  mode: 'simulated';
  simulator: string;
  livePlantConnected: boolean;
  currentTelemetryChannelCount: number;
  trainingDataset: {
    name: string;
    labelScope: string;
    sourceAndLicenseVerified: boolean;
    autoencoderFeatureCount: number;
    faultLabeledEvaluationAvailable: boolean;
  };
  supervisedFaultTrainingDataset: string;
  heldOutTestingDatasets: string[];
  supervisedFaultClassesAvailable: number[];
  benchmarkChannelsNotModeled: string[];
  simulatorChannelsNotPresentInLocalDataset: string[];
  limitations: string[];
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
  monitoredChannels: string[];
  healthIndex: number;
  status: 'OPTIMAL' | 'STABLE' | 'DEGRADED' | 'CRITICAL';
  activeAlarmsCount: number;
  anomalyScore: number;
  temperature: number;
  pressure: number;
  level?: number;
}

export interface UnitAgentObservation {
  channelId: string;
  value: number | null;
  alarm: 'NORMAL' | 'WARN_LOW' | 'WARN_HIGH' | 'TRIP_LOW' | 'TRIP_HIGH' | 'UNAVAILABLE';
}

export interface UnitAgentAssessment {
  agentName: string;
  unit: string;
  unitName: string;
  upstreamUnits: string[];
  digitalGate: 'READY' | 'HOLD_REVIEW';
  blockedByUnits: string[];
  dataQuality: 'COMPLETE' | 'INCOMPLETE';
  missingChannels: string[];
  telemetryTimestamp: number;
  generatedAt: number;
  dataSource: 'SIMULATED_TEP';
  authority: 'ADVISORY_ONLY';
  healthStatus: UnitHealthState['status'];
  healthIndex: number | null;
  activeAlarmsCount: number;
  status: 'MONITORING' | 'REVIEW' | 'ATTENTION' | 'URGENT_REVIEW';
  observations: UnitAgentObservation[];
  recommendation: string;
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
  speThreshold: number;
  calibrationQuantile: number;
  trainingDataName: string;
  trainingRunCount: number;
  normalHoldoutFalseAlarmRate: number;
  isAnomalous: boolean;
  severity: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';
  speMetric: number;
  standardizedInputDistance: number;
  persistenceCount: number;
  topOffendingSensors: SensorAttribution[];
  attributions: SensorAttribution[];
}

export interface FaultPrediction {
  faultId: number;
  code: string;
  name: string;
  score: number;
  isSupported: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  ttfMinutes: null;
}

export interface ModelValidationStatus {
  method: 'PHYSICS_SIGNATURE_HEURISTIC';
  status: 'UNVALIDATED';
  supportedFaultIds: number[];
}

export interface PredictionResult {
  timestamp: number;
  topPrediction: FaultPrediction;
  allPredictions: FaultPrediction[];
  modelValidation: ModelValidationStatus;
  estimatedTTFMinutes: null;
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

export interface RAGDocumentChunk {
  id: string;
  documentTitle: string;
  section: string;
  category: 'process_spec' | 'fault_physics' | 'research_method' | 'maintenance_sop' | 'safety_limits' | 'instrumentation';
  content: string;
  keywords: string[];
  applicableFaults?: number[];
  applicableSensors?: string[];
  source?: {
    citation: string;
    url: string;
    verificationStatus: 'PRIMARY_SOURCE' | 'METADATA_VERIFIED' | 'SECONDARY_SOURCE' | 'UNVERIFIED_ILLUSTRATIVE';
    note?: string;
  };
}

export interface RAGSearchResult {
  chunk: RAGDocumentChunk;
  score: number;
  matchedKeywords: string[];
  evidenceStatus: 'PRIMARY_SOURCE' | 'METADATA_VERIFIED' | 'SECONDARY_SOURCE' | 'UNVERIFIED_ILLUSTRATIVE';
  retrievalMethod: 'BM25_LEXICAL_ENTITY';
}

export interface MaintenanceWorkOrder {
  id: string;
  timestamp: number;
  priority: 'P1_CRITICAL' | 'P2_HIGH' | 'P3_MEDIUM' | 'P4_ROUTINE';
  targetUnit: string;
  targetComponent: string;
  faultHypothesis: string;
  faultSource?: 'SIMULATOR_INJECTION' | 'MODEL_CANDIDATE' | 'TEP_CSV_XGBOOST';
  simulatorFaultId?: number;
  linkedAlarmId?: string;
  modelScore: number | null;
  status: 'PROPOSED_PENDING_ENGINEER' | 'APPROVED' | 'REJECTED' | 'DISPATCHED_TO_N8N' | 'DISPATCHED_TO_TECHNICIAN' | 'REPAIR_COMPLETE' | 'CLOSED';
  recommendedChecks: string[];
  requiredParts: { partNumber: string; description: string; quantity: number }[];
  lockoutTagoutRequired: boolean | null;
  estimatedDowntimeHours: number;
  costAvoidanceUsd: number;
  applicableSop: string;
  sensorSnapshot?: { code: string; name: string; unit: string; actual: number; zScore: number }[];
  ragEvidence?: { title: string; section: string; snippet: string; relevance: number; sourceStatus?: string; citation?: string; sourceUrl?: string }[];
  attachedSop?: { title: string; section: string; snippet: string; sourceStatus?: string; citation?: string; sourceUrl?: string };
  engineerNotes?: string;
  assignedTechnician?: string;
  technicianNotes?: string;
  repairedAt?: number;
  closedBy?: string;
  closedAt?: number;
  closureNotes?: string;
  riskScore?: number;
  riskBand?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  triage?: {
    expectedSeverity: number;
    uncertainty: number;
    uncertaintyBand: 'LOW' | 'MEDIUM' | 'HIGH';
    reviewPriority: number;
    evidenceGaps: string[];
    scoreStatus: 'UNCALIBRATED_MODEL_SCORES';
    policyVersion: 'risk-entropy-v1';
  };
  modelEvidence?: {
    model: 'XGBoost';
    explanationMethod: 'TreeSHAP';
    faultScore: number;
    classConfidence: number;
    topSensors: { sensor: string; contribution: number; actual?: number; unit?: string }[];
    replayFile?: string;
  };
  impactAnalysis?: {
    primaryUnit: string | null;
    connectedUnits: string[];
    linkedSensors: string[];
    linkedProcedures: string[];
    interpretation: string;
    graphSource: 'NEO4J' | 'LOCAL_FALLBACK';
  };
  replayFingerprint?: string;
}

export interface AlarmReviewRecord {
  id: string;
  variableId: string;
  code: string;
  name: string;
  unit: string;
  category: string;
  alarm: 'WARN_LOW' | 'WARN_HIGH' | 'TRIP_LOW' | 'TRIP_HIGH';
  sourceFaults: Array<{ id: number; code: string; name: string; primaryUnit: string; keySensors: string[] }>;
  value: number;
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'CLEARED_PENDING_REVIEW' | 'RESOLVED' | 'ARCHIVED';
  firstSeenAt: number;
  lastSeenAt: number;
  note: string;
  source?: 'SIMULATOR' | 'TEP_CSV_REPLAY';
  sourceFingerprint?: string;
  modelDiagnosis?: {
    model: 'XGBoost';
    candidateFaultId: number;
    classConfidence: number;
    explanationMethod: 'TreeSHAP';
    topSensors: { sensor: string; contribution: number }[];
    firstAlarmSampleIndex: number;
  };
  acknowledgedBy?: string;
  resolvedBy?: string;
  reviewedBy?: string;
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
  agentExecutionMode: 'LOCAL_SEQUENTIAL' | 'CREWAI_REMOTE';
  timestamp: number;
  processHealthStatus: 'OPTIMAL' | 'STABLE' | 'DEGRADED' | 'CRITICAL';
  plantHealthIndex: number;
  overallAnomalyScore: number;
  topPredictedFault: {
    faultId: number;
    code: string;
    name: string;
    score: number;
    severity: string;
    ttfMinutes: null;
  };
  diagnosisHypotheses: {
    rank: number;
    faultCode: string;
    faultName: string;
    score: number;
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
  maintenancePlan: MaintenanceWorkOrder | null;
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

export interface UnitEventAnalysisReport {
  executionId: string;
  agentExecutionMode: 'LOCAL_SEQUENTIAL' | 'CREWAI_REMOTE';
  targetUnit: string;
  telemetryTimestamp: number;
  processHealthStatus: UnitHealthState['status'];
  diagnosisEvidence: string[];
  affectedSubsystems: string[];
  shapAttributionSummary: string;
  recommendedChecks: string[];
  agentLogs: { agentName: string; role: string; timestamp: number; status: string; thought: string; actionTaken: string; outputSummary: string }[];
}

export type AuthRole = 'ADMIN' | 'ENGINEER' | 'OPERATOR' | 'TECHNICIAN';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: AuthRole;
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
