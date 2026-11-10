/**
 * Express REST API Routes for Tennessee Eastman Process Digital Twin
 */

import { Router } from 'express';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { TEP_VARIABLES, TEP_FAULTS } from './tep/tepConstants.ts';
import { TEP_DATA_PROFILE, TEP_VARIABLES_WITH_DATA_PROFILE } from './tep/tepDataProfile.ts';
import { tepSimulator } from './tep/tepSimulator.ts';
import { assessUnitAgents } from './tep/unitAgents.ts';
import { autoencoderDetector } from './ml/autoencoder.ts';
import { physicsSignaturePredictor } from './ml/physicsSignaturePredictor.ts';
import { classifyXGBoostWindow, compareBenchmarkAnomaly, detectAndDiagnoseFirstAlarm, getXGBoostHealth } from './ml/xgboostService.ts';
import { shapEngine } from './ml/shapEngine.ts';
import { tepKnowledgeGraph, type KnowledgeGraphQueryId } from './kg/neo4jGraph.ts';
import { tepRagEngine, TEP_RAG_CORPUS } from './rag/ragCorpus.ts';
import { crewaiOrchestrator, WorkOrderTransitionError } from './agents/crewaiOrchestrator.ts';
import { geminiService } from './gemini/geminiService.ts';
import { n8nService } from './n8n/n8nService.ts';
import { stateStore } from './state/stateStore.ts';
import { authService, requireAuth, requireRole, type AuthRole } from './auth/authService.ts';

export const apiRouter = Router();
const unitAnalysisLastRun = new Map<string, number>();

apiRouter.get('/auth/session', (req, res) => {
  const setup = authService.getSetupStatus();
  const user = authService.getUser(req);
  res.json({ ...setup, user });
});

apiRouter.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }
  const clientKey = req.ip || 'unknown';
  if (authService.isLoginRateLimited(clientKey)) {
    return res.status(429).json({ error: 'Too many failed sign-in attempts. Wait 15 minutes and try again.' });
  }
  const user = authService.login(email, password, res);
  if (!user) {
    authService.recordFailedLogin(clientKey);
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  authService.clearLoginFailures(clientKey);
  res.json({ user });
});

apiRouter.post('/auth/logout', (req, res) => {
  authService.logout(req, res);
  res.json({ success: true });
});

apiRouter.use(requireAuth);

apiRouter.get('/tep/model-performance', async (_req, res) => {
  try {
    const resultsPath = path.resolve(process.cwd(), 'outputs/alarm_time_pipeline_52_delay250_internal_holdout_fallback/pipeline_results.json');
    const results = JSON.parse(await readFile(resultsPath, 'utf8')) as {
      configuration?: { evaluationSplit?: string; diagnosisDelaySamples?: number };
      aggregate?: {
        normalRuns?: number; normalRunsWithFalseAlarm?: number; faultRuns?: number;
        faultRunsDetectedAfterOnset?: number; diagnosesCorrectAmongDetected?: number;
        conditionalDiagnosisAccuracy?: number; endToEndCorrectDiagnoses?: number; endToEndCorrectRate?: number;
        meanDetectionDelaySamples?: number;
      };
    };
    const aggregate = results.aggregate;
    if (!aggregate || !aggregate.normalRuns || !aggregate.faultRuns) {
      return res.status(503).json({ error: 'Run-level evaluation metrics are unavailable.' });
    }
    const tp = aggregate.faultRunsDetectedAfterOnset ?? 0;
    const fp = aggregate.normalRunsWithFalseAlarm ?? 0;
    const fn = aggregate.faultRuns - tp;
    const tn = aggregate.normalRuns - fp;
    const total = tp + fp + fn + tn;
    const safePercent = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator * 100 : 0;
    res.json({
      source: 'Current serving bundle run-level internal holdout evaluation',
      evaluationSplit: results.configuration?.evaluationSplit ?? 'Run-level internal holdout',
      diagnosisDelaySamples: results.configuration?.diagnosisDelaySamples ?? null,
      counts: { faultRuns: aggregate.faultRuns, normalRuns: aggregate.normalRuns, detectedFaultRuns: tp, missedFaultRuns: fn, falseAlarms: fp, correctlyNormalRuns: tn },
      detection: {
        accuracy: safePercent(tp + tn, total),
        precision: safePercent(tp, tp + fp),
        recall: safePercent(tp, tp + fn),
        specificity: safePercent(tn, tn + fp),
        f1: safePercent(2 * tp, 2 * tp + fp + fn),
        falseAlarmRate: safePercent(fp, fp + tn),
        meanDetectionDelaySamples: aggregate.meanDetectionDelaySamples ?? null,
      },
      diagnosis: {
        correctAmongDetected: aggregate.diagnosesCorrectAmongDetected ?? 0,
        conditionalAccuracy: (aggregate.conditionalDiagnosisAccuracy ?? 0) * 100,
        endToEndCorrectDiagnoses: aggregate.endToEndCorrectDiagnoses ?? 0,
        endToEndCorrectRate: (aggregate.endToEndCorrectRate ?? 0) * 100,
      },
    });
  } catch (error) {
    console.error('[TEP performance] Could not load run-level evaluation results:', error);
    res.status(503).json({ error: 'Run-level evaluation metrics are unavailable.' });
  }
});

