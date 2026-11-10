import assert from 'node:assert/strict';
import test from 'node:test';
import { assessUnitAgents } from './unitAgents.ts';
import type { TelemetryPoint, UnitHealthState } from './tepSimulator.ts';

function unit(status: UnitHealthState['status']): UnitHealthState {
  return {
    unit: 'reactor',
    name: 'Chemical Reactor',
    monitoredChannels: ['XMEAS_7', 'XMEAS_9'],
    healthIndex: status === 'CRITICAL' ? 5 : 100,
    status,
    activeAlarmsCount: status === 'CRITICAL' ? 1 : 0,
    anomalyScore: status === 'CRITICAL' ? 95 : 0,
    temperature: 120,
    pressure: 2700,
  };
}

const telemetry: TelemetryPoint = {
  timestamp: 1234,
  step: 8,
  values: { XMEAS_7: 2700, XMEAS_9: 121 },
  alarms: { XMEAS_7: 'TRIP_HIGH', XMEAS_9: 'NORMAL' },
  activeFaults: [],
  faultIntensity: 1,
};

test('unit monitor reports its mapped live values and existing alarm labels', () => {
  const [assessment] = assessUnitAgents(telemetry, [unit('CRITICAL')], 4321);

  assert.equal(assessment.agentName, 'Chemical Reactor Monitor');
  assert.equal(assessment.telemetryTimestamp, 1234);
  assert.equal(assessment.generatedAt, 4321);
  assert.equal(assessment.dataSource, 'SIMULATED_TEP');
  assert.equal(assessment.authority, 'ADVISORY_ONLY');
  assert.equal(assessment.status, 'URGENT_REVIEW');
  assert.deepEqual(assessment.observations, [
    { channelId: 'XMEAS_7', value: 2700, alarm: 'TRIP_HIGH' },
    { channelId: 'XMEAS_9', value: 121, alarm: 'NORMAL' },
  ]);
  assert.match(assessment.recommendation, /operator/);
});

test('unit monitor does not create a flow gate or control action', () => {
  const assessments = assessUnitAgents(telemetry, [unit('OPTIMAL')]);

  assert.equal(assessments[0].status, 'MONITORING');
  assert.equal(assessments[0].authority, 'ADVISORY_ONLY');
  assert.equal('actuatorCommand' in assessments[0], false);
  assert.equal('flowPermission' in assessments[0], false);
});

test('unit monitor marks missing channel values as unavailable', () => {
  const incomplete: TelemetryPoint = {
    ...telemetry,
    values: { XMEAS_7: Number.NaN },
    alarms: {},
  };
  const [assessment] = assessUnitAgents(incomplete, [unit('STABLE')]);

  assert.equal(assessment.observations[0].value, null);
  assert.equal(assessment.observations[0].alarm, 'UNAVAILABLE');
  assert.equal(assessment.status, 'REVIEW');
  assert.equal(assessment.dataQuality, 'INCOMPLETE');
  assert.equal(assessment.healthIndex, null);
  assert.deepEqual(assessment.missingChannels, ['XMEAS_7', 'XMEAS_9']);
});

test('upstream alarm holds dependent digital reviews without controlling equipment', () => {
  const health = [
    { ...unit('CRITICAL'), unit: 'reactor', name: 'Reactor' },
    { ...unit('OPTIMAL'), unit: 'condenser', name: 'Condenser' },
    { ...unit('OPTIMAL'), unit: 'separator', name: 'Separator' },
    { ...unit('OPTIMAL'), unit: 'stripper', name: 'Stripper' },
    { ...unit('OPTIMAL'), unit: 'compressor', name: 'Compressor' },
  ];
  const assessments = assessUnitAgents(telemetry, health, 4321);
  const assessmentByUnit = new Map(assessments.map((assessment) => [assessment.unit, assessment]));

  assert.equal(assessmentByUnit.get('reactor')?.digitalGate, 'HOLD_REVIEW');
  assert.equal(assessmentByUnit.get('condenser')?.digitalGate, 'HOLD_REVIEW');
  assert.deepEqual(assessmentByUnit.get('condenser')?.blockedByUnits, ['reactor']);
  assert.equal(assessmentByUnit.get('separator')?.digitalGate, 'HOLD_REVIEW');
  assert.deepEqual(assessmentByUnit.get('separator')?.blockedByUnits, ['condenser']);
  assert.equal(assessmentByUnit.get('stripper')?.digitalGate, 'HOLD_REVIEW');
  assert.equal(assessmentByUnit.get('compressor')?.digitalGate, 'HOLD_REVIEW');
  assert.match(assessmentByUnit.get('compressor')?.recommendation ?? '', /does not stop or control physical process flow/);
});

