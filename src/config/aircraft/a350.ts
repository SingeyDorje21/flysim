/**
 * Airbus A350-900. Published: MTOW 283 t, wing 442 m^2, span 64.75 m,
 * 2 x Trent XWB-84 (370 kN), cruise Mach 0.85, MMO 0.89, ceiling 43,100 ft.
 *
 * GAME WEIGHT: MTOW = 283,000 kg, so the take-off reproduces the published
 * 2,600 m field length (measured: lift-off ~1,950 m, 35 ft at ~2,220 m,
 * x 1.15 = ~2,560 m). At 80 % MTOW it lifted off in ~1,500 m.
 * Aerodynamics are estimates: clean CLmax 1.57 (1 g clean stall ~72 m/s at
 * 80 % MTOW, ~80 m/s at MTOW), CONF 1+F (lever 1/3) CLmax ~2.35, full flap ~2.8.
 */

import { getAircraft } from '../aircraftCatalog'
import {
  PAVED_RUNWAY_FRICTION,
  gearSprings,
  inertiaFromGyration,
  type AircraftConfig,
  type TurbofanEngineConfig,
} from './types'
import { AIRLINER_FBW, HIGH_BYPASS_LAPSE } from './shared'

const DEG = Math.PI / 180
const INFO = getAircraft('a350')
const G = INFO.geometry
export const A350_MASS = 283_000

export const A350_CONFIG: AircraftConfig & { engine: TurbofanEngineConfig } = {
  id: 'a350',
  mass: A350_MASS,
  inertia: inertiaFromGyration(A350_MASS, G.wingspan, G.length, { roll: 0.27, pitch: 0.38, yaw: 0.47 }),
  wingArea: G.wing.area,
  wingSpan: G.wing.span,
  chord: G.wing.meanChord,
  wingY: -2.2,
  geometry: G,
  vmo: INFO.speeds.maxOperating,
  mmo: INFO.speeds.maxMach,

  aero: {
    cl0: 0.3,
    clAlpha: 5.2,
    alphaCritDeg: 14,
    alphaCritNegDeg: -10,
    slatAlphaCritDeg: 3,
    stallBlendDeg: 5,
    flatPlateLift: 0.9,
    flatPlateDrag: 1.3,
    stallWarningMarginDeg: 1.5,
    stallFlagMinSpeed: 30,
    cd0: 0.0165,
    // AR 9.5, Oswald 0.85.
    inducedK: 0.0395,
    flapCl: 0.95,
    flapCd: 0.075,
    flapCm: -0.08,
    groundEffectLift: 0.1,
    groundEffectInducedDrag: 0.4,
    groundEffectCm: -0.05,
    cyBeta: -0.6,
    cyRudder: -0.15,
    cm0: 0,
    cmAlpha: -1.2,
    cmQ: -30,
    cmElevator: 1.6,
    clBeta: -0.12,
    clP: -0.45,
    clR: 0.12,
    clAileron: 0.1,
    cnBeta: 0.12,
    cnP: -0.03,
    cnR: -0.18,
    cnAileron: -0.005,
    cnRudder: 0.08,
    compressibility: {
      mcrit: 0.8,
      mpeak: 1.05,
      cdPeak: 0.12,
      exponent: 3,
      cdSupersonic: 0.06,
      decay: 0.3,
      inducedMachGain: 0,
    },
  },

  engine: {
    kind: 'turbofan',
    engines: 2,
    staticThrust: 2 * 370_000,
    dryLapse: HIGH_BYPASS_LAPSE,
    idleThrustFraction: 0.05,
    idleN1: 0.22,
    maxFanRpm: 2700,
    spoolUpBase: 0.06,
    spoolUpGain: 0.35,
    spoolDownBase: 0.12,
    spoolDownGain: 0.4,
    settleTau: 0.6,
    reverser: { efficiency: 0.38, maxSpool: 0.95, deployTime: 1.5, maxThrottle: 0.1 },
    afterburner: null,
  },

  surfaces: {
    elevatorMax: 25 * DEG,
    elevatorRate: 30 * DEG,
    aileronMax: 20 * DEG,
    aileronRate: 40 * DEG,
    rudderMax: 25 * DEG,
    rudderRate: 30 * DEG,
    flapMax: 35 * DEG,
    flapRate: 2.5 * DEG,
    trimRange: 10 * DEG,
  },

  flapDetents: [0, 1 / 3, 2 / 3, 1],
  flapsWithGear: false,

  speedbrake: {
    cd: 0.06,
    clLossFlight: 0.15,
    clLossGround: 0.7,
    rate: 1,
    autoGround: true,
    autoMaxThrottle: 0.05,
    autoMinSpeed: 15,
  },

  gear: {
    retractable: true,
    transitTime: 9,
    cd: 0.018,
    ...gearSprings(A350_MASS, G, 0.15, 0.7),
    steerMaxLowSpeed: 40 * DEG,
    steerMaxHighSpeed: 6 * DEG,
    steerFadeSpeed: 20,
    frictionSpeedEps: 0.05,
    lateralSlipSaturation: 0.1,
    lateralMinSpeed: 1,
    surfaces: PAVED_RUNWAY_FRICTION,
  },

  crash: {
    hardLandingSinkRate: 3.5,
    maxSlopeDeg: 12,
    slopeMinSpeed: 1,
  },

  limits: {
    maxAngularRate: 3,
    // Safety clamp only (Mach ~1.0 at sea level); drag rise stops the type far below it.
    maxSpeed: 340,
  },

  fbw: {
    ...AIRLINER_FBW,
    pitchBandwidth: 1.2,
    rollBandwidth: 1.2,
    yawBandwidth: 1,
    maxPitchRate: 0.08,
    maxRollRate: 13 * DEG,
  },
  thrustVector: null,
}
