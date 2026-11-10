import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookmarkPlus,
  CheckCircle2,
  FileUp,
  Info,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  TriangleAlert,
} from 'lucide-react';
import { MaintenanceWorkOrder, TEPVariable, UnitHealthState } from '../types/index.js';
import { UnitEventAnalysisReport } from '../types/index.js';
import { api } from '../services/api.js';
import type { TepModelPerformance } from '../services/api.js';
import {
  assessReplayUnits,
  buildReplayEnvelopeEvents,
  buildReplaySamples,
  createDefaultSensorMappings,
  MAX_CSV_BYTES,
  TEP_BENCHMARK_FEATURE_IDS,
  ParsedTelemetryCsv,
  ReplayEnvelopeEvent,
  ReplaySample,
  parseTelemetryCsv,
  suggestSensorMapping,
} from '../services/telemetryCsv.js';

interface TelemetryReplayViewProps {
  variables: TEPVariable[];
  unitHealth: UnitHealthState[];
  onWorkOrderCreated?: () => void;
  onOpenAlarmReview?: () => void;
}

interface ReplayChannel {
  key: string;
  label: string;
  unit: string;
  variableId?: string;
}

interface ReplayReviewNote {
  id: string;
  sampleIndex: number;
  timestamp: number;
  note: string;
}

type TimelineEntry =
  | { id: string; sampleIndex: number; timestamp: number; kind: ReplayEnvelopeEvent['kind']; title: string; detail: string }
  | { id: string; sampleIndex: number; timestamp: number; kind: 'review'; title: string; detail: string };

const XGBOOST_FEATURE_IDS = TEP_BENCHMARK_FEATURE_IDS;