test('healthy upstream assessments leave dependent digital reviews ready', () => {
  const health = [
    { ...unit('OPTIMAL'), unit: 'reactor', name: 'Reactor' },
    { ...unit('OPTIMAL'), unit: 'condenser', name: 'Condenser' },
    { ...unit('OPTIMAL'), unit: 'separator', name: 'Separator' },
    { ...unit('OPTIMAL'), unit: 'stripper', name: 'Stripper' },
    { ...unit('OPTIMAL'), unit: 'compressor', name: 'Compressor' },
  ];

  assert.ok(assessUnitAgents(telemetry, health).every(({ digitalGate }) => digitalGate === 'READY'));
});

test('review holds propagate on a fault and clear after all upstream units recover', () => {
  const healthFor = (statuses: Record<string, UnitHealthState['status']>) => (
    ['reactor', 'condenser', 'separator', 'stripper', 'compressor'].map((name) => ({
      ...unit(statuses[name] ?? 'OPTIMAL'),
      unit: name,
      name,
    }))
  );
  const gatesByUnit = (statuses: Record<string, UnitHealthState['status']>) => (
    new Map(
      assessUnitAgents(telemetry, healthFor(statuses))
        .map(({ unit: unitName, digitalGate, blockedByUnits }) => [
          unitName,
          { digitalGate, blockedByUnits },
        ])
    )
  );

  const normalRun = gatesByUnit({});
  assert.ok([...normalRun.values()].every(({ digitalGate }) => digitalGate === 'READY'));

  const reactorFault = gatesByUnit({ reactor: 'DEGRADED' });
  assert.equal(reactorFault.get('reactor')?.digitalGate, 'HOLD_REVIEW');
  assert.equal(reactorFault.get('condenser')?.digitalGate, 'HOLD_REVIEW');
  assert.equal(reactorFault.get('separator')?.digitalGate, 'HOLD_REVIEW');
  assert.equal(reactorFault.get('stripper')?.digitalGate, 'HOLD_REVIEW');
  assert.equal(reactorFault.get('compressor')?.digitalGate, 'HOLD_REVIEW');

  const partialRecovery = gatesByUnit({
    reactor: 'OPTIMAL',
    condenser: 'CRITICAL',
  });
  assert.equal(partialRecovery.get('condenser')?.digitalGate, 'HOLD_REVIEW');
  assert.equal(partialRecovery.get('separator')?.digitalGate, 'HOLD_REVIEW');
  assert.deepEqual(partialRecovery.get('separator')?.blockedByUnits, ['condenser']);
  assert.equal(partialRecovery.get('stripper')?.digitalGate, 'HOLD_REVIEW');
  assert.equal(partialRecovery.get('compressor')?.digitalGate, 'HOLD_REVIEW');

  const fullyRecovered = gatesByUnit({});
  assert.ok([...fullyRecovered.values()].every(({ digitalGate }) => digitalGate === 'READY'));
});

test('missing upstream unit assessment holds dependent digital reviews', () => {
  const health = [{ ...unit('OPTIMAL'), unit: 'condenser', name: 'Condenser' }];

  const [assessment] = assessUnitAgents(telemetry, health);
  assert.equal(assessment.digitalGate, 'HOLD_REVIEW');
  assert.deepEqual(assessment.blockedByUnits, ['reactor']);
});
