import type { TEPVariable, UnitHealthState } from '../types/index.js';

export interface ParsedTelemetryCsv {
  headers: string[];
  rows: string[][];
}

export interface ReplaySample {
  timestamp: number;
  values: Record<string, number>;
}

export interface ReplayEnvelopeEvent {
  id: string;
  sampleIndex: number;
  timestamp: number;
  variableId: string;
  code: string;
  name: string;
  value: number;
  unit: string;
  kind: 'warning' | 'trip' | 'recovered';
  reference: number | null;
}

export interface ReplayUnitAssessment {
  unit: string;
  name: string;
  status: 'UNIT_COMPATIBILITY_REQUIRED' | 'NO_MAPPED_DATA' | UnitHealthState['status'];
  healthIndex: number | null;
  activeAlarmsCount: number;
  observedChannelCount: number;
  expectedChannelCount: number;
  observations: {
    channelId: string;
    value: number;
    unit: string;
    alarm: 'NOT_ASSESSED' | 'NORMAL' | 'WARN_LOW' | 'WARN_HIGH' | 'TRIP_LOW' | 'TRIP_HIGH';
  }[];
}

export interface SensorAliasMatch {
  candidates: string[];
  matchedAlias: string;
}

export const MAX_CSV_ROWS = 10_000;
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const TEP_BENCHMARK_FEATURE_IDS = [
  ...Array.from({ length: 41 }, (_, index) => `XMEAS_${index + 1}`),
  ...Array.from({ length: 11 }, (_, index) => `XMV_${index + 1}`),
];

const SENSOR_ALIASES: Record<string, string[]> = {
  'a feed flow': ['XMEAS_1'],
  'reactant a feed': ['XMEAS_1'],
  'd feed flow': ['XMEAS_2'],
  'reactant d feed': ['XMEAS_2'],
  'e feed flow': ['XMEAS_3'],
  'reactant e feed': ['XMEAS_3'],
  'ac feed flow': ['XMEAS_4'],
  'a c feed flow': ['XMEAS_4'],
  'recycle flow': ['XMEAS_5'],
  'reactor feed flow': ['XMEAS_6'],
  'reactor feed rate': ['XMEAS_6'],
  'reactor pressure': ['XMEAS_7'],
  'reactor level': ['XMEAS_8'],
  'reactor temperature': ['XMEAS_9'],
  'reactor temp': ['XMEAS_9'],
  'purge flow': ['XMEAS_10'],
  'separator temperature': ['XMEAS_11'],
  'separator temp': ['XMEAS_11'],
  'separator level': ['XMEAS_12'],
  'separator pressure': ['XMEAS_13'],
  'separator underflow': ['XMEAS_14'],
  'stripper level': ['XMEAS_15'],
  'stripper pressure': ['XMEAS_16'],
  'stripper underflow': ['XMEAS_17'],
  'stripper temperature': ['XMEAS_18'],
  'stripper temp': ['XMEAS_18'],
  'steam flow': ['XMEAS_19'],
  'compressor power': ['XMEAS_20'],
  'compressor work': ['XMEAS_20'],
  'reactor cooling water outlet temperature': ['XMEAS_21'],
  'reactor cooling water outlet temp': ['XMEAS_21'],
  'condenser cooling water outlet temperature': ['XMEAS_22'],
  'condenser cooling water outlet temp': ['XMEAS_22'],
  'reactor feed component a': ['XMEAS_23'],
  'reactor feed component b': ['XMEAS_24'],
  'reactor feed component c': ['XMEAS_25'],
  'reactor feed component d': ['XMEAS_26'],
  'reactor feed component e': ['XMEAS_27'],
  'purge component a': ['XMEAS_28'],
  'product purity': ['XMEAS_29'],
  'd feed valve': ['XMV_1'],
  'e feed valve': ['XMV_2'],
  'a feed valve': ['XMV_3'],
  'total feed valve': ['XMV_4'],
  'recycle valve': ['XMV_5'],
  'purge valve': ['XMV_6'],
  'separator underflow valve': ['XMV_7'],
  'stripper underflow valve': ['XMV_8'],
  'stripper steam valve': ['XMV_9'],
  'reactor cooling water valve': ['XMV_10'],
  'condenser cooling water valve': ['XMV_11'],
  'agitator speed': ['XMV_12'],
  temperature: ['XMEAS_9', 'XMEAS_11', 'XMEAS_18', 'XMEAS_21', 'XMEAS_22'],
  temp: ['XMEAS_9', 'XMEAS_11', 'XMEAS_18', 'XMEAS_21', 'XMEAS_22'],
  pressure: ['XMEAS_7', 'XMEAS_13', 'XMEAS_16'],
  level: ['XMEAS_8', 'XMEAS_12', 'XMEAS_15'],
  flow: ['XMEAS_1', 'XMEAS_2', 'XMEAS_3', 'XMEAS_4', 'XMEAS_5', 'XMEAS_6', 'XMEAS_10', 'XMEAS_14', 'XMEAS_17', 'XMEAS_19'],
};

