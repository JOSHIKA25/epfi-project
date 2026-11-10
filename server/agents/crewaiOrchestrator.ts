/**
 * TypeScript adapter for the Python CrewAI service and work-order lifecycle.
 */

import { tepSimulator } from '../tep/tepSimulator.ts';
import { TEP_FAULTS, TEP_VARIABLES } from '../tep/tepConstants.ts';
import { autoencoderDetector } from '../ml/autoencoder.ts';
import { physicsSignaturePredictor } from '../ml/physicsSignaturePredictor.ts';
import { shapEngine } from '../ml/shapEngine.ts';
import { tepKnowledgeGraph, type KnowledgeGraphData } from '../kg/neo4jGraph.ts';
import { tepRagEngine } from '../rag/ragCorpus.ts';
import { stateStore } from '../state/stateStore.ts';

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

interface CrewAIServiceResult {
  processHealthStatus: OrchestrationReport['processHealthStatus'];
  diagnosisEvidence: string[];
  affectedSubsystems: string[];
  shapAttributionSummary: string;
  recommendedChecks: string[];
  agentLogs: AgentExecutionLog[];
}

export interface UnitEventAnalysisReport extends CrewAIServiceResult {
  executionId: string;
  agentExecutionMode: OrchestrationReport['agentExecutionMode'];
  targetUnit: string;
  telemetryTimestamp: number;
}

export class WorkOrderTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkOrderTransitionError';
  }
}

export class CrewAIOrchestrator {
  private activeOrders: Map<string, MaintenanceWorkOrder> = new Map();

