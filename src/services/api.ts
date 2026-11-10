/**
 * Client API Service to interface with Express Backend
 */

import {
  TEPVariable,
  TEPDataProfile,
  TEPFault,
  TelemetryPoint,
  AlarmReviewRecord,
  UnitHealthState,
  UnitAgentAssessment,
  AnomalyReport,
  PredictionResult,
  ShapExplanation,
  KnowledgeGraphData,
  KnowledgeGraphHealth,
  KnowledgeGraphQueryId,
  RAGDocumentChunk,
  RAGSearchResult,
  OrchestrationReport,
  UnitEventAnalysisReport,
  MaintenanceWorkOrder,
  AuthUser,
  AuthRole,
  N8nWebhookEvent,
  ChatMessage,
} from '../types/index.js';

async function parseApiResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return body as T;
}

type XGBoostReplayPrediction = {
  model: 'XGBoost';
  status: 'FAULT_CANDIDATE' | 'UNKNOWN_FAULT' | 'NORMAL';
  faultId: number;
  candidateFaultId: number;
  code: string;
  faultScore: number;
  classConfidence: number;
  faultDecisionThreshold: number;
  classConfidenceThreshold: number;
  probabilities: { faultId: number; score: number }[];
  windowSize: number;
  explanationMethod: 'TreeSHAP';
  topFeatures: { feature: string; contribution: number }[];
  topSensors: { sensor: string; contribution: number }[];
  validation: { status: string; faultDetectionRate: number; falseAlarmRate: number };
};

type FirstAlarmReplayPipeline = {
  status: 'NO_PERSISTENT_ALARM' | 'ALARM_WINDOW_UNAVAILABLE' | 'DIAGNOSIS_PENDING' | 'PERSISTENT_ALARM';
  featureCount: number;
  sampleCount: number;
  threshold: number;
  latestScore: number;
  firstAlarmIndex: number | null;
  diagnosisDelaySamples?: number;
  diagnosisDelayFallback?: boolean;
  diagnosisReadyAtIndex?: number;
  alarmScore?: number;
  persistenceRequired?: number;
  windowStartIndex?: number;
  windowEndIndex?: number;
  diagnosis: XGBoostReplayPrediction | null;
  alarm: AlarmReviewRecord | null;
  operatorNotification: N8nWebhookEvent | null;
  replayFile?: string;
  duplicate?: boolean;
};

export type TepModelPerformance = {
  source: string;
  evaluationSplit: string;
  diagnosisDelaySamples: number | null;
  counts: { faultRuns: number; normalRuns: number; detectedFaultRuns: number; missedFaultRuns: number; falseAlarms: number; correctlyNormalRuns: number };
  detection: { accuracy: number; precision: number; recall: number; specificity: number; f1: number; falseAlarmRate: number; meanDetectionDelaySamples: number | null };
  diagnosis: { correctAmongDetected: number; conditionalAccuracy: number; endToEndCorrectDiagnoses: number; endToEndCorrectRate: number };
};

