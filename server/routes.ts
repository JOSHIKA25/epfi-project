/**
 * Express REST API Routes for Tennessee Eastman Process Digital Twin
 */

import { Router } from 'express';
import { TEP_VARIABLES, TEP_FAULTS } from './tep/tepConstants.ts';
import { tepSimulator } from './tep/tepSimulator.ts';
import { autoencoderDetector } from './ml/autoencoder.ts';
import { xgboostPredictor } from './ml/xgboostPredictor.ts';
import { shapEngine } from './ml/shapEngine.ts';
import { tepKnowledgeGraph } from './kg/neo4jGraph.ts';
import { tepRagEngine } from './rag/ragCorpus.ts';
import { crewaiOrchestrator } from './agents/crewaiOrchestrator.ts';
import { geminiService } from './gemini/geminiService.ts';
import { n8nService } from './n8n/n8nService.ts';

export const apiRouter = Router();

// --- 1. TEP SIMULATOR ENDPOINTS ---
apiRouter.get('/tep/variables', (req, res) => {
  res.json({ variables: TEP_VARIABLES });
});

apiRouter.get('/tep/faults', (req, res) => {
  res.json({ faults: TEP_FAULTS });
});

apiRouter.get('/tep/state', (req, res) => {
  const telemetry = tepSimulator.getLatestTelemetry();
  const unitHealth = tepSimulator.getUnitHealthStates();
  const activeFaults = tepSimulator.getActiveFaults();
  res.json({
    telemetry,
    unitHealth,
    activeFaults,
  });
});

apiRouter.get('/tep/history', (req, res) => {
  const count = parseInt(req.query.count as string, 10) || 60;
  res.json({ history: tepSimulator.getHistory(count) });
});

apiRouter.post('/tep/step', (req, res) => {
  const telemetry = tepSimulator.step();
  const unitHealth = tepSimulator.getUnitHealthStates();
  res.json({ telemetry, unitHealth });
});

apiRouter.post('/tep/inject-fault', (req, res) => {
  const { faultId, intensity } = req.body;
  tepSimulator.injectFault(Number(faultId), Number(intensity) || 1.0);
  res.json({
    success: true,
    activeFaults: tepSimulator.getActiveFaults(),
  });
});

apiRouter.post('/tep/clear-fault', (req, res) => {
  const { faultId } = req.body;
  tepSimulator.clearFault(faultId ? Number(faultId) : undefined);
  res.json({
    success: true,
    activeFaults: tepSimulator.getActiveFaults(),
  });
});

apiRouter.post('/tep/reset', (req, res) => {
  tepSimulator.resetToNominal();
  autoencoderDetector.resetPersistence();
  res.json({
    success: true,
    message: 'TEP plant reset to nominal steady state.',
    telemetry: tepSimulator.getLatestTelemetry(),
  });
});

apiRouter.post('/tep/actuator', (req, res) => {
  const { actuatorId, value } = req.body;
  tepSimulator.setManualActuator(actuatorId, Number(value));
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
  const result = xgboostPredictor.predict(history);
  res.json(result);
});

apiRouter.get('/ml/shap', (req, res) => {
  const telemetry = tepSimulator.getLatestTelemetry();
  const history = tepSimulator.getHistory(30);
  const anomaly = autoencoderDetector.analyze(telemetry.values);
  const prediction = xgboostPredictor.predict(history);
  const explanation = shapEngine.explainPrediction(prediction, anomaly, telemetry.values);
  res.json(explanation);
});

// --- 3. KNOWLEDGE GRAPH ENDPOINTS ---
apiRouter.get('/kg/graph', (req, res) => {
  res.json(tepKnowledgeGraph.getFullGraph());
});

apiRouter.get('/kg/subgraph/:faultId', (req, res) => {
  const faultId = parseInt(req.params.faultId, 10);
  res.json(tepKnowledgeGraph.getSubgraphForFault(faultId));
});

apiRouter.post('/kg/query', (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query string is required.' });
  }
  const result = tepKnowledgeGraph.executeCypher(query);
  res.json(result);
});

// --- 4. RAG DOCUMENTATION ENDPOINTS ---
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
    const report = await crewaiOrchestrator.runOrchestration();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Orchestration execution failed.' });
  }
});

apiRouter.get('/maintenance/orders', (req, res) => {
  res.json({ orders: crewaiOrchestrator.getWorkOrders() });
});

apiRouter.post('/maintenance/action', async (req, res) => {
  const { orderId, action, notes, triggerN8n } = req.body;
  const updated = crewaiOrchestrator.updateWorkOrder(orderId, action, notes);
  if (!updated) {
    return res.status(404).json({ error: 'Work order not found.' });
  }

  // Optionally trigger n8n automated dispatch upon approval
  let n8nEvent = null;
  if (action === 'APPROVE' && triggerN8n) {
    n8nEvent = await n8nService.dispatchWebhook('MAINTENANCE_WORK_ORDER', {
      orderId: updated.id,
      priority: updated.priority,
      targetComponent: updated.targetComponent,
      notes: notes || 'Approved by reliability engineer on shift.',
    });
  }

  res.json({ success: true, order: updated, n8nEvent });
});

// --- 6. N8N AUTOMATION ENDPOINTS ---
apiRouter.post('/n8n/dispatch', async (req, res) => {
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
