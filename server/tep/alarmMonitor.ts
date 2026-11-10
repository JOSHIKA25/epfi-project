import { TEP_VARIABLES } from './tepConstants.ts';
import { tepSimulator } from './tepSimulator.ts';
import { stateStore } from '../state/stateStore.ts';
import { n8nService } from '../n8n/n8nService.ts';

let monitorRunning = false;

/** Synchronize telemetry alarms and dispatch new operator alerts from the backend loop. */
export async function monitorAlarmNotifications(): Promise<void> {
  if (monitorRunning) return;
  monitorRunning = true;
  try {
    const telemetry = tepSimulator.getLatestTelemetry();
    const activeFaults = tepSimulator.getActiveFaults();
    const newlyRaisedAlarms = stateStore.syncAlarmReviews(TEP_VARIABLES.flatMap((variable) => {
      const alarm = telemetry.alarms[variable.id];
      const value = telemetry.values[variable.id];
      const relatedFaults = activeFaults
        .filter((fault) => fault.keySensors.includes(variable.id) || fault.primaryUnit === variable.category)
        .map(({ id, code, name, primaryUnit, keySensors }) => ({ id, code, name, primaryUnit, keySensors }));
      return alarm && alarm !== 'NORMAL' && Number.isFinite(value)
        ? [{ variableId: variable.id, code: variable.code, name: variable.name, unit: variable.unit, category: variable.category, alarm, value, sourceFaults: relatedFaults }]
        : [];
    }));

    if (newlyRaisedAlarms.length === 0) return;
    await n8nService.dispatchWebhook('CRITICAL_ALARM', {
      recipientRole: 'OPERATOR',
      event: 'NEW_ALARM',
      alarmCount: newlyRaisedAlarms.length,
      alarms: newlyRaisedAlarms.map(({ id, code, name, unit, category, alarm, value, sourceFaults, firstSeenAt }) => ({
        id, code, name, unit, category, alarm, value, sourceFaults, firstSeenAt,
      })),
      instruction: 'Notify the on-duty operator immediately. This alert is informational and does not execute plant control.',
    });
  } catch (error) {
    console.error('[AlarmNotify] Backend alarm monitor could not synchronize or dispatch:', error);
  } finally {
    monitorRunning = false;
  }
}
