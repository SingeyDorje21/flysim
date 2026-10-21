/**
 * Airbus A220-300. Published: MTOW 70.9 t, wing 112.3 m^2, span 35.1 m,
 * 2 x PW1500G (98-108.5 kN), cruise Mach 0.78, MMO 0.82, ceiling 41,000 ft.
 *
 * GAME WEIGHT: 80 % of MTOW = 56,720 kg. Thrust: 2 x 105 kN.
 * Aerodynamics are estimates: clean CLmax ~1.69, CONF 1+F ~2.5, full ~3.0.
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
const INFO = getAircraft('a220')
const G = INFO.geometry
export const A220_MASS = 0.8 * 70_900

export const A220_CONFIG: AircraftConfig & { engine: TurbofanEngineConfig } = {
  id: 'a220',
  mass: A220_MASS,
  inertia: inertiaFromGyration(A220_MASS, G.wingspan, G.length, { roll: 0.26, pitch: 0.37, yaw: 0.47 }),
  wingArea: G.wing.area,
  wingSpan: G.wing.span,
  chord: G.wing.meanChord,
  wingY: -1.6,
  geometry: G,
  vmo: INFO.speeds.maxOperating,
  mmo: INFO.speeds.maxMach,

  aero: {
    cl0: 0.32,
    clAlpha: 5.6,
    alphaCritDeg: 14,
    alphaCritNegDeg: -10,
    slatAlphaCritDeg: 3,
    stallBlendDeg: 5,
    flatPlateLift: 0.9,
    flatPlateDrag: 1.3,
    stallWarningMarginDeg: 1.5,
    stallFlagMinSpeed: 30,
    cd0: 0.021,
    // AR 11, Oswald 0.82.
    inducedK: 0.0354,
    flapCl: 1.0,
    flapCd: 0.08,
    flapCm: -0.08,
    groundEffectLift: 0.1,
    groundEffectInducedDrag: 0.4,
    groundEffectCm: -0.05,
    cyBeta: -0.6,
    cyRudder: -0.15,
    cm0: 0,
    cmAlpha: -1.2,
    cmQ: -28,
    cmElevator: 1.5,
    clBeta: -0.12,
    clP: -0.45,
    clR: 0.12,
    clAileron: 0.11,
    cnBeta: 0.12,
    cnP: -0.03,
    cnR: -0.18,
    cnAileron: -0.005,
    cnRudder: 0.08,
    compressibility: {
      mcrit: 0.74,
      mpeak: 1.0,
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
    staticThrust: 2 * 105_000,
    dryLapse: HIGH_BYPASS_LAPSE,
    idleThrustFraction: 0.05,
    idleN1: 0.22,
    maxFanRpm: 3300,
    spoolUpBase: 0.065,
    spoolUpGain: 0.38,
    spoolDownBase: 0.12,
    spoolDownGain: 0.4,
    settleTau: 0.5,
    reverser: { efficiency: 0.38, maxSpool: 0.95, deployTime: 1.2, maxThrottle: 0.1 },
    afterburner: null,
  },

  surfaces: {
    elevatorMax: 25 * DEG,
    elevatorRate: 35 * DEG,
    aileronMax: 20 * DEG,
    aileronRate: 45 * DEG,
    rudderMax: 25 * DEG,
    rudderRate: 35 * DEG,
    flapMax: 35 * DEG,
    flapRate: 3 * DEG,
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
    transitTime: 7,
    cd: 0.02,
    ...gearSprings(A220_MASS, G, 0.12, 0.7),
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
    pitchBandwidth: 1.6,
    rollBandwidth: 1.6,
    yawBandwidth: 1.2,
    maxPitchRate: 0.1,
    maxRollRate: 15 * DEG,
  },
  thrustVector: null,
}
