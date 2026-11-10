import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessReplayUnits,
  buildReplaySamples,
  buildReplayEnvelopeEvents,
  createDefaultSensorMappings,
  matchSensorAlias,
  parseReplayTimestamp,
  parseTelemetryCsv,
  suggestSensorMapping,
} from './telemetryCsv.js';
import type { TEPVariable, UnitHealthState } from '../types/index.js';

test('parses quoted CSV fields and CRLF rows', () => {
  assert.deepEqual(
    parseTelemetryCsv('time,XMEAS_1,note\r\n1700000000,12.5,"steady, normal"\r\n'),
    {
      headers: ['time', 'XMEAS_1', 'note'],
      rows: [['1700000000', '12.5', 'steady, normal']],
    }
  );
});

test('rejects malformed CSV and duplicate headers', () => {
  assert.throws(() => parseTelemetryCsv('time,value\n1'), /same number of columns/);
  assert.throws(() => parseTelemetryCsv('time,time\n1,2'), /must be unique/);
  assert.throws(() => parseTelemetryCsv('time,note\n"1,open'), /unclosed quoted/);
});

test('converts timestamps in seconds and ISO date strings', () => {
  assert.equal(parseReplayTimestamp('1700000000'), 1_700_000_000_000);
  assert.equal(parseReplayTimestamp('2024-01-01T00:00:00Z'), Date.UTC(2024, 0, 1));
  assert.equal(parseReplayTimestamp('not-a-date'), null);
});

test('matches scoped physical aliases and leaves generic terms ambiguous', () => {
  const variables = [
    { id: 'XMEAS_7', code: 'XMEAS(7)' },
    { id: 'XMEAS_9', code: 'XMEAS(9)' },
    { id: 'XMEAS_11', code: 'XMEAS(11)' },
    { id: 'XMEAS_13', code: 'XMEAS(13)' },
  ];

  assert.deepEqual(suggestSensorMapping('reactor_temp_C', variables), {
    candidates: ['XMEAS_9'],
    matchedAlias: 'reactor temp',
  });
  assert.deepEqual(matchSensorAlias('pressure_kPa'), {
    candidates: ['XMEAS_7', 'XMEAS_13', 'XMEAS_16'],
    matchedAlias: 'pressure',
  });
  assert.equal(matchSensorAlias('vibration'), null);
});

test('automatically maps only unique aliases and preserves other columns as custom channels', () => {
  assert.deepEqual(
    createDefaultSensorMappings(
      ['timestamp', 'reactor_temp', 'pressure', 'vibration'],
      'timestamp',
      [
        { id: 'XMEAS_9', code: 'XMEAS(9)' },
        { id: 'XMEAS_7', code: 'XMEAS(7)' },
        { id: 'XMEAS_13', code: 'XMEAS(13)' },
      ]
    ),
    {
      reactor_temp: 'XMEAS_9',
      pressure: 'custom:pressure',
      vibration: 'custom:vibration',
    }
  );
});

test('validates mapped telemetry and builds replay samples', () => {
  const csv = parseTelemetryCsv('timestamp,reactor_temp\n1700000000,120.5\n1700000001,121');
  assert.deepEqual(buildReplaySamples(csv, 'timestamp', { reactor_temp: 'XMEAS_9' }), [
    { timestamp: 1_700_000_000_000, values: { XMEAS_9: 120.5 } },
    { timestamp: 1_700_000_001_000, values: { XMEAS_9: 121 } },
  ]);
  assert.throws(
    () =>
      buildReplaySamples(
        parseTelemetryCsv('timestamp,temp\n1700000000,hot'),
        'timestamp',
        { temp: 'XMEAS_9' }
      ),
    /expected a numeric sensor value/
  );
});

