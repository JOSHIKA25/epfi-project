/**
 * Tennessee Eastman Process (TEP) Dynamic Simulator
 * Implements coupled non-linear differential approximations of the Downs & Vogel plant:
 * - Reactor exothermic kinetics, jacket heat exchange, vapor-liquid equilibria
 * - Condenser cooling & phase split
 * - Separator gas recycle & liquid underflow
 * - Stripper reboiler column stripping
 * - Centrifugal compressor with recycle & purge
 * - Multi-loop PI control system
 * - Fault injection engine for IDV(1) - IDV(21)
 */

import { TEP_VARIABLES, TEP_FAULTS, type TEPVariable, type TEPFault } from './tepConstants.ts';

export interface TelemetryPoint {
  timestamp: number;
  step: number;
  values: Record<string, number>;
  alarms: Record<string, 'NORMAL' | 'WARN_LOW' | 'WARN_HIGH' | 'TRIP_LOW' | 'TRIP_HIGH'>;
  activeFaults: number[];
  faultIntensity: number;
}

export interface UnitHealthState {
  unit: string;
  name: string;
  healthIndex: number; // 0 - 100%
  status: 'OPTIMAL' | 'STABLE' | 'DEGRADED' | 'CRITICAL';
  activeAlarmsCount: number;
  anomalyScore: number;
  temperature: number;
  pressure: number;
  level?: number;
}

export class TEPSimulator {
  private stepCount: number = 0;
  private isRunning: boolean = true;
  private timeStepSec: number = 1.0;
  private activeFaults: Set<number> = new Set();
  private faultIntensity: number = 1.0;
  private history: TelemetryPoint[] = [];
  private maxHistory: number = 120; // 2 minutes at 1 Hz

  // State variables for 41 process variables
  private state: Record<string, number> = {};

  // Controller states (Integral errors)
  private piIntegrals: Record<string, number> = {
    reactor_level: 0,
    reactor_temp: 0,
    reactor_press: 0,
    separator_level: 0,
    stripper_level: 0,
    stripper_temp: 0,
  };

  // Internal physical dynamics state
  private internalKinetics: number = 1.0; // Catalyst activity factor
  private condenserFouling: number = 0.0; // Fouling coefficient
  private valveStiction: Record<string, number> = {}; // Valve sticking offset

  constructor() {
    this.resetToNominal();
  }

  public resetToNominal(): void {
    this.stepCount = 0;
    this.activeFaults.clear();
    this.faultIntensity = 1.0;
    this.internalKinetics = 1.0;
    this.condenserFouling = 0.0;
    this.valveStiction = {};

    Object.keys(this.piIntegrals).forEach((k) => {
      this.piIntegrals[k] = 0;
    });

    this.state = {};
    for (const v of TEP_VARIABLES) {
      // Add slight initial gaussian-like noise around nominal setpoint (±0.2%)
      const noise = (Math.random() - 0.5) * 0.004 * v.nominal;
      this.state[v.id] = v.nominal + noise;
    }

    this.history = [];
    this.recordSnapshot();
  }

  public injectFault(faultId: number, intensity: number = 1.0): void {
    if (faultId >= 1 && faultId <= 21) {
      this.activeFaults.add(faultId);
      this.faultIntensity = Math.max(0.1, Math.min(2.0, intensity));
    }
  }

  public clearFault(faultId?: number): void {
    if (faultId !== undefined) {
      this.activeFaults.delete(faultId);
    } else {
      this.activeFaults.clear();
    }
  }

  public setFaultIntensity(intensity: number): void {
    this.faultIntensity = Math.max(0.1, Math.min(2.5, intensity));
  }

  public setManualActuator(actuatorId: string, value: number): void {
    if (this.state[actuatorId] !== undefined) {
      this.state[actuatorId] = Math.max(0, Math.min(100, value));
    }
  }