apiRouter.get('/auth/users', requireRole('ADMIN'), (_req, res) => {
  res.json({ users: authService.listUsers() });
});

apiRouter.post('/auth/users', requireRole('ADMIN'), (req, res) => {
  try {
    const { email, displayName, role, password } = req.body || {};
    if (typeof email !== 'string' || typeof displayName !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email, display name, role, and password are required.' });
    }
    const user = authService.createUser({ email, displayName, role: role as AuthRole, password }, req.authUser!);
    res.status(201).json({ user });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not create user.' });
  }
});

apiRouter.patch('/auth/users/:userId', requireRole('ADMIN'), (req, res) => {
  try {
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'Provide an active true/false value.' });
    authService.setUserActive(req.params.userId, req.body.active, req.authUser!);
    res.json({ success: true, users: authService.listUsers() });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update user.' });
  }
});

const supportedKnowledgeGraphQueries = new Set<KnowledgeGraphQueryId>([
  'fault-evidence-links',
  'fault-source-provenance',
  'sensors-by-unit',
  'unit-flow',
]);

function isKnowledgeGraphQueryId(value: unknown): value is KnowledgeGraphQueryId {
  return typeof value === 'string' && supportedKnowledgeGraphQueries.has(value as KnowledgeGraphQueryId);
}

// --- 1. TEP SIMULATOR ENDPOINTS ---
apiRouter.get('/tep/variables', (req, res) => {
  res.json({ variables: TEP_VARIABLES_WITH_DATA_PROFILE, dataProfile: TEP_DATA_PROFILE });
});

apiRouter.get('/tep/faults', (req, res) => {
  res.json({ faults: TEP_FAULTS });
});

apiRouter.get('/tep/state', async (req, res) => {
  const telemetry = tepSimulator.getLatestTelemetry();
  const unitHealth = tepSimulator.getUnitHealthStates();
  const activeFaults = tepSimulator.getActiveFaults();
  res.json({
    telemetry,
    unitHealth,
    unitAgents: assessUnitAgents(telemetry, unitHealth),
    activeFaults,
    simulationRunning: tepSimulator.getSimulationStatus(),
  });
});

apiRouter.get('/tep/alarms', (_req, res) => {
  res.json({ alarms: stateStore.getAlarmReviews() });
});

apiRouter.post('/tep/alarms/:alarmId/action', requireRole('OPERATOR', 'ENGINEER', 'ADMIN'), (req, res) => {
  const { action, note } = req.body || {};
  if (typeof action !== 'string' || !['ACKNOWLEDGE', 'RESOLVE', 'REVIEW'].includes(action)) {
    return res.status(400).json({ error: 'Choose acknowledge, resolve, or engineer review.' });
  }
  const requiredNoteLength = action === 'REVIEW' || (action === 'RESOLVE' && req.authUser!.role !== 'OPERATOR') ? 10 : 3;
  if (typeof note !== 'string' || note.trim().length < requiredNoteLength) {
    return res.status(400).json({ error: action === 'REVIEW' || action === 'RESOLVE'
      ? 'Add a review note describing the evidence checked and the resolution.'
      : 'Add a short operator note before acknowledging the alarm.' });
  }
  if (action === 'REVIEW' && !['ENGINEER', 'ADMIN'].includes(req.authUser!.role)) {
    return res.status(403).json({ error: 'Only an engineer or admin can review an alarm record.' });
  }
  if (action === 'ACKNOWLEDGE' && req.authUser!.role !== 'OPERATOR') {
    return res.status(403).json({ error: 'Only an operator can acknowledge an alarm.' });
  }

  const alarm = stateStore.getAlarmReviews().find((record) => record.id === req.params.alarmId);
  if (!alarm) return res.status(404).json({ error: 'Alarm record not found.' });
  if ((action === 'ACKNOWLEDGE' || action === 'REVIEW' || action === 'RESOLVE')
    && ['RESOLVED', 'ARCHIVED'].includes(alarm.status)) {
    return res.status(409).json({ error: 'This alarm is closed or archived and cannot be changed.' });
  }
  if (action === 'RESOLVE' && req.authUser!.role === 'OPERATOR' && !alarm.acknowledgedBy) {
    return res.status(409).json({ error: 'Acknowledge the alarm with an operator note before resolving it.' });
  }
  if (action === 'RESOLVE' && alarm.source === 'TEP_CSV_REPLAY' && !['ENGINEER', 'ADMIN'].includes(req.authUser!.role)) {
    return res.status(403).json({ error: 'Only an engineer can close a replay alarm after the technician reports repair.' });
  }
  if (action === 'RESOLVE' && alarm.source === 'TEP_CSV_REPLAY' && alarm.status !== 'CLEARED_PENDING_REVIEW') {
    return res.status(409).json({ error: 'For a recorded replay, the technician must report repair before the engineer closes the alarm.' });
  }
  if (action === 'RESOLVE' && alarm.source !== 'TEP_CSV_REPLAY' && tepSimulator.getLatestTelemetry().alarms[alarm.variableId] !== 'NORMAL') {
    return res.status(409).json({ error: 'This alarm is still active. Resolve it after the reading returns to its normal range.' });
  }
  const updates = action === 'ACKNOWLEDGE'
    ? { status: 'ACKNOWLEDGED' as const, acknowledgedBy: req.authUser!.displayName, note: note.trim() }
    : action === 'RESOLVE'
      ? {
        status: 'RESOLVED' as const,
        resolvedBy: req.authUser!.displayName,
        ...(req.authUser!.role === 'OPERATOR' ? {} : { reviewedBy: req.authUser!.displayName }),
        note: note.trim(),
      }
      : { reviewedBy: req.authUser!.displayName, note: note.trim() };
  const updated = stateStore.updateAlarmReview(alarm.id, updates);
  stateStore.addAuditEvent({
    category: 'system',
    action: `ALARM_${action}`,
    actor: req.authUser!.displayName,
    entityType: 'alarm',
    entityId: alarm.id,
    status: action === 'RESOLVE' ? 'SUCCESS' : 'INFO',
    details: { variableId: alarm.variableId, alarm: alarm.alarm, note: note.trim() },
  });
  res.json({ success: true, alarm: updated });
});