  public async runOrchestration(targetUnit?: string): Promise<OrchestrationReport> {
    const timestamp = Date.now();
    const executionId = `CREW-${timestamp.toString(36).toUpperCase()}`;
    const history = tepSimulator.getHistory(30);
    const telemetry = tepSimulator.getLatestTelemetry();
    const unitHealth = tepSimulator.getUnitHealthStates();
    const anomaly = autoencoderDetector.analyze(telemetry.values);
    const prediction = physicsSignaturePredictor.predict(history);
    const shap = shapEngine.explainPrediction(prediction, anomaly, telemetry.values);
    const topPrediction = prediction.topPrediction;
    const activeFaultIds = new Set(tepSimulator.getActiveFaults().map((fault) => fault.id));
    const injectedFault = TEP_FAULTS.find((fault) => activeFaultIds.has(fault.id));
    const scenarioFaultId = injectedFault?.id || topPrediction.faultId || 4;
    let graph: KnowledgeGraphData;
    let graphFailure: string | null = null;
    try {
      graph = await tepKnowledgeGraph.getSubgraphForFault(scenarioFaultId);
    } catch (error) {
      graphFailure = error instanceof Error ? error.message : 'Knowledge graph request failed.';
      graph = { nodes: [], relationships: [] };
    }
    const ragResults = tepRagEngine.search(
      `${injectedFault?.code || topPrediction.code} ${injectedFault?.name || topPrediction.name} ${anomaly.topOffendingSensors[0]?.code || 'process safety'}`,
      3
    );
    const plantHealthIndex = Math.round(
      unitHealth.reduce((total, unit) => total + unit.healthIndex, 0) / Math.max(1, unitHealth.length)
    );
    const context: Record<string, unknown> = {
      telemetry: { timestamp: telemetry.timestamp, step: telemetry.step, values: telemetry.values, alarms: telemetry.alarms },
      unitHealth,
      anomalyReport: {
        anomalyScore: anomaly.anomalyScore, threshold: anomaly.threshold, severity: anomaly.severity,
        persistenceCount: anomaly.persistenceCount, topOffendingSensors: anomaly.topOffendingSensors.slice(0, 5),
      },
      predictionResult: {
        topPrediction, allPredictions: prediction.allPredictions.slice(0, 3),
        modelValidation: prediction.modelValidation, riskLevel: prediction.riskLevel,
        estimatedTTFMinutes: prediction.estimatedTTFMinutes,
      },
      shapExplanation: { summaryText: shap.summaryText, topContributions: shap.topContributions.slice(0, 5) },
      knowledgeGraphSubgraph: graph,
      ragEvidence: ragResults.map((result) => ({
        title: result.chunk.documentTitle, section: result.chunk.section,
        snippet: result.chunk.content.slice(0, 600), relevance: result.score,
      })),
    };
    const targetUnitHealth = targetUnit ? unitHealth.find((unit) => unit.unit === targetUnit) : undefined;
    if (targetUnit && targetUnitHealth) {
      const targetChannels = new Set(targetUnitHealth.monitoredChannels);
      const unitObservations = unitHealth.map((unit) => ({
        unit: unit.unit,
        unitName: unit.name,
        observations: unit.monitoredChannels.map((channelId) => ({
          channelId,
          value: telemetry.values[channelId],
          alarm: telemetry.alarms[channelId],
        })),
      }));
      context.unitEvent = {
        targetUnit,
        unitName: targetUnitHealth.name,
        telemetryStep: telemetry.step,
        observations: targetUnitHealth.monitoredChannels.map((channelId) => ({
          channelId,
          value: telemetry.values[channelId],
          alarm: telemetry.alarms[channelId],
        })),
        unitObservations,
        activeFaults: tepSimulator.getActiveFaults().map(({ id, code, name, primaryUnit, keySensors }) => ({ id, code, name, primaryUnit, keySensors })),
        unitHealth,
        adjacentUnitStatus: unitHealth
          .filter((unit) => unit.unit !== targetUnit)
          .map(({ unit, name, status, healthIndex, activeAlarmsCount }) => ({ unit, name, status, healthIndex, activeAlarmsCount })),
        anomalyEvidence: anomaly.topOffendingSensors
          .filter((sensor) => targetChannels.has(sensor.varId))
          .slice(0, 4)
          .map(({ varId, actual, unit, zScore, percentContribution }) => ({ varId, actual, unit, zScore, percentContribution })),
      };
    }
    agentTrace('Orchestrator · SHARED INPUT', { executionId, activeFault: injectedFault ? { id: injectedFault.id, code: injectedFault.code, name: injectedFault.name } : null, ...context });
    const serviceUrl = (process.env.CREWAI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
    let agentExecutionMode: OrchestrationReport['agentExecutionMode'] = 'LOCAL_SEQUENTIAL';
    let remoteFailure: string | null = null;
    let crewResult: CrewAIServiceResult;
    if (process.env.CREWAI_MODE?.toLowerCase() === 'remote') {
      try {
        agentTrace('Orchestrator → Remote CrewAI · INPUT', { executionId, serviceUrl, context });
        crewResult = await runRemoteCrewAI(serviceUrl, executionId, timestamp, context);
        agentExecutionMode = 'CREWAI_REMOTE';
        agentTrace('Remote CrewAI → Orchestrator · OUTPUT', crewResult);
      } catch (error) {
        remoteFailure = error instanceof Error ? error.message : 'Unknown remote CrewAI error.';
        crewResult = targetUnit && targetUnitHealth
          ? runLocalUnitEvent(targetUnitHealth, telemetry, context.unitEvent as Record<string, unknown>, timestamp)
          : runLocalSequentialAgents({
          timestamp, unitHealth, anomaly, prediction, shapSummary: shap.summaryText,
          graph, ragResults, injectedFault,
        });
      }
    } else {
      crewResult = targetUnit && targetUnitHealth
        ? runLocalUnitEvent(targetUnitHealth, telemetry, context.unitEvent as Record<string, unknown>, timestamp)
        : runLocalSequentialAgents({
        timestamp, unitHealth, anomaly, prediction, shapSummary: shap.summaryText,
        graph, ragResults, injectedFault,
      });
    }
    agentTrace('Orchestrator · TICKET DECISION', {
      injectedFault: injectedFault ? { id: injectedFault.id, code: injectedFault.code } : null,
      modelCandidate: { faultId: topPrediction.faultId, code: topPrediction.code, score: topPrediction.score, supported: topPrediction.isSupported },
      ticketCreated: Boolean(injectedFault || (topPrediction.faultId !== 0 && topPrediction.isSupported && topPrediction.score >= 0.25)),
    });
    if (remoteFailure) {
      appendAgentLogSummary(crewResult.agentLogs, 0, `Remote CrewAI failed (${remoteFailure.slice(0, 180)}); local sequence continued.`);
    }
    if (graphFailure) {
      appendAgentLogSummary(crewResult.agentLogs, 3, `Graph connection failed (${graphFailure.slice(0, 120)}); diagnosis continued with telemetry and RAG evidence.`);
    }

    const modelCandidateSupported =
      topPrediction.faultId !== 0 && topPrediction.isSupported && topPrediction.score >= 0.25;
    const faultForTicket = injectedFault || (modelCandidateSupported
      ? TEP_FAULTS.find((fault) => fault.id === topPrediction.faultId)
      : undefined);
    const hasSupportedFault = Boolean(injectedFault || modelCandidateSupported);
    let workOrder: MaintenanceWorkOrder | null = null;
    if (hasSupportedFault) {
      const existingScenarioOrder = injectedFault
        ? this.getWorkOrders().find((order) => order.simulatorFaultId === injectedFault.id
          && !['REJECTED', 'CLOSED'].includes(order.status))
        : undefined;
      if (existingScenarioOrder) {
        workOrder = existingScenarioOrder;
        appendAgentLogSummary(crewResult.agentLogs, 4, `Existing review ticket ${workOrder.id} remains open for this injected scenario.`);
      } else {
      const issueSeverity = faultForTicket?.severity || topPrediction.severity;
      const priority: MaintenanceWorkOrder['priority'] =
        issueSeverity === 'critical' || (!injectedFault && topPrediction.score > 0.7)
          ? 'P1_CRITICAL'
          : issueSeverity === 'high' || (!injectedFault && topPrediction.score > 0.4)
            ? 'P2_HIGH'
            : 'P3_MEDIUM';
      const workOrderId = `WO-${timestamp.toString(36).slice(-5).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      const unitNames: Record<string, string> = {
        reactor: 'Chemical Reactor', condenser: 'Product Condenser', separator: 'Vapor-Liquid Separator',
        stripper: 'Stripping Column', compressor: 'Recycle Compressor', feed: 'Feed Stream Manifold',
      };
      workOrder = {
        id: workOrderId,
        timestamp,
        priority,
        targetUnit: unitNames[faultForTicket!.primaryUnit],
        targetComponent: `Instrumentation and equipment associated with ${faultForTicket!.primaryUnit}`,
        faultHypothesis: `${injectedFault ? '[Fault Lab injected scenario]' : '[Model candidate]'} ${faultForTicket!.code}: ${faultForTicket!.name}`,
        faultSource: injectedFault ? 'SIMULATOR_INJECTION' : 'MODEL_CANDIDATE',
        simulatorFaultId: injectedFault?.id,
        modelScore: injectedFault ? null : topPrediction.score,
        status: 'PROPOSED_PENDING_ENGINEER',
        recommendedChecks: crewResult.recommendedChecks,
        requiredParts: [],
        lockoutTagoutRequired: null,
        estimatedDowntimeHours: 0,
        costAvoidanceUsd: 0,
        applicableSop: ragResults[0]?.chunk.documentTitle
          ? `Research reference only: ${ragResults[0].chunk.documentTitle}; no site SOP attached.`
          : 'No research reference retrieved; no site SOP attached.',
        sensorSnapshot: anomaly.topOffendingSensors.slice(0, 5).map((sensor) => ({
          code: sensor.code,
          name: sensor.name,
          unit: sensor.unit,
          actual: sensor.actual,
          zScore: sensor.zScore,
        })),
        ragEvidence: ragResults.slice(0, 3).map((result) => ({
          title: result.chunk.documentTitle,
          section: result.chunk.section,
          snippet: result.chunk.content.slice(0, 320),
          relevance: result.score,
          sourceStatus: result.evidenceStatus,
          citation: result.chunk.source?.citation,
          sourceUrl: result.chunk.source?.url,
        })),
      };
      this.activeOrders.set(workOrderId, workOrder);
      stateStore.storeWorkOrders(Array.from(this.activeOrders.values()));
      stateStore.addAuditEvent({
        category: 'maintenance',
        action: 'WORK_ORDER_CREATED',
        actor: 'crewai-orchestrator',
        entityType: 'work_order',
        entityId: workOrder.id,
        status: 'SUCCESS',
        details: {
          targetUnit: workOrder.targetUnit,
          targetComponent: workOrder.targetComponent,
          faultHypothesis: workOrder.faultHypothesis,
          faultSource: workOrder.faultSource,
          simulatorFaultId: workOrder.simulatorFaultId,
          priority: workOrder.priority,
        },
      });
      appendAgentLogSummary(crewResult.agentLogs, 4, `Drafted work order ${workOrder.id} for engineer review.`);
      }
    } else {
      appendAgentLogSummary(crewResult.agentLogs, 4, 'No supported fault candidate; no work order was created.');
    }

    const diagnosisHypotheses: OrchestrationReport['diagnosisHypotheses'] = [
      {
        rank: 1,
        faultCode: topPrediction.code,
        faultName: topPrediction.name,
        score: topPrediction.score,
        evidenceChain: crewResult.diagnosisEvidence,
        affectedSubsystems: crewResult.affectedSubsystems,
      },
    ];
    const secondPrediction = prediction.allPredictions[1];
    if (topPrediction.faultId !== 0 && secondPrediction && secondPrediction.score > 0.05) {
      diagnosisHypotheses.push({
        rank: 2,
        faultCode: secondPrediction.code,
        faultName: secondPrediction.name,
        score: secondPrediction.score,
        evidenceChain: [`Secondary model candidate at ${(secondPrediction.score * 100).toFixed(1)}% relative score.`],
        affectedSubsystems: crewResult.affectedSubsystems,
      });
    }

    const report: OrchestrationReport = {
      executionId,
      agentExecutionMode,
      timestamp,
      processHealthStatus: crewResult.processHealthStatus,
      plantHealthIndex,
      overallAnomalyScore: anomaly.anomalyScore,
      topPredictedFault: {
        faultId: topPrediction.faultId,
        code: topPrediction.code,
        name: topPrediction.name,
        score: topPrediction.score,
        severity: topPrediction.severity,
        ttfMinutes: topPrediction.ttfMinutes,
      },
      diagnosisHypotheses,
      shapAttributionSummary: crewResult.shapAttributionSummary,
      knowledgeGraphSubgraph: graph,
      ragEvidence: ragResults.map((result) => ({
        title: result.chunk.documentTitle,
        section: result.chunk.section,
        snippet: result.chunk.content.slice(0, 240) + '...',
        relevance: result.score,
      })),
      maintenancePlan: workOrder,
      agentLogs: crewResult.agentLogs,
    };
    agentTrace('Orchestrator · FINAL REPORT', report);
    return report;
  }

  public async runReplayUnitAnalysis(
    targetUnit: string,
    observations: { channelId: string; value: number; unit: string; alarm: string }[],
    telemetryTimestamp: number,
    adjacentUnitStatus: { unit: string; name: string; status: string; healthIndex: number | null; activeAlarmsCount: number; observations?: { channelId: string; value: number; unit: string; alarm: string }[] }[]
  ): Promise<UnitEventAnalysisReport> {
    const timestamp = Date.now();
    const executionId = `REPLAY-${timestamp.toString(36).toUpperCase()}`;
    const currentUnitHealth = tepSimulator.getUnitHealthStates();
    const unitInfo = currentUnitHealth.find((unit) => unit.unit === targetUnit);
    const replayAlarmPoints = observations.reduce((total, item) =>
      total + (item.alarm.startsWith('TRIP') ? 30 : item.alarm.startsWith('WARN') ? 12 : 0), 0);
    const replayHealth = Math.max(5, 100 - replayAlarmPoints);
    const replayStatus = replayHealth < 40 ? 'CRITICAL' : replayHealth < 70 ? 'DEGRADED' : replayHealth < 90 ? 'STABLE' : 'OPTIMAL';
    const replayUnitHealth = [
      { unit: targetUnit, name: unitInfo?.name || targetUnit, status: replayStatus, healthIndex: replayHealth, activeAlarmsCount: observations.filter((item) => item.alarm !== 'NORMAL').length },
      ...adjacentUnitStatus,
    ];
    const event = {
      targetUnit,
      unitName: unitInfo?.name || targetUnit,
      telemetryStep: telemetryTimestamp,
      observations,
      activeFaults: [],
      unitHealth: replayUnitHealth,
      unitObservations: [
        { unit: targetUnit, unitName: unitInfo?.name || targetUnit, observations },
        ...adjacentUnitStatus.map(({ unit, name, observations: unitReadings = [] }) => ({ unit, unitName: name, observations: unitReadings })),
      ],
      adjacentUnitStatus,
      anomalyEvidence: observations.filter((observation) => observation.alarm !== 'NORMAL'),
    };
    const context: Record<string, unknown> = {
      telemetry: { timestamp: telemetryTimestamp, step: telemetryTimestamp, values: {}, alarms: {} },
      unitHealth: replayUnitHealth,
      anomalyReport: {},
      predictionResult: {},
      shapExplanation: {},
      knowledgeGraphSubgraph: { nodes: [], relationships: [] },
      ragEvidence: [],
      unitEvent: event,
    };
    let result: CrewAIServiceResult;
    let agentExecutionMode: OrchestrationReport['agentExecutionMode'] = 'LOCAL_SEQUENTIAL';
    if (process.env.CREWAI_MODE?.toLowerCase() === 'remote') {
      try {
        const serviceUrl = (process.env.CREWAI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
        result = await runRemoteCrewAI(serviceUrl, executionId, timestamp, context);
        agentExecutionMode = 'CREWAI_REMOTE';
      } catch {
        result = replayUnitLocalResult(targetUnit, observations, timestamp);
      }
    } else {
      result = replayUnitLocalResult(targetUnit, observations, timestamp);
    }
    return { ...result, executionId, agentExecutionMode, targetUnit, telemetryTimestamp };
  }

  public getWorkOrders(): MaintenanceWorkOrder[] {
    const persistedOrders = stateStore.getWorkOrders();
    if (persistedOrders.length > 0) {
      this.activeOrders = new Map(persistedOrders.map((order) => [order.id, order]));
    }
    return Array.from(this.activeOrders.values()).sort((a, b) => {
      const aPending = a.status === 'PROPOSED_PENDING_ENGINEER';
      const bPending = b.status === 'PROPOSED_PENDING_ENGINEER';
      if (aPending !== bPending) return aPending ? -1 : 1;
      if (aPending && bPending) {
        if (a.linkedAlarmId || b.linkedAlarmId) return b.timestamp - a.timestamp;
        const priorityDifference = (b.triage?.reviewPriority ?? b.riskScore ?? 0)
          - (a.triage?.reviewPriority ?? a.riskScore ?? 0);
        if (priorityDifference !== 0) return priorityDifference;
      }
      return b.timestamp - a.timestamp;
    });
  }

  public async createAlarmWorkOrder(alarm: {
    id: string; code: string; name: string; unit: string; category: string; alarm: string;
    value: number; firstSeenAt: number; acknowledgedBy?: string; note?: string; sourceFaults: Array<{ id: number; code: string; name: string; primaryUnit: string; keySensors: string[] }>;
    source?: 'SIMULATOR' | 'TEP_CSV_REPLAY';
    modelDiagnosis?: { model: 'XGBoost'; candidateFaultId: number; classConfidence: number; explanationMethod: 'TreeSHAP'; topSensors: { sensor: string; contribution: number }[]; firstAlarmSampleIndex: number };
  }, actor: string): Promise<MaintenanceWorkOrder> {
    const existing = this.getWorkOrders().find((order) => order.linkedAlarmId === alarm.id && !['REJECTED', 'CLOSED'].includes(order.status));
    if (existing) return existing;
    const sourceFault = alarm.sourceFaults[0];
    const matchingDraft = alarm.source !== 'TEP_CSV_REPLAY' && sourceFault && this.getWorkOrders().find((order) => order.faultSource === 'SIMULATOR_INJECTION'
      && order.simulatorFaultId === sourceFault.id && !order.linkedAlarmId
      && order.status === 'PROPOSED_PENDING_ENGINEER' && order.timestamp >= alarm.firstSeenAt - 120_000);
    if (matchingDraft) {
      matchingDraft.linkedAlarmId = alarm.id;
      matchingDraft.sensorSnapshot = [{ code: alarm.code, name: alarm.name, unit: alarm.unit, actual: alarm.value, zScore: 0 }];
      stateStore.storeWorkOrders(Array.from(this.activeOrders.values()));
      stateStore.addAuditEvent({ category: 'maintenance', action: 'WORK_ORDER_LINKED_TO_ACKNOWLEDGED_ALARM', actor, entityType: 'work_order', entityId: matchingDraft.id, status: 'SUCCESS', details: { linkedAlarmId: alarm.id, sensor: alarm.code, operator: alarm.acknowledgedBy } });
      return matchingDraft;
    }
    const unitNames: Record<string, string> = {
      reactor: 'Chemical Reactor', condenser: 'Product Condenser', separator: 'Vapor-Liquid Separator',
      stripper: 'Stripping Column', compressor: 'Recycle Compressor', feed: 'Feed Stream Manifold',
    };
    let impactAnalysis: MaintenanceWorkOrder['impactAnalysis'];
    let ragEvidence: NonNullable<MaintenanceWorkOrder['ragEvidence']> = [];
    if (sourceFault) {
      try {
        impactAnalysis = await tepKnowledgeGraph.getImpactAnalysisForFault(sourceFault.id);
      } catch (error) {
        console.warn('[Maintenance] Graph context unavailable for acknowledged alarm:', error instanceof Error ? error.message : 'unknown error');
      }
      ragEvidence = tepRagEngine.search(`${sourceFault.code} ${sourceFault.name} ${alarm.name}`, 3).map((result) => ({
        title: result.chunk.documentTitle,
        section: result.chunk.section,
        snippet: result.chunk.content.slice(0, 320),
        relevance: result.score,
        sourceStatus: result.evidenceStatus,
        citation: result.chunk.source?.citation,
        sourceUrl: result.chunk.source?.url,
      }));
    }
    const order: MaintenanceWorkOrder = {
      id: `WO-${Date.now().toString(36).slice(-5).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      timestamp: Date.now(), priority: alarm.alarm.startsWith('TRIP') ? 'P1_CRITICAL' : 'P2_HIGH',
      targetUnit: unitNames[sourceFault?.primaryUnit ?? alarm.category] ?? alarm.category,
      targetComponent: `${alarm.name} (${alarm.code})`,
      faultHypothesis: sourceFault ? `${sourceFault.code}: ${sourceFault.name}${alarm.modelDiagnosis ? ` (XGBoost candidate, ${(alarm.modelDiagnosis.classConfidence * 100).toFixed(1)}% class score)` : ''}` : `Investigate ${alarm.name} alarm`,
      faultSource: alarm.source === 'TEP_CSV_REPLAY' ? 'TEP_CSV_XGBOOST' : 'SIMULATOR_INJECTION',
      simulatorFaultId: alarm.source === 'TEP_CSV_REPLAY' ? undefined : sourceFault?.id,
      linkedAlarmId: alarm.id,
      modelScore: alarm.modelDiagnosis?.classConfidence ?? null, status: 'PROPOSED_PENDING_ENGINEER',
      ...(alarm.modelDiagnosis ? { modelEvidence: {
        model: 'XGBoost' as const,
        explanationMethod: 'TreeSHAP' as const,
        faultScore: alarm.modelDiagnosis.classConfidence,
        classConfidence: alarm.modelDiagnosis.classConfidence,
        topSensors: alarm.modelDiagnosis.topSensors.map((item) => ({ sensor: item.sensor, contribution: item.contribution })),
        replayFile: 'Prepared held-out TEP CSV replay',
      } } : {}),
      recommendedChecks: [
        'Verify the indicated sensor and compare it with related process readings.',
        ...(impactAnalysis?.connectedUnits.length ? [`Review connected units in the graph impact context: ${impactAnalysis.connectedUnits.join(', ')}.`] : []),
        'Consult the current site-approved maintenance procedure before physical work.',
      ],
      requiredParts: [], lockoutTagoutRequired: null, estimatedDowntimeHours: 0, costAvoidanceUsd: 0,
      applicableSop: ragEvidence[0]?.title
        ? `Research reference only: ${ragEvidence[0].title}; no site SOP attached.`
        : 'No research reference retrieved; confirm the approved site procedure before work.',
      ...(ragEvidence.length ? { ragEvidence } : {}),
      ...(impactAnalysis ? { impactAnalysis } : {}),
      sensorSnapshot: [{ code: alarm.code, name: alarm.name, unit: alarm.unit, actual: alarm.value, zScore: 0 }],
      engineerNotes: undefined,
    };
    this.activeOrders.set(order.id, order);
    stateStore.storeWorkOrders(Array.from(this.activeOrders.values()));
    stateStore.addAuditEvent({ category: 'maintenance', action: 'WORK_ORDER_CREATED_FROM_ACKNOWLEDGED_ALARM', actor, entityType: 'work_order', entityId: order.id, status: 'SUCCESS', details: { linkedAlarmId: alarm.id, sensor: alarm.code, operator: alarm.acknowledgedBy } });
    return order;
  }

  public async createTepReplayWorkOrder(input: {
    faultId: number;
    faultScore: number;
    classConfidence: number;
    probabilities: { faultId: number; score: number }[];
    topSensors: { sensor: string; contribution: number }[];
    sensorValues: Record<string, number>;
    replayFile?: string;
    fingerprint: string;
    actor: string;
  }): Promise<MaintenanceWorkOrder> {
    const existing = this.getWorkOrders().find((order) => order.replayFingerprint === input.fingerprint && order.status !== 'REJECTED');
    if (existing) return existing;
    const fault = TEP_FAULTS.find((item) => item.id === input.faultId);
    if (!fault) throw new Error('The predicted fault is not a supported TEP class.');
    const unitCriticality: Record<string, number> = { reactor: 15, compressor: 12, condenser: 10, separator: 8, stripper: 8, feed: 10 };
    const validProbabilities = input.probabilities.filter((item) => Number.isInteger(item.faultId)
      && item.score >= 0 && Number.isFinite(item.score));
    const probabilityTotal = validProbabilities.reduce((sum, item) => sum + item.score, 0);
    if (validProbabilities.length < 2 || probabilityTotal <= 0) {
      throw new Error('Triage requires a complete class probability distribution.');
    }
    const normalizedProbabilities = validProbabilities.map((item) => ({ ...item, score: item.score / probabilityTotal }));
    const severityValue: Record<typeof fault.severity, number> = { low: 20, medium: 40, high: 65, critical: 90 };
    const severityByFault = new Map(TEP_FAULTS.map((item) => [item.id, severityValue[item.severity]]));
    const expectedSeverity = normalizedProbabilities.reduce((sum, item) =>
      sum + item.score * (item.faultId === 0 ? 0 : (severityByFault.get(item.faultId) ?? 90)), 0);
    const entropy = -normalizedProbabilities.reduce((sum, item) => item.score > 0
      ? sum + item.score * Math.log(item.score) : sum, 0);
    const uncertainty = normalizedProbabilities.length > 1 ? entropy / Math.log(normalizedProbabilities.length) : 0;
    const uncertaintyBand = uncertainty >= 0.7 ? 'HIGH' : uncertainty >= 0.4 ? 'MEDIUM' : 'LOW';
    const evidenceGaps = [
      ...(input.topSensors.length === 0 ? ['No TreeSHAP sensor evidence'] : []),
      ...(!input.replayFile ? ['Replay filename not recorded'] : []),
    ];
    const reviewPriority = Math.round(Math.min(100, expectedSeverity + uncertainty * 10 + evidenceGaps.length * 5));
    const riskScore = Math.round(Math.min(100, expectedSeverity + (unitCriticality[fault.primaryUnit] || 5) * 0.25));
    const riskBand = riskScore >= 85 ? 'CRITICAL' : riskScore >= 65 ? 'HIGH' : riskScore >= 40 ? 'MEDIUM' : 'LOW';
    const priority: MaintenanceWorkOrder['priority'] = riskBand === 'CRITICAL' ? 'P1_CRITICAL'
      : riskBand === 'HIGH' ? 'P2_HIGH' : riskBand === 'MEDIUM' ? 'P3_MEDIUM' : 'P4_ROUTINE';
    const unitNames: Record<string, string> = {
      reactor: 'Chemical Reactor', condenser: 'Product Condenser', separator: 'Vapor-Liquid Separator',
      stripper: 'Stripping Column', compressor: 'Recycle Compressor', feed: 'Feed Stream Manifold',
    };
    const impact = await tepKnowledgeGraph.getImpactAnalysisForFault(fault.id);
    const sensorEvidence = input.topSensors.slice(0, 8).map((item) => {
      const variable = TEP_VARIABLES.find((candidate) => candidate.id === item.sensor);
      return {
        sensor: item.sensor,
        contribution: item.contribution,
        ...(Number.isFinite(input.sensorValues[item.sensor]) ? { actual: input.sensorValues[item.sensor] } : {}),
        ...(variable ? { unit: variable.unit } : {}),
      };
    });
    const ragEvidence = tepRagEngine.search(`${fault.code} ${fault.name} ${fault.physicalMechanism}`, 3).map((result) => ({
      title: result.chunk.documentTitle,
      section: result.chunk.section,
      snippet: result.chunk.content.slice(0, 320),
      relevance: result.score,
      sourceStatus: result.evidenceStatus,
      citation: result.chunk.source?.citation,
      sourceUrl: result.chunk.source?.url,
    }));
    const timestamp = Date.now();
    const order: MaintenanceWorkOrder = {
      id: `WO-TEP-${timestamp.toString(36).slice(-5).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      timestamp,
      priority,
      targetUnit: unitNames[fault.primaryUnit] || fault.primaryUnit,
      targetComponent: `Equipment associated with ${fault.primaryUnit}`,
      faultHypothesis: `[TEP CSV · XGBoost candidate] ${fault.code}: ${fault.name}`,
      faultSource: 'TEP_CSV_XGBOOST',
      simulatorFaultId: fault.id,
      modelScore: input.faultScore,
      status: 'PROPOSED_PENDING_ENGINEER',
      riskScore,
      riskBand,
      triage: {
          expectedSeverity: Math.round(expectedSeverity * 10) / 10,
          uncertainty: Math.round(uncertainty * 1000) / 1000,
          uncertaintyBand,
          reviewPriority,
        evidenceGaps,
          scoreStatus: 'UNCALIBRATED_MODEL_SCORES',
          policyVersion: 'risk-entropy-v1',
        },
      replayFingerprint: input.fingerprint,
      modelEvidence: {
        model: 'XGBoost', explanationMethod: 'TreeSHAP', faultScore: input.faultScore,
        classConfidence: input.classConfidence, topSensors: sensorEvidence, replayFile: input.replayFile,
      },
      impactAnalysis: impact,
      recommendedChecks: [
        `Review the model evidence for ${fault.code} and compare the listed sensors with the replay trend.`,
        `Check the ${fault.primaryUnit} unit and connected process units shown in the graph impact summary.`,
        'Consult the current site-approved maintenance procedure before physical work; this research app does not supply one.',
      ],
      requiredParts: [],
      lockoutTagoutRequired: null,
      estimatedDowntimeHours: 0,
      costAvoidanceUsd: 0,
      applicableSop: ragEvidence[0]?.title
        ? `Research reference only: ${ragEvidence[0].title}; no site SOP attached.`
        : 'No research reference retrieved; no site SOP attached.',
      ragEvidence,
    };
    this.activeOrders.set(order.id, order);
    stateStore.storeWorkOrders(Array.from(this.activeOrders.values()));
    stateStore.addAuditEvent({
      category: 'maintenance', action: 'TEP_REPLAY_WORK_ORDER_DRAFTED', actor: input.actor,
      entityType: 'work_order', entityId: order.id, status: 'SUCCESS',
      details: { faultId: fault.id, riskScore, riskBand, replayFile: input.replayFile, impactGraphSource: impact.graphSource },
    });
    return order;
  }

  public updateWorkOrder(
    orderId: string,
    action: 'APPROVE' | 'REJECT' | 'DISPATCH',
    engineerNotes?: string,
    actor = 'engineer'
  ): MaintenanceWorkOrder | null {
    const order = this.activeOrders.get(orderId);
    if (!order) return null;

    if (action === 'DISPATCH') {
      if (order.status !== 'APPROVED') {
        throw new WorkOrderTransitionError('Only approved work orders can be dispatched.');
      }
      order.status = 'DISPATCHED_TO_TECHNICIAN';
    } else {
      if (order.status !== 'PROPOSED_PENDING_ENGINEER') {
        throw new WorkOrderTransitionError('Only pending work orders can be approved or rejected.');
      }
      order.status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    }

    if (engineerNotes !== undefined) order.engineerNotes = engineerNotes;
    this.activeOrders.set(order.id, order);
    stateStore.storeWorkOrders(Array.from(this.activeOrders.values()));
    stateStore.addAuditEvent({
      category: 'maintenance',
      action: `WORK_ORDER_${action}`,
      actor,
      entityType: 'work_order',
      entityId: order.id,
      status: 'SUCCESS',
      details: {
        previousStatus: order.status === 'APPROVED' || order.status === 'REJECTED' ? 'PROPOSED_PENDING_ENGINEER' : 'APPROVED',
        newStatus: order.status,
        engineerNotes,
      },
    });
    return order;
  }

  public markRepairComplete(orderId: string, notes: string, actor: string): MaintenanceWorkOrder | null {
    const order = this.activeOrders.get(orderId);
    if (!order) return null;
    if (!['DISPATCHED_TO_TECHNICIAN', 'DISPATCHED_TO_N8N'].includes(order.status)) {
      throw new WorkOrderTransitionError('Only a dispatched work order can be marked repaired.');
    }
    order.status = 'REPAIR_COMPLETE';
    order.technicianNotes = notes;
    order.repairedAt = Date.now();
    this.activeOrders.set(order.id, order);
    stateStore.storeWorkOrders(Array.from(this.activeOrders.values()));
    stateStore.addAuditEvent({
      category: 'maintenance', action: 'WORK_ORDER_REPAIR_COMPLETED', actor,
      entityType: 'work_order', entityId: order.id, status: 'SUCCESS',
      details: { technicianNotes: notes, targetUnit: order.targetUnit },
    });
    return order;
  }

  public closeWorkOrder(orderId: string, notes: string, actor: string): MaintenanceWorkOrder | null {
    const order = this.activeOrders.get(orderId);
    if (!order) return null;
    if (order.status !== 'REPAIR_COMPLETE') {
      throw new WorkOrderTransitionError('A technician must record repair completion before engineer closure.');
    }
    order.status = 'CLOSED';
    order.closureNotes = notes;
    order.closedBy = actor;
    order.closedAt = Date.now();
    this.activeOrders.set(order.id, order);
    stateStore.storeWorkOrders(Array.from(this.activeOrders.values()));
    stateStore.addAuditEvent({
      category: 'maintenance', action: 'WORK_ORDER_CLOSED', actor,
      entityType: 'work_order', entityId: order.id, status: 'SUCCESS',
      details: { closureNotes: notes, targetUnit: order.targetUnit },
    });
    return order;
  }

  public assignTechnician(orderId: string, technicianName: string, actor: string): MaintenanceWorkOrder | null {
    const order = this.activeOrders.get(orderId);
    if (!order) return null;
    order.assignedTechnician = technicianName;
    this.activeOrders.set(order.id, order);
    stateStore.storeWorkOrders(Array.from(this.activeOrders.values()));
    stateStore.addAuditEvent({
      category: 'maintenance', action: 'WORK_ORDER_ASSIGNED_TO_TECHNICIAN', actor,
      entityType: 'work_order', entityId: order.id, status: 'INFO',
      details: { technician: technicianName },
    });
    return order;
  }

  public attachSop(orderId: string, sop: { title: string; section: string; snippet: string; sourceStatus?: string; citation?: string; sourceUrl?: string }, actor = 'engineer'): MaintenanceWorkOrder | null {
    const order = this.activeOrders.get(orderId);
    if (!order) return null;
    order.attachedSop = sop;
    this.activeOrders.set(order.id, order);
    stateStore.storeWorkOrders(Array.from(this.activeOrders.values()));
    stateStore.addAuditEvent({
      category: 'maintenance',
      action: 'SOP_ATTACHED_TO_WORK_ORDER',
      actor,
      entityType: 'work_order',
      entityId: order.id,
      status: 'SUCCESS',
      details: { title: sop.title, section: sop.section },
    });
    return order;
  }
}

function agentTrace(label: string, data: unknown): void {
  if (process.env.AGENT_TRACE?.toLowerCase() !== 'true') return;
  console.info(`[AgentTrace] ${label}\n${JSON.stringify(data, null, 2)}`);
}

function appendAgentLogSummary(logs: AgentExecutionLog[], preferredIndex: number, message: string): void {
  const target = logs[preferredIndex] ?? logs[logs.length - 1];
  if (target) {
    target.outputSummary = [target.outputSummary, message].filter(Boolean).join(' ');
    return;
  }
  logs.push({
    agentName: 'Plant Coordinator Agent',
    role: 'Orchestration summary',
    timestamp: Date.now(),
    status: 'WARNING',
    thought: 'Recorded an orchestration result for review.',
    actionTaken: 'Added a report-building note because the agent response contained no logs.',
    outputSummary: message,
  });
}

function replayUnitLocalResult(
  targetUnit: string,
  observations: { channelId: string; value: number; unit: string; alarm: string }[],
  timestamp: number
): CrewAIServiceResult {
  const abnormal = observations.filter((observation) => observation.alarm !== 'NORMAL');
  const summary = abnormal.length
    ? `${targetUnit} replay sample has ${abnormal.length} channel(s) outside the selected TEP reference envelope.`
    : `${targetUnit} replay sample has no mapped channels outside the selected TEP reference envelope.`;
  return {
    processHealthStatus: abnormal.some((item) => item.alarm.startsWith('TRIP')) ? 'CRITICAL' : abnormal.length > 1 ? 'DEGRADED' : 'STABLE',
    diagnosisEvidence: [summary, ...abnormal.slice(0, 5).map((item) => `${item.channelId}=${item.value} ${item.unit} (${item.alarm}).`)],
    affectedSubsystems: [targetUnit],
    shapAttributionSummary: 'No model attribution was computed for this static replay sample.',
    recommendedChecks: abnormal.length
      ? abnormal.slice(0, 4).map((item) => `Have an engineer verify ${item.channelId} (${item.value} ${item.unit}) against site-approved procedures.`)
      : [`Review the ${targetUnit} replay sample and confirm whether follow-up is needed.`],
    agentLogs: [
      { agentName: `${targetUnit} Unit Specialist`, role: 'Local replay threshold reviewer', timestamp, status: 'SUCCESS', thought: 'Reviewed the selected static CSV sample.', actionTaken: 'Reported mapped readings outside the configured TEP reference envelope.', outputSummary: summary },
      { agentName: 'Plant Coordinator Agent', role: 'Replay context reviewer', timestamp, status: 'SUCCESS', thought: 'Prepared a replay-only summary for engineer review.', actionTaken: 'Drafted checks without affecting the live simulator.', outputSummary: 'Static replay analysis is isolated from live plant state.' },
    ],
  };
}

function runLocalUnitEvent(
  unit: ReturnType<typeof tepSimulator.getUnitHealthStates>[number],
  telemetry: ReturnType<typeof tepSimulator.getLatestTelemetry>,
  event: Record<string, unknown>,
  timestamp: number
): CrewAIServiceResult {
  const activeFaults = Array.isArray(event.activeFaults)
    ? event.activeFaults as Array<{ id?: number; code?: string; name?: string; keySensors?: string[] }>
    : [];
  const scenarioSensorIds = Array.from(new Set(activeFaults.flatMap((fault) => fault.keySensors ?? [])));
  const channelsToReview = scenarioSensorIds.length > 0 ? scenarioSensorIds : unit.monitoredChannels;
  const observations = channelsToReview.map((channelId) => ({
    channelId,
    value: telemetry.values[channelId],
    alarm: telemetry.alarms[channelId],
  })).filter(({ value, alarm }) => Number.isFinite(value) && alarm !== undefined);
  const abnormal = observations.filter(({ alarm }) => alarm !== 'NORMAL');
  const unitSummary = abnormal.length
    ? `${abnormal.length} of ${observations.length} scenario-linked channel(s) are outside normal alarm bands.`
    : `${unit.name} was reviewed across ${observations.length} scenario-linked channel(s); none currently crosses an alarm band.`;
  const diagnosisEvidence = [
    ...activeFaults.map((fault) => `Injected scenario ${fault.code ?? fault.id} (${fault.name ?? 'IDV'}); its mapped channels were checked together.`),
    unitSummary,
    ...abnormal.map(({ channelId, value, alarm }) => `${channelId} measured ${value} with alarm ${alarm}.`),
    `Telemetry snapshot step ${telemetry.step}; source is the local TEP simulator.`,
  ];
  const recommendedChecks = abnormal.length
    ? abnormal.slice(0, 4).map(({ channelId, value, alarm }) => `Have an engineer verify ${channelId} (${value}; ${alarm}) against site-approved limits and procedures.`)
    : [`Have an engineer review the ${unit.name} sensor snapshot and confirm whether follow-up is needed.`];
  agentTrace('Unit event · LOCAL SPECIALIST INPUT', event);
  agentTrace('Unit event · LOCAL COORDINATOR OUTPUT', { unitSummary, diagnosisEvidence, recommendedChecks });
  const unitKey = String(event.targetUnit || unit.unit);
  return {
    processHealthStatus: unit.status,
    diagnosisEvidence,
    affectedSubsystems: [unitKey],
    shapAttributionSummary: `Targeted ${unitKey} unit review used ${unit.monitoredChannels.length} monitored channels.`,
    recommendedChecks,
    agentLogs: [
      {
        agentName: `${unit.name} Unit Specialist`, role: 'Local rule-based unit monitor', timestamp,
        status: 'SUCCESS', thought: 'Reviewed the unit-only telemetry snapshot and alarm bands.',
        actionTaken: 'Flagged abnormal channels and preserved their observed readings.',
        outputSummary: unitSummary,
      },
      {
        agentName: 'Plant Coordinator Agent', role: 'Local adjacent-unit correlation', timestamp,
        status: 'SUCCESS', thought: 'Compared the selected unit with adjacent unit status.',
        actionTaken: 'Prepared review checks; no plant control action was issued.',
        outputSummary: `${unitSummary} Adjacent unit baselines were included in the event context.`,
      },
    ],
  };
}

function runLocalSequentialAgents(input: {
  timestamp: number;
  unitHealth: ReturnType<typeof tepSimulator.getUnitHealthStates>;
  anomaly: ReturnType<typeof autoencoderDetector.analyze>;
  prediction: ReturnType<typeof physicsSignaturePredictor.predict>;
  shapSummary: string;
  graph: KnowledgeGraphData;
  ragResults: ReturnType<typeof tepRagEngine.search>;
  injectedFault: (typeof TEP_FAULTS)[number] | undefined;
}): CrewAIServiceResult {
  const meanHealth = Math.round(input.unitHealth.reduce((sum, unit) => sum + unit.healthIndex, 0) / Math.max(1, input.unitHealth.length));
  const processHealthStatus: OrchestrationReport['processHealthStatus'] =
    input.anomaly.anomalyScore >= 75 || meanHealth < 50 ? 'CRITICAL'
      : input.anomaly.anomalyScore >= 45 || meanHealth < 75 ? 'DEGRADED'
        : input.anomaly.anomalyScore >= 25 || meanHealth < 90 ? 'STABLE' : 'OPTIMAL';
  const topPrediction = input.prediction.topPrediction;
  const topSensors = input.anomaly.topOffendingSensors.slice(0, 3);
  const ragTitle = input.ragResults[0]?.chunk.documentTitle;
  const agentLogs: AgentExecutionLog[] = [];

  agentTrace('1/5 Process Health Agent · INPUT', {
    anomalyScore: input.anomaly.anomalyScore,
    severity: input.anomaly.severity,
    unitHealth: input.unitHealth.map(({ name, healthIndex, status }) => ({ name, healthIndex, status })),
  });
  agentTrace('1/5 Process Health Agent · OUTPUT', { processHealthStatus, meanHealth });
  agentLogs.push({
    agentName: 'Process Health Agent', role: 'Telemetry & Anomaly Monitor', timestamp: input.timestamp,
    status: 'SUCCESS', thought: 'Read the current anomaly score and unit health snapshot.',
    actionTaken: 'Applied the documented deterministic health thresholds.',
    outputSummary: `${processHealthStatus}: mean unit health ${meanHealth}%; anomaly score ${input.anomaly.anomalyScore.toFixed(1)}%.`,
  });
  agentTrace('2/5 Failure Prediction Agent · INPUT', {
    topPrediction,
    alternatives: input.prediction.allPredictions.slice(0, 5),
    validation: input.prediction.modelValidation,
  });
  agentTrace('2/5 Failure Prediction Agent · OUTPUT', {
    summary: `${topPrediction.code} (${(topPrediction.score * 100).toFixed(1)}% relative score); model status ${input.prediction.modelValidation.status}.`,
  });
  agentLogs.push({
    agentName: 'Failure Prediction Agent', role: 'Predictive Model Review', timestamp: input.timestamp,
    status: 'SUCCESS', thought: 'Read the local predictor output without rewriting its scores.',
    actionTaken: 'Reported the model candidate and its unvalidated status.',
    outputSummary: `${topPrediction.code} (${(topPrediction.score * 100).toFixed(1)}% relative score); model status ${input.prediction.modelValidation.status}.`,
  });
  agentTrace('3/5 Explainability Agent · INPUT', {
    summary: input.shapSummary,
    topSensors,
  });
  agentTrace('3/5 Explainability Agent · OUTPUT', { summary: input.shapSummary });
  agentLogs.push({
    agentName: 'Explainable AI Agent', role: 'Heuristic Sensor Attribution Analyst', timestamp: input.timestamp,
    status: 'SUCCESS', thought: 'Read the local sensor attribution summary.',
    actionTaken: 'Listed the largest supplied sensor contributions.',
    outputSummary: input.shapSummary || 'No additional sensor attribution summary was available.',
  });
  const affectedSubsystems = input.injectedFault
    ? [input.injectedFault.primaryUnit]
    : input.unitHealth.filter((unit) => unit.status !== 'OPTIMAL').map((unit) => unit.name);
  const diagnosisEvidence = [
    input.injectedFault
      ? `Fault Lab injected ${input.injectedFault.code}; this is simulator scenario ground truth, not an ML diagnosis.`
      : `Local predictor candidate: ${topPrediction.code} at ${(topPrediction.score * 100).toFixed(1)}% relative, uncalibrated score.`,
    ...topSensors.map((sensor) => `${sensor.code} measured ${sensor.actual.toFixed(2)} ${sensor.unit}; attribution z-score ${sensor.zScore.toFixed(2)}.`),
    `Graph context contains ${input.graph.nodes.length} nodes and ${input.graph.relationships.length} relationships for this candidate.`,
  ];
  agentTrace('4/5 Diagnosis Agent · INPUT', {
    injectedScenario: input.injectedFault ? { id: input.injectedFault.id, code: input.injectedFault.code, name: input.injectedFault.name } : null,
    candidate: topPrediction,
    sensorEvidence: topSensors,
    graph: { nodes: input.graph.nodes.map(({ id, label, name }) => ({ id, label, name })), relationships: input.graph.relationships },
  });
  agentTrace('4/5 Diagnosis Agent · OUTPUT', { diagnosisEvidence, affectedSubsystems });
  agentLogs.push({
    agentName: 'Failure Diagnosis Agent', role: 'Knowledge Graph Reasoning Analyst', timestamp: input.timestamp,
    status: 'SUCCESS', thought: 'Combined scenario provenance, local prediction, sensor evidence, and graph context.',
    actionTaken: 'Kept injected scenario labels separate from model-inferred candidates.',
    outputSummary: `Prepared ${diagnosisEvidence.length} traceable evidence statements.`,
  });
  const recommendedChecks = [
    `Review the ${input.injectedFault?.code || topPrediction.code} scenario against current site-approved procedures before inspection.`,
    ...topSensors.slice(0, 2).map((sensor) => `Verify ${sensor.code} (${sensor.name}) reading ${sensor.actual.toFixed(2)} ${sensor.unit} and check transmitter condition under the site procedure.`),
  ];
  agentTrace('5/5 Maintenance Agent · INPUT', {
    retrievedReferences: input.ragResults.map((result) => ({
      title: result.chunk.documentTitle, section: result.chunk.section,
      relevance: result.score, snippet: result.chunk.content.slice(0, 600),
    })),
    diagnosisEvidence,
  });
  agentTrace('5/5 Maintenance Agent · OUTPUT', { recommendedChecks, engineerApprovalRequired: true });
  agentLogs.push({
    agentName: 'Maintenance Action Agent', role: 'Engineer-Reviewable Maintenance Planner', timestamp: input.timestamp,
    status: 'SUCCESS', thought: `Read ${input.ragResults.length} local retrieval result(s) and the diagnostic evidence.`,
    actionTaken: 'Drafted inspection-only checks for human review; no control action was issued.',
    outputSummary: ragTitle ? `Drafted review checks with research-reference context from ${ragTitle}; no site-approved SOP was retrieved.` : 'Drafted evidence-review checks; no matching research reference was retrieved.',
  });

  return {
    processHealthStatus,
    diagnosisEvidence,
    affectedSubsystems,
    shapAttributionSummary: input.shapSummary,
    recommendedChecks,
    agentLogs,
  };
}

async function runRemoteCrewAI(
  serviceUrl: string,
  executionId: string,
  timestamp: number,
  context: Record<string, unknown>
): Promise<CrewAIServiceResult> {
  const response = await fetch(`${serviceUrl}/orchestrator/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ executionId, timestamp, context }),
    signal: AbortSignal.timeout(90_000),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const detail = typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string'
      ? body.detail : `CrewAI service returned HTTP ${response.status}.`;
    throw new Error(detail);
  }
  return body as CrewAIServiceResult;
}

export const crewaiOrchestrator = new CrewAIOrchestrator();