test('builds sorted replay envelope events for mapped TEP channels only', () => {
  const events = buildReplayEnvelopeEvents(
    [
      { timestamp: 1000, values: { XMEAS_9: 121, 'custom:vibration': 3 } },
      { timestamp: 2000, values: { XMEAS_9: 125, 'custom:vibration': 5 } },
      { timestamp: 3000, values: { XMEAS_9: 131, 'custom:vibration': 4 } },
      { timestamp: 4000, values: { XMEAS_9: 120, 'custom:vibration': 2 } },
    ],
    { reactor_temp: 'XMEAS_9', vibration: 'custom:vibration' },
    [{
      id: 'XMEAS_9',
      code: 'XMEAS(9)',
      name: 'Reactor temperature',
      unit: '°C',
      lowWarn: 115,
      highWarn: 124,
      lowTrip: 110,
      highTrip: 130,
    }]
  );

  assert.deepEqual(
    events.map(({ kind, sampleIndex, timestamp, value, reference }) => ({
      kind,
      sampleIndex,
      timestamp,
      value,
      reference,
    })),
    [
      { kind: 'warning', sampleIndex: 1, timestamp: 2000, value: 125, reference: 124 },
      { kind: 'trip', sampleIndex: 2, timestamp: 3000, value: 131, reference: 130 },
      { kind: 'recovered', sampleIndex: 3, timestamp: 4000, value: 120, reference: null },
    ]
  );
});

test('replay unit assessments require confirmation before applying TEP reference envelopes', () => {
  const mappedUnit: UnitHealthState = {
    unit: 'reactor',
    name: 'Chemical Reactor',
    monitoredChannels: ['XMEAS_9', 'XMEAS_7', 'XMEAS_28'],
    healthIndex: 100,
    status: 'OPTIMAL',
    activeAlarmsCount: 0,
    anomalyScore: 0,
    temperature: 120,
    pressure: 2700,
  };
  const variables: TEPVariable[] = [
    {
      id: 'XMEAS_9',
      code: 'XMEAS(9)',
      name: 'Reactor temperature',
      unit: '°C',
      nominal: 120,
      min: 90,
      max: 150,
      lowWarn: 115,
      highWarn: 124,
      lowTrip: 110,
      highTrip: 130,
      category: 'reactor',
      type: 'measurement',
      description: 'Reactor temperature',
    },
    {
      id: 'XMEAS_7',
      code: 'XMEAS(7)',
      name: 'Reactor pressure',
      unit: 'kPa',
      nominal: 2700,
      min: 2000,
      max: 3200,
      lowWarn: 2550,
      highWarn: 2850,
      lowTrip: 2300,
      highTrip: 3000,
      category: 'reactor',
      type: 'measurement',
      description: 'Reactor pressure',
    },
    {
      id: 'XMEAS_28',
      code: 'XMEAS(28)',
      name: 'Mismatched simulator label',
      unit: '%',
      nominal: 0,
      min: 0,
      max: 100,
      lowWarn: 0,
      highWarn: 100,
      lowTrip: 0,
      highTrip: 100,
      category: 'reactor',
      type: 'composition',
      description: 'Excluded mapping',
      benchmarkMapping: {
        status: 'excluded_semantic_mismatch',
        datasetColumn: 'XMEAS_28',
        reason: 'Semantic mismatch.',
      },
    },
  ];
  const sample = { timestamp: 1234, values: { XMEAS_9: 131, XMEAS_28: 20 } };

  const unconfirmed = assessReplayUnits(sample, [mappedUnit], variables, false)[0];
  assert.equal(unconfirmed.status, 'UNIT_COMPATIBILITY_REQUIRED');
  assert.equal(unconfirmed.healthIndex, null);
  assert.equal(unconfirmed.observations.length, 1);
  assert.equal(unconfirmed.observations[0].alarm, 'NOT_ASSESSED');

  const confirmed = assessReplayUnits(sample, [mappedUnit], variables, true)[0];
  assert.equal(confirmed.status, 'STABLE');
  assert.equal(confirmed.healthIndex, 70);
  assert.equal(confirmed.activeAlarmsCount, 1);
  assert.equal(confirmed.expectedChannelCount, 2);
  assert.equal(confirmed.observations[0].alarm, 'TRIP_HIGH');
});

test('replay unit assessments distinguish units with no mapped data', () => {
  const mappedUnit: UnitHealthState = {
    unit: 'compressor',
    name: 'Recycle Gas Compressor',
    monitoredChannels: ['XMEAS_20'],
    healthIndex: 100,
    status: 'OPTIMAL',
    activeAlarmsCount: 0,
    anomalyScore: 0,
    temperature: 0,
    pressure: 0,
  };

  const [assessment] = assessReplayUnits(
    { timestamp: 1234, values: { 'custom:vibration': 4 } },
    [mappedUnit],
    [],
    true,
  );
  assert.equal(assessment.status, 'NO_MAPPED_DATA');
  assert.equal(assessment.healthIndex, null);
  assert.equal(assessment.observedChannelCount, 0);
});