export const api = {
  async fetchTepModelPerformance(): Promise<TepModelPerformance> {
    const res = await fetch('/api/tep/model-performance');
    return parseApiResponse(res);
  },

  async fetchAuthSession(): Promise<{ configured: boolean; adminExists: boolean; user: AuthUser | null }> {
    const res = await fetch('/api/auth/session');
    return parseApiResponse(res);
  },

  async login(email: string, password: string): Promise<{ user: AuthUser }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return parseApiResponse(res);
  },

  async logout(): Promise<void> {
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    await parseApiResponse(res);
  },

  async fetchUsers(): Promise<{ users: Array<AuthUser & { active: boolean; createdAt: number }> }> {
    const res = await fetch('/api/auth/users');
    return parseApiResponse(res);
  },

  async createUser(input: { email: string; displayName: string; role: AuthRole; password: string }): Promise<{ user: AuthUser }> {
    const res = await fetch('/api/auth/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    return parseApiResponse(res);
  },

  async setUserActive(userId: string, active: boolean): Promise<{ success: boolean }> {
    const res = await fetch(`/api/auth/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }),
    });
    return parseApiResponse(res);
  },

  // --- TEP Simulator ---
  async fetchVariables(): Promise<{ variables: TEPVariable[]; dataProfile: TEPDataProfile }> {
    const res = await fetch('/api/tep/variables');
    return res.json();
  },

  async fetchFaults(): Promise<{ faults: TEPFault[] }> {
    const res = await fetch('/api/tep/faults');
    return res.json();
  },

  async fetchPlantState(): Promise<{
    telemetry: TelemetryPoint;
    unitHealth: UnitHealthState[];
    unitAgents: UnitAgentAssessment[];
    activeFaults: TEPFault[];
    simulationRunning: boolean;
  }> {
    const res = await fetch('/api/tep/state');
    const body = await parseApiResponse<unknown>(res);
    if (
      typeof body !== 'object'
      || body === null
      || !('telemetry' in body)
      || !('unitHealth' in body)
      || !('unitAgents' in body)
      || !Array.isArray(body.unitAgents)
      || !('simulationRunning' in body)
    ) {
      throw new Error(
        'The backend is running an outdated telemetry API and did not return unit-agent assessments. ' +
        'Stop the app server, run "npm run dev" again, then refresh this page.'
      );
    }
    return body as {
      telemetry: TelemetryPoint;
      unitHealth: UnitHealthState[];
      unitAgents: UnitAgentAssessment[];
      activeFaults: TEPFault[];
      simulationRunning: boolean;
    };
  },

  async setSimulationRunning(running: boolean): Promise<{ success: boolean; simulationRunning: boolean }> {
    const res = await fetch(`/api/tep/${running ? 'resume' : 'pause'}`, { method: 'POST' });
    return parseApiResponse(res);
  },

  async fetchAlarmReviews(): Promise<{ alarms: AlarmReviewRecord[] }> {
    const res = await fetch('/api/tep/alarms');
    return parseApiResponse(res);
  },

  async actOnAlarm(
    alarmId: string,
    action: 'ACKNOWLEDGE' | 'RESOLVE' | 'REVIEW',
    note: string,
  ): Promise<{ success: boolean; alarm: AlarmReviewRecord }> {
    const res = await fetch(`/api/tep/alarms/${encodeURIComponent(alarmId)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, note }),
    });
    return parseApiResponse(res);
  },

  async fetchHistory(count: number = 60): Promise<{ history: TelemetryPoint[] }> {
    const res = await fetch(`/api/tep/history?count=${count}`);
    return res.json();
  },

  async stepSimulation(): Promise<{
    telemetry: TelemetryPoint;
    unitHealth: UnitHealthState[];
    unitAgents: UnitAgentAssessment[];
  }> {
    const res = await fetch('/api/tep/step', { method: 'POST' });
    return res.json();
  },

  async injectFault(faultId: number, intensity: number = 1.0): Promise<{ success: boolean; activeFaults: TEPFault[] }> {
    const res = await fetch('/api/tep/inject-fault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultId, intensity }),
    });
    return res.json();
  },

  async clearFault(faultId?: number): Promise<{ success: boolean; activeFaults: TEPFault[] }> {
    const res = await fetch('/api/tep/clear-fault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultId }),
    });
    return res.json();
  },

  async resetPlant(): Promise<{ success: boolean; message: string; archivedAlarmCount: number; telemetry: TelemetryPoint }> {
    const res = await fetch('/api/tep/reset', { method: 'POST' });
    return parseApiResponse(res);
  },

  async setActuator(actuatorId: string, value: number): Promise<{ success: boolean; telemetry: TelemetryPoint }> {
    const res = await fetch('/api/tep/actuator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actuatorId, value }),
    });
    return res.json();
  },

  // --- ML & XAI ---
  async fetchAnomalyReport(): Promise<AnomalyReport> {
    const res = await fetch('/api/ml/anomaly');
    return res.json();
  },

  async fetchPredictionReport(): Promise<PredictionResult> {
    const res = await fetch('/api/ml/prediction');
    return res.json();
  },

  async fetchShapExplanation(): Promise<ShapExplanation> {
    const res = await fetch('/api/ml/shap');
    return res.json();
  },

  // --- Knowledge Graph ---
  async fetchKnowledgeGraphHealth(): Promise<KnowledgeGraphHealth> {
    const res = await fetch('/api/kg/health');
    return parseApiResponse<KnowledgeGraphHealth>(res);
  },

  async fetchKnowledgeGraph(): Promise<KnowledgeGraphData> {
    const res = await fetch('/api/kg/graph');
    return parseApiResponse<KnowledgeGraphData>(res);
  },

  async fetchFaultSubgraph(faultId: number): Promise<KnowledgeGraphData> {
    const res = await fetch(`/api/kg/subgraph/${faultId}`);
    return res.json();
  },

  async executeKnowledgeGraphQuery(queryId: KnowledgeGraphQueryId): Promise<{ results: any[]; summary: string; executionTimeMs: number }> {
    const res = await fetch('/api/kg/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryId }),
    });
    return parseApiResponse<{ results: any[]; summary: string; executionTimeMs: number }>(res);
  },

  // --- RAG ---
  async fetchRAGDocuments(): Promise<{ documents: RAGDocumentChunk[] }> {
    const res = await fetch('/api/rag/documents');
    return parseApiResponse<{ documents: RAGDocumentChunk[] }>(res);
  },

  async searchRAG(query: string, limit: number = 4): Promise<{ results: RAGSearchResult[] }> {
    const res = await fetch('/api/rag/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit }),
    });
    return res.json();
  },

  // --- CrewAI Orchestration ---
  async runCrewAI(targetUnit?: string): Promise<OrchestrationReport> {
    const res = await fetch('/api/orchestrator/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(targetUnit ? { targetUnit } : {}),
    });
    return parseApiResponse<OrchestrationReport>(res);
  },

  async fetchWorkOrders(): Promise<{ orders: MaintenanceWorkOrder[] }> {
    const res = await fetch('/api/maintenance/orders');
    return res.json();
  },

  async createWorkOrderFromAlarm(alarmId: string): Promise<{ success: boolean; order: MaintenanceWorkOrder }> {
    const res = await fetch(`/api/maintenance/from-alarm/${encodeURIComponent(alarmId)}`, { method: 'POST' });
    return parseApiResponse(res);
  },

  async runReplayUnitAnalysis(input: {
    targetUnit: string;
    telemetryTimestamp: number;
    observations: { channelId: string; value: number; unit: string; alarm: string }[];
    adjacentUnitStatus: { unit: string; name: string; status: string; healthIndex: number | null; activeAlarmsCount: number; observations?: { channelId: string; value: number; unit: string; alarm: string }[] }[];
  }): Promise<UnitEventAnalysisReport> {
    const res = await fetch('/api/orchestrator/replay-unit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return parseApiResponse<UnitEventAnalysisReport>(res);
  },

  async classifyReplayWindow(input: { history: { timestamp: number; values: Record<string, number> }[] }): Promise<XGBoostReplayPrediction> {
    const res = await fetch('/api/ml/xgboost/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return parseApiResponse(res);
  },

  async detectReplayFirstAlarm(input: {
    history: { timestamp: number; values: Record<string, number> }[];
    replayFile?: string;
    replaySessionId?: string;
  }): Promise<FirstAlarmReplayPipeline> {
    const res = await fetch('/api/ml/pipeline/first-alarm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return parseApiResponse<FirstAlarmReplayPipeline>(res);
  },

  async classifyAndDraftReplayWorkOrder(input: {
    history: { timestamp: number; values: Record<string, number> }[];
    replayFile?: string;
  }): Promise<{
    success: boolean;
    created: boolean;
    prediction: XGBoostReplayPrediction;
    order: MaintenanceWorkOrder | null;
    operatorAlert: N8nWebhookEvent | null;
  }> {
    const res = await fetch('/api/maintenance/replay-draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    return parseApiResponse(res);
  },

  async compareReplayAnomaly(input: { history: { timestamp: number; values: Record<string, number> }[]; replayFile?: string }): Promise<{
    source: 'IMPORTED_TEP_CSV_REPLAY';
    sampleCount: number;
    pca: null | { method: string; status: string; t2: number; t2Limit: number; spe: number; speLimit: number; consecutiveViolations: number; persistenceRequired: number; isAnomalous: boolean; calibrationQuantile: number };
    autoencoder: null | { method: string; status: string; reconstructionError: number; threshold: number; consecutiveViolations: number; persistenceRequired: number; isAnomalous: boolean };
    note: string;
    operatorAlert: N8nWebhookEvent | null;
  }> {
    const res = await fetch('/api/ml/anomaly/compare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    return parseApiResponse(res);
  },

  async attachSopToWorkOrder(
    orderId: string,
    sop: { title: string; section: string; snippet: string; sourceStatus?: string; citation?: string; sourceUrl?: string }
  ): Promise<{ success: boolean; order: MaintenanceWorkOrder }> {
    const res = await fetch(`/api/maintenance/orders/${encodeURIComponent(orderId)}/sop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sop),
    });
    return parseApiResponse<{ success: boolean; order: MaintenanceWorkOrder }>(res);
  },

  async actOnWorkOrder(
    orderId: string,
    action: 'APPROVE' | 'REJECT' | 'DISPATCH',
    notes?: string,
    triggerN8n?: boolean
  ): Promise<{ success: boolean; order: MaintenanceWorkOrder; n8nEvent?: N8nWebhookEvent }> {
    const res = await fetch('/api/maintenance/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, action, notes, triggerN8n }),
    });
    return parseApiResponse<{ success: boolean; order: MaintenanceWorkOrder; n8nEvent?: N8nWebhookEvent }>(res);
  },

  async completeWorkOrderRepair(orderId: string, notes: string): Promise<{ success: boolean; order: MaintenanceWorkOrder }> {
    const res = await fetch(`/api/maintenance/orders/${encodeURIComponent(orderId)}/repair-complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }),
    });
    return parseApiResponse<{ success: boolean; order: MaintenanceWorkOrder }>(res);
  },

  async closeWorkOrder(orderId: string, notes: string): Promise<{ success: boolean; order: MaintenanceWorkOrder }> {
    const res = await fetch(`/api/maintenance/orders/${encodeURIComponent(orderId)}/close`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }),
    });
    return parseApiResponse<{ success: boolean; order: MaintenanceWorkOrder }>(res);
  },

  // --- n8n Webhook ---
  async dispatchN8n(
    workflowType: 'MAINTENANCE_WORK_ORDER' | 'CRITICAL_ALARM' | 'SHIFT_REPORT',
    payload: Record<string, any>,
    customUrl?: string
  ): Promise<{ success: boolean; event: N8nWebhookEvent }> {
    const res = await fetch('/api/n8n/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowType, payload, customUrl }),
    });
    return res.json();
  },

  async fetchN8nHistory(): Promise<{ events: N8nWebhookEvent[] }> {
    const res = await fetch('/api/n8n/history');
    return res.json();
  },

  // --- Gemini AI Chat ---
  async sendGeminiChat(message: string, history: ChatMessage[] = []): Promise<ChatMessage> {
    const res = await fetch('/api/gemini/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });
    return res.json();
  },
};
