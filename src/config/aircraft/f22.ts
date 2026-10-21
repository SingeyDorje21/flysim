/**
 * Lockheed Martin F-22 Raptor. Published: empty 19.7 t, MTOW 38 t, wing
 * 78.04 m^2, span 13.56 m, 2 x F119 (120 kN dry / 160 kN wet each),
 * Mach 2.25 max, supercruise Mach 1.76, ceiling 65,000 ft, +9 / -3 g,
 * +-20 deg pitch thrust vectoring.
 *
 * GAME WEIGHT: 29,400 kg gross (19.7 t empty + ~8.2 t internal fuel +
 * internal missiles and gun ammunition: a typical air-to-air combat weight).
 * Aerodynamics are estimates: low aspect ratio (2.36), vortex lift to a 30 deg
 * critical AoA, gentle post-stall break, transonic drag hump peaking at Mach
 * 1.15. Thrust lapse with Mach includes ram recovery (low-bypass engine).
 */

import { getAircraft } from '../aircraftCatalog'
import {
  PAVED_RUNWAY_FRICTION,
  gearSprings,
  inertiaFromGyration,
  type AircraftConfig,
  type TurbofanEngineConfig,
} from './types'

const DEG = Math.PI / 180
const INFO = getAircraft('f22')
const G = INFO.geometry
export const F22_MASS = 29_400

export const F22_CONFIG: AircraftConfig & { engine: TurbofanEngineConfig } = {
  id: 'f22',
  mass: F22_MASS,
  inertia: inertiaFromGyration(F22_MASS, G.wingspan, G.length, { roll: 0.27, pitch: 0.34, yaw: 0.47 }),
  wingArea: G.wing.area,
  wingSpan: G.wing.span,
  chord: G.wing.meanChord,
  wingY: -0.4,
  geometry: G,
  vmo: INFO.speeds.maxOperating,
  mmo: INFO.speeds.maxMach,

  aero: {
    cl0: 0.05,
    clAlpha: 3.3,
    alphaCritDeg: 30,
    alphaCritNegDeg: -20,
    slatAlphaCritDeg: 0,
    stallBlendDeg: 15,
    flatPlateLift: 1.1,
    flatPlateDrag: 1.5,
    stallWarningMarginDeg: 3,
    stallFlagMinSpeed: 30,
    cd0: 0.019,
    // AR 2.36, Oswald 0.75.
    inducedK: 0.18,
    // Flaperons + leading-edge flaps, gear down: approach at ~75 m/s and ~10 deg AoA.
    flapCl: 0.45,
    flapCd: 0.04,
    flapCm: -0.03,
    groundEffectLift: 0.1,
    groundEffectInducedDrag: 0.4,
    groundEffectCm: -0.02,
    cyBeta: -0.8,
    cyRudder: -0.1,
    cm0: 0,
    // Close to neutral static stability (the FBW does the rest).
    cmAlpha: -0.25,
    cmQ: -5,
    cmElevator: 0.9,
    clBeta: -0.08,
    clP: -0.3,
    clR: 0.05,
    clAileron: 0.12,
    cnBeta: 0.15,
    cnP: -0.02,
    cnR: -0.25,
    cnAileron: -0.005,
    cnRudder: 0.08,
    compressibility: {
      mcrit: 0.85,
      mpeak: 1.15,
      cdPeak: 0.025,
      exponent: 2.5,
      cdSupersonic: 0.011,
      decay: 0.5,
      inducedMachGain: 1,
    },
  },

  engine: {
    kind: 'afterburningTurbofan',
    engines: 2,
    staticThrust: 2 * 120_000,
    dryLapse: { densityExponent: 0.7, m1: -0.25, m2: 0.38, m3: -0.08 },
    idleThrustFraction: 0.05,
    idleN1: 0.25,
    maxFanRpm: 10_400,
    spoolUpBase: 0.12,
    spoolUpGain: 0.6,
    spoolDownBase: 0.2,
    spoolDownGain: 0.6,
    settleTau: 0.35,
    reverser: null,
    afterburner: {
      detent: 0.95,
      wetThrust: 2 * 160_000,
      wetLapse: { densityExponent: 0.7, m1: -0.1, m2: 0.3, m3: -0.08 },
      minSpool: 0.9,
      lightUpDelay: 0.6,
      rampTime: 1,
    },
  },

  surfaces: {
    elevatorMax: 25 * DEG,
    elevatorRate: 70 * DEG,
    aileronMax: 25 * DEG,
    aileronRate: 100 * DEG,
    rudderMax: 30 * DEG,
    rudderRate: 80 * DEG,
    flapMax: 20 * DEG,
    flapRate: 10 * DEG,
    trimRange: 10 * DEG,
  },

  // Flaperons droop with the gear down (scheduled by the flight computer): no lever.
  flapDetents: [0],
  flapsWithGear: true,

  speedbrake: {
    // Flaperons up + split rudders.
    cd: 0.05,
    clLossFlight: 0.05,
    clLossGround: 0.25,
    rate: 1.5,
    autoGround: true,
    autoMaxThrottle: 0.05,
    autoMinSpeed: 15,
  },

  gear: {
    retractable: true,
    transitTime: 4,
    cd: 0.02,
    ...gearSprings(F22_MASS, G, 0.12, 0.7),
    steerMaxLowSpeed: 40 * DEG,
    steerMaxHighSpeed: 6 * DEG,
    steerFadeSpeed: 20,
    frictionSpeedEps: 0.05,
    lateralSlipSaturation: 0.1,
    lateralMinSpeed: 1,
    surfaces: PAVED_RUNWAY_FRICTION,
  },

  crash: {
    hardLandingSinkRate: 4,
    maxSlopeDeg: 12,
    slopeMinSpeed: 1,
  },

  limits: {
    maxAngularRate: 8,
    // Safety clamp only (Mach ~2.7 in the stratosphere).
    maxSpeed: 800,
  },

  fbw: {
    pitchBandwidth: 5,
    rollBandwidth: 6,
    yawBandwidth: 3,
    maxPitchRate: 0.6,
    maxRollRate: 200 * DEG,
    maxPedalYawRate: 0.3,
    nzMax: 9,
    nzMin: -3,
    pathHoldGain: 0.8,
    bankHoldGain: 2,
    bankCompensationDeg: 45,
    bankLimitDeg: null,
    bankNeutralLimitDeg: null,
    // AoA limiter at 40 deg: 10 deg beyond the aerodynamic stall (thrust vectoring keeps control).
    alphaProtMarginDeg: -10,
    alphaMaxMarginDeg: -10,
    alphaGain: 3,
    pitchLimitUpDeg: null,
    pitchLimitDownDeg: null,
    overspeedGain: 0,
    betaGain: 2,
    flightBlendTime: 1.5,
  },
  thrustVector: { maxAngle: 20 * DEG, rate: 60 * DEG, arm: 7 },
}