  public step(): TelemetryPoint {
    this.stepCount++;
    const s = this.state;
    const fInt = this.faultIntensity;

    // --- FAULT DISTURBANCE TERMS ---
    let stream4RatioDisturb = 0;
    let inertsDisturb = 0;
    let dTempDisturb = 0;
    let rCoolWaterInletDisturb = 0;
    let cCoolWaterInletDisturb = 0;
    let aLossDisturb = 0;
    let cHeaderLoss = 0;
    let feedCompNoise = 0;
    let catalystDecay = 0;
    let rValveStuck = false;
    let cValveStuck = false;
    let condenserFouled = false;
    let recycleOsc = 0;
    let steamDisturb = 0;
    let compressorSurge = 0;
    let stream4ValveFrozen = false;

    for (const fid of this.activeFaults) {
      switch (fid) {
        case 1: // IDV(1): A/C feed ratio step
          stream4RatioDisturb += 0.35 * fInt;
          break;
        case 2: // IDV(2): Inerts B step in Stream 4
          inertsDisturb += 0.45 * fInt;
          break;
        case 3: // IDV(3): D feed temp step
          dTempDisturb += 12.0 * fInt;
          break;
        case 4: // IDV(4): Reactor cooling water inlet temp step
          rCoolWaterInletDisturb += 16.5 * fInt;
          break;
        case 5: // IDV(5): Condenser cooling water inlet temp step
          cCoolWaterInletDisturb += 14.0 * fInt;
          break;
        case 6: // IDV(6): A feed stream loss
          aLossDisturb = 0.95 * fInt;
          break;
        case 7: // IDV(7): C header pressure reduction
          cHeaderLoss += 0.3 * fInt;
          break;
        case 8: // IDV(8): A, B, C feed composition random
          feedCompNoise += (Math.random() - 0.5) * 4.5 * fInt;
          break;
        case 9: // IDV(9): D feed temp random
          dTempDisturb += (Math.random() - 0.5) * 6.0 * fInt;
          break;
        case 10: // IDV(10): C feed temp random
          feedCompNoise += (Math.random() - 0.5) * 3.0 * fInt;
          break;
        case 11: // IDV(11): Reactor cooling water random
          rCoolWaterInletDisturb += (Math.random() - 0.5) * 7.5 * fInt;
          break;
        case 12: // IDV(12): Condenser cooling water random
          cCoolWaterInletDisturb += (Math.random() - 0.5) * 6.5 * fInt;
          break;
        case 13: // IDV(13): Reaction kinetics slow drift
          catalystDecay += 0.003 * fInt * Math.min(this.stepCount, 200);
          break;
        case 14: // IDV(14): Reactor cooling water valve stiction
          rValveStuck = true;
          break;
        case 15: // IDV(15): Condenser cooling water valve stiction
          cValveStuck = true;
          break;
        case 16: // IDV(16): Unknown condenser heat exchanger fouling
          condenserFouled = true;
          break;
        case 17: // IDV(17): Unknown recycle valve fluctuation
          recycleOsc += Math.sin(this.stepCount * 0.15) * 12.0 * fInt;
          break;
        case 18: // IDV(18): Unknown stripper steam flow disturbance
          steamDisturb += (Math.random() - 0.5) * 35.0 * fInt;
          break;
        case 19: // IDV(19): Unknown feed mixture disturbance
          stream4RatioDisturb += (Math.random() - 0.5) * 0.25 * fInt;
          feedCompNoise += (Math.random() - 0.5) * 3.0 * fInt;
          break;
        case 20: // IDV(20): Unknown compressor surge
          compressorSurge += Math.sin(this.stepCount * 0.35) * 38.0 * fInt;
          break;
        case 21: // IDV(21): Stream 4 valve fixed
          stream4ValveFrozen = true;
          break;
      }
    }

    // --- 1. FEED SECTION DYNAMICS ---
    // A Feed (Stream 1)
    if (aLossDisturb > 0) {
      s['XMEAS_1'] = Math.max(0.01, 0.2505 * (1 - aLossDisturb) + (Math.random() - 0.5) * 0.005);
      s['XMV_3'] = Math.max(0, s['XMV_3'] * (1 - aLossDisturb * 0.8));
    } else {
      s['XMEAS_1'] = 0.2505 + (s['XMV_3'] - 25.0) * 0.005 + (Math.random() - 0.5) * 0.002;
    }

    // D Feed (Stream 2)
    s['XMEAS_2'] = 3664.0 + (s['XMV_1'] - 63.0) * 45.0 + dTempDisturb * 8.0 + (Math.random() - 0.5) * 15.0;

    // E Feed (Stream 3)
    s['XMEAS_3'] = 4509.0 + (s['XMV_2'] - 54.0) * 55.0 + (Math.random() - 0.5) * 18.0;

    // Stream 4 (A & C Feed)
    if (stream4ValveFrozen) {
      // Actuator is stuck; pressure loss causes flow dip
      s['XMV_4'] = 61.3;
      s['XMEAS_4'] = 9.3477 - 1.2 * fInt + (Math.random() - 0.5) * 0.05;
    } else {
      const cLoss = cHeaderLoss * 2.5;
      s['XMEAS_4'] = 9.3477 + (s['XMV_4'] - 61.3) * 0.12 - cLoss + stream4RatioDisturb * 0.5 + (Math.random() - 0.5) * 0.04;
    }

    // --- 2. REACTOR DYNAMICS ---
    // Kinetics and heat generation
    this.internalKinetics = Math.max(0.6, 1.0 - catalystDecay);

    // Total reactor feed (Stream 6 = Stream 1..4 + Recycle Stream 8)
    const recycleFlow = s['XMEAS_5'] || 26.888;
    s['XMEAS_6'] = 42.339 + (s['XMEAS_4'] - 9.3477) * 1.1 + (recycleFlow - 26.888) * 0.85 + (Math.random() - 0.5) * 0.1;

    // Exothermic heat generation function Q_rxn
    const tempK = (s['XMEAS_9'] || 120.4) + 273.15;
    const arrhenius = Math.exp(30.0 - 9000.0 / tempK) * this.internalKinetics;
    const reactantAvailability = (s['XMEAS_1'] / 0.2505) * (s['XMEAS_4'] / 9.3477);
    const heatGenerated = 45000.0 * arrhenius * reactantAvailability;

    // Reactor cooling control loop (PI Controller on XMV_10)
    const tempSetpoint = 120.4;
    const tempError = s['XMEAS_9'] - tempSetpoint;
    this.piIntegrals.reactor_temp += tempError * this.timeStepSec;
    this.piIntegrals.reactor_temp = Math.max(-50, Math.min(50, this.piIntegrals.reactor_temp));

    let coolingValveTarget = 41.1 + 1.8 * tempError + 0.15 * this.piIntegrals.reactor_temp;
    if (rValveStuck) {
      // Stiction limit cycle: valve sticks until error exceeds deadband, then jumps
      const deadband = 4.5 * fInt;
      if (Math.abs(coolingValveTarget - s['XMV_10']) > deadband) {
        s['XMV_10'] = coolingValveTarget + (Math.random() - 0.5) * 2.0;
      }
    } else {
      s['XMV_10'] = Math.max(0, Math.min(100, coolingValveTarget));
    }

    // Heat removal by cooling jacket
    const coolingInletTemp = 32.0 + rCoolWaterInletDisturb;
    const coolingFlow = (s['XMV_10'] / 41.1) * 38.0;
    const heatRemoved = coolingFlow * 1200.0 * ((s['XMEAS_9'] - coolingInletTemp) / 88.4);

    // Dynamic temperature ODE update
    const netHeat = heatGenerated - heatRemoved;
    s['XMEAS_9'] += (netHeat / 120000.0) * this.timeStepSec + (Math.random() - 0.5) * 0.08;
    s['XMEAS_9'] = Math.max(80.0, Math.min(170.0, s['XMEAS_9']));

    // Jacket outlet temperature
    s['XMEAS_21'] = coolingInletTemp + (heatRemoved / (coolingFlow * 1200.0 + 1.0)) * 62.6 + (Math.random() - 0.5) * 0.15;

    // Reactor Pressure (Coupled to temperature and purge flow)
    const vaporPressureFactor = Math.pow(s['XMEAS_9'] / 120.4, 3.2);
    const inertAccumulation = inertsDisturb * 220.0;
    const purgeRelief = (s['XMEAS_10'] - 0.3371) * 450.0;
    const targetPressure = 2705.0 * vaporPressureFactor + inertAccumulation - purgeRelief + (s['XMEAS_6'] - 42.339) * 8.0;
    s['XMEAS_7'] += (targetPressure - s['XMEAS_7']) * 0.2 + (Math.random() - 0.5) * 2.0;

    // Reactor Liquid Level (PI controller to underflow)
    const levelSetpoint = 75.0;
    const levelError = s['XMEAS_8'] - levelSetpoint;
    this.piIntegrals.reactor_level += levelError * this.timeStepSec;
    s['XMEAS_8'] += (s['XMEAS_2'] / 3664.0 + s['XMEAS_3'] / 4509.0 - 2.0) * 0.4 - (s['XMEAS_9'] - 120.4) * 0.05 + (Math.random() - 0.5) * 0.05;
    s['XMEAS_8'] = Math.max(20.0, Math.min(98.0, s['XMEAS_8']));

    // --- 3. CONDENSER DYNAMICS ---
    if (condenserFouled) {
      this.condenserFouling = Math.min(0.65, this.condenserFouling + 0.005 * fInt);
    }
    const cCoolingInlet = 28.0 + cCoolWaterInletDisturb;

    let cValveTarget = 18.1 + (s['XMEAS_11'] - 80.1) * 1.5;
    if (cValveStuck) {
      if (Math.abs(cValveTarget - s['XMV_11']) > 5.0 * fInt) {
        s['XMV_11'] = cValveTarget;
      }
    } else {
      s['XMV_11'] = Math.max(0, Math.min(100, cValveTarget));
    }

    const effectiveUA = (1.0 - this.condenserFouling) * (s['XMV_11'] / 18.1);
    s['XMEAS_22'] = cCoolingInlet + 49.3 / (effectiveUA + 0.1) + (Math.random() - 0.5) * 0.2;

    // --- 4. SEPARATOR DYNAMICS ---
    s['XMEAS_11'] = 80.1 + (s['XMEAS_9'] - 120.4) * 0.35 + (cCoolWaterInletDisturb) * 0.4 + this.condenserFouling * 18.0 + (Math.random() - 0.5) * 0.15;
    s['XMEAS_13'] = s['XMEAS_7'] - 72.0 + (s['XMEAS_11'] - 80.1) * 3.5 + (Math.random() - 0.5) * 1.5;

    // Separator Level (PI controller to XMV_7)
    const sepLevelError = s['XMEAS_12'] - 50.0;
    this.piIntegrals.separator_level += sepLevelError * this.timeStepSec;
    s['XMV_7'] = Math.max(0, Math.min(100, 38.1 + sepLevelError * 1.2 + this.piIntegrals.separator_level * 0.05));
    s['XMEAS_14'] = 25.16 + (s['XMV_7'] - 38.1) * 0.65 + (Math.random() - 0.5) * 0.1;
    s['XMEAS_12'] = 50.0 + (s['XMEAS_14'] - 25.16) * 0.2 + (Math.random() - 0.5) * 0.2;

    // --- 5. COMPRESSOR & RECYCLE DYNAMICS ---
    s['XMEAS_5'] = 26.888 + (s['XMEAS_13'] - 2633.0) * 0.015 - (s['XMV_5'] - 22.2) * 0.3 + recycleOsc + (Math.random() - 0.5) * 0.1;
    s['XMEAS_20'] = 341.4 + (s['XMEAS_5'] - 26.888) * 7.5 + (s['XMEAS_13'] - 2633.0) * 0.1 + compressorSurge + (Math.random() - 0.5) * 2.0;

    // Purge valve (PI controller on reactor/separator pressure)
    const pressError = s['XMEAS_7'] - 2705.0;
    this.piIntegrals.reactor_press += pressError * this.timeStepSec;
    s['XMV_6'] = Math.max(5, Math.min(100, 40.1 + pressError * 0.08 + inertsDisturb * 15.0));
    s['XMEAS_10'] = 0.3371 + (s['XMV_6'] - 40.1) * 0.01 + (s['XMEAS_13'] - 2633.0) * 0.0003 + (Math.random() - 0.5) * 0.005;

    // --- 6. STRIPPER COLUMN DYNAMICS ---
    s['XMEAS_16'] = s['XMEAS_13'] - 143.0 + (Math.random() - 0.5) * 1.0;

    // Stripper Steam control
    s['XMEAS_19'] = 230.5 + (s['XMV_9'] - 47.4) * 4.5 + steamDisturb + (Math.random() - 0.5) * 2.5;
    s['XMEAS_18'] = 65.7 + (s['XMEAS_19'] - 230.5) * 0.08 + (Math.random() - 0.5) * 0.15;

    // Stripper Level & Underflow (Finished product G + H)
    const stripLevelError = s['XMEAS_15'] - 50.0;
    this.piIntegrals.stripper_level += stripLevelError * this.timeStepSec;
    s['XMV_8'] = Math.max(0, Math.min(100, 46.5 + stripLevelError * 1.1 + this.piIntegrals.stripper_level * 0.04));
    s['XMEAS_17'] = 22.95 + (s['XMV_8'] - 46.5) * 0.5 + (s['XMEAS_14'] - 25.16) * 0.4 + (Math.random() - 0.5) * 0.1;
    s['XMEAS_15'] = 50.0 + (s['XMEAS_14'] - s['XMEAS_17']) * 0.3 + (Math.random() - 0.5) * 0.2;

    // --- 7. GAS CHROMATOGRAPH COMPOSITIONS (Stream 6, 9, 11) ---
    s['XMEAS_23'] = Math.max(5, Math.min(60, 32.2 - (aLossDisturb * 20.0) + stream4RatioDisturb * 4.0 + feedCompNoise + (Math.random() - 0.5) * 0.2));
    s['XMEAS_24'] = Math.max(1, Math.min(30, 8.9 + inertsDisturb * 8.0 + (Math.random() - 0.5) * 0.15));
    s['XMEAS_25'] = Math.max(5, Math.min(50, 26.4 - stream4RatioDisturb * 3.5 + (Math.random() - 0.5) * 0.2));
    s['XMEAS_26'] = Math.max(1, Math.min(25, 6.8 + (dTempDisturb * 0.1) + (Math.random() - 0.5) * 0.1));
    s['XMEAS_27'] = Math.max(5, Math.min(35, 18.8 + (Math.random() - 0.5) * 0.15));
    s['XMEAS_28'] = Math.max(10, Math.min(60, 32.8 + (s['XMEAS_23'] - 32.2) * 0.9 + (Math.random() - 0.5) * 0.2));
    s['XMEAS_29'] = Math.max(25, Math.min(80, 53.8 - catalystDecay * 15.0 - (Math.abs(s['XMEAS_18'] - 65.7) * 0.4) + (Math.random() - 0.5) * 0.25));

    // Agitator constant speed
    s['XMV_12'] = 100.0;

    return this.recordSnapshot();
  }

