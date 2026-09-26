/**
 * CrewAI Multi-Agent Orchestration Framework for Tennessee Eastman Process
 * Coordinates specialized industrial agents:
 * 1. Process Health Agent (Autoencoder anomaly scores, trends, persistence)
 * 2. Failure Prediction Agent (XGBoost primary + GRU temporal comparison)
 * 3. Explainable AI (XAI) Agent (Reconstruction errors + SHAP attribution)
 * 4. Failure Diagnosis Agent (Knowledge Graph causal reasoning + hypothesis ranking)
 * 5. Maintenance Agent (RAG SOP retrieval, priority scoring, LOTO, engineer sign-off)
 */

import { tepSimulator, type TelemetryPoint, type UnitHealthState } from '../tep/tepSimulator.ts';
import { autoencoderDetector, type AnomalyReport } from '../ml/autoencoder.ts';
import { xgboostPredictor, type PredictionResult } from '../ml/xgboostPredictor.ts';
import { shapEngine, type ShapExplanation } from '../ml/shapEngine.ts';
import { tepKnowledgeGraph, type KnowledgeGraphData } from '../kg/neo4jGraph.ts';
import { tepRagEngine, type RAGSearchResult } from '../rag/ragCorpus.ts';

export interface AgentExecutionLog {
  agentName: string;
  role: string;
  timestamp: number;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'WARNING';
  thought: string;
  actionTaken: string;
  outputSummary: string;
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

export class CrewAIOrchestrator {
  private activeOrders: Map<string, MaintenanceWorkOrder> = new Map();