export function normalizeSensorName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_()[\]{}-]+/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function matchSensorAlias(header: string): SensorAliasMatch | null {
  const normalizedHeader = normalizeSensorName(header);
  const directAlias = SENSOR_ALIASES[normalizedHeader];
  if (directAlias) {
    return { candidates: directAlias, matchedAlias: normalizedHeader };
  }

  const normalizedAliases = Object.keys(SENSOR_ALIASES)
    .filter((alias) => ` ${normalizedHeader} `.includes(` ${alias} `))
    .sort((left, right) => right.length - left.length);
  const longestAlias = normalizedAliases[0];
  if (!longestAlias) return null;
  const candidates = SENSOR_ALIASES[longestAlias];
  return { candidates, matchedAlias: longestAlias };
}

export function suggestSensorMapping(
  header: string,
  variables: Array<{ id: string; code: string }>
): SensorAliasMatch | null {
  const normalizedHeader = normalizeSensorName(header);
  const exactVariable = variables.find(
    (variable) =>
      normalizeSensorName(variable.id) === normalizedHeader
      || normalizeSensorName(variable.code) === normalizedHeader
  );
  if (exactVariable) {
    return { candidates: [exactVariable.id], matchedAlias: exactVariable.code };
  }
  const benchmarkCode = header.toUpperCase().replace(/[()\s-]/g, '_').replace(/_+/g, '_');
  const benchmarkMatch = /^(XMEAS|XMV)_?(\d+)$/.exec(benchmarkCode);
  if (benchmarkMatch) {
    const index = Number(benchmarkMatch[2]);
    const valid = benchmarkMatch[1] === 'XMEAS' ? index >= 1 && index <= 41 : index >= 1 && index <= 11;
    if (valid) return { candidates: [`${benchmarkMatch[1]}_${index}`], matchedAlias: `${benchmarkMatch[1]}(${index})` };
  }
  return matchSensorAlias(header);
}

export function createDefaultSensorMappings(
  headers: string[],
  timestampColumn: string,
  variables: Array<{ id: string; code: string }>
): Record<string, string> {
  const defaults: Record<string, string> = {};
  const availableVariables = new Set([...variables.map(({ id }) => id), ...TEP_BENCHMARK_FEATURE_IDS]);
  for (const header of headers) {
    if (header === timestampColumn) continue;
    const candidates = suggestSensorMapping(header, variables)
      ?.candidates.filter((id) => availableVariables.has(id)) ?? [];
    defaults[header] = candidates.length === 1
      ? candidates[0]
      : `custom:${header}`;
  }
  return defaults;
}