apiRouter.get('/tep/history', (req, res) => {
  const count = parseInt(req.query.count as string, 10) || 60;
  const history = stateStore.getTelemetryHistory(count);
  res.json({ history: history.length > 0 ? history : tepSimulator.getHistory(count) });
});

apiRouter.get('/audit/trail', (req, res) => {
  const limit = parseInt(req.query.limit as string, 10) || 50;
  res.json({ entries: stateStore.getAuditTrail(limit) });
});

apiRouter.post('/tep/step', requireRole('OPERATOR', 'ENGINEER', 'ADMIN'), (req, res) => {
  const telemetry = tepSimulator.stepOnce();
  const unitHealth = tepSimulator.getUnitHealthStates();
  res.json({ telemetry, unitHealth, unitAgents: assessUnitAgents(telemetry, unitHealth) });
});

apiRouter.post('/tep/pause', requireRole('OPERATOR', 'ENGINEER', 'ADMIN'), (_req, res) => {
  tepSimulator.setRunning(false);
  res.json({ success: true, simulationRunning: false });
});

apiRouter.post('/tep/resume', requireRole('OPERATOR', 'ENGINEER', 'ADMIN'), (_req, res) => {
  tepSimulator.setRunning(true);
  res.json({ success: true, simulationRunning: true });
});

apiRouter.post('/tep/inject-fault', requireRole('OPERATOR', 'ENGINEER', 'ADMIN'), (req, res) => {
  const { faultId, intensity } = req.body;
  tepSimulator.injectFault(Number(faultId), Number(intensity) || 1.0);
  // Apply the new disturbance to fresh telemetry immediately. `step()` is a
  // no-op while the simulator is paused, which previously left the injected
  // scenario visible in Fault Lab while every sensor still showed the old,
  // pre-injection snapshot. Advance explicit ticks here regardless of the
  // continuous run/pause setting so an injection is observable immediately.
  for (let step = 0; step < 3; step += 1) tepSimulator.stepOnce();
  stateStore.addAuditEvent({
    category: 'fault',
    action: 'FAULT_INJECTED',
    actor: req.authUser!.displayName,
    entityType: 'fault',
    entityId: String(faultId),
    status: 'WARNING',
    details: { faultId: Number(faultId), intensity: Number(intensity) || 1.0 },
  });
  res.json({
    success: true,
    activeFaults: tepSimulator.getActiveFaults(),
  });
});

apiRouter.post('/tep/clear-fault', requireRole('OPERATOR', 'ENGINEER', 'ADMIN'), (req, res) => {
  const { faultId } = req.body;
  tepSimulator.clearFault(faultId ? Number(faultId) : undefined);
  stateStore.addAuditEvent({
    category: 'fault',
    action: 'FAULT_CLEARED',
    actor: req.authUser!.displayName,
    entityType: 'fault',
    entityId: faultId ? String(faultId) : 'ALL',
    status: 'INFO',
    details: { faultId: faultId ? Number(faultId) : null },
  });
  res.json({
    success: true,
    activeFaults: tepSimulator.getActiveFaults(),
  });
});

apiRouter.post('/tep/reset', requireRole('OPERATOR', 'ENGINEER', 'ADMIN'), (req, res) => {
  tepSimulator.resetToNominal();
  autoencoderDetector.resetPersistence();
  const archivedAlarmCount = stateStore.archiveOpenAlarmReviews(
    req.authUser!.displayName,
    'Archived by Reset Plant: simulator returned to nominal for a fresh demo run.',
  );
  stateStore.addAuditEvent({
    category: 'telemetry',
    action: 'PLANT_RESET',
    actor: req.authUser!.displayName,
    entityType: 'plant',
    status: 'INFO',
    details: { message: 'TEP simulator reset to nominal; open alarm records archived, not deleted.', archivedAlarmCount },
  });
  res.json({
    success: true,
    message: `Simulator reset to nominal. ${archivedAlarmCount} open alarm(s) archived; audit history and work orders were kept.`,
    archivedAlarmCount,
    telemetry: tepSimulator.getLatestTelemetry(),
  });
});

apiRouter.post('/tep/actuator', requireRole('OPERATOR', 'ENGINEER', 'ADMIN'), (req, res) => {
  const { actuatorId, value } = req.body;
  tepSimulator.setManualActuator(actuatorId, Number(value));
  stateStore.addAuditEvent({
    category: 'telemetry', action: 'ACTUATOR_SET', actor: req.authUser!.displayName,
    entityType: 'actuator', entityId: String(actuatorId), status: 'WARNING',
    details: { value: Number(value) },
  });
  res.json({ success: true, telemetry: tepSimulator.getLatestTelemetry() });
});