  private recordSnapshot(): TelemetryPoint {
    const pointValues: Record<string, number> = {};
    const pointAlarms: Record<string, 'NORMAL' | 'WARN_LOW' | 'WARN_HIGH' | 'TRIP_LOW' | 'TRIP_HIGH'> = {};

    for (const v of TEP_VARIABLES) {
      const val = Number((this.state[v.id] ?? v.nominal).toFixed(3));
      pointValues[v.id] = val;

      if (val >= v.highTrip) {
        pointAlarms[v.id] = 'TRIP_HIGH';
      } else if (val <= v.lowTrip) {
        pointAlarms[v.id] = 'TRIP_LOW';
      } else if (val >= v.highWarn) {
        pointAlarms[v.id] = 'WARN_HIGH';
      } else if (val <= v.lowWarn) {
        pointAlarms[v.id] = 'WARN_LOW';
      } else {
        pointAlarms[v.id] = 'NORMAL';
      }
    }

    const snapshot: TelemetryPoint = {
      timestamp: Date.now(),
      step: this.stepCount,
      values: pointValues,
      alarms: pointAlarms,
      activeFaults: Array.from(this.activeFaults),
      faultIntensity: this.faultIntensity,
    };

    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    return snapshot;
  }

  public getLatestTelemetry(): TelemetryPoint {
    if (this.history.length === 0) {
      return this.recordSnapshot();
    }
    return this.history[this.history.length - 1];
  }

