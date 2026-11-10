import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MaintenanceWorkOrder } from '../agents/crewaiOrchestrator.ts';
import type { N8nWebhookEvent } from '../n8n/n8nService.ts';
import type { TelemetryPoint } from '../tep/tepSimulator.ts';

export type AuditCategory = 'telemetry' | 'fault' | 'maintenance' | 'dispatch' | 'system';
export type AuditStatus = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export interface AuditEntry {
  id: string;
  timestamp: number;
  category: AuditCategory;
  action: string;
  actor: string;
  entityType: string;
  entityId?: string;
  status: AuditStatus;
  details: Record<string, any>;
}

export interface AlarmReviewRecord {
  id: string;
  variableId: string;
  code: string;
  name: string;
  unit: string;
  category: string;
  alarm: 'WARN_LOW' | 'WARN_HIGH' | 'TRIP_LOW' | 'TRIP_HIGH';
  sourceFaults: Array<{ id: number; code: string; name: string; primaryUnit: string; keySensors: string[] }>;
  value: number;
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'CLEARED_PENDING_REVIEW' | 'RESOLVED' | 'ARCHIVED';
  firstSeenAt: number;
  lastSeenAt: number;
  note: string;
  acknowledgedBy?: string;
  resolvedBy?: string;
  reviewedBy?: string;
  source?: 'SIMULATOR' | 'TEP_CSV_REPLAY';
  sourceFingerprint?: string;
  modelDiagnosis?: {
    model: 'XGBoost';
    candidateFaultId: number;
    classConfidence: number;
    explanationMethod: 'TreeSHAP';
    topSensors: { sensor: string; contribution: number }[];
    firstAlarmSampleIndex: number;
  };
}

export interface PersistedState {
  lastUpdated: number;
  telemetryHistory: TelemetryPoint[];
  workOrders: MaintenanceWorkOrder[];
  n8nEvents: N8nWebhookEvent[];
  auditTrail: AuditEntry[];
  alarmReviews: AlarmReviewRecord[];
  authUsers: StoredAuthUser[];
}

export interface StoredAuthUser {
  id: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'ENGINEER' | 'OPERATOR' | 'TECHNICIAN';
  passwordSalt: string;
  passwordHash: string;
  active: boolean;
  createdAt: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const legacyStatePath = path.resolve(__dirname, 'digital_twin_state.json');
const defaultStateDirectory = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'DigitalTwinFactory')
  : path.join(os.homedir(), '.local', 'state', 'digital-twin-factory');
const statePath = process.env.DIGITAL_TWIN_STATE_PATH
  ? path.resolve(process.env.DIGITAL_TWIN_STATE_PATH)
  : path.join(defaultStateDirectory, 'digital_twin_state.json');

const emptyState = (): PersistedState => ({
  lastUpdated: Date.now(),
  telemetryHistory: [],
  workOrders: [],
  n8nEvents: [],
  auditTrail: [],
  alarmReviews: [],
  authUsers: [],
});

export class StateStore {
  private state: PersistedState = emptyState();

  constructor() {
    this.load();
  }