// --- 2. MACHINE LEARNING & XAI ENDPOINTS ---
apiRouter.get('/ml/anomaly', (req, res) => {
  const telemetry = tepSimulator.getLatestTelemetry();
  const report = autoencoderDetector.analyze(telemetry.values);
  res.json(report);
});

apiRouter.get('/ml/prediction', (req, res) => {
  const history = tepSimulator.getHistory(30);
  const result = physicsSignaturePredictor.predict(history);
  res.json(result);
});

apiRouter.get('/ml/shap', (req, res) => {
  const telemetry = tepSimulator.getLatestTelemetry();
  const history = tepSimulator.getHistory(30);
  const anomaly = autoencoderDetector.analyze(telemetry.values);
  const prediction = physicsSignaturePredictor.predict(history);
  const explanation = shapEngine.explainPrediction(prediction, anomaly, telemetry.values);
  res.json(explanation);
});

// --- 3. KNOWLEDGE GRAPH ENDPOINTS ---
apiRouter.get('/kg/health', async (_req, res) => {
  res.json(await tepKnowledgeGraph.getHealth());
});

apiRouter.get('/kg/graph', async (_req, res) => {
  try {
    res.json(await tepKnowledgeGraph.getFullGraph());
  } catch (error) {
    res.status(503).json({
      error: error instanceof Error ? error.message : 'Knowledge graph is unavailable.',
    });
  }
});

apiRouter.get('/kg/subgraph/:faultId', async (req, res) => {
  const faultId = parseInt(req.params.faultId, 10);
  if (!Number.isInteger(faultId) || faultId < 1 || faultId > 21) {
    return res.status(400).json({ error: 'Fault ID must be an integer from 1 through 21.' });
  }
  try {
    res.json(await tepKnowledgeGraph.getSubgraphForFault(faultId));
  } catch (error) {
    res.status(503).json({
      error: error instanceof Error ? error.message : 'Knowledge graph is unavailable.',
    });
  }
});

apiRouter.post('/kg/query', async (req, res) => {
  const { queryId } = req.body;
  if (!isKnowledgeGraphQueryId(queryId)) {
    return res.status(400).json({ error: 'A supported named knowledge-graph query is required.' });
  }
  try {
    res.json(await tepKnowledgeGraph.executeNamedQuery(queryId));
  } catch (error) {
    res.status(503).json({
      error: error instanceof Error ? error.message : 'Knowledge graph query failed.',
    });
  }
});

// --- 4. RAG DOCUMENTATION ENDPOINTS ---
apiRouter.get('/rag/documents', (_req, res) => {
  res.json({ documents: TEP_RAG_CORPUS });
});

apiRouter.post('/rag/search', (req, res) => {
  const { query, limit } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Query is required.' });
  }
  const results = tepRagEngine.search(String(query), Number(limit) || 4);
  res.json({ results });
});

// --- 5. CREWAI MULTI-AGENT ORCHESTRATOR ---
apiRouter.post('/orchestrator/run', async (req, res) => {
  try {
    const targetUnit = typeof req.body?.targetUnit === 'string' ? req.body.targetUnit : undefined;
    const allowedUnits = new Set(['reactor', 'stripper', 'compressor', 'condenser', 'separator']);
    if (targetUnit && !allowedUnits.has(targetUnit)) {
      return res.status(400).json({ error: 'Unknown target unit for focused analysis.' });
    }
    if (targetUnit) {
      const cooldownMs = Math.max(60_000, Number(process.env.CREWAI_EVENT_COOLDOWN_MS) || 900_000);
      const now = Date.now();
      const cooldownKey = 'live:plant-event';
      const lastRun = unitAnalysisLastRun.get(cooldownKey) || 0;
      if (now - lastRun < cooldownMs) {
        const retryAfterSeconds = Math.ceil((cooldownMs - (now - lastRun)) / 1000);
        return res.status(429).json({ error: `Plant event analysis is cooling down; retry in about ${retryAfterSeconds} seconds.` });
      }
      unitAnalysisLastRun.set(cooldownKey, now);
    }
    const report = await crewaiOrchestrator.runOrchestration(targetUnit);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Orchestration execution failed.' });
  }
});

apiRouter.get('/maintenance/orders', (req, res) => {
  res.json({ orders: crewaiOrchestrator.getWorkOrders() });
});

apiRouter.post('/maintenance/from-alarm/:alarmId', requireRole('ENGINEER', 'ADMIN'), async (req, res) => {
  const alarm = stateStore.getAlarmReviews().find((item) => item.id === req.params.alarmId);
  if (!alarm || ['RESOLVED', 'ARCHIVED'].includes(alarm.status)) {
    return res.status(404).json({ error: 'This alarm is no longer active. Refresh Alarm review and select a current alarm.' });
  }
  if (!alarm.acknowledgedBy) {
    return res.status(409).json({ error: 'The Operator must acknowledge this alarm before an Engineer can create its work order.' });
  }
  const order = await crewaiOrchestrator.createAlarmWorkOrder(alarm, req.authUser!.displayName);
  res.status(201).json({ success: true, order });
});