  public getHistory(count: number = 60): TelemetryPoint[] {
    return this.history.slice(-count);
  }

  public getUnitHealthStates(): UnitHealthState[] {
    const latest = this.getLatestTelemetry();
    const alarms = latest.alarms;
    const v = latest.values;

    const units = [
      {
        unit: 'reactor',
        name: 'Chemical Reactor (CSTR)',
        tempId: 'XMEAS_9',
        pressId: 'XMEAS_7',
        levelId: 'XMEAS_8',
        vars: ['XMEAS_6', 'XMEAS_7', 'XMEAS_8', 'XMEAS_9', 'XMEAS_21', 'XMV_10', 'XMV_12', 'XMEAS_23'],
      },
      {
        unit: 'condenser',
        name: 'Product Condenser',
        tempId: 'XMEAS_11',
        pressId: 'XMEAS_13',
        levelId: undefined,
        vars: ['XMEAS_11', 'XMEAS_22', 'XMV_11'],
      },
      {
        unit: 'separator',
        name: 'Vapor-Liquid Separator',
        tempId: 'XMEAS_11',
        pressId: 'XMEAS_13',
        levelId: 'XMEAS_12',
        vars: ['XMEAS_11', 'XMEAS_12', 'XMEAS_13', 'XMEAS_14', 'XMV_7'],
      },
      {
        unit: 'stripper',
        name: 'Stripping Column',
        tempId: 'XMEAS_18',
        pressId: 'XMEAS_16',
        levelId: 'XMEAS_15',
        vars: ['XMEAS_15', 'XMEAS_16', 'XMEAS_17', 'XMEAS_18', 'XMEAS_19', 'XMV_8', 'XMV_9', 'XMEAS_29'],
      },
      {
        unit: 'compressor',
        name: 'Recycle Gas Compressor',
        tempId: 'XMEAS_11',
        pressId: 'XMEAS_13',
        levelId: undefined,
        vars: ['XMEAS_5', 'XMEAS_10', 'XMEAS_20', 'XMV_5', 'XMV_6', 'XMEAS_28'],
      },
    ];

    return units.map((u) => {
      let alarmPoints = 0;
      u.vars.forEach((varId) => {
        const al = alarms[varId];
        if (al === 'TRIP_HIGH' || al === 'TRIP_LOW') alarmPoints += 30;
        else if (al === 'WARN_HIGH' || al === 'WARN_LOW') alarmPoints += 12;
      });

      const healthIndex = Math.max(5, Math.min(100, Math.round(100 - alarmPoints)));
      let status: 'OPTIMAL' | 'STABLE' | 'DEGRADED' | 'CRITICAL' = 'OPTIMAL';
      if (healthIndex < 40) status = 'CRITICAL';
      else if (healthIndex < 70) status = 'DEGRADED';
      else if (healthIndex < 90) status = 'STABLE';

      return {
        unit: u.unit,
        name: u.name,
        healthIndex,
        status,
        activeAlarmsCount: u.vars.filter((vid) => alarms[vid] !== 'NORMAL').length,
        anomalyScore: Number((100 - healthIndex).toFixed(1)),
        temperature: v[u.tempId] ?? 0,
        pressure: v[u.pressId] ?? 0,
        level: u.levelId ? v[u.levelId] : undefined,
      };
    });
  }

  public getActiveFaults(): TEPFault[] {
    const ids = Array.from(this.activeFaults);
    return TEP_FAULTS.filter((f) => ids.includes(f.id));
  }
}

// Export singleton instance for Express server
export const tepSimulator = new TEPSimulator();
