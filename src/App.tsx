import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header.js';
import { Navigation, TabKey } from './components/Navigation.js';
import { FlowsheetPID } from './components/FlowsheetPID.js';
import { TelemetryMatrix } from './components/TelemetryMatrix.js';
import { TelemetryReplayView } from './components/TelemetryReplayView.js';
import { FaultInjectionPanel } from './components/FaultInjectionPanel.js';
import { HealthAnomalyView } from './components/HealthAnomalyView.js';
import { PredictionShapView } from './components/PredictionShapView.js';
import { KnowledgeGraphView } from './components/KnowledgeGraphView.js';
import { RAGKnowledgeView } from './components/RAGKnowledgeView.js';
import { CrewAIBoard } from './components/CrewAIBoard.js';
import { MaintenanceStation } from './components/MaintenanceStation.js';
import { N8nAutomationView } from './components/N8nAutomationView.js';
import { GeminiCopilotDrawer } from './components/GeminiCopilotDrawer.js';
import { LoginView } from './components/LoginView.js';
import { AdminUsersView } from './components/AdminUsersView.js';
import { AlarmCenter } from './components/AlarmCenter.js';
import {
  TEPVariable,
  TEPFault,
  TelemetryPoint,
  UnitHealthState,
  UnitAgentAssessment,
  AnomalyReport,
  PredictionResult,
  ShapExplanation,
  KnowledgeGraphData,
  MaintenanceWorkOrder,
  OrchestrationReport,
  AuthUser,
  AlarmReviewRecord,
} from './types/index.js';
import { api } from './services/api.js';

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [authLoadError, setAuthLoadError] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('replay');
  const [selectedTelemetryVariableId, setSelectedTelemetryVariableId] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(true);
  const [alarmReviews, setAlarmReviews] = useState<AlarmReviewRecord[]>([]);
  const [alarmActionError, setAlarmActionError] = useState<string | null>(null);
  const [busyAlarmId, setBusyAlarmId] = useState<string | null>(null);
  const [plantNotice, setPlantNotice] = useState<string | null>(null);
  const [runningAgentUnits, setRunningAgentUnits] = useState<string[]>([]);
  const [analysisReportsByUnit, setAnalysisReportsByUnit] = useState<Record<string, OrchestrationReport>>({});
  const [copilotOpen, setCopilotOpen] = useState<boolean>(false);
  const [orchestrationError, setOrchestrationError] = useState<string | null>(null);
  const [unitAgentsError, setUnitAgentsError] = useState<string | null>(null);

  // Core Plant State
  const [variables, setVariables] = useState<TEPVariable[]>([]);
  const [faults, setFaults] = useState<TEPFault[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryPoint | null>(null);
  const [unitHealth, setUnitHealth] = useState<UnitHealthState[]>([]);
  const [unitAgents, setUnitAgents] = useState<UnitAgentAssessment[]>([]);
  const [activeFaults, setActiveFaults] = useState<TEPFault[]>([]);

  // AI & ML Models State
  const [anomalyReport, setAnomalyReport] = useState<AnomalyReport | null>(null);
  const [predictionReport, setPredictionReport] = useState<PredictionResult | null>(null);
  const [shapExplanation, setShapExplanation] = useState<ShapExplanation | null>(null);
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraphData | null>(null);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [orchestrationReport, setOrchestrationReport] = useState<OrchestrationReport | null>(null);
  const activeAgentIncidents = useRef(new Set<string>());
  const lastAgentDispatch = useRef(new Map<string, number>());
  const lastPlantAgentDispatch = useRef(0);

  const loadAuthSession = useCallback(async () => {
    setAuthLoading(true);
    setAuthLoadError(false);
    try {
      const session = await api.fetchAuthSession();
      setAuthConfigured(session.configured);
      setAuthUser(session.user);
    } catch (error) {
      console.error('Could not load sign-in status:', error);
      setAuthLoadError(true);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => { void loadAuthSession(); }, []);

  // Initial Data Load
  useEffect(() => {
    if (!authUser) return;
    async function initData() {
      try {
        const [varsRes, faultsRes, stateRes, kgRes, ordersRes] = await Promise.all([
          api.fetchVariables(),
          api.fetchFaults(),
          api.fetchPlantState(),
          api.fetchKnowledgeGraph().catch((error) => {
            console.error('Knowledge graph load failed:', error);
            return null;
          }),
          api.fetchWorkOrders(),
        ]);

        setVariables(varsRes.variables || []);
        setFaults(faultsRes.faults || []);
        setTelemetry(stateRes.telemetry);
        setIsSimulating(stateRes.simulationRunning);
        setUnitHealth(stateRes.unitHealth || []);
        setUnitAgents(stateRes.unitAgents || []);
        setUnitAgentsError(null);
        setActiveFaults(stateRes.activeFaults || []);
        const alarmRes = await api.fetchAlarmReviews();
        setAlarmReviews(alarmRes.alarms || []);
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

        // Avoid spending remote CrewAI credits just because the dashboard opened.
        // A focused analysis runs only when a unit enters a meaningful alert state.
      } catch (err) {
        console.error('Error during initial data loading:', err);
        setUnitAgentsError(
          err instanceof Error ? err.message : 'Failed to load unit monitor assessments.'
        );
      }
    }

    initData();
  }, [authUser]);

  // Poll shared plant and workflow state so already-open role sessions stay in sync.
  useEffect(() => {
    if (!authUser) return;

    const interval = setInterval(async () => {
      try {
        const stateRes = await api.fetchPlantState();
        setTelemetry(stateRes.telemetry);
        setIsSimulating(stateRes.simulationRunning);
        setUnitHealth(stateRes.unitHealth || []);
        setUnitAgents(stateRes.unitAgents || []);
        setUnitAgentsError(null);
        setActiveFaults(stateRes.activeFaults || []);
        const [alarmRes, ordersRes] = await Promise.all([
          api.fetchAlarmReviews(),
          api.fetchWorkOrders(),
        ]);
        setAlarmReviews(alarmRes.alarms || []);
        setWorkOrders(ordersRes.orders || []);

        // Refresh model summaries while the simulator runs or an injected fault is active.
        if (stateRes.simulationRunning || (stateRes.activeFaults?.length ?? 0) > 0) {
          const [anomRes, predRes] = await Promise.all([
            api.fetchAnomalyReport(),
            api.fetchPredictionReport(),
          ]);
          setAnomalyReport(anomRes);
          setPredictionReport(predRes);

          if ((stateRes.activeFaults?.length ?? 0) > 0 || anomRes.anomalyScore >= 100) {
            const shapRes = await api.fetchShapExplanation();
            setShapExplanation(shapRes);
          }
        }
      } catch (err) {
        console.error('Error polling plant state:', err);
        setUnitAgentsError(
          err instanceof Error ? err.message : 'Failed to refresh unit monitor assessments.'
        );
      }
    }, isSimulating ? 1500 : 2500);

    return () => clearInterval(interval);
  }, [authUser, isSimulating]);

  // Dispatch one focused plant-agent chain when a unit becomes abnormal.
  // Unit sensors continue to be monitored locally on every telemetry snapshot.
  useEffect(() => {
    if (!authUser) return;
    const specialistUnits = ['reactor', 'condenser', 'separator', 'stripper', 'compressor'];
    const impactedUnits = new Set(
      unitHealth
        .filter((unit) => unit.status === 'DEGRADED' || unit.status === 'CRITICAL')
        .map((unit) => unit.unit)
        .filter((unit) => specialistUnits.includes(unit))
    );
    for (const variable of variables) {
      if (telemetry?.alarms[variable.id] && telemetry.alarms[variable.id] !== 'NORMAL'
        && specialistUnits.includes(variable.category)) impactedUnits.add(variable.category);
    }
    for (const fault of activeFaults) {
      if (specialistUnits.includes(fault.primaryUnit)) impactedUnits.add(fault.primaryUnit);
    }

    for (const unit of Array.from(activeAgentIncidents.current)) {
      if (!impactedUnits.has(unit)) activeAgentIncidents.current.delete(unit);
    }
    const now = Date.now();
    const nextUnit = Array.from(impactedUnits).find((unit) => {
      const lastRun = lastAgentDispatch.current.get(unit) || 0;
      return !activeAgentIncidents.current.has(unit)
        && !runningAgentUnits.includes(unit)
        && now - lastRun >= 15 * 60 * 1000
        && now - lastPlantAgentDispatch.current >= 15 * 60 * 1000;
    });
    if (!nextUnit) return;

    activeAgentIncidents.current.add(nextUnit);
    lastAgentDispatch.current.set(nextUnit, now);
    lastPlantAgentDispatch.current = now;
    setRunningAgentUnits((current) => [...new Set([...current, nextUnit])]);
    void api.runCrewAI(nextUnit)
      .then(async (report) => {
        setOrchestrationReport(report);
        setAnalysisReportsByUnit((current) => ({ ...current, [nextUnit]: report }));
        setOrchestrationError(null);
        const orders = await api.fetchWorkOrders();
        setWorkOrders(orders.orders || []);
      })
      .catch((error) => {
        console.error(`Focused ${nextUnit} agent analysis failed:`, error);
        setOrchestrationError(error instanceof Error ? error.message : `Focused ${nextUnit} analysis failed.`);
      })
      .finally(() => setRunningAgentUnits((current) => current.filter((unit) => unit !== nextUnit)));
  }, [authUser, telemetry, unitHealth, activeFaults, variables, runningAgentUnits]);

  // Actions
  const handleToggleSimulate = async () => {
    try {
      const result = await api.setSimulationRunning(!isSimulating);
      setIsSimulating(result.simulationRunning);
      if (!result.simulationRunning) await refreshPlantSnapshot();
    } catch (err) {
      console.error('Could not change simulation state:', err);
    }
  };

  const handleStepSimulate = async () => {
    try {
      const res = await api.stepSimulation();
      setTelemetry(res.telemetry);
      setUnitHealth(res.unitHealth || []);
      setUnitAgents(res.unitAgents || []);
      await refreshPlantSnapshot();
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

  const refreshPlantSnapshot = async () => {
    const stateRes = await api.fetchPlantState();
    setTelemetry(stateRes.telemetry);
    setIsSimulating(stateRes.simulationRunning);
    setUnitHealth(stateRes.unitHealth || []);
    setUnitAgents(stateRes.unitAgents || []);
    setActiveFaults(stateRes.activeFaults || []);
    const alarmsRes = await api.fetchAlarmReviews();
    setAlarmReviews(alarmsRes.alarms || []);
    setUnitAgentsError(null);
  };

  const handleResetPlant = async () => {
    try {
      activeAgentIncidents.current.clear();
      lastAgentDispatch.current.clear();
      lastPlantAgentDispatch.current = 0;
      const res = await api.resetPlant();
      setPlantNotice(res.message);
      setTelemetry(res.telemetry);
      await refreshPlantSnapshot();
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
      setPlantNotice(err instanceof Error ? `Reset failed: ${err.message}` : 'Reset failed. Check that the app server is running and try again.');
    }
  };

  const handleInjectFault = async (faultId: number, intensity: number = 1.0) => {
    try {
      const res = await api.injectFault(faultId, intensity);
      setActiveFaults(res.activeFaults || []);
      const scenario = faults.find((fault) => fault.id === faultId);
      const unitSpecialists = ['reactor', 'stripper', 'compressor', 'condenser', 'separator'];
      const targetUnit = scenario && unitSpecialists.includes(scenario.primaryUnit)
        ? scenario.primaryUnit
        : scenario?.keySensors
          .map((sensorId) => variables.find((variable) => variable.id === sensorId)?.category)
          .find((category) => Boolean(category && unitSpecialists.includes(category)));
      if (targetUnit) {
        activeAgentIncidents.current.add(targetUnit);
        lastAgentDispatch.current.set(targetUnit, Date.now());
        lastPlantAgentDispatch.current = Date.now();
      }
      await refreshPlantSnapshot();
      const [anomRes, predRes] = await Promise.all([
        api.fetchAnomalyReport(),
        api.fetchPredictionReport(),
      ]);
      setAnomalyReport(anomRes);
      setPredictionReport(predRes);
      const shapRes = await api.fetchShapExplanation();
      setShapExplanation(shapRes);
      try {
        if (!targetUnit) return;
        setRunningAgentUnits((current) => [...new Set([...current, targetUnit])]);
        const report = await api.runCrewAI(targetUnit);
        setAnalysisReportsByUnit((current) => ({ ...current, [targetUnit]: report }));
        await handleOrchestrationComplete(report);
      } catch (analysisError) {
        setOrchestrationError(
          analysisError instanceof Error ? analysisError.message : 'The fault was injected, but diagnostic analysis failed.'
        );
      } finally {
        if (targetUnit) setRunningAgentUnits((current) => current.filter((unit) => unit !== targetUnit));
      }
    } catch (err) {
      console.error('Error injecting fault:', err);
    }
  };

  const handleClearFault = async (faultId?: number) => {
    try {
      const res = await api.clearFault(faultId);
      setActiveFaults(res.activeFaults || []);
      await refreshPlantSnapshot();
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
      await refreshPlantSnapshot();
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

  const handleAttachSop = async (
    orderId: string,
    sop: { title: string; section: string; snippet: string; sourceStatus?: string; citation?: string; sourceUrl?: string }
  ) => {
    await api.attachSopToWorkOrder(orderId, sop);
    await handleRefreshOrders();
  };

  const handleOrchestrationComplete = async (report: OrchestrationReport) => {
    setOrchestrationReport(report);
    setOrchestrationError(null);
    await handleRefreshOrders();
  };

  const handleAlarmAction = async (
    alarm: AlarmReviewRecord,
    action: 'ACKNOWLEDGE' | 'RESOLVE' | 'REVIEW',
    note: string,
  ) => {
    setBusyAlarmId(alarm.id);
    setAlarmActionError(null);
    try {
      await api.actOnAlarm(alarm.id, action, note);
      const result = await api.fetchAlarmReviews();
      setAlarmReviews(result.alarms || []);
    } catch (error) {
      setAlarmActionError(error instanceof Error ? error.message : 'Could not update this alarm record.');
    } finally {
      setBusyAlarmId(null);
    }
  };

  const handleCreateAlarmWorkOrder = async (alarm: AlarmReviewRecord) => {
    setBusyAlarmId(alarm.id);
    setAlarmActionError(null);
    try {
      await api.createWorkOrderFromAlarm(alarm.id);
      await handleRefreshOrders();
      setActiveTab('maintenance');
    } catch (error) {
      setAlarmActionError(error instanceof Error ? error.message : 'Could not create a work order from this alarm.');
    } finally {
      setBusyAlarmId(null);
    }
  };

  const handleSelectTelemetryVariable = (variableId: string) => {
    setSelectedTelemetryVariableId(variableId);
    setActiveTab('telemetry');
  };

  const handleLogout = async () => {
    try { await api.logout(); }
    finally {
      setAuthUser(null);
      setActiveTab('flowsheet');
      setIsSimulating(false);
    }
  };

  if (authLoading) {
    return <main className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center text-sm">Checking sign-in…</main>;
  }
  if (authLoadError) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <section className="w-full max-w-md rounded-2xl border border-amber-800 bg-slate-900 p-6 shadow-2xl">
          <h1 className="text-lg font-bold text-white">Can’t reach the app server</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">The app could not check whether an admin account exists. This does not mean your admin settings are missing. Start the app from this project folder with <code>npm run dev</code>, open the address shown in the terminal (normally <code>http://localhost:3000</code>), then retry.</p>
          <button onClick={() => void loadAuthSession()} className="mt-4 w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-500">Retry connection</button>
        </section>
      </main>
    );
  }
  if (!authUser) {
    return <LoginView configured={authConfigured} onLogin={(user) => { setAuthConfigured(true); setAuthUser(user); }} />;
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100">
      {/* Top SCADA Control Header */}
      <Header
        workflowMode={activeTab === 'replay'}
        telemetry={telemetry}
        unitHealth={unitHealth}
        activeFaults={activeFaults}
        anomalyScore={anomalyReport?.anomalyScore ?? 0}
        isSimulating={isSimulating}
        onToggleSimulate={handleToggleSimulate}
        onStepSimulate={handleStepSimulate}
        onResetPlant={handleResetPlant}
        canOperateProcess={authUser.role !== 'TECHNICIAN'}
        onClearFaults={() => handleClearFault()}
        onOpenCopilot={() => setCopilotOpen((prev) => !prev)}
        copilotOpen={copilotOpen}
      />

      {plantNotice && <div role="status" className="border-b border-cyan-900 bg-cyan-950/60 px-4 py-2 text-center text-xs text-cyan-100">{plantNotice}<button onClick={() => setPlantNotice(null)} className="ml-3 text-cyan-300 underline">Dismiss</button></div>}

      <div className="flex items-center justify-end gap-2 border-b border-slate-800 bg-slate-950 px-4 py-1.5 text-[11px]">
        <span className="text-slate-300">{authUser.displayName}</span>
        <span className="rounded border border-cyan-800 bg-cyan-950/60 px-2 py-0.5 font-mono text-cyan-200">{authUser.role}</span>
        <button onClick={() => void handleLogout()} className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:bg-slate-800">Sign out</button>
      </div>

      {/* Primary Tab Navigation */}
      <Navigation
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        activeFaultsCount={activeFaults.length}
        anomalyScore={anomalyReport?.anomalyScore ?? 0}
        pendingOrdersCount={workOrders.filter((o) => !['REJECTED', 'CLOSED'].includes(o.status)).length}
        isAdmin={authUser.role === 'ADMIN'}
        openAlarmCount={alarmReviews.filter((alarm) => !['RESOLVED', 'ARCHIVED'].includes(alarm.status)).length}
      />

      {/* Main View Port */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'flowsheet' && (
          <FlowsheetPID
            telemetry={telemetry}
            unitHealth={unitHealth}
            activeFaults={activeFaults}
            variables={variables}
            unitAgents={unitAgents}
            anomalyReport={anomalyReport}
            runningAgentUnits={runningAgentUnits}
            analysisReportsByUnit={analysisReportsByUnit}
            orchestrationError={orchestrationError}
            onOpenAlarmCenter={() => setActiveTab('alarms')}
            onSelectVariable={handleSelectTelemetryVariable}
            onInjectPresetFault={(faultId) => void handleInjectFault(faultId)}
          />
        )}

        {activeTab === 'telemetry' && (
          <TelemetryMatrix
            variables={variables}
            telemetry={telemetry}
            onSetActuator={handleSetActuator}
            selectedVariableId={selectedTelemetryVariableId}
          />
        )}

        {activeTab === 'replay' && <TelemetryReplayView variables={variables} unitHealth={unitHealth} onWorkOrderCreated={() => void handleRefreshOrders()} onOpenAlarmReview={() => setActiveTab('alarms')} />}

        {activeTab === 'faults' && (
          <FaultInjectionPanel
            faults={faults}
            activeFaults={activeFaults}
            variables={variables}
            telemetry={telemetry}
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
            telemetry={telemetry}
          />
        )}

        {activeTab === 'rag' && (
          <RAGKnowledgeView orders={workOrders} onAttachSop={handleAttachSop} canAttach={authUser.role === 'ENGINEER' || authUser.role === 'ADMIN'} />
        )}

        {activeTab === 'alarms' && (
          <AlarmCenter
            alarms={alarmReviews}
            activeFaults={activeFaults}
            variables={variables}
            telemetry={telemetry}
            onClearFault={(faultId) => void handleClearFault(faultId)}
            onOpenFaultLab={() => setActiveTab('faults')}
            onOpenMaintenance={() => setActiveTab('maintenance')}
            onCreateWorkOrder={(alarm) => void handleCreateAlarmWorkOrder(alarm)}
            role={authUser.role}
            error={alarmActionError}
            busyAlarmId={busyAlarmId}
            onAction={(alarm, action, note) => void handleAlarmAction(alarm, action, note)}
          />
        )}

        {activeTab === 'crewai' && (
          <CrewAIBoard
            orchestrationReport={orchestrationReport}
            unitAgents={unitAgents}
            unitAgentsError={unitAgentsError}
            initialError={orchestrationReport ? null : orchestrationError}
            onRefreshOrchestration={handleOrchestrationComplete}
          />
        )}

        {activeTab === 'maintenance' && (
          <MaintenanceStation
            orders={workOrders}
            alarms={alarmReviews}
            onOrderUpdated={handleRefreshOrders}
            report={orchestrationReport}
            analysisError={orchestrationError}
            canReview={authUser.role === 'ENGINEER' || authUser.role === 'ADMIN'}
            role={authUser.role}
            onRunAnalysis={async () => {
              const report = await api.runCrewAI();
              await handleOrchestrationComplete(report);
            }}
          />
        )}

        {activeTab === 'n8n' && <N8nAutomationView />}
        {activeTab === 'admin' && authUser.role === 'ADMIN' && <AdminUsersView />}
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