apiRouter.get('/ml/xgboost/health', requireAuth, async (_req, res) => {
  try {
    res.json(await getXGBoostHealth());
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'XGBoost service is unavailable.' });
  }
});

apiRouter.post('/ml/xgboost/predict', requireAuth, async (req, res) => {
  const history = req.body?.history;
  if (!Array.isArray(history) || history.length < 25 || history.length > 10_000) {
    return res.status(400).json({ error: 'Provide between 25 and 10,000 mapped telemetry samples.' });
  }
  if (history.some((sample) => !sample || typeof sample.values !== 'object' || sample.values === null)) {
    return res.status(400).json({ error: 'Each telemetry sample must contain a values mapping.' });
  }
  try {
    const result = await classifyXGBoostWindow(history);
    res.json(result);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'XGBoost prediction is unavailable.' });
  }
});

apiRouter.post('/ml/pipeline/first-alarm', requireRole('OPERATOR', 'ENGINEER', 'ADMIN'), async (req, res) => {
  const history = req.body?.history;
  const replayFile = typeof req.body?.replayFile === 'string' ? req.body.replayFile.slice(0, 160) : 'TEP CSV replay';
  const replaySessionId = typeof req.body?.replaySessionId === 'string' ? req.body.replaySessionId.slice(0, 100) : 'default-session';
  if (!Array.isArray(history) || history.length > 10_000
    || history.some((sample) => !sample || typeof sample.values !== 'object' || sample.values === null)) {
    return res.status(400).json({ error: 'Provide sequential mapped samples from one TEP replay run.' });
  }
  try {
    const result = await detectAndDiagnoseFirstAlarm(history, typeof req.body?.replayFile === 'string');
    if (result.status !== 'PERSISTENT_ALARM' || !result.diagnosis) {
      return res.json({ ...result, alarm: null, operatorNotification: null });
    }
    const diagnosis = result.diagnosis;
    const candidate = TEP_FAULTS.find((fault) => fault.id === diagnosis.faultId);
    if (!candidate) return res.status(502).json({ error: 'XGBoost returned a fault class outside the supported TEP catalog.' });
    const topSensor = diagnosis.topSensors[0]?.sensor || diagnosis.topFeatures[0]?.feature.split('__').at(-1) || 'XMEAS_9';
    const variable = TEP_VARIABLES.find((item) => item.id === topSensor);
    const sensorValue = history[result.firstAlarmIndex!]?.values?.[topSensor];
    const fingerprint = createHash('sha256').update(JSON.stringify({ replayFile, replaySessionId, firstAlarmIndex: result.firstAlarmIndex, history: history.slice(Math.max(0, result.firstAlarmIndex! - 24), result.firstAlarmIndex! + 1) })).digest('hex');
    const existing = stateStore.getAlarmReviews().find((alarm) => alarm.source === 'TEP_CSV_REPLAY' && alarm.sourceFingerprint === fingerprint);
    const alarm = stateStore.createReplayAlarmReview({
      variableId: topSensor,
      code: variable?.code || topSensor.replace(/^(XMEAS|XMV)_(\d+)$/, '$1($2)'),
      name: variable?.name || `Benchmark sensor ${topSensor}`,
      unit: variable?.unit || 'dataset units',
      category: candidate.primaryUnit,
      value: Number.isFinite(sensorValue) ? sensorValue! : result.alarmScore!,
      fault: { id: candidate.id, code: candidate.code, name: candidate.name, primaryUnit: candidate.primaryUnit, keySensors: candidate.keySensors },
      fingerprint,
      modelDiagnosis: {
        model: 'XGBoost', candidateFaultId: candidate.id, classConfidence: diagnosis.classConfidence,
        explanationMethod: 'TreeSHAP', topSensors: diagnosis.topSensors,
        firstAlarmSampleIndex: result.firstAlarmIndex!,
      },
    });
    let operatorNotification = null;
    if (!existing) {
      operatorNotification = await n8nService.dispatchWebhook('CRITICAL_ALARM', {
        recipientRole: 'OPERATOR', event: 'TEP_REPLAY_FIRST_ALARM', alarmId: alarm.id,
        replayFile, sampleIndex: result.firstAlarmIndex, detector: '52-variable MLP autoencoder',
        detectionScore: result.alarmScore, detectionLimit: result.threshold,
        faultCandidate: candidate.code, classScore: diagnosis.classConfidence,
        topTreeShapSensors: diagnosis.topSensors,
        instruction: 'Operator acknowledgement required. XGBoost output is a benchmark candidate for engineer review, not a confirmed cause.',
      });
    }
    res.json({ ...result, alarm, operatorNotification, replayFile, duplicate: Boolean(existing) });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'Could not run the 52-variable first-alarm pipeline.' });
  }
});

