import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.js';
import { Navigation, TabKey } from './components/Navigation.js';
import { FlowsheetPID } from './components/FlowsheetPID.js';
import { TelemetryMatrix } from './components/TelemetryMatrix.js';
import { FaultInjectionPanel } from './components/FaultInjectionPanel.js';
import { HealthAnomalyView } from './components/HealthAnomalyView.js';
import { PredictionShapView } from './components/PredictionShapView.js';
import { KnowledgeGraphView } from './components/KnowledgeGraphView.js';
import { RAGKnowledgeView } from './components/RAGKnowledgeView.js';
import { CrewAIBoard } from './components/CrewAIBoard.js';
import { MaintenanceStation } from './components/MaintenanceStation.js';
import { N8nAutomationView } from './components/N8nAutomationView.js';
import { GeminiCopilotDrawer } from './components/GeminiCopilotDrawer.js';
import {
  TEPVariable,
  TEPFault,
  TelemetryPoint,
  UnitHealthState,
  AnomalyReport,
  PredictionResult,
  ShapExplanation,
  KnowledgeGraphData,
  MaintenanceWorkOrder,
  OrchestrationReport,
} from './types/index.js';
import { api } from './services/api.js';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('flowsheet');
  const [isSimulating, setIsSimulating] = useState<boolean>(true);
  const [copilotOpen, setCopilotOpen] = useState<boolean>(false);

  // Core Plant State
  const [variables, setVariables] = useState<TEPVariable[]>([]);
  const [faults, setFaults] = useState<TEPFault[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryPoint | null>(null);
  const [unitHealth, setUnitHealth] = useState<UnitHealthState[]>([]);
  const [activeFaults, setActiveFaults] = useState<TEPFault[]>([]);

  // AI & ML Models State
  const [anomalyReport, setAnomalyReport] = useState<AnomalyReport | null>(null);
  const [predictionReport, setPredictionReport] = useState<PredictionResult | null>(null);
  const [shapExplanation, setShapExplanation] = useState<ShapExplanation | null>(null);
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraphData | null>(null);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [orchestrationReport, setOrchestrationReport] = useState<OrchestrationReport | null>(null);

  // Initial Data Load
  useEffect(() => {
    async function initData() {
      try {
        const [varsRes, faultsRes, stateRes, kgRes, ordersRes] = await Promise.all([
          api.fetchVariables(),
          api.fetchFaults(),
          api.fetchPlantState(),
          api.fetchKnowledgeGraph(),
          api.fetchWorkOrders(),
        ]);

        setVariables(varsRes.variables || []);
        setFaults(faultsRes.faults || []);
        setTelemetry(stateRes.telemetry);
        setUnitHealth(stateRes.unitHealth || []);
        setActiveFaults(stateRes.activeFaults || []);
        setKnowledgeGraph(kgRes);
        setWorkOrders(ordersRes.orders || []);

        // Fetch initial ML reports
        const [anomRes, predRes] = await Promise.all([
          api.fetchAnomalyReport(),
          api.fetchPredictionReport(),
        ]);
        setAnomalyReport(anomRes);
        setPredictionReport(predRes);

        const shapRes = await api.fetchShapExplanation();
        setShapExplanation(shapRes);

        // Run initial CrewAI orchestration snapshot
        const crewRes = await api.runCrewAI();
        setOrchestrationReport(crewRes);
      } catch (err) {
        console.error('Error during initial data loading:', err);
      }
    }

    initData();
  }, []);

  // Periodic Telemetry Sync
  useEffect(() => {
    if (!isSimulating) return;

    const interval = setInterval(async () => {
      try {
        const stateRes = await api.fetchPlantState();
        setTelemetry(stateRes.telemetry);
        setUnitHealth(stateRes.unitHealth || []);
        setActiveFaults(stateRes.activeFaults || []);

        // Refresh anomaly and predictions
        const [anomRes, predRes] = await Promise.all([
          api.fetchAnomalyReport(),
          api.fetchPredictionReport(),
        ]);
        setAnomalyReport(anomRes);
        setPredictionReport(predRes);

        // Periodically update SHAP
        if (stateRes.activeFaults.length > 0 || anomRes.anomalyScore > 35) {
          const shapRes = await api.fetchShapExplanation();
          setShapExplanation(shapRes);
        }
      } catch (err) {
        console.error('Error polling plant state:', err);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [isSimulating]);

  // Actions
  const handleToggleSimulate = () => {
    setIsSimulating((prev) => !prev);
  };

  const handleStepSimulate = async () => {
    try {
      const res = await api.stepSimulation();
      setTelemetry(res.telemetry);
      setUnitHealth(res.unitHealth || []);
      const [anomRes, predRes] = await Promise.all([
        api.fetchAnomalyReport(),
        api.fetchPredictionReport(),
      ]);
      setAnomalyReport(anomRes);
      setPredictionReport(predRes);
    } catch (err) {
      console.error('Error stepping plant:', err);
    }
  };

  const handleResetPlant = async () => {
    try {
      const res = await api.resetPlant();
      setTelemetry(res.telemetry);
      setActiveFaults([]);
      const [anomRes, predRes] = await Promise.all([
        api.fetchAnomalyReport(),
        api.fetchPredictionReport(),
      ]);
      setAnomalyReport(anomRes);
      setPredictionReport(predRes);
      const shapRes = await api.fetchShapExplanation();
      setShapExplanation(shapRes);
    } catch (err) {
      console.error('Error resetting plant:', err);
    }
  };

  const handleInjectFault = async (faultId: number, intensity: number = 1.0) => {
    try {
      const res = await api.injectFault(faultId, intensity);
      setActiveFaults(res.activeFaults || []);
      const [anomRes, predRes] = await Promise.all([
        api.fetchAnomalyReport(),
        api.fetchPredictionReport(),
      ]);
      setAnomalyReport(anomRes);
      setPredictionReport(predRes);
      const shapRes = await api.fetchShapExplanation();
      setShapExplanation(shapRes);
    } catch (err) {
      console.error('Error injecting fault:', err);
    }
  };

  const handleClearFault = async (faultId?: number) => {
    try {
      const res = await api.clearFault(faultId);
      setActiveFaults(res.activeFaults || []);
      const [anomRes, predRes] = await Promise.all([
        api.fetchAnomalyReport(),
        api.fetchPredictionReport(),
      ]);
      setAnomalyReport(anomRes);
      setPredictionReport(predRes);
    } catch (err) {
      console.error('Error clearing fault:', err);
    }
  };

  const handleSetActuator = async (actuatorId: string, value: number) => {
    try {
      const res = await api.setActuator(actuatorId, value);
      setTelemetry(res.telemetry);
    } catch (err) {
      console.error('Error setting actuator:', err);
    }
  };

  const handleRefreshOrders = async () => {
    try {
      const res = await api.fetchWorkOrders();
      setWorkOrders(res.orders || []);
    } catch (err) {
      console.error('Error fetching work orders:', err);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100">
      {/* Top SCADA Control Header */}
      <Header
        telemetry={telemetry}
        unitHealth={unitHealth}
        activeFaults={activeFaults}
        anomalyScore={anomalyReport?.anomalyScore ?? 0}
        isSimulating={isSimulating}
        onToggleSimulate={handleToggleSimulate}
        onStepSimulate={handleStepSimulate}
        onResetPlant={handleResetPlant}
        onClearFaults={() => handleClearFault()}
        onOpenCrewAI={() => setActiveTab('crewai')}
        onOpenCopilot={() => setCopilotOpen((prev) => !prev)}
        copilotOpen={copilotOpen}
      />

      {/* Primary Tab Navigation */}
      <Navigation
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        activeFaultsCount={activeFaults.length}
        anomalyScore={anomalyReport?.anomalyScore ?? 0}
        pendingOrdersCount={workOrders.filter((o) => o.status === 'PROPOSED_PENDING_ENGINEER').length}
      />

      {/* Main View Port */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'flowsheet' && (
          <FlowsheetPID
            telemetry={telemetry}
            unitHealth={unitHealth}
            activeFaults={activeFaults}
            variables={variables}
            onInjectPresetFault={handleInjectFault}
          />
        )}

        {activeTab === 'telemetry' && (
          <TelemetryMatrix
            variables={variables}
            telemetry={telemetry}
            onSetActuator={handleSetActuator}
          />
        )}

        {activeTab === 'faults' && (
          <FaultInjectionPanel
            faults={faults}
            activeFaults={activeFaults}
            onInjectFault={handleInjectFault}
            onClearFault={handleClearFault}
          />
        )}

        {activeTab === 'health' && (
          <HealthAnomalyView
            anomalyReport={anomalyReport}
            unitHealth={unitHealth}
          />
        )}

        {activeTab === 'prediction' && (
          <PredictionShapView
            prediction={predictionReport}
            shap={shapExplanation}
          />
        )}

        {activeTab === 'kg' && (
          <KnowledgeGraphView
            graphData={knowledgeGraph}
            activeFaultId={activeFaults[0]?.id}
          />
        )}

        {activeTab === 'rag' && <RAGKnowledgeView />}

        {activeTab === 'crewai' && (
          <CrewAIBoard
            orchestrationReport={orchestrationReport}
            onRefreshOrchestration={setOrchestrationReport}
          />
        )}

        {activeTab === 'maintenance' && (
          <MaintenanceStation
            orders={workOrders}
            onOrderUpdated={handleRefreshOrders}
          />
        )}

        {activeTab === 'n8n' && <N8nAutomationView />}
      </main>

      {/* Gemini AI Copilot Assistant Drawer */}
      <GeminiCopilotDrawer
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        telemetry={telemetry}
        topPrediction={predictionReport?.topPrediction}
        anomalyScore={anomalyReport?.anomalyScore}
      />
    </div>
  );
}
