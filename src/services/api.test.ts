import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from './api.js';

test('plant-state API explains when the running backend predates unit assessments', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    telemetry: {},
    unitHealth: [],
    activeFaults: [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  await assert.rejects(
    api.fetchPlantState(),
    /outdated telemetry API.*Stop the app server, run "npm run dev" again/s,
  );
});

test('plant-state API accepts a response containing unit-agent assessments', async (context) => {
  const expected = {
    telemetry: { timestamp: 1, step: 1, values: {}, alarms: {}, activeFaults: [], faultIntensity: 1 },
    unitHealth: [],
    unitAgents: [],
    activeFaults: [],
  };
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(expected), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  assert.deepEqual(await api.fetchPlantState(), expected);
});