apiRouter.post('/maintenance/replay-draft', requireRole('OPERATOR', 'ENGINEER', 'ADMIN'), async (req, res) => {
  const history = req.body?.history;
  const replayFile = typeof req.body?.replayFile === 'string' ? req.body.replayFile.slice(0, 160) : undefined;
  if (!Array.isArray(history) || history.length < 25 || history.length > 10_000
    || history.some((sample) => !sample || typeof sample.values !== 'object' || sample.values === null)) {
    return res.status(400).json({ error: 'Provide at least 25 mapped telemetry samples from one imported TEP run.' });
  }
  try {
    const prediction = await classifyXGBoostWindow(history);
    if (prediction.status === 'NORMAL') {
      return res.json({ success: true, created: false, prediction, order: null, operatorAlert: null });
    }
    if (prediction.status === 'UNKNOWN_FAULT') {
      const operatorAlert = await n8nService.dispatchWebhook('CRITICAL_ALARM', {
        recipientRole: 'OPERATOR', event: 'TEP_REPLAY_UNKNOWN_FAULT',
        candidateFaultId: prediction.candidateFaultId, faultScore: prediction.faultScore,
        classConfidence: prediction.classConfidence, source: 'IMPORTED_TEP_CSV_REPLAY', replayFile,
        instruction: 'Notify the operator. The classifier detected an abnormal run but cannot assign a known fault class; escalate for engineer review.',
      });
      return res.json({ success: true, created: false, prediction, order: null, operatorAlert });
    }
    const recent = history.slice(-25);
    const fingerprint = createHash('sha256').update(JSON.stringify(recent.map((sample: { values: Record<string, number> }) => sample.values))).digest('hex');
    const existing = crewaiOrchestrator.getWorkOrders().find((order) => order.replayFingerprint === fingerprint && order.status !== 'REJECTED');
    const lastValues = recent[recent.length - 1].values as Record<string, number>;
    const order = await crewaiOrchestrator.createTepReplayWorkOrder({
      faultId: prediction.faultId,
      faultScore: prediction.faultScore,
      classConfidence: prediction.classConfidence,
      probabilities: prediction.probabilities,
      topSensors: prediction.topSensors,
      sensorValues: lastValues,
      replayFile,
      fingerprint,
      actor: req.authUser!.displayName,
    });
    let operatorAlert = null;
    if (!existing) {
      operatorAlert = await n8nService.dispatchWebhook('CRITICAL_ALARM', {
        recipientRole: 'OPERATOR',
        event: 'TEP_REPLAY_FAULT_CANDIDATE',
        orderId: order.id,
        fault: order.faultHypothesis,
        riskBand: order.riskBand,
        riskScore: order.riskScore,
        source: 'IMPORTED_TEP_CSV_REPLAY',
        replayFile,
        instruction: 'Notify the operator immediately. This is benchmark replay, not a live plant alarm.',
      });
    }
    res.json({ success: true, created: !existing, prediction, order, operatorAlert });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'Could not draft the TEP replay work order.' });
  }
});

apiRouter.post('/ml/anomaly/compare', requireAuth, async (req, res) => {
  const history = req.body?.history;
  if (!Array.isArray(history) || history.length < 1 || history.length > 10_000) {
    return res.status(400).json({ error: 'Provide between 1 and 10,000 mapped telemetry samples.' });
  }
  if (history.some((sample) => !sample || typeof sample.values !== 'object' || sample.values === null)) {
    return res.status(400).json({ error: 'Each telemetry sample must contain a values mapping.' });
  }
  try {
    const comparison = await compareBenchmarkAnomaly(history);
    // This is an offline score comparison. The first-alarm pipeline owns the
    // single operator alert so opening the comparison cannot send duplicates.
    res.json({ ...comparison, operatorAlert: null });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'Anomaly detectors are unavailable.' });
  }
});

apiRouter.post('/orchestrator/replay-unit', async (req, res) => {
  const allowedUnits = new Set(['reactor', 'stripper', 'compressor', 'condenser', 'separator']);
  const { targetUnit, observations, telemetryTimestamp, adjacentUnitStatus } = req.body || {};
  if (typeof targetUnit !== 'string' || !allowedUnits.has(targetUnit)) {
    return res.status(400).json({ error: 'Choose a supported process unit for replay analysis.' });
  }
  const allowedChannels = new Set(tepSimulator.getUnitHealthStates().find((unit) => unit.unit === targetUnit)?.monitoredChannels || []);
  const allowedAlarms = new Set(['NORMAL', 'WARN_LOW', 'WARN_HIGH', 'TRIP_LOW', 'TRIP_HIGH', 'NOT_ASSESSED']);
  if (!Array.isArray(observations) || observations.length < 1 || observations.length > 20
    || observations.some((item) => !item || typeof item.channelId !== 'string'
      || typeof item.unit !== 'string' || typeof item.alarm !== 'string'
      || typeof item.value !== 'number' || !Number.isFinite(item.value)
      || !allowedChannels.has(item.channelId) || !allowedAlarms.has(item.alarm))) {
    return res.status(400).json({ error: 'Replay observations must contain 1 to 20 mapped finite sensor readings.' });
  }
  const invalidAdjacentContext = !Array.isArray(adjacentUnitStatus)
    || adjacentUnitStatus.length > 4
    || adjacentUnitStatus.some((item) => {
      if (!item || typeof item.unit !== 'string' || typeof item.name !== 'string'
        || !allowedUnits.has(item.unit)
        || !['OPTIMAL', 'STABLE', 'DEGRADED', 'CRITICAL'].includes(item.status)
        || !(item.healthIndex === null || (typeof item.healthIndex === 'number' && Number.isFinite(item.healthIndex)))
        || typeof item.activeAlarmsCount !== 'number' || !Number.isFinite(item.activeAlarmsCount)) return true;
      if (item.observations === undefined) return false;
      if (!Array.isArray(item.observations) || item.observations.length > 20) return true;
      const channels = new Set(tepSimulator.getUnitHealthStates().find((unit) => unit.unit === item.unit)?.monitoredChannels || []);
      return item.observations.some((observation: { channelId?: unknown; value?: unknown; unit?: unknown; alarm?: unknown }) => !observation
        || typeof observation.channelId !== 'string'
        || typeof observation.value !== 'number' || !Number.isFinite(observation.value)
        || typeof observation.unit !== 'string' || typeof observation.alarm !== 'string'
        || !allowedAlarms.has(observation.alarm) || !channels.has(observation.channelId));
    });
  if (invalidAdjacentContext) {
    return res.status(400).json({ error: 'Replay analysis needs valid adjacent-unit status context.' });
  }
  const cooldownMs = Math.max(60_000, Number(process.env.CREWAI_EVENT_COOLDOWN_MS) || 900_000);
  const cooldownKey = 'replay:plant-event';
  const now = Date.now();
  const lastRun = unitAnalysisLastRun.get(cooldownKey) || 0;
  if (now - lastRun < cooldownMs) {
    const retryAfterSeconds = Math.ceil((cooldownMs - (now - lastRun)) / 1000);
    return res.status(429).json({ error: `Replay plant analysis is cooling down; retry in about ${retryAfterSeconds} seconds.` });
  }
  unitAnalysisLastRun.set(cooldownKey, now);
  try {
    const report = await crewaiOrchestrator.runReplayUnitAnalysis(
      targetUnit,
      observations,
      Number.isFinite(telemetryTimestamp) ? telemetryTimestamp : now,
      adjacentUnitStatus
    );
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Replay unit analysis failed.' });
  }
});

