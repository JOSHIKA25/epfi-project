/**
 * Client API Service to interface with Express Backend
 */

import {
  TEPVariable,
  TEPFault,
  TelemetryPoint,
  UnitHealthState,
  AnomalyReport,
  PredictionResult,
  ShapExplanation,
  KnowledgeGraphData,
  RAGSearchResult,
  OrchestrationReport,
  MaintenanceWorkOrder,
  N8nWebhookEvent,
  ChatMessage,
} from '../types/index.js';

export const api = {
  // --- TEP Simulator ---
  async fetchVariables(): Promise<{ variables: TEPVariable[] }> {
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
    activeFaults: TEPFault[];
  }> {
    const res = await fetch('/api/tep/state');
    return res.json();
  },

  async fetchHistory(count: number = 60): Promise<{ history: TelemetryPoint[] }> {
    const res = await fetch(`/api/tep/history?count=${count}`);
    return res.json();
  },

  async stepSimulation(): Promise<{ telemetry: TelemetryPoint; unitHealth: UnitHealthState[] }> {
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

  async resetPlant(): Promise<{ success: boolean; message: string; telemetry: TelemetryPoint }> {
    const res = await fetch('/api/tep/reset', { method: 'POST' });
    return res.json();
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
  async fetchKnowledgeGraph(): Promise<KnowledgeGraphData> {
    const res = await fetch('/api/kg/graph');
    return res.json();
  },

  async fetchFaultSubgraph(faultId: number): Promise<KnowledgeGraphData> {
    const res = await fetch(`/api/kg/subgraph/${faultId}`);
    return res.json();
  },

  async executeCypher(query: string): Promise<{ results: any[]; summary: string; executionTimeMs: number }> {
    const res = await fetch('/api/kg/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    return res.json();
  },

  // --- RAG ---
  async searchRAG(query: string, limit: number = 4): Promise<{ results: RAGSearchResult[] }> {
    const res = await fetch('/api/rag/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit }),
    });
    return res.json();
  },

  // --- CrewAI Orchestration ---
  async runCrewAI(): Promise<OrchestrationReport> {
    const res = await fetch('/api/orchestrator/run', { method: 'POST' });
    return res.json();
  },

  async fetchWorkOrders(): Promise<{ orders: MaintenanceWorkOrder[] }> {
    const res = await fetch('/api/maintenance/orders');
    return res.json();
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
    return res.json();
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