export const TelemetryReplayView: React.FC<TelemetryReplayViewProps> = ({ variables, unitHealth, onWorkOrderCreated, onOpenAlarmReview }) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [replaySessionId, setReplaySessionId] = useState('');
  const [csv, setCsv] = useState<ParsedTelemetryCsv | null>(null);
  const [timestampColumn, setTimestampColumn] = useState('');
  const [columnToVariable, setColumnToVariable] = useState<Record<string, string>>({});
  const [samples, setSamples] = useState<ReplaySample[]>([]);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [speed, setSpeed] = useState(20);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVariable, setSelectedVariable] = useState('');
  const [hasStartedReplay, setHasStartedReplay] = useState(false);
  const [unitCompatibilityConfirmed, setUnitCompatibilityConfirmed] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewNotes, setReviewNotes] = useState<ReplayReviewNote[]>([]);
  const [eventReports, setEventReports] = useState<Record<string, UnitEventAnalysisReport>>({});
  const [analyzingUnit, setAnalyzingUnit] = useState<string | null>(null);
  const [eventAnalysisError, setEventAnalysisError] = useState<string | null>(null);
  const [xgboostResult, setXgboostResult] = useState<Awaited<ReturnType<typeof api.classifyReplayWindow>> | null>(null);
  const [firstAlarmPipeline, setFirstAlarmPipeline] = useState<Awaited<ReturnType<typeof api.detectReplayFirstAlarm>> | null>(null);
  const [xgboostError, setXgboostError] = useState<string | null>(null);
  const [classifyingXgboost, setClassifyingXgboost] = useState(false);
  const [replayDraftOrder, setReplayDraftOrder] = useState<MaintenanceWorkOrder | null>(null);
  const [replayDraftMessage, setReplayDraftMessage] = useState<string | null>(null);
  const [anomalyComparison, setAnomalyComparison] = useState<Awaited<ReturnType<typeof api.compareReplayAnomaly>> | null>(null);
  const [anomalyComparisonError, setAnomalyComparisonError] = useState<string | null>(null);
  const [modelPerformance, setModelPerformance] = useState<TepModelPerformance | null>(null);
  const [modelPerformanceError, setModelPerformanceError] = useState<string | null>(null);

  const variableById = useMemo(
    () => new Map(variables.map((variable) => [variable.id, variable])),
    [variables]
  );
  const currentSample = samples[sampleIndex] ?? null;
  const xgboostFeaturesMapped = Boolean(currentSample)
    && XGBOOST_FEATURE_IDS.every((featureId) => Number.isFinite(currentSample?.values[featureId]));
  const replayUnitAssessments = useMemo(
    () => currentSample
      ? assessReplayUnits(currentSample, unitHealth, variables, unitCompatibilityConfirmed)
      : [],
    [currentSample, unitCompatibilityConfirmed, unitHealth, variables]
  );
  const mappedChannels: ReplayChannel[] = Object.entries(columnToVariable)
    .filter(([, key]) => Boolean(key))
    .map(([sourceColumn, key]) => {
      const variable = variableById.get(key);
      return variable
        ? { key, label: `${variable.code} — ${variable.name}`, unit: variable.unit, variableId: variable.id }
        : { key, label: sourceColumn, unit: 'source units (verify)' };
    });
  const activeChannel = mappedChannels.find((channel) => channel.key === selectedVariable)
    ?? mappedChannels[0];
  const envelopeEvents = useMemo(
    () => unitCompatibilityConfirmed
      ? buildReplayEnvelopeEvents(samples, columnToVariable, variables)
      : [],
    [columnToVariable, samples, unitCompatibilityConfirmed, variables]
  );
  const timelineEntries = useMemo<TimelineEntry[]>(() => {
    const observations: TimelineEntry[] = envelopeEvents.map((event) => ({
      id: event.id,
      sampleIndex: event.sampleIndex,
      timestamp: event.timestamp,
      kind: event.kind,
      title: event.kind === 'warning'
        ? `Outside warning reference: ${event.code}`
        : event.kind === 'trip'
          ? `Outside trip reference: ${event.code}`
          : `Returned inside reference: ${event.code}`,
      detail: event.kind === 'recovered'
        ? `${event.name}: ${event.value} ${event.unit}`
        : `${event.name}: ${event.value} ${event.unit}; reference ${event.reference} ${event.unit}`,
    }));
    const notes: TimelineEntry[] = reviewNotes.map((note) => ({
      id: note.id,
      sampleIndex: note.sampleIndex,
      timestamp: note.timestamp,
      kind: 'review',
      title: 'Engineer review note',
      detail: note.note,
    }));
    return [...observations, ...notes].sort(
      (left, right) => left.timestamp - right.timestamp || left.sampleIndex - right.sampleIndex
    );
  }, [envelopeEvents, reviewNotes]);

  useEffect(() => {
    if (!playing || samples.length === 0) return undefined;
    const interval = window.setInterval(() => {
      setSampleIndex((index) => {
        if (index >= samples.length - 1) {
          setPlaying(false);
          return index;
        }
        return index + 1;
      });
    }, 1000 / speed);
    return () => window.clearInterval(interval);
  }, [playing, samples.length, speed]);

  useEffect(() => {
    let active = true;
    void api.fetchTepModelPerformance()
      .then((result) => { if (active) setModelPerformance(result); })
      .catch((cause) => {
        if (active) setModelPerformanceError(cause instanceof Error ? cause.message : 'Could not load held-out evaluation metrics.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setXgboostResult(null);
    setFirstAlarmPipeline(null);
    setReplayDraftOrder(null);
    setReplayDraftMessage(null);
    setFirstAlarmPipeline(null);
    setXgboostResult(null);
    setXgboostError(null);
    setAnomalyComparison(null);
    setAnomalyComparisonError(null);
  }, [sampleIndex]);

  const handleFile = async (file?: File) => {
    setError(null);
    setPlaying(false);
    setSamples([]);
    setSampleIndex(0);
    setCsv(null);
    setFileName('');
    setReplayDraftOrder(null);
    setReplayDraftMessage(null);
    setFirstAlarmPipeline(null);
    setXgboostResult(null);
    setXgboostError(null);
    setAnomalyComparison(null);
    setAnomalyComparisonError(null);
    setReviewNotes([]);
    setEventReports({});
    setEventAnalysisError(null);
    setReviewNote('');
    setHasStartedReplay(false);
    setUnitCompatibilityConfirmed(false);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Choose a .csv file. Other formats are not supported in this prototype.');
      return;
    }
    if (file.size > MAX_CSV_BYTES) {
      setError('CSV file is larger than the 5 MB limit.');
      return;
    }

    try {
      const parsed = parseTelemetryCsv(await file.text());
      const guessedTimestamp = parsed.headers.find((header) =>
        /^(timestamp|time|datetime|date|sample)$/i.test(header)
      ) ?? parsed.headers[0];
      const defaults = createDefaultSensorMappings(parsed.headers, guessedTimestamp, variables);
      setCsv(parsed);
      setFileName(file.name);
      setReplaySessionId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      setTimestampColumn(guessedTimestamp);
      setColumnToVariable(defaults);
      setSelectedVariable(Object.values(defaults)[0] ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read this CSV file.');
    }
  };

  const handleLoadBenchmarkDemo = async () => {
    setError(null);
    try {
      const response = await fetch('/demo/tep_fault_replay.csv');
      if (!response.ok) throw new Error(`Prepared TEP demo run is unavailable (HTTP ${response.status}).`);
      const content = await response.text();
      await handleFile(new File([content], 'tep_fault_replay.csv', { type: 'text/csv' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the prepared TEP demo run.');
    }
  };

  const invalidatePreparedReplay = () => {
    setSamples([]);
    setSampleIndex(0);
    setFirstAlarmPipeline(null);
    setXgboostResult(null);
    setXgboostError(null);
    setAnomalyComparison(null);
    setAnomalyComparisonError(null);
    setPlaying(false);
    setHasStartedReplay(false);
    setUnitCompatibilityConfirmed(false);
    setReviewNotes([]);
    setReviewNote('');
  };

  const handleApplyMapping = () => {
    if (!csv) return;
    try {
      const prepared = buildReplaySamples(csv, timestampColumn, columnToVariable);
      setSamples(prepared);
      setSampleIndex(0);
      setPlaying(false);
      setReviewNotes([]);
      setReviewNote('');
      setHasStartedReplay(false);
      setSelectedVariable(Object.values(columnToVariable).find(Boolean) ?? '');
      setError(null);
      setXgboostResult(null);
      setXgboostError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not validate the telemetry mapping.');
    }
  };

  const handleAddReviewNote = () => {
    const note = reviewNote.trim();
    if (!currentSample || !note) return;
    setReviewNotes((current) => [
      ...current,
      {
        id: `review:${sampleIndex}:${Date.now()}`,
        sampleIndex,
        timestamp: currentSample.timestamp,
        note,
      },
    ]);
    setReviewNote('');
  };

  const handleAnalyzeReplayUnit = async (unit: string) => {
    if (!currentSample) return;
    const assessment = replayUnitAssessments.find((candidate) => candidate.unit === unit);
    if (!assessment || assessment.observations.length === 0) return;
    setAnalyzingUnit(unit);
    setEventAnalysisError(null);
    try {
      const report = await api.runReplayUnitAnalysis({
        targetUnit: unit,
        telemetryTimestamp: currentSample.timestamp,
        observations: assessment.observations.map((observation) => ({
          channelId: observation.channelId,
          value: observation.value,
          unit: observation.unit,
          alarm: observation.alarm,
        })),
        adjacentUnitStatus: replayUnitAssessments
          .filter((other) => other.unit !== unit)
          .map((other) => ({
            unit: other.unit,
            name: other.name,
            status: ['OPTIMAL', 'STABLE', 'DEGRADED', 'CRITICAL'].includes(other.status) ? other.status : 'STABLE',
            healthIndex: other.healthIndex,
            activeAlarmsCount: other.activeAlarmsCount,
            observations: other.observations.map((observation) => ({
              channelId: observation.channelId,
              value: observation.value,
              unit: observation.unit,
              alarm: observation.alarm,
            })),
          })),
      });
      setEventReports((current) => ({ ...current, [unit]: report }));
    } catch (cause) {
      setEventAnalysisError(cause instanceof Error ? cause.message : 'Replay unit analysis failed.');
    } finally {
      setAnalyzingUnit(null);
    }
  };

  const handleClassifyReplayWindow = async () => {
    if (!xgboostFeaturesMapped || sampleIndex !== samples.length - 1) return;
    const history = samples.slice(0, sampleIndex + 1);
    setClassifyingXgboost(true);
    setXgboostError(null);
    setAnomalyComparisonError(null);
    setAnomalyComparison(null);
    try {
      const comparison = await api.compareReplayAnomaly({ history, replayFile: fileName });
      setAnomalyComparison(comparison);
    } catch (cause) {
      setAnomalyComparisonError(cause instanceof Error ? cause.message : 'PCA/autoencoder evidence is unavailable.');
    }
    try {
      const result = await api.detectReplayFirstAlarm({ history, replayFile: fileName, replaySessionId });
      setFirstAlarmPipeline(result);
      setXgboostResult(result.diagnosis);
      setReplayDraftMessage(result.alarm
        ? result.operatorNotification
          ? `Operator webhook: ${result.operatorNotification.status}. Check the n8n execution and recipient message. The incident is in Alarm Review.`
          : 'Persistent alarm recorded for Operator review. External n8n delivery was not confirmed.'
        : result.status === 'NO_PERSISTENT_ALARM'
          ? 'No persistent autoencoder alarm was found in this replay; XGBoost was not called.'
          : result.status === 'DIAGNOSIS_PENDING'
            ? `Persistent alarm found. Diagnosis needs ${result.diagnosisDelaySamples ?? 0} additional samples before its evidence window is ready.`
            : 'A persistent alarm occurred before a complete 25-sample diagnosis window was available.');
      if (result.alarm) onWorkOrderCreated?.();
    } catch (cause) {
      setXgboostError(cause instanceof Error ? cause.message : 'XGBoost replay classification failed.');
    } finally {
      setClassifyingXgboost(false);
    }
  };

  const handleSelectTimelineEntry = (entry: TimelineEntry) => {
    setPlaying(false);
    setSampleIndex(entry.sampleIndex);
  };

  const chartPoints = useMemo(() => {
    if (!activeChannel || samples.length === 0) return '';
    const stride = Math.max(1, Math.ceil(samples.length / 240));
    const visible = samples.filter((_, index) => index % stride === 0);
    if (visible[visible.length - 1] !== samples[samples.length - 1]) {
      visible.push(samples[samples.length - 1]);
    }
    const values = visible.map((sample) => sample.values[activeChannel.key]).filter(Number.isFinite);
    if (values.length === 0) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return visible
      .map((sample, index) => {
        const value = sample.values[activeChannel.key];
        const x = visible.length <= 1 ? 0 : (index / (visible.length - 1)) * 1000;
        const y = 185 - ((value - min) / range) * 160;
        return `${x},${y}`;
      })
      .join(' ');
  }, [activeChannel, samples]);

  return (
    <div className="h-full overflow-y-auto bg-slate-950 p-4 text-slate-100">
      <section className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-lg font-bold text-white">Unified TEP Data → Detection → Diagnosis Workflow</h2>
          <p className="mt-1 text-sm text-slate-400">
            Load a TEP dataset run, inspect detector evidence, diagnose the first persistent alarm, and send the same incident into Operator and Engineer review.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {[
              { label: '1. Load dataset', complete: Boolean(csv) },
              { label: '2. Validate 52 channels', complete: samples.length > 0 && xgboostFeaturesMapped },
              { label: '3. Inspect sequence', complete: hasStartedReplay },
              { label: '4. PCA + AE evidence', complete: Boolean(anomalyComparison) },
              { label: '5. XGBoost + SHAP', complete: Boolean(xgboostResult) },
              { label: '6. Operator incident', complete: Boolean(firstAlarmPipeline?.alarm) },
            ].map((step) => (
              <div
                key={step.label}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                  step.complete
                    ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400'
                }`}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{step.label}</span>
              </div>
            ))}
          </div>
        </header>

        <section className="rounded-xl border border-cyan-900/70 bg-cyan-950/20 p-4">
          <h3 className="text-sm font-semibold text-cyan-100">How the models were prepared and what this run uses</h3>
          <p className="mt-1 text-xs text-slate-300">The model artifacts are trained from project CSV datasets before this run. This screen applies those fitted models to the loaded run chronologically; it does not train on the test run or use its fault label to make a prediction.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <article className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"><h4 className="text-xs font-semibold text-white">1 · Dataset preparation</h4><p className="mt-1 text-[11px] leading-5 text-slate-400">Normal training: <code>TEP_FaultFree_Training.csv</code>. Fault-classifier training: <code>faulty_training.csv</code>. <code>fault_free_testing.csv</code> and <code>faulty_testing.csv</code> are held out for evaluation. Splits keep each run together.</p></article>
            <article className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"><h4 className="text-xs font-semibold text-white">2 · Learn normal operation</h4><p className="mt-1 text-[11px] leading-5 text-slate-400">Both PCA and the MLP autoencoder use 350 normal runs (175,000 rows), 75 normal calibration runs, and 75 normal holdout runs. PCA retains normal structure for T²/SPE scoring; the autoencoder learns reconstruction, with its limit calibrated at the 99.5th percentile.</p></article>
            <article className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"><h4 className="text-xs font-semibold text-white">3 · Detect then diagnose</h4><p className="mt-1 text-[11px] leading-5 text-slate-400">PCA and autoencoder evidence is calculated on this history. The serving alarm rule uses two consecutive autoencoder threshold exceedances; XGBoost classifies a 25-sample × 52-channel window using last, mean, standard deviation, and slope features.</p></article>
            <article className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"><h4 className="text-xs font-semibold text-white">4 · Explain and review</h4><p className="mt-1 text-[11px] leading-5 text-slate-400">XGBoost uses 52 channels (XMEAS 1–41, XMV 1–11). TreeSHAP ranks features influencing its prediction. The operator acknowledges the event; an engineer reviews any work order.</p></article>
          </div>
          <p className="mt-3 text-[10px] text-slate-500">Training and calibration use training datasets; held-out CSVs are for evaluation. PCA is corroborating evidence in this interface—the deployed first-alarm trigger is the calibrated autoencoder rule. TreeSHAP is model evidence, not proof of physical cause.</p>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">1. Upload and map data</h3>
              <p className="mt-1 text-xs text-slate-400">
                CSV only, up to 5 MB and 10,000 data rows. Generic signals can stay as custom
                replay channels; aliases only suggest semantic TEP matches.
              </p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-cyan-700 bg-cyan-950/50 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-900/60"
            >
              <FileUp className="h-4 w-4" /> Choose CSV
            </button>
            <button
              type="button"
              onClick={() => void handleLoadBenchmarkDemo()}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
            >
              Load prepared TEP demo run
            </button>
          </div>
          {fileName && <p className="mt-3 text-xs text-slate-300">Selected: {fileName}</p>}

          {csv && (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(200px,0.7fr)_minmax(0,1.3fr)]">
              <div className="space-y-3">
                <label className="block text-xs text-slate-300">
                  Timestamp column
                  <select
                    value={timestampColumn}
                    onChange={(event) => {
                      const nextTimestampColumn = event.target.value;
                      setTimestampColumn(nextTimestampColumn);
                      invalidatePreparedReplay();
                      setColumnToVariable((current) => {
                        return Object.fromEntries(
                          Object.entries(current).filter(([column]) => column !== nextTimestampColumn)
                        );
                      });
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  >
                    {csv.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                  </select>
                </label>
                <div className="max-h-64 space-y-2 overflow-auto pr-1">
                  {csv.headers.filter((header) => header !== timestampColumn).map((header) => {
                    const suggestion = suggestSensorMapping(header, variables);
                    const suggestedCandidates = suggestion?.candidates
                      .filter((id) => variableById.has(id))
                      .map((id) => variableById.get(id))
                      .filter((variable): variable is TEPVariable => Boolean(variable)) ?? [];
                    const otherSelected = new Set(
                      Object.entries(columnToVariable)
                        .filter(([column, id]) => column !== header && id)
                        .map(([, id]) => id)
                        .filter((id) => variableById.has(id))
                    );
                    return (
                      <label key={header} className="block text-xs text-slate-300">
                        {header}
                        <select
                          value={columnToVariable[header] ?? ''}
                          onChange={(event) => {
                            const nextMapping = event.target.value;
                            invalidatePreparedReplay();
                            setColumnToVariable((current) => ({
                              ...current,
                              [header]: nextMapping,
                            }));
                          }}
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                        >
                          <option value="">Do not include</option>
                          <option value={`custom:${header}`}>Keep as custom sensor</option>
                          {variables.map((variable) => (
                            <option
                              key={variable.id}
                              value={variable.id}
                              disabled={otherSelected.has(variable.id)}
                            >
                              {variable.code} — {variable.name}
                            </option>
                          ))}
                          {TEP_BENCHMARK_FEATURE_IDS
                            .filter((featureId) => !variableById.has(featureId))
                            .map((featureId) => (
                              <option key={featureId} value={featureId}>
                                {featureId.replace('_', '(')}) — benchmark channel
                              </option>
                            ))}
                        </select>
                        {suggestedCandidates.length > 0 && (
                          <span className="mt-1 block text-[10px] text-cyan-300">
                            {suggestedCandidates.length === 1
                              ? `Alias match: ${suggestedCandidates[0].code} (${suggestion?.matchedAlias})`
                              : `Ambiguous "${suggestion?.matchedAlias}" — choose the correct TEP sensor or keep custom`}
                          </span>
                        )}
                        {suggestedCandidates.length === 0 && columnToVariable[header]?.startsWith('custom:') && (
                          <span className="mt-1 block text-[10px] text-slate-500">
                            No TEP alias match; this column will be preserved as a custom channel.
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={handleApplyMapping}
                  className="w-full rounded-lg bg-cyan-600 px-3 py-2 text-sm font-bold text-white hover:bg-cyan-500"
                >
                  Validate mapping and prepare replay
                </button>
                {samples.length > 0 && (
                  <label className="flex items-start gap-2 rounded-lg border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-200">
                    <input
                      type="checkbox"
                      checked={unitCompatibilityConfirmed}
                      onChange={(event) => setUnitCompatibilityConfirmed(event.target.checked)}
                      className="mt-0.5 accent-amber-400"
                    />
                    <span>
                      I verified that mapped CSV values use the same units as the selected TEP variables.
                      Enable reference-envelope observations.
                    </span>
                  </label>
                )}
              </div>

              <div className="overflow-auto rounded-lg border border-slate-800">
                <p className="border-b border-slate-800 px-3 py-2 text-xs font-semibold text-slate-300">
                  Preview — first 8 of {csv.rows.length.toLocaleString()} rows
                </p>
                <table className="w-full whitespace-nowrap text-left font-mono text-xs">
                  <thead className="bg-slate-950 text-slate-400">
                    <tr>{csv.headers.map((header) => <th key={header} className="px-3 py-2">{header}</th>)}</tr>
                  </thead>
                  <tbody>
                    {csv.rows.slice(0, 8).map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t border-slate-800/70">
                        {row.map((cell, cellIndex) => (
                          <td key={`${rowIndex}-${cellIndex}`} className="max-w-48 truncate px-3 py-2">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </section>

        {samples.length > 0 && (
          <>
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">2. Replay telemetry</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Sample {sampleIndex + 1} of {samples.length.toLocaleString()}
                    {currentSample && ` · ${new Date(currentSample.timestamp).toLocaleString()}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => { setPlaying(false); setSampleIndex(0); }} aria-label="Reset replay" className="rounded-lg border border-slate-700 p-2 hover:bg-slate-800"><RotateCcw className="h-4 w-4" /></button>
                  <button type="button" onClick={() => { setHasStartedReplay(true); setSampleIndex((index) => Math.min(index + 1, samples.length - 1)); }} aria-label="Step replay" className="rounded-lg border border-slate-700 p-2 hover:bg-slate-800"><SkipForward className="h-4 w-4" /></button>
                  <button type="button" onClick={() => { setHasStartedReplay(true); setPlaying((value) => !value); }} className="flex items-center gap-2 rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold hover:bg-cyan-600">
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    {playing ? 'Pause' : 'Play'}
                  </button>
                  <select aria-label="Replay speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm">
                    {[1, 5, 20].map((value) => <option key={value} value={value}>{value}×</option>)}
                  </select>
                </div>
              </div>
              <input
                aria-label="Replay timeline"
                type="range"
                min={0}
                max={samples.length - 1}
                value={sampleIndex}
                onChange={(event) => {
                  setPlaying(false);
                  setHasStartedReplay(true);
                  setSampleIndex(Number(event.target.value));
                }}
                className="mt-4 w-full accent-cyan-400"
              />
              {mappedChannels.length > 0 && (
                <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                  Chart sensor
                  <select value={activeChannel?.key ?? ''} onChange={(event) => setSelectedVariable(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm">
                    {mappedChannels.map((channel) => <option key={channel.key} value={channel.key}>{channel.label}</option>)}
                  </select>
                </label>
              )}
              {activeChannel && chartPoints && (
                <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-2">
                  <p className="px-2 pt-1 text-xs text-slate-400">
                    {activeChannel.label} trend · imported values, not live plant readings
                  </p>
                  <svg viewBox="0 0 1000 210" role="img" aria-label={`${activeChannel.label} replay trend`} className="mt-2 h-48 w-full">
                    <line x1="0" y1="25" x2="1000" y2="25" stroke="#334155" />
                    <line x1="0" y1="105" x2="1000" y2="105" stroke="#334155" />
                    <line x1="0" y1="185" x2="1000" y2="185" stroke="#334155" />
                    <polyline points={chartPoints} fill="none" stroke="#22d3ee" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                  </svg>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">First alarm → diagnosis</h3>
                  <p className="mt-1 max-w-3xl text-xs text-slate-400">
                    Runs PCA and autoencoder evidence over the loaded 52-variable history, finds the first persistent autoencoder alarm, then uses the configured post-alarm evidence window for XGBoost and TreeSHAP.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleClassifyReplayWindow()}
                    disabled={classifyingXgboost || sampleIndex !== samples.length - 1 || !xgboostFeaturesMapped}
                    className="rounded-lg border border-cyan-700 bg-cyan-950 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {classifyingXgboost ? 'Running PCA + AE → XGBoost…' : 'Run PCA + AE detection → XGBoost diagnosis'}
                  </button>
                </div>
              </div>
              {sampleIndex !== samples.length - 1 && <p className="mt-3 text-xs text-amber-300">Finish replaying this run before running the chronological first-alarm pipeline.</p>}
              {!xgboostFeaturesMapped && currentSample && (
                <p className="mt-3 text-xs text-amber-300">Map all 52 channels: XMEAS(1–41) and XMV(1–11).</p>
              )}
              {xgboostError && <p role="alert" className="mt-3 rounded border border-rose-800 bg-rose-950/50 p-2 text-xs text-rose-300">{xgboostError}</p>}
              {anomalyComparisonError && <p role="alert" className="mt-3 rounded border border-rose-800 bg-rose-950/50 p-2 text-xs text-rose-300">{anomalyComparisonError}</p>}
              {anomalyComparison && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {[
                    anomalyComparison.pca && {
                      title: 'PCA · Hotelling T² / SPE',
                      details: `T² ${anomalyComparison.pca.t2.toFixed(2)} / limit ${anomalyComparison.pca.t2Limit.toFixed(2)} · SPE ${anomalyComparison.pca.spe.toFixed(2)} / limit ${anomalyComparison.pca.speLimit.toFixed(2)}`,
                      alarm: anomalyComparison.pca.isAnomalous,
                      streak: anomalyComparison.pca.consecutiveViolations,
                      required: anomalyComparison.pca.persistenceRequired,
                    },
                    anomalyComparison.autoencoder && {
                      title: 'MLP autoencoder',
                      details: `Reconstruction error ${anomalyComparison.autoencoder.reconstructionError.toFixed(2)} / limit ${anomalyComparison.autoencoder.threshold.toFixed(2)}`,
                      alarm: anomalyComparison.autoencoder.isAnomalous,
                      streak: anomalyComparison.autoencoder.consecutiveViolations,
                      required: anomalyComparison.autoencoder.persistenceRequired,
                    },
                  ].filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => (
                    <article key={item.title} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                      <div className="flex justify-between gap-3">
                        <h4 className="text-xs font-semibold text-white">{item.title}</h4>
                        <span className={item.alarm ? 'text-xs font-bold text-rose-300' : 'text-xs font-bold text-emerald-300'}>
                          {item.alarm ? 'PERSISTENT ALERT' : 'NO PERSISTENT ALERT'}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-300">{item.details}</p>
                      <p className="mt-1 text-[10px] text-slate-500">Consecutive violations: {item.streak}/{item.required}</p>
                    </article>
                  ))}
                  {!anomalyComparison.pca && <p className="text-xs text-amber-300">PCA artifact not trained yet. Run <code>npm run ml:train-pca</code>.</p>}
                  {!anomalyComparison.autoencoder && <p className="text-xs text-amber-300">Autoencoder artifact not found.</p>}
                  <p className="text-[10px] text-slate-500 md:col-span-2">{anomalyComparison.note} This comparison does not dispatch an alert; the chronological first-alarm pipeline sends the single Operator notification.</p>
                </div>
              )}
              {firstAlarmPipeline && (
                <div className="mt-4 rounded-lg border border-cyan-900 bg-slate-950 p-3 text-xs">
                  {firstAlarmPipeline.status === 'PERSISTENT_ALARM' ? (
                    <>
                      <p className="font-semibold text-cyan-200">
                        Persistent alarm at sample {firstAlarmPipeline.firstAlarmIndex! + 1}
                        {' '}— error {firstAlarmPipeline.alarmScore?.toFixed(3)} / threshold {firstAlarmPipeline.threshold.toFixed(3)}
                      </p>
                      <p className="mt-1 text-slate-300">
                        Diagnosis window: samples {firstAlarmPipeline.windowStartIndex! + 1}–{firstAlarmPipeline.windowEndIndex! + 1}.
                        The persistent alarm was at sample {firstAlarmPipeline.firstAlarmIndex! + 1};{' '}
                        {firstAlarmPipeline.diagnosisDelayFallback
                          ? 'the configured delay did not fit in this replay, so XGBoost used the latest complete 25-sample window.'
                          : `XGBoost waited ${firstAlarmPipeline.diagnosisDelaySamples ?? 0} samples before classifying.`}
                      </p>
                      <p className="mt-1 text-slate-400">
                        {firstAlarmPipeline.alarm
                          ? `Operator alarm ${firstAlarmPipeline.alarm.id} created.`
                          : 'Persistent alarm found, but no new alarm record was created.'}
                        {firstAlarmPipeline.duplicate ? ' This replay alarm already existed.' : ''}
                      </p>
                      {firstAlarmPipeline.alarm && onOpenAlarmReview && <button type="button" onClick={onOpenAlarmReview} className="mt-2 rounded-md border border-cyan-800 bg-cyan-950/60 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-900">Open Operator alarm review</button>}
                      <p className="mt-1 text-slate-400">
                        {firstAlarmPipeline.operatorNotification
                          ? `n8n operator webhook: ${firstAlarmPipeline.operatorNotification.status}. Verify the n8n execution and recipient inbox separately.`
                          : 'No new n8n notification was sent for this duplicate incident.'}
                      </p>
                      <p className="mt-1 text-amber-300">XGBoost is a candidate for engineer review; TreeSHAP shows model contributions, not physical cause.</p>
                    </>
                  ) : firstAlarmPipeline.status === 'NO_PERSISTENT_ALARM' ? (
                    <p className="text-amber-200">No persistent autoencoder alarm in this run. XGBoost was not called and no operator alarm was created.</p>
                  ) : firstAlarmPipeline.status === 'DIAGNOSIS_PENDING' ? (
                    <p className="text-amber-200">Persistent alarm at sample {firstAlarmPipeline.firstAlarmIndex! + 1}. Diagnosis is pending until sample {(firstAlarmPipeline.diagnosisReadyAtIndex ?? firstAlarmPipeline.sampleCount - 1) + 1}; the operator alarm is created after the full replay supplies this evidence window.</p>
                  ) : (
                    <p className="text-amber-200">A persistent alarm occurred before a complete 25-sample diagnosis window was available; no diagnosis or operator alarm was created.</p>
                  )}
                </div>
              )}
              {xgboostResult && (
                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <p className="text-[10px] font-mono uppercase tracking-wide text-cyan-300">{xgboostResult.model} · {xgboostResult.explanationMethod}</p>
                    <h4 className="mt-2 text-lg font-bold text-white">
                      {xgboostResult.status === 'NORMAL' ? 'Normal class' : xgboostResult.status === 'UNKNOWN_FAULT' ? 'Unknown fault · needs review' : `Candidate IDV(${xgboostResult.faultId})`}
                    </h4>
                    <p className="mt-1 text-xs text-slate-400">
                      Fault score {(xgboostResult.faultScore * 100).toFixed(1)}% · candidate class score {(xgboostResult.classConfidence * 100).toFixed(1)}%
                    </p>
                    <p className="mt-3 text-[10px] text-amber-300">Candidate classification for the incident window. The benchmark run’s known fault label is hidden from this prediction.</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <h4 className="text-xs font-semibold text-white">Sensors influencing this class score</h4>
                    <div className="mt-2 space-y-2">
                      {xgboostResult.topSensors.map((item) => {
                        const variable = variableById.get(item.sensor);
                        const extent = Math.max(0.001, ...xgboostResult.topSensors.map((entry) => Math.abs(entry.contribution)));
                        return (
                          <div key={item.sensor} className="text-[10px]">
                            <div className="mb-1 flex justify-between gap-3 text-slate-300">
                              <span>{variable?.code ?? item.sensor}{variable ? ` · ${variable.name}` : ''}</span>
                              <span className="font-mono">{item.contribution >= 0 ? '+' : ''}{item.contribution.toFixed(4)}</span>
                            </div>
                            <div className="h-1.5 rounded bg-slate-800"><div className="h-full rounded bg-cyan-500" style={{ width: `${Math.max(2, Math.abs(item.contribution) / extent * 100)}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-[10px] text-slate-500">TreeSHAP describes model contributions; it does not prove cause. Model scores are not calibrated probabilities.</p>
                  </div>
                </div>
              )}
              {replayDraftMessage && (
                <div className={`mt-3 rounded-lg border p-3 text-xs ${replayDraftOrder ? 'border-amber-800 bg-amber-950/30 text-amber-200' : 'border-slate-700 bg-slate-950 text-slate-300'}`}>
                  <p>{replayDraftMessage}</p>
                  {replayDraftOrder && (
                    <p className="mt-1">Draft <strong>{replayDraftOrder.id}</strong> · {replayDraftOrder.riskBand} risk ({replayDraftOrder.riskScore}/100) · sent to Engineer Review in Maintenance Station.</p>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">3. Per-unit replay monitor</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Uses only this replay sample and mapped TEP channels. A flagged unit can be sent to its focused specialist and plant coordinator; replay never changes live simulator state.
                  </p>
                </div>
                <span className="rounded border border-amber-800 bg-amber-950/50 px-2 py-1 text-[10px] font-mono text-amber-300">
                  CSV REPLAY · NOT LIVE
                </span>
              </div>
              {!unitCompatibilityConfirmed && (
                <p className="mb-3 rounded-lg border border-amber-800/70 bg-amber-950/30 p-3 text-xs text-amber-200">
                  Values are shown without alarm classification until you confirm the mapped CSV units match the selected TEP variables.
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {replayUnitAssessments.map((assessment) => (
                  <article key={assessment.unit} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-xs font-bold text-white">{assessment.name}</h4>
                      <span className="text-[9px] font-mono text-slate-400">{assessment.status.replaceAll('_', ' ')}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {assessment.observedChannelCount}/{assessment.expectedChannelCount} monitored channels
                      {assessment.healthIndex !== null ? ` · health ${assessment.healthIndex}%` : ''}
                    </p>
                    <div className="mt-2 space-y-1">
                      {assessment.observations.length > 0 ? assessment.observations.map((observation) => (
                        <div key={observation.channelId} className="flex justify-between gap-2 text-[10px] font-mono">
                          <span className="text-slate-400">{observation.channelId}</span>
                          <span className={observation.alarm === 'NORMAL' ? 'text-cyan-300' : 'text-amber-300'}>
                            {observation.value.toFixed(2)} {observation.unit} · {observation.alarm}
                          </span>
                        </div>
                      )) : (
                        <p className="text-[10px] text-slate-500">No mapped unit channels in this sample.</p>
                      )}
                    </div>
                    {unitCompatibilityConfirmed && ['DEGRADED', 'CRITICAL'].includes(assessment.status) && assessment.observations.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleAnalyzeReplayUnit(assessment.unit)}
                        disabled={analyzingUnit !== null}
                        className="mt-3 w-full rounded border border-cyan-800 bg-cyan-950/50 px-2 py-1.5 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-900/60 disabled:opacity-50"
                      >
                        {analyzingUnit === assessment.unit ? 'Analyzing sample…' : `Analyze ${assessment.unit} sample`}
                      </button>
                    )}
                  </article>
                ))}
              </div>
              {eventAnalysisError && <p role="alert" className="mt-3 rounded border border-rose-800 bg-rose-950/50 p-2 text-xs text-rose-300">{eventAnalysisError}</p>}
              {Object.values(eventReports).map((report) => (
                <article key={report.executionId} className="mt-3 rounded-lg border border-cyan-900 bg-slate-950 p-3">
                  <p className="text-xs font-semibold text-cyan-200">{report.targetUnit} replay analysis · {report.agentExecutionMode === 'CREWAI_REMOTE' ? 'CrewAI' : 'local fallback'} · sample {new Date(report.telemetryTimestamp).toLocaleString()}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-300">{report.diagnosisEvidence.map((item, index) => <li key={`${report.executionId}-${index}`}>{item}</li>)}</ul>
                  <p className="mt-2 text-xs text-slate-300">Engineer review checks: {report.recommendedChecks.join(' · ')}</p>
                </article>
              ))}
              {unitCompatibilityConfirmed && (
                <p className="mt-3 text-[10px] text-slate-500">
                  Alarm labels compare against the app’s TEP reference envelope only. These are not site limits, approved alarms, or safety trips.
                </p>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <TriangleAlert className="h-4 w-4 text-amber-300" />
                    Replay incident timeline
                  </h3>
                  <p className="mt-1 max-w-3xl text-xs text-slate-400">
                    Timeline entries are local observations attached to this replay. Reference-envelope
                    entries are available only after you confirm compatible units; they are not live alarms,
                    fault diagnoses, or validated safety limits.
                  </p>
                </div>
                <span className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-300">
                  {timelineEntries.length} {timelineEntries.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleAddReviewNote();
                  }}
                  placeholder="Add a review note for the current replay timestamp..."
                  aria-label="Review note for current replay timestamp"
                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500"
                  disabled={!currentSample}
                />
                <button
                  type="button"
                  onClick={handleAddReviewNote}
                  disabled={!currentSample || !reviewNote.trim()}
                  className="flex items-center justify-center gap-2 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white enabled:hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <BookmarkPlus className="h-4 w-4" /> Add review marker
                </button>
              </div>

              {!unitCompatibilityConfirmed && (
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-400">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                  Confirm unit compatibility above to compare mapped TEP channels with their reference
                  warning/trip envelopes. Otherwise, use review markers to annotate events you identify.
                </p>
              )}

              {timelineEntries.length > 0 ? (
                <ol className="mt-4 space-y-2">
                  {timelineEntries.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectTimelineEntry(entry)}
                        className="flex w-full items-start gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-left hover:border-cyan-700"
                      >
                        <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                          entry.kind === 'trip'
                            ? 'bg-rose-400'
                            : entry.kind === 'warning'
                              ? 'bg-amber-400'
                              : entry.kind === 'recovered'
                                ? 'bg-emerald-400'
                                : 'bg-indigo-400'
                        }`} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                            <strong className="text-xs text-slate-100">{entry.title}</strong>
                            <time className="font-mono text-[10px] text-slate-500">
                              {new Date(entry.timestamp).toLocaleString()}
                            </time>
                          </span>
                          <span className="mt-1 block text-xs text-slate-400">{entry.detail}</span>
                          <span className="mt-1 block text-[10px] text-cyan-400">
                            Go to replay sample {entry.sampleIndex + 1}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
                  No timeline entries yet. Play or step through the data, then add a review marker.
                  If envelope comparison is enabled, this dataset may still have no transitions; that
                  alone does not establish that the equipment is normal.
                </p>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {mappedChannels.map((channel) => (
                <article key={channel.key} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <p className="text-xs text-slate-400">{channel.label}</p>
                  <p className="mt-2 font-mono text-xl font-bold text-cyan-300">
                    {currentSample?.values[channel.key]?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? '—'}
                    <span className="ml-1 text-xs font-normal text-slate-400">{channel.unit}</span>
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-amber-300">
                    {channel.variableId
                      ? 'Imported replay · semantic TEP mapping · verify units'
                      : 'Imported custom replay · not live'}
                  </p>
                </article>
              ))}
            </section>

            <section className="rounded-xl border border-violet-900/70 bg-violet-950/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-violet-100">Model performance · run-level evaluation</h3>
                  <p className="mt-1 text-xs text-slate-400">Held-out benchmark results for the detector and diagnosis pipeline; these describe many labelled runs, not the single CSV currently replaying.</p>
                </div>
                {modelPerformance && <span className="rounded-full border border-violet-800 bg-violet-950/60 px-2.5 py-1 text-[10px] text-violet-200">{modelPerformance.counts.faultRuns.toLocaleString()} fault + {modelPerformance.counts.normalRuns.toLocaleString()} normal runs</span>}
              </div>
              {modelPerformanceError && <p role="alert" className="mt-3 rounded border border-rose-800 bg-rose-950/50 p-2 text-xs text-rose-300">Evaluation metrics unavailable: {modelPerformanceError}</p>}
              {!modelPerformance && !modelPerformanceError && <p className="mt-3 text-xs text-slate-400">Loading saved evaluation metrics…</p>}
              {modelPerformance && <>
                <div className="mt-4">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Fault detection</h4>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {([
                      ['Accuracy', modelPerformance.detection.accuracy],
                      ['Precision', modelPerformance.detection.precision],
                      ['Recall / detection rate', modelPerformance.detection.recall],
                      ['Specificity', modelPerformance.detection.specificity],
                      ['F1 score', modelPerformance.detection.f1],
                      ['False alarm rate', modelPerformance.detection.falseAlarmRate],
                    ] as const).map(([label, value]) => <article key={label} className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"><p className="text-[10px] text-slate-400">{label}</p><p className="mt-1 font-mono text-xl font-bold text-violet-200">{value.toFixed(2)}%</p></article>)}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.3fr]">
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Fault diagnosis</h4>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                      <article className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"><p className="text-[10px] text-slate-400">Correct fault type among detected runs ({modelPerformance.diagnosis.correctAmongDetected.toLocaleString()} / {modelPerformance.counts.detectedFaultRuns.toLocaleString()})</p><p className="mt-1 font-mono text-xl font-bold text-emerald-300">{modelPerformance.diagnosis.conditionalAccuracy.toFixed(2)}%</p></article>
                      <article className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"><p className="text-[10px] text-slate-400">End-to-end correct diagnosis ({modelPerformance.diagnosis.endToEndCorrectDiagnoses.toLocaleString()} / {modelPerformance.counts.faultRuns.toLocaleString()} faulty runs)</p><p className="mt-1 font-mono text-xl font-bold text-emerald-300">{modelPerformance.diagnosis.endToEndCorrectRate.toFixed(2)}%</p></article>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Run-level detection counts</h4>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      {([
                        ['Detected fault (TP)', modelPerformance.counts.detectedFaultRuns],
                        ['Missed fault (FN)', modelPerformance.counts.missedFaultRuns],
                        ['False alarm (FP)', modelPerformance.counts.falseAlarms],
                        ['Correct normal (TN)', modelPerformance.counts.correctlyNormalRuns],
                      ] as const).map(([label, count]) => <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/80 p-3"><p className="text-[10px] text-slate-400">{label}</p><p className="mt-1 font-mono text-lg font-bold text-slate-100">{count.toLocaleString()}</p></div>)}
                    </div>
                    <p className="mt-2 text-[10px] text-slate-400">Mean detection delay after assumed fault onset: {modelPerformance.detection.meanDetectionDelaySamples?.toFixed(2) ?? '—'} samples.</p>
                  </div>
                </div>
                <p className="mt-4 rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-[10px] leading-5 text-amber-200">Source: {modelPerformance.evaluationSplit}; current app serving bundle, with a {modelPerformance.diagnosisDelaySamples ?? 'configured'}-sample diagnosis delay. These are run-level held-out results, not live accuracy for the uploaded file. The delay was selected during earlier test-split experiments, so treat these figures as provisional and confirm on an untouched evaluation split before making a final research-performance claim.</p>
              </>}
            </section>
          </>
        )}
      </section>
    </div>
  );
};