apiRouter.post('/maintenance/orders/:orderId/sop', requireRole('ENGINEER', 'ADMIN'), (req, res) => {
  const { title, section, snippet, sourceStatus, citation, sourceUrl } = req.body || {};
  if (![title, section, snippet].every((value) => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ error: 'SOP title, section, and snippet are required.' });
  }
  const order = crewaiOrchestrator.attachSop(req.params.orderId, {
    title: title.trim(),
    section: section.trim(),
    snippet: snippet.trim(),
    sourceStatus: typeof sourceStatus === 'string' ? sourceStatus.slice(0, 80) : 'UNVERIFIED_ILLUSTRATIVE',
    citation: typeof citation === 'string' ? citation.slice(0, 500) : undefined,
    sourceUrl: typeof sourceUrl === 'string' && /^https:\/\//i.test(sourceUrl) ? sourceUrl.slice(0, 1000) : undefined,
  }, req.authUser!.displayName);
  if (!order) return res.status(404).json({ error: 'Work order not found.' });
  res.json({ success: true, order });
});

apiRouter.post('/maintenance/action', requireRole('ENGINEER', 'ADMIN'), async (req, res) => {
  const { orderId, action, notes } = req.body;
  if (typeof orderId !== 'string' || !['APPROVE', 'REJECT', 'DISPATCH'].includes(action)) {
    return res.status(400).json({ error: 'A work order ID and valid action are required.' });
  }
  if ((action === 'APPROVE' || action === 'REJECT') && (typeof notes !== 'string' || notes.trim().length < 10)) {
    return res.status(400).json({ error: 'Add at least 10 characters of review evidence before approving or rejecting.' });
  }

  if (action === 'APPROVE') {
    const pendingOrder = crewaiOrchestrator.getWorkOrders().find((order) => order.id === orderId);
    if (pendingOrder?.linkedAlarmId) {
      const linkedAlarms = stateStore.getAlarmReviews().filter((alarm) => alarm.id === pendingOrder.linkedAlarmId
        && !['RESOLVED', 'ARCHIVED'].includes(alarm.status));
      if (linkedAlarms.length === 0) {
        return res.status(409).json({ error: 'The linked sensor alarm has been resolved or archived. Create a work order from a current acknowledged alarm.' });
      }
      const unacknowledged = linkedAlarms.filter((alarm) => !alarm.acknowledgedBy);
      if (unacknowledged.length > 0) {
        return res.status(409).json({ error: 'Operator acknowledgement is required before Engineer approval.' });
      }
    } else if (pendingOrder?.faultSource === 'SIMULATOR_INJECTION' && pendingOrder.simulatorFaultId) {
      const linkedAlarms = stateStore.getAlarmReviews().filter((alarm) =>
        alarm.sourceFaults.some((fault) => fault.id === pendingOrder.simulatorFaultId)
        && !['RESOLVED', 'ARCHIVED'].includes(alarm.status)
      );
      if (linkedAlarms.length === 0) {
        return res.status(409).json({
          error: 'Engineer approval is waiting for a non-normal sensor alarm linked to this injected fault. Check Fault Lab readings and configured alarm limits.',
        });
      }
      const unacknowledged = linkedAlarms.filter((alarm) => !alarm.acknowledgedBy);
      if (unacknowledged.length > 0) {
        return res.status(409).json({
          error: `Operator acknowledgement is required before Engineer approval. Pending sensor alarm(s): ${unacknowledged.map((alarm) => alarm.code).join(', ')}.`,
        });
      }
    }
  }

  let updated;
  try {
    if (action === 'DISPATCH') {
      updated = crewaiOrchestrator.getWorkOrders().find((order) => order.id === orderId) || null;
      if (!updated) return res.status(404).json({ error: 'Work order not found.' });
      if (updated.status !== 'APPROVED') {
        return res.status(409).json({ error: 'Only approved work orders can be dispatched.' });
      }
    } else {
      updated = crewaiOrchestrator.updateWorkOrder(orderId, action, notes, req.authUser!.displayName);
      if (!updated) return res.status(404).json({ error: 'Work order not found.' });
    }
  } catch (err) {
    if (err instanceof WorkOrderTransitionError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  let n8nEvent = null;
  if ((action === 'DISPATCH' || action === 'APPROVE') && updated) {
    try {
      if (!updated.assignedTechnician) {
        const technician = authService.listUsers().find((user) => user.role === 'TECHNICIAN' && user.active);
        if (technician) updated = crewaiOrchestrator.assignTechnician(updated.id, technician.displayName, req.authUser!.displayName) || updated;
      }
      n8nEvent = await n8nService.dispatchWebhook('MAINTENANCE_WORK_ORDER', {
        recipientRole: 'TECHNICIAN',
        recipientName: updated.assignedTechnician || null,
        requiresEngineerApproval: true,
        approvedBy: req.authUser!.displayName,
        orderId: updated.id,
        priority: updated.priority,
        targetComponent: updated.targetComponent,
        notes: notes || updated.engineerNotes || 'Approved by reliability engineer on shift.',
        workOrder: updated,
      });
      // A simulation is only a local log entry; do not mark the work order as
      // dispatched until a configured n8n webhook has accepted the event.
      if (n8nEvent.status === 'DELIVERED') {
        updated = crewaiOrchestrator.updateWorkOrder(orderId, 'DISPATCH', notes, req.authUser!.displayName) || updated;
      }
    } catch (err) {
      console.error('Maintenance work order dispatch failed:', err);
      stateStore.addAuditEvent({
        category: 'dispatch',
        action: 'MAINTENANCE_DISPATCH_ERROR',
        actor: 'n8n-service',
        entityType: 'work_order',
        entityId: updated.id,
        status: 'ERROR',
        details: { message: err instanceof Error ? err.message : 'Unknown dispatch error' },
      });
      return res.status(502).json({
        error: 'Work order was approved, but n8n dispatch failed. Retry dispatch from the approved work order.',
        order: updated,
      });
    }
  }

  res.json({ success: true, order: updated, n8nEvent });
});

apiRouter.post('/maintenance/orders/:orderId/repair-complete', requireRole('TECHNICIAN'), (req, res) => {
  const notes = req.body?.notes;
  if (typeof notes !== 'string' || notes.trim().length < 10) {
    return res.status(400).json({ error: 'Record at least 10 characters describing the repair performed and outcome.' });
  }
  try {
    const current = crewaiOrchestrator.getWorkOrders().find((order) => order.id === req.params.orderId);
    if (current?.assignedTechnician && current.assignedTechnician !== req.authUser!.displayName) {
      return res.status(403).json({ error: 'This work order is assigned to another technician.' });
    }
    const order = crewaiOrchestrator.markRepairComplete(req.params.orderId, notes.trim(), req.authUser!.displayName);
    if (!order) return res.status(404).json({ error: 'Work order not found.' });
    if (order.faultSource === 'TEP_CSV_XGBOOST' && order.linkedAlarmId) {
      stateStore.markReplayAlarmRepairComplete(order.linkedAlarmId, req.authUser!.displayName, notes.trim());
    }
    res.json({ success: true, order });
  } catch (error) {
    if (error instanceof WorkOrderTransitionError) return res.status(409).json({ error: error.message });
    throw error;
  }
});

apiRouter.post('/maintenance/orders/:orderId/close', requireRole('ENGINEER', 'ADMIN'), (req, res) => {
  const notes = req.body?.notes;
  if (typeof notes !== 'string' || notes.trim().length < 10) {
    return res.status(400).json({ error: 'Record at least 10 characters for the engineer’s final review and closure.' });
  }
  try {
    const order = crewaiOrchestrator.closeWorkOrder(req.params.orderId, notes.trim(), req.authUser!.displayName);
    if (!order) return res.status(404).json({ error: 'Work order not found.' });
    res.json({ success: true, order });
  } catch (error) {
    if (error instanceof WorkOrderTransitionError) return res.status(409).json({ error: error.message });
    throw error;
  }
});

// --- 6. N8N AUTOMATION ENDPOINTS ---
apiRouter.post('/n8n/dispatch', requireRole('ADMIN'), async (req, res) => {
  const { workflowType, payload, customUrl } = req.body;
  try {
    const event = await n8nService.dispatchWebhook(workflowType, payload || {}, customUrl);
    res.json({ success: true, event });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Webhook dispatch failed.' });
  }
});

apiRouter.get('/n8n/history', (req, res) => {
  res.json({ events: n8nService.getHistory() });
});

// --- 7. GEMINI AI COPILOT CHAT ENDPOINT ---
apiRouter.post('/gemini/chat', async (req, res) => {
  const { message, history } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message text is required.' });
  }

  try {
    const reply = await geminiService.chat(message, history || []);
    res.json(reply);
  } catch (err: any) {
    console.error('Gemini chat route error:', err);
    res.status(500).json({
      error: 'Failed to generate response.',
      details: err.message,
    });
  }
});
