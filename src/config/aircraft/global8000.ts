/**
 * Bombardier Global 8000 (Global 7500 airframe figures). Published: MTOW
 * 52.1 t, wing 116.5 m^2, span 31.7 m, 2 x GE Passport (84.2 kN, +7 %),
 * MMO 0.95, ceiling 51,000 ft, landing distance 680 m.
 *
 * GAME WEIGHT: 80 % of MTOW = 41,680 kg. Thrust: 2 x 90 kN.
 * Aerodynamics are estimates: clean CLmax ~1.63, high critical Mach (0.86)
 * for the Mach 0.92+ wing.
 */

import { getAircraft } from '../aircraftCatalog'
import {
  PAVED_RUNWAY_FRICTION,
  gearSprings,
  inertiaFromGyration,
  type AircraftConfig,
  type TurbofanEngineConfig,
} from './types'
import { AIRLINER_FBW, MEDIUM_BYPASS_LAPSE } from './shared'

const DEG = Math.PI / 180
const INFO = getAircraft('global8000')
const G = INFO.geometry
export const GLOBAL8000_MASS = 0.8 * 52_100

export const GLOBAL8000_CONFIG: AircraftConfig & { engine: TurbofanEngineConfig } = {
  id: 'global8000',
  mass: GLOBAL8000_MASS,
  inertia: inertiaFromGyration(GLOBAL8000_MASS, G.wingspan, G.length, { roll: 0.28, pitch: 0.34, yaw: 0.46 }),
  wingArea: G.wing.area,
  wingSpan: G.wing.span,
  chord: G.wing.meanChord,
  wingY: -1.0,
  geometry: G,
  vmo: INFO.speeds.maxOperating,
  mmo: INFO.speeds.maxMach,

  aero: {
    cl0: 0.25,
    clAlpha: 5.0,
    alphaCritDeg: 16,
    alphaCritNegDeg: -10,
    slatAlphaCritDeg: 3,
    stallBlendDeg: 5,
    flatPlateLift: 0.9,
    flatPlateDrag: 1.3,
    stallWarningMarginDeg: 1.5,
    stallFlagMinSpeed: 30,
    cd0: 0.018,
    // AR 8.6, Oswald 0.8.
    inducedK: 0.0461,
    flapCl: 1.0,
    flapCd: 0.08,
    flapCm: -0.06,
    groundEffectLift: 0.1,
    groundEffectInducedDrag: 0.4,
    groundEffectCm: -0.05,
    cyBeta: -0.6,
    cyRudder: -0.15,
    cm0: 0,
    cmAlpha: -1.1,
    cmQ: -25,
    cmElevator: 1.4,
    clBeta: -0.1,
    clP: -0.45,
    clR: 0.12,
    clAileron: 0.12,
    cnBeta: 0.12,
    cnP: -0.03,
    cnR: -0.18,
    cnAileron: -0.005,
    cnRudder: 0.08,
    compressibility: {
      mcrit: 0.86,
      mpeak: 1.1,
      cdPeak: 0.1,
      exponent: 3,
      cdSupersonic: 0.05,
      decay: 0.3,
      inducedMachGain: 0,
    },
  },

  engine: {
    kind: 'turbofan',
    engines: 2,
    staticThrust: 2 * 90_000,
    dryLapse: MEDIUM_BYPASS_LAPSE,
    idleThrustFraction: 0.05,
    idleN1: 0.24,
    maxFanRpm: 7500,
    spoolUpBase: 0.065,
    spoolUpGain: 0.4,
    spoolDownBase: 0.13,
    spoolDownGain: 0.45,
    settleTau: 0.5,
    reverser: { efficiency: 0.35, maxSpool: 0.95, deployTime: 1.2, maxThrottle: 0.1 },
    afterburner: null,
  },

  surfaces: {
    elevatorMax: 25 * DEG,
    elevatorRate: 40 * DEG,
    aileronMax: 20 * DEG,
    aileronRate: 50 * DEG,
    rudderMax: 25 * DEG,
    rudderRate: 40 * DEG,
    flapMax: 35 * DEG,
    flapRate: 3.5 * DEG,
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
    transitTime: 6,
    cd: 0.02,
    ...gearSprings(GLOBAL8000_MASS, G, 0.12, 0.7),
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
    maxSpeed: 340,
  },

  fbw: {
    ...AIRLINER_FBW,
    pitchBandwidth: 2,
    rollBandwidth: 2,
    yawBandwidth: 1.5,
    maxPitchRate: 0.12,
    maxRollRate: 20 * DEG,
  },
  thrustVector: null,
}
