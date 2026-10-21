/**
 * FS-1 Trainer: single-engine, low-wing, fixed tricycle gear, direct
 * (mechanical) controls. These are the validated Phase 1 numbers, unchanged.
 */

import { getAircraft } from '../aircraftCatalog'
import { AIRCRAFT_GEOMETRY } from '../aircraftGeometry'
import { PAVED_RUNWAY_FRICTION, gearSprings, type AircraftConfig, type PistonEngineConfig } from './types'

const DEG = Math.PI / 180
const MASS = 1100
const INFO = getAircraft('trainer')

export const TRAINER_CONFIG: AircraftConfig & { engine: PistonEngineConfig } = {
  id: 'trainer',
  mass: MASS,
  inertia: { x: 1925, y: 2810, z: 1355 },
  wingArea: AIRCRAFT_GEOMETRY.wing.area,
  wingSpan: AIRCRAFT_GEOMETRY.wing.span,
  chord: AIRCRAFT_GEOMETRY.wing.chord,
  wingY: AIRCRAFT_GEOMETRY.wing.rootY,
  geometry: INFO.geometry,
  vmo: INFO.speeds.maxOperating,
  mmo: INFO.speeds.maxMach,

  aero: {
    cl0: 0.4,
    clAlpha: 4.2,
    alphaCritDeg: 15,
    alphaCritNegDeg: -12,
    slatAlphaCritDeg: 0,
    stallBlendDeg: 6,
    flatPlateLift: 0.9,
    flatPlateDrag: 1.25,
    stallWarningMarginDeg: 3,
    stallFlagMinSpeed: 10,
    cd0: 0.032,
    inducedK: 0.057,
    flapCl: 0.55,
    flapCd: 0.06,
    flapCm: -0.04,
    groundEffectLift: 0.1,
    groundEffectInducedDrag: 0.4,
    groundEffectCm: -0.12,
    cyBeta: -0.35,
    cyRudder: -0.08,
    cm0: 0,
    cmAlpha: -1.5,
    cmQ: -30,
    cmElevator: 1.03,
    clBeta: -0.09,
    clP: -0.47,
    clR: 0.1,
    clAileron: 0.15,
    cnBeta: 0.065,
    cnP: -0.03,
    cnR: -0.1,
    cnAileron: -0.01,
    cnRudder: 0.05,
    compressibility: null,
  },

  engine: {
    kind: 'piston',
    maxPower: 134_000,
    staticThrust: 2400,
    thrustZeroSpeed: 95,
    idlePowerFraction: 0.03,
    idleRpm: 700,
    maxRpm: 2700,
    spoolUpTau: 0.8,
    spoolDownTau: 0.6,
    rpmTau: 0.25,
    propDiameter: AIRCRAFT_GEOMETRY.propeller.diameter,
  },

  surfaces: {
    elevatorMax: 25 * DEG,
    elevatorRate: 60 * DEG,
    aileronMax: 20 * DEG,
    aileronRate: 80 * DEG,
    rudderMax: 20 * DEG,
    rudderRate: 60 * DEG,
    flapMax: 30 * DEG,
    flapRate: 10 * DEG,
    trimRange: 12 * DEG,
  },

  flapDetents: [0, 1 / 3, 2 / 3, 1],
  flapsWithGear: false,

  speedbrake: null,

  gear: {
    retractable: false,
    transitTime: 0,
    cd: 0,
    ...gearSprings(MASS, INFO.geometry, 0.05, 0.7),
    steerMaxLowSpeed: 30 * DEG,
    steerMaxHighSpeed: 6 * DEG,
    steerFadeSpeed: 25,
    frictionSpeedEps: 0.1,
    lateralSlipSaturation: 0.1,
    lateralMinSpeed: 1,
    surfaces: PAVED_RUNWAY_FRICTION,
  },

  crash: {
    hardLandingSinkRate: 4.5,
    maxSlopeDeg: 12,
    slopeMinSpeed: 1,
  },

  limits: {
    maxAngularRate: 8,
    // Safety clamp only: about twice the trainer's never-exceed speed.
    maxSpeed: 150,
  },

  fbw: null,
  thrustVector: null,
}
