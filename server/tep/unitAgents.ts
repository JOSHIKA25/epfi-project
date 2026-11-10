import type { TelemetryPoint, UnitHealthState } from './tepSimulator.ts';

export interface UnitAgentObservation {
  channelId: string;
  value: number | null;
  alarm: TelemetryPoint['alarms'][string] | 'UNAVAILABLE';
}

export interface UnitAgentAssessment {
  agentName: string;
  unit: string;
  unitName: string;
  upstreamUnits: string[];
  digitalGate: 'READY' | 'HOLD_REVIEW';
  blockedByUnits: string[];
  dataQuality: 'COMPLETE' | 'INCOMPLETE';
  missingChannels: string[];
  telemetryTimestamp: number;
  generatedAt: number;
  dataSource: 'SIMULATED_TEP';
  authority: 'ADVISORY_ONLY';
  healthStatus: UnitHealthState['status'];
  healthIndex: number | null;
  activeAlarmsCount: number;
  status: 'MONITORING' | 'REVIEW' | 'ATTENTION' | 'URGENT_REVIEW';
  observations: UnitAgentObservation[];
  recommendation: string;
}

const DIGITAL_REVIEW_DEPENDENCIES: Record<string, string[]> = {
  reactor: [],
  condenser: ['reactor'],
  separator: ['condenser'],
  stripper: ['separator'],
  compressor: ['separator'],
};
const DIGITAL_REVIEW_ORDER = ['reactor', 'condenser', 'separator', 'stripper', 'compressor'];

function getAssessmentStatus(
  status: UnitHealthState['status'],
): UnitAgentAssessment['status'] {
  switch (status) {
    case 'CRITICAL':
      return 'URGENT_REVIEW';
    case 'DEGRADED':
      return 'ATTENTION';
    case 'STABLE':
      return 'REVIEW';
    case 'OPTIMAL':
      return 'MONITORING';
  }
}

export function assessUnitAgents(
  telemetry: TelemetryPoint,
  unitHealth: UnitHealthState[],
  generatedAt = Date.now(),
): UnitAgentAssessment[] {
  const baseAssessments: UnitAgentAssessment[] = unitHealth.map((unit) => {
    const observations: UnitAgentObservation[] = unit.monitoredChannels.map((channelId) => {
      const alarm = telemetry.alarms[channelId];
      return {
        channelId,
        value: Number.isFinite(telemetry.values[channelId]) ? telemetry.values[channelId] : null,
        alarm: alarm === undefined ? 'UNAVAILABLE' : alarm,
      };
    });
    const missingChannels = observations
      .filter(({ value, alarm }) => value === null || alarm === 'UNAVAILABLE')
      .map(({ channelId }) => channelId);
    const dataQuality = missingChannels.length > 0 ? 'INCOMPLETE' : 'COMPLETE';
    const status = dataQuality === 'INCOMPLETE' && unit.status === 'OPTIMAL'
      ? 'REVIEW'
      : getAssessmentStatus(unit.status);

    return {
      agentName: `${unit.name} Monitor`,
      unit: unit.unit,
      unitName: unit.name,
      upstreamUnits: DIGITAL_REVIEW_DEPENDENCIES[unit.unit] ?? [],
      digitalGate: status === 'MONITORING' ? 'READY' : 'HOLD_REVIEW',
      blockedByUnits: [] as string[],
      dataQuality,
      missingChannels,
      telemetryTimestamp: telemetry.timestamp,
      generatedAt,
      dataSource: 'SIMULATED_TEP',
      authority: 'ADVISORY_ONLY',
      healthStatus: unit.status,
      healthIndex: dataQuality === 'COMPLETE' ? unit.healthIndex : null,
      activeAlarmsCount: unit.activeAlarmsCount,
      status,
      observations,
      recommendation:
        status === 'MONITORING'
          ? 'No unit alarms are active in the simulator snapshot; continue monitoring.'
          : dataQuality === 'INCOMPLETE'
            ? `Telemetry is missing or lacks alarm quality for: ${missingChannels.join(', ')}. Review the input before relying on this assessment.`
            : 'Review the listed telemetry and alarms with an operator; follow site-approved response procedures.',
    };
  });

  const assessmentByUnit = new Map(baseAssessments.map((assessment) => [assessment.unit, assessment]));
  const reviewOrder = [...baseAssessments].sort((left, right) => {
    const leftIndex = DIGITAL_REVIEW_ORDER.indexOf(left.unit);
    const rightIndex = DIGITAL_REVIEW_ORDER.indexOf(right.unit);
    return (leftIndex < 0 ? DIGITAL_REVIEW_ORDER.length : leftIndex)
      - (rightIndex < 0 ? DIGITAL_REVIEW_ORDER.length : rightIndex);
  });

  for (const assessment of reviewOrder) {
    const blockedByUnits = assessment.upstreamUnits.filter((upstreamUnit) => {
      const upstream = assessmentByUnit.get(upstreamUnit);
      return upstream === undefined
        || upstream.status !== 'MONITORING'
        || upstream.digitalGate === 'HOLD_REVIEW';
    });
    const digitalGate = assessment.status !== 'MONITORING' || blockedByUnits.length > 0
      ? 'HOLD_REVIEW'
      : 'READY';
    if (blockedByUnits.length === 0) {
      assessmentByUnit.set(assessment.unit, { ...assessment, digitalGate });
      continue;
    }

    assessmentByUnit.set(assessment.unit, {
      ...assessment,
      digitalGate,
      blockedByUnits,
      recommendation:
        `Digital review held because upstream unit(s) need operator review: ${blockedByUnits.join(', ')}. ` +
        'This does not stop or control physical process flow.',
    });
  }

  return baseAssessments.map((assessment) => assessmentByUnit.get(assessment.unit) ?? assessment);
}