export function parseTelemetryCsv(
  text: string,
  maxRows = MAX_CSV_ROWS
): ParsedTelemetryCsv {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (insideQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      insideQuotes = true;
    } else if (char === ',') {
      record.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      record.push(field.trim());
      field = '';
      if (record.some((value) => value.length > 0)) {
        records.push(record);
        if (records.length > maxRows + 1) {
          throw new Error(`CSV exceeds the ${maxRows.toLocaleString()} data-row limit.`);
        }
      }
      record = [];
      if (char === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      field += char;
    }
  }

  if (insideQuotes) throw new Error('CSV contains an unclosed quoted field.');
  record.push(field.trim());
  if (record.some((value) => value.length > 0)) records.push(record);

  const [headers, ...rows] = records;
  if (!headers?.length || headers.every((header) => !header)) {
    throw new Error('CSV must include a header row.');
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error('CSV column names must be unique.');
  }
  if (rows.length === 0) throw new Error('CSV has headers but no data rows.');
  if (rows.length > maxRows) {
    throw new Error(`CSV exceeds the ${maxRows.toLocaleString()} data-row limit.`);
  }
  if (rows.some((row) => row.length !== headers.length)) {
    throw new Error('CSV rows must all have the same number of columns as the header.');
  }

  return { headers, rows };
}