  public load(): PersistedState {
    try {
      const sourcePath = fs.existsSync(statePath)
        ? statePath
        : fs.existsSync(legacyStatePath)
          ? legacyStatePath
          : null;
      if (!sourcePath) {
        this.state = emptyState();
        this.persist();
        return this.state;
      }

      const raw = fs.readFileSync(sourcePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      this.state = {
        lastUpdated: Number(parsed.lastUpdated ?? Date.now()),
        telemetryHistory: Array.isArray(parsed.telemetryHistory) ? (parsed.telemetryHistory as TelemetryPoint[]) : [],
        workOrders: Array.isArray(parsed.workOrders) ? (parsed.workOrders as MaintenanceWorkOrder[]) : [],
        n8nEvents: Array.isArray(parsed.n8nEvents) ? (parsed.n8nEvents as N8nWebhookEvent[]) : [],
        auditTrail: Array.isArray(parsed.auditTrail) ? (parsed.auditTrail as AuditEntry[]) : [],
        alarmReviews: Array.isArray(parsed.alarmReviews) ? (parsed.alarmReviews as AlarmReviewRecord[]) : [],
        authUsers: Array.isArray(parsed.authUsers) ? (parsed.authUsers as StoredAuthUser[]) : [],
      };
      if (sourcePath !== statePath) this.persist();
    } catch (error) {
      console.warn('State persistence load failed, starting fresh.', error);
      this.state = emptyState();
      this.persist();
    }

    return this.state;
  }

  public getState(): PersistedState {
    return this.state;
  }

  public getTelemetryHistory(count?: number): TelemetryPoint[] {
    const history = this.state.telemetryHistory;
    return typeof count === 'number' ? history.slice(-count) : history;
  }

  public recordTelemetryHistory(history: TelemetryPoint[]): void {
    this.state.telemetryHistory = history.slice(-120);
    this.state.lastUpdated = Date.now();
    this.persist();
  }

  public getWorkOrders(): MaintenanceWorkOrder[] {
    return [...this.state.workOrders];
  }

  public storeWorkOrders(workOrders: MaintenanceWorkOrder[]): void {
    this.state.workOrders = [...workOrders];
    this.state.lastUpdated = Date.now();
    this.persist();
  }

  public getN8nEvents(limit = 50): N8nWebhookEvent[] {
    return this.state.n8nEvents.slice(0, limit);
  }

  public appendN8nEvent(event: N8nWebhookEvent): void {
    this.state.n8nEvents = [event, ...this.state.n8nEvents].slice(0, 50);
    this.state.lastUpdated = Date.now();
    this.persist();
  }

  public getAuditTrail(limit = 100): AuditEntry[] {
    return this.state.auditTrail.slice(0, limit);
  }

  public getAlarmReviews(): AlarmReviewRecord[] {
    return [...this.state.alarmReviews].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  public syncAlarmReviews(alarms: Array<Omit<AlarmReviewRecord, 'id' | 'status' | 'firstSeenAt' | 'lastSeenAt' | 'note'>>): AlarmReviewRecord[] {
    const now = Date.now();
    const created: AlarmReviewRecord[] = [];
    const activeByVariable = new Map(alarms.map((alarm) => [alarm.variableId, alarm]));
    const previousByVariable = new Map<string, AlarmReviewRecord>();
    for (const record of this.state.alarmReviews) {
      if (record.source === 'TEP_CSV_REPLAY') continue;
      if (!previousByVariable.has(record.variableId)) previousByVariable.set(record.variableId, record);
    }
    for (const [variableId, alarm] of activeByVariable) {
      const previous = previousByVariable.get(variableId);
      if (previous && previous.status !== 'RESOLVED' && previous.status !== 'ARCHIVED') {
        Object.assign(previous, alarm, { lastSeenAt: now });
        if (previous.status === 'CLEARED_PENDING_REVIEW') previous.status = 'ACTIVE';
      } else {
        const record: AlarmReviewRecord = {
          ...alarm,
          id: `ALM-${variableId}-${now.toString(36)}`,
          status: 'ACTIVE',
          firstSeenAt: now,
          lastSeenAt: now,
          note: '',
        };
        this.state.alarmReviews.unshift(record);
        created.push(record);
      }
    }
    for (const record of this.state.alarmReviews) {
      if (record.source !== 'TEP_CSV_REPLAY' && !activeByVariable.has(record.variableId) && record.status !== 'RESOLVED' && record.status !== 'ARCHIVED') {
        record.status = 'CLEARED_PENDING_REVIEW';
      }
    }
    this.state.alarmReviews = this.state.alarmReviews.slice(0, 200);
    this.state.lastUpdated = now;
    this.persist();
    return created;
  }

  public createReplayAlarmReview(input: {
    variableId: string;
    code: string;
    name: string;
    unit: string;
    category: string;
    value: number;
    fault: { id: number; code: string; name: string; primaryUnit: string; keySensors: string[] };
    fingerprint: string;
    modelDiagnosis: NonNullable<AlarmReviewRecord['modelDiagnosis']>;
  }): AlarmReviewRecord {
    const existing = this.state.alarmReviews.find((record) => record.source === 'TEP_CSV_REPLAY'
      && record.sourceFingerprint === input.fingerprint);
    if (existing) return existing;
    const now = Date.now();
    const record: AlarmReviewRecord = {
      id: `ALM-REPLAY-${now.toString(36).toUpperCase()}`,
      variableId: input.variableId,
      code: input.code,
      name: input.name,
      unit: input.unit,
      category: input.category,
      alarm: 'WARN_HIGH',
      sourceFaults: [input.fault],
      value: input.value,
      status: 'ACTIVE',
      firstSeenAt: now,
      lastSeenAt: now,
      note: `Imported TEP replay: persistent autoencoder alarm; XGBoost candidate ${input.fault.code}. Operator review required.`,
      source: 'TEP_CSV_REPLAY',
      sourceFingerprint: input.fingerprint,
      modelDiagnosis: input.modelDiagnosis,
    };
    this.state.alarmReviews = [record, ...this.state.alarmReviews].slice(0, 200);
    this.state.lastUpdated = now;
    this.persist();
    this.addAuditEvent({ category: 'fault', action: 'TEP_REPLAY_FIRST_ALARM_DETECTED', actor: 'ml-pipeline', entityType: 'alarm', entityId: record.id, status: 'SUCCESS', details: { fingerprint: input.fingerprint, variable: input.code, faultCandidate: input.fault.code, alarmSampleIndex: input.modelDiagnosis.firstAlarmSampleIndex, explanationMethod: 'TreeSHAP' } });
    return record;
  }

  public archiveOpenAlarmReviews(actor: string, reason: string): number {
    const now = Date.now();
    let archived = 0;
    for (const record of this.state.alarmReviews) {
      if (record.status === 'RESOLVED' || record.status === 'ARCHIVED') continue;
      record.status = 'ARCHIVED';
      record.resolvedBy = actor;
      record.note = reason;
      record.lastSeenAt = now;
      archived += 1;
    }
    if (archived > 0) {
      this.state.lastUpdated = now;
      this.persist();
    }
    return archived;
  }

  public updateAlarmReview(
    id: string,
    update: Partial<Pick<AlarmReviewRecord, 'status' | 'note' | 'acknowledgedBy' | 'resolvedBy' | 'reviewedBy'>>,
  ): AlarmReviewRecord | undefined {
    const record = this.state.alarmReviews.find((alarm) => alarm.id === id);
    if (!record) return undefined;
    Object.assign(record, update);
    this.state.lastUpdated = Date.now();
    this.persist();
    return record;
  }

  /** A replay has no live sensor recovery signal; only a linked technician repair report can advance it. */
  public markReplayAlarmRepairComplete(id: string, actor: string, repairNote: string): AlarmReviewRecord | undefined {
    const record = this.state.alarmReviews.find((alarm) => alarm.id === id && alarm.source === 'TEP_CSV_REPLAY');
    if (!record || ['RESOLVED', 'ARCHIVED'].includes(record.status)) return record;
    record.status = 'CLEARED_PENDING_REVIEW';
    record.lastSeenAt = Date.now();
    record.note = `Replay repair reported by ${actor}: ${repairNote}`;
    this.state.lastUpdated = Date.now();
    this.persist();
    this.addAuditEvent({ category: 'maintenance', action: 'TEP_REPLAY_REPAIR_REPORTED', actor, entityType: 'alarm', entityId: id, status: 'SUCCESS', details: { note: repairNote, source: 'TEP_CSV_REPLAY' } });
    return record;
  }

  public addAuditEvent(event: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const auditEntry: AuditEntry = {
      ...event,
      id: `AUD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      timestamp: Date.now(),
    };

    this.state.auditTrail = [auditEntry, ...this.state.auditTrail].slice(0, 200);
    this.state.lastUpdated = Date.now();
    this.persist();
    return auditEntry;
  }

  public getAuthUsers(): StoredAuthUser[] {
    return [...this.state.authUsers];
  }

  public storeAuthUsers(users: StoredAuthUser[]): void {
    this.state.authUsers = [...users];
    this.state.lastUpdated = Date.now();
    this.persist();
  }

  public reset(): void {
    this.state = emptyState();
    this.persist();
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error('Failed to persist state store.', error);
    }
  }
}

export const stateStore = new StateStore();