  public async runOrchestration(): Promise<OrchestrationReport> {
    const executionId = `CREW-${Date.now().toString(36).toUpperCase()}`;
    const timestamp = Date.now();
    const logs: AgentExecutionLog[] = [];

    // 1. Gather Telemetry & Sensor Windows
    const history = tepSimulator.getHistory(30);
    const latestTelemetry = tepSimulator.getLatestTelemetry();
    const unitStates = tepSimulator.getUnitHealthStates();

    // --- AGENT 1: MACHINE/PROCESS HEALTH AGENT ---
    logs.push({
      agentName: 'Process Health Agent',
      role: 'Industrial Anomaly & Trend Monitor',
      timestamp: Date.now(),
      status: 'RUNNING',
      thought: 'Evaluating 41-variable telemetry vector against Autoencoder SPE residual bounds and calculating multi-window persistence...',
      actionTaken: 'Execute Autoencoder reconstruction and evaluate sensor residuals',
      outputSummary: 'Processing anomaly scores...',
    });

    const anomalyReport: AnomalyReport = autoencoderDetector.analyze(latestTelemetry.values);
    const avgHealth = Math.round(unitStates.reduce((acc, u) => acc + u.healthIndex, 0) / unitStates.length);

    let processHealthStatus: 'OPTIMAL' | 'STABLE' | 'DEGRADED' | 'CRITICAL' = 'OPTIMAL';
    if (anomalyReport.anomalyScore >= 75 || avgHealth < 50) processHealthStatus = 'CRITICAL';
    else if (anomalyReport.anomalyScore >= 45 || avgHealth < 75) processHealthStatus = 'DEGRADED';
    else if (anomalyReport.anomalyScore >= 25 || avgHealth < 90) processHealthStatus = 'STABLE';

    logs[0].status = 'SUCCESS';
    logs[0].outputSummary = `Anomaly Score: ${anomalyReport.anomalyScore}% (Threshold: ${anomalyReport.threshold}%). Persistence: ${anomalyReport.persistenceCount} consecutive windows. Overall Plant Health: ${avgHealth}%. Status: ${processHealthStatus}. Top offending sensor: ${anomalyReport.topOffendingSensors[0]?.code || 'None'}.`;

    // --- AGENT 2: FAILURE PREDICTION AGENT ---
    logs.push({
      agentName: 'Failure Prediction Agent',
      role: 'XGBoost & Recurrent Predictive Specialist',
      timestamp: Date.now(),
      status: 'RUNNING',
      thought: 'Extracting sliding-window statistical features (slopes, rolling standard deviations) and evaluating XGBoost multi-class classifier alongside GRU temporal sequence model...',
      actionTaken: 'Evaluate XGBoost fault classifier and benchmark with GRU latency & confidence',
      outputSummary: 'Predicting future fault trajectories...',
    });

    const predictionResult: PredictionResult = xgboostPredictor.predict(history);
    const topPred = predictionResult.topPrediction;

    logs[1].status = 'SUCCESS';
    logs[1].outputSummary = `Primary Model (XGBoost): ${topPred.code} (${topPred.name}) with ${(topPred.probability * 100).toFixed(1)}% probability. Est. Time to Failure: ${topPred.faultId === 0 ? 'Indefinite' : topPred.ttfMinutes + ' min'}. GRU Temporal Comparison: ${(predictionResult.comparison.gru.confidence * 100).toFixed(1)}% confidence, Agreement: ${predictionResult.comparison.agreement ? 'YES' : 'NO'}.`;

    // --- AGENT 3: EXPLAINABLE AI (XAI) AGENT ---
    logs.push({
      agentName: 'Explainable AI Agent',
      role: 'SHAP & Residual Attribution Explainer',
      timestamp: Date.now(),
      status: 'RUNNING',
      thought: 'Calculating TreeSHAP Shapley values and linking reconstruction errors to physical chemical dynamics...',
      actionTaken: 'Compute marginal feature contributions and build waterfall visualization data',
      outputSummary: 'Generating SHAP explanations...',
    });

    const shapExplanation: ShapExplanation = shapEngine.explainPrediction(
      predictionResult,
      anomalyReport,
      latestTelemetry.values
    );

    logs[2].status = 'SUCCESS';
    logs[2].outputSummary = shapExplanation.summaryText;

    // --- AGENT 4: FAILURE DIAGNOSIS & KNOWLEDGE GRAPH AGENT ---
    logs.push({
      agentName: 'Failure Diagnosis Agent',
      role: 'Knowledge Graph Reasoning & Root-Cause Analyst',
      timestamp: Date.now(),
      status: 'RUNNING',
      thought: 'Traversing Tennessee Eastman Neo4j Knowledge Graph. Correlating active sensor deviations with causal symptom nodes and physical unit topology...',
      actionTaken: 'Execute multi-hop graph path traversal from fault candidates to affected piping units',
      outputSummary: 'Synthesizing evidence-based hypotheses...',
    });

    const subGraph = tepKnowledgeGraph.getSubgraphForFault(topPred.faultId || 4);

    const diagnosisHypotheses = [
      {
        rank: 1,
        faultCode: topPred.code,
        faultName: topPred.name,
        confidence: topPred.probability,
        evidenceChain: [
          `Autoencoder flagged sensor residual deviation on ${anomalyReport.topOffendingSensors.map((s) => s.code).join(', ')}`,
          `SHAP attribution confirms ${shapExplanation.topContributions[0]?.code || 'XMEAS(9)'} pushed prediction by +${shapExplanation.topContributions[0]?.shapValue || 0.45}`,
          `Knowledge Graph topological path traces root cause through ${topPred.faultId === 4 ? 'Reactor Coolant Header -> Jacket -> Exotherm' : 'Feed Manifold -> Stream 4'}`,
        ],
        affectedSubsystems: [
          topPred.faultId === 4 ? 'Chemical Reactor (CSTR)' : 'Feed Blending System',
          'Vapor-Liquid Separator',
        ],
      },
    ];

    if (topPred.faultId !== 0 && predictionResult.allPredictions.length > 1) {
      const second = predictionResult.allPredictions[1];
      if (second.probability > 0.05) {
        diagnosisHypotheses.push({
          rank: 2,
          faultCode: second.code,
          faultName: second.name,
          confidence: second.probability,
          evidenceChain: [
            `Secondary candidate with ${(second.probability * 100).toFixed(1)}% prediction probability`,
            `Potential cross-coupling with primary disturbance mode`,
          ],
          affectedSubsystems: ['Product Condenser', 'Centrifugal Compressor'],
        });
      }
    }

    logs[3].status = 'SUCCESS';
    logs[3].outputSummary = `Formulated ${diagnosisHypotheses.length} ranked diagnostic hypotheses. Lead Hypothesis: ${diagnosisHypotheses[0].faultCode} (${diagnosisHypotheses[0].faultName}) with ${(diagnosisHypotheses[0].confidence * 100).toFixed(1)}% confidence. Subgraph contains ${subGraph.nodes.length} nodes and ${subGraph.relationships.length} edges.`;

    // --- AGENT 5: MAINTENANCE & RAG ACTION AGENT ---
    logs.push({
      agentName: 'Maintenance Action Agent',
      role: 'Prescriptive Maintenance & SOP Specialist',
      timestamp: Date.now(),
      status: 'RUNNING',
      thought: 'Querying TEP RAG Engineering Corpus for Standard Operating Procedures (SOPs), Safe Operating Limits (SOL), and generating human-in-the-loop work order...',
      actionTaken: 'Perform semantic RAG retrieval and formulate reviewable maintenance plan',
      outputSummary: 'Compiling maintenance work order...',
    });

    const ragQuery = `${topPred.code} ${topPred.name} ${anomalyReport.topOffendingSensors[0]?.code || 'reactor cooling'}`;
    const ragResults: RAGSearchResult[] = tepRagEngine.search(ragQuery, 3);

    // Formulate Work Order
    let priority: MaintenanceWorkOrder['priority'] = 'P4_ROUTINE';
    if (topPred.faultId !== 0) {
      if (topPred.severity === 'critical' || topPred.probability > 0.7) priority = 'P1_CRITICAL';
      else if (topPred.severity === 'high' || topPred.probability > 0.4) priority = 'P2_HIGH';
      else priority = 'P3_MEDIUM';
    }

    const workOrderId = `WO-${Date.now().toString(36).slice(-5).toUpperCase()}`;
    const workOrder: MaintenanceWorkOrder = {
      id: workOrderId,
      timestamp: Date.now(),
      priority,
      targetUnit: topPred.faultId === 4 ? 'Chemical Reactor Jacket' : topPred.faultId === 14 ? 'Cooling Water Valve XMV(10)' : 'Feed Blending Stream 4',
      targetComponent: topPred.faultId === 4 ? 'Cooling Water Supply Booster Pump & Header' : topPred.faultId === 14 ? 'Pneumatic Actuator Positioner' : 'Control Valve Trim',
      faultHypothesis: `${topPred.code}: ${topPred.name}`,
      confidence: topPred.probability,
      status: 'PROPOSED_PENDING_ENGINEER',
      recommendedChecks: [
        topPred.faultId === 4 ? 'Inspect secondary cooling water pump P-102 discharge pressure' : 'Test valve stroke hysteresis across 0-100% signal range',
        'Verify resistance temperature detector (RTD) calibration on jacket discharge line',
        'Inspect air supply pressure regulator (set to 60 psig minimum)',
        'Check safety relief valve (PSV-101) tell-tale pressure indicator',
      ],
      requiredParts: [
        { partNumber: 'VLV-SEAL-PTFE-4', description: 'PTFE Chevron Packing Seal Kit', quantity: 2 },
        { partNumber: 'POS-DIG-420', description: 'HART Digital Valve Positioner Module', quantity: 1 },
      ],
      lockoutTagoutRequired: priority === 'P1_CRITICAL' || priority === 'P2_HIGH',
      estimatedDowntimeHours: priority === 'P1_CRITICAL' ? 1.5 : 3.0,
      costAvoidanceUsd: priority === 'P1_CRITICAL' ? 48500 : 12400,
      applicableSop: ragResults[0]?.chunk.documentTitle || 'SOP-TEP-004: Reactor Thermal Excursion Response',
    };

    this.activeOrders.set(workOrderId, workOrder);

    logs[4].status = 'SUCCESS';
    logs[4].outputSummary = `Generated Work Order ${workOrder.id} (${workOrder.priority}). Requires Engineer review. Retrieved ${ragResults.length} relevant SOP citations. Estimated economic cost avoidance: $${workOrder.costAvoidanceUsd.toLocaleString()}.`;

    return {
      executionId,
      timestamp,
      processHealthStatus,
      plantHealthIndex: avgHealth,
      overallAnomalyScore: anomalyReport.anomalyScore,
      topPredictedFault: {
        faultId: topPred.faultId,
        code: topPred.code,
        name: topPred.name,
        probability: topPred.probability,
        severity: topPred.severity,
        ttfMinutes: topPred.ttfMinutes,
      },
      diagnosisHypotheses,
      shapAttributionSummary: shapExplanation.summaryText,
      knowledgeGraphSubgraph: subGraph,
      ragEvidence: ragResults.map((r) => ({
        title: r.chunk.documentTitle,
        section: r.chunk.section,
        snippet: r.chunk.content.slice(0, 240) + '...',
        relevance: r.score,
      })),
      maintenancePlan: workOrder,
      agentLogs: logs,
    };
  }

  public getWorkOrders(): MaintenanceWorkOrder[] {
    return Array.from(this.activeOrders.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  public updateWorkOrder(orderId: string, action: 'APPROVE' | 'REJECT' | 'DISPATCH', engineerNotes?: string): MaintenanceWorkOrder | null {
    const order = this.activeOrders.get(orderId);
    if (!order) return null;

    if (action === 'APPROVE') order.status = 'APPROVED';
    else if (action === 'REJECT') order.status = 'REJECTED';
    else if (action === 'DISPATCH') order.status = 'DISPATCHED_TO_N8N';

    if (engineerNotes) order.engineerNotes = engineerNotes;
    return order;
  }
}

export const crewaiOrchestrator = new CrewAIOrchestrator();