export function parseReplayTimestamp(value: string): number | null {
  const numericValue = Number(value);
  if (value.trim() !== '' && Number.isFinite(numericValue)) {
    return Math.abs(numericValue) < 100_000_000_000
      ? numericValue * 1000
      : numericValue;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildReplaySamples(
  csv: ParsedTelemetryCsv,
  timestampColumn: string,
  columnToVariable: Record<string, string>
): ReplaySample[] {
  const timestampIndex = csv.headers.indexOf(timestampColumn);
  if (timestampIndex < 0) throw new Error('Select a timestamp column.');

  const mappings = Object.entries(columnToVariable)
    .filter(([, variableId]) => variableId)
    .map(([column, variableId]) => ({
      column,
      variableId,
      index: csv.headers.indexOf(column),
    }));
  if (mappings.length === 0) throw new Error('Map at least one CSV column to a sensor.');
  if (new Set(mappings.map(({ variableId }) => variableId)).size !== mappings.length) {
    throw new Error('Each sensor can only be mapped from one CSV column.');
  }

  return csv.rows.map((row, rowIndex) => {
    const timestamp = parseReplayTimestamp(row[timestampIndex]);
    if (timestamp === null) {
      throw new Error(`Row ${rowIndex + 2}: invalid timestamp "${row[timestampIndex]}".`);
    }
    const values: Record<string, number> = {};
    for (const mapping of mappings) {
      const rawValue = row[mapping.index];
      const value = Number(rawValue);
      if (rawValue === '' || !Number.isFinite(value)) {
        throw new Error(
          `Row ${rowIndex + 2}, "${mapping.column}": expected a numeric sensor value.`
        );
      }
      values[mapping.variableId] = value;
    }
    return { timestamp, values };
  });
}

export function buildReplayEnvelopeEvents(
  samples: ReplaySample[],
  columnToVariable: Record<string, string>,
  variables: Array<{
    id: string;
    code: string;
    name: string;
    unit: string;
    lowWarn: number;
    highWarn: number;
    lowTrip: number;
    highTrip: number;
  }>
): ReplayEnvelopeEvent[] {
  const variablesById = new Map(variables.map((variable) => [variable.id, variable]));
  const events: ReplayEnvelopeEvent[] = [];

  for (const variableId of Object.values(columnToVariable)) {
    const variable = variablesById.get(variableId);
    if (!variable) continue;

    let previousKind: ReplayEnvelopeEvent['kind'] | null = null;
    for (const [sampleIndex, sample] of samples.entries()) {
      const value = sample.values[variableId];
      if (!Number.isFinite(value)) continue;

      let kind: ReplayEnvelopeEvent['kind'] | null = null;
      let reference: number | null = null;
      if (value <= variable.lowTrip) {
        kind = 'trip';
        reference = variable.lowTrip;
      } else if (value >= variable.highTrip) {
        kind = 'trip';
        reference = variable.highTrip;
      } else if (value <= variable.lowWarn) {
        kind = 'warning';
        reference = variable.lowWarn;
      } else if (value >= variable.highWarn) {
        kind = 'warning';
        reference = variable.highWarn;
      }

      if (kind !== previousKind) {
        if (kind || previousKind) {
          events.push({
            id: `${variableId}:${sampleIndex}:${kind ?? 'recovered'}`,
            sampleIndex,
            timestamp: sample.timestamp,
            variableId,
            code: variable.code,
            name: variable.name,
            value,
            unit: variable.unit,
            kind: kind ?? 'recovered',
            reference,
          });
        }
        previousKind = kind;
      }
    }
  }

  return events.sort((left, right) =>
    left.timestamp - right.timestamp || left.sampleIndex - right.sampleIndex
  );
}

export function assessReplayUnits(
  sample: ReplaySample,
  unitHealth: UnitHealthState[],
  variables: TEPVariable[],
  unitCompatibilityConfirmed: boolean,
): ReplayUnitAssessment[] {
  const variablesById = new Map(variables.map((variable) => [variable.id, variable]));

  return unitHealth.map((unit) => {
    const usableChannels = unit.monitoredChannels
      .map((channelId) => ({
        channelId,
        variable: variablesById.get(channelId),
        value: sample.values[channelId],
      }))
      .filter(({ variable, value }) =>
        variable !== undefined
        && Number.isFinite(value)
        && variable.benchmarkMapping?.status !== 'excluded_semantic_mismatch'
        && variable.benchmarkMapping?.status !== 'not_available_in_training_data'
      );

    const observations = usableChannels.map(({ channelId, variable, value }) => {
      if (!variable || !unitCompatibilityConfirmed) {
        return {
          channelId,
          value,
          unit: variable?.unit ?? 'unknown',
          alarm: 'NOT_ASSESSED' as const,
        };
      }

      let alarm: ReplayUnitAssessment['observations'][number]['alarm'] = 'NORMAL';
      if (value <= variable.lowTrip) alarm = 'TRIP_LOW';
      else if (value >= variable.highTrip) alarm = 'TRIP_HIGH';
      else if (value <= variable.lowWarn) alarm = 'WARN_LOW';
      else if (value >= variable.highWarn) alarm = 'WARN_HIGH';

      return { channelId, value, unit: variable.unit, alarm };
    });

    const alarmPoints = observations.reduce((total, observation) => {
      if (observation.alarm === 'TRIP_HIGH' || observation.alarm === 'TRIP_LOW') return total + 30;
      if (observation.alarm === 'WARN_HIGH' || observation.alarm === 'WARN_LOW') return total + 12;
      return total;
    }, 0);
    const healthIndex = observations.length > 0
      ? Math.max(5, Math.min(100, Math.round(100 - alarmPoints)))
      : null;

    let status: ReplayUnitAssessment['status'];
    if (observations.length === 0) status = 'NO_MAPPED_DATA';
    else if (!unitCompatibilityConfirmed) status = 'UNIT_COMPATIBILITY_REQUIRED';
    else if (healthIndex !== null && healthIndex < 40) status = 'CRITICAL';
    else if (healthIndex !== null && healthIndex < 70) status = 'DEGRADED';
    else if (healthIndex !== null && healthIndex < 90) status = 'STABLE';
    else status = 'OPTIMAL';

    return {
      unit: unit.unit,
      name: unit.name,
      status,
      healthIndex: unitCompatibilityConfirmed ? healthIndex : null,
      activeAlarmsCount: observations.filter(
        ({ alarm }) => alarm !== 'NORMAL' && alarm !== 'NOT_ASSESSED'
      ).length,
      observedChannelCount: observations.length,
      expectedChannelCount: unit.monitoredChannels.filter((channelId) => {
        const variable = variablesById.get(channelId);
        return variable !== undefined
          && variable.benchmarkMapping?.status !== 'excluded_semantic_mismatch'
          && variable.benchmarkMapping?.status !== 'not_available_in_training_data';
      }).length,
      observations,
    };
  });
}
