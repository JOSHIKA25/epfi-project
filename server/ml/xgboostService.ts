export interface XGBoostExplanationResponse {
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
  validation: {
    status: string;
    faultDetectionRate: number;
    falseAlarmRate: number;
  };
}

export interface BenchmarkAnomalyComparison {
  source: 'IMPORTED_TEP_CSV_REPLAY';
  sampleCount: number;
  pca: null | {
    method: string; status: string; t2: number; t2Limit: number; spe: number; speLimit: number;
    consecutiveViolations: number; persistenceRequired: number; isAnomalous: boolean; calibrationQuantile: number;
  };
  autoencoder: null | {
    method: string; status: string; reconstructionError: number; threshold: number;
    consecutiveViolations: number; persistenceRequired: number; isAnomalous: boolean;
  };
  note: string;
}

export interface FirstAlarmPipelineResult {
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
  diagnosis: XGBoostExplanationResponse | null;
}

function serviceBaseUrl(): string {
  return (process.env.XGBOOST_SERVICE_URL || process.env.CREWAI_SERVICE_URL || 'http://127.0.0.1:8000')
    .replace(/\/+$/, '');
}

export async function getXGBoostHealth(): Promise<{ status: string; model: string }> {
  const response = await fetch(`${serviceBaseUrl()}/ml/health`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`ML service returned HTTP ${response.status}.`);
  return await response.json() as { status: string; model: string };
}

export async function classifyXGBoostWindow(
  history: Array<{ values: Record<string, number> }>,
): Promise<XGBoostExplanationResponse> {
  const response = await fetch(`${serviceBaseUrl()}/ml/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history: history.slice(-25) }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as { detail?: string } & Partial<XGBoostExplanationResponse>;
  if (!response.ok) {
    throw new Error(payload.detail || `ML service returned HTTP ${response.status}.`);
  }
  if (payload.model !== 'XGBoost' || payload.explanationMethod !== 'TreeSHAP') {
    throw new Error('ML service returned an unexpected model or explanation format.');
  }
  return payload as XGBoostExplanationResponse;
}

export async function compareBenchmarkAnomaly(
  history: Array<{ values: Record<string, number> }>,
): Promise<BenchmarkAnomalyComparison> {
  const response = await fetch(`${serviceBaseUrl()}/ml/anomaly/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as { detail?: string } & Partial<BenchmarkAnomalyComparison>;
  if (!response.ok) throw new Error(payload.detail || `ML service returned HTTP ${response.status}.`);
  if (payload.source !== 'IMPORTED_TEP_CSV_REPLAY') throw new Error('ML service returned an unexpected anomaly source.');
  return payload as BenchmarkAnomalyComparison;
}

export async function detectAndDiagnoseFirstAlarm(
  history: Array<{ values: Record<string, number> }>,
  finalReplay = false,
): Promise<FirstAlarmPipelineResult> {
  const response = await fetch(`${serviceBaseUrl()}/ml/pipeline/first-alarm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, finalReplay }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => ({})) as { detail?: string } & Partial<FirstAlarmPipelineResult>;
  if (!response.ok) throw new Error(payload.detail || `ML service returned HTTP ${response.status}.`);
  if (payload.featureCount !== 52 || !['NO_PERSISTENT_ALARM', 'ALARM_WINDOW_UNAVAILABLE', 'DIAGNOSIS_PENDING', 'PERSISTENT_ALARM'].includes(String(payload.status))) {
    throw new Error('ML service returned an unexpected 52-variable first-alarm result.');
  }
  if (payload.status === 'PERSISTENT_ALARM'
    && (!payload.diagnosis || payload.diagnosis.model !== 'XGBoost' || payload.diagnosis.explanationMethod !== 'TreeSHAP')) {
    throw new Error('The alarm event is missing its XGBoost and TreeSHAP diagnosis.');
  }
  return payload as FirstAlarmPipelineResult;
}
