/**
 * Flight-model parameters for the single-engine low-wing trainer.
 *
 * Everything is SI (kg, m, s, N, rad) unless the name says Deg.
 * Inertia is given in OUR body axes (see src/simulation/types.ts):
 *   x = pitch axis, y = yaw axis, z = roll axis.
 *
 * Aerodynamic derivatives use the conventional (aerospace) sign meaning so
 * they can be compared with published data:
 *   roll moment  Cl  + = right wing down,  P = roll rate (+ right wing down)
 *   pitch moment Cm  + = nose up,          Q = pitch rate (+ nose up)
 *   yaw moment   Cn  + = nose right,       R = yaw rate  (+ nose right)
 * The physics converts them to the body frame (see AircraftPhysics.ts).
 * Control derivatives follow ControlSurfaces signs (+ elevator = nose up,
 * + aileron = roll right, + rudder = nose right).
 */

import type { SurfaceType, Vec3 } from '../simulation/types'
import { AIRCRAFT_GEOMETRY } from './aircraftGeometry'

const DEG = Math.PI / 180

export interface GroundSurfaceFriction {
  /** Rolling-resistance coefficient (free-rolling wheel). */
  rolling: number
  /** Extra longitudinal friction coefficient at full brakes (main wheels). */
  braking: number
  /** Peak lateral (cornering) friction coefficient. */
  lateral: number
}

export interface AircraftConfig {
  /** Gross mass (kg). */
  mass: number
  /** Principal moments of inertia in body axes: x = pitch, y = yaw, z = roll (kg m^2). */
  inertia: Vec3
  wingArea: number
  wingSpan: number
  /** Mean aerodynamic chord (m). */
  chord: number

  aero: {
    /** Lift coefficient at zero body AoA, flaps up. */
    cl0: number
    /** Lift-curve slope (per rad). */
    clAlpha: number
    /** Critical (stall) AoA, positive side. */
    alphaCritDeg: number
    /** Critical AoA, negative side (a negative number). */
    alphaCritNegDeg: number
    /** Width of the blend from attached flow to flat plate past the critical AoA. */
    stallBlendDeg: number
    /** Flat-plate lift amplitude: CL = k * sin(2 alpha) when fully stalled. */
    flatPlateLift: number
    /** Flat-plate drag amplitude: CD += k * sin^2(alpha) when stalled. */
    flatPlateDrag: number
    /** stallWarning switches on this many degrees below the critical AoA. */
    stallWarningMarginDeg: number
    /** Stall flags are suppressed below this airspeed (parked, taxiing). */
    stallFlagMinSpeed: number
    cd0: number
    /** Induced-drag factor k = 1 / (pi e AR). */
    inducedK: number
    /** Lift increment at full flaps. */
    flapCl: number
    /** Drag increment at full flaps. */
    flapCd: number
    /** Pitch-moment increment at full flaps (negative = nose down). */
    flapCm: number
    /** Ground effect: fractional lift gain with the wing on the ground. */
    groundEffectLift: number
    /** Ground effect: fractional induced-drag reduction with the wing on the ground. */
    groundEffectInducedDrag: number
    /** Ground effect: pitch-moment change with the wing on the ground (less tail downwash, nose down). */
    groundEffectCm: number
    /** Side force per rad of sideslip (negative = opposes slip). */
    cyBeta: number
    cyRudder: number
    cm0: number
    /** Static pitch stability (per rad, applied as Cma * sin(alpha)). */
    cmAlpha: number
    /** Pitch damping, including the alpha-dot (downwash lag) contribution. */
    cmQ: number
    cmElevator: number
    clBeta: number
    clP: number
    clR: number
    clAileron: number
    cnBeta: number
    cnP: number
    cnR: number
    /** Adverse yaw from aileron deflection (negative). */
    cnAileron: number
    cnRudder: number
  }

  engine: {
    /** Rated power (W), informational; thrust uses staticThrust. */
    maxPower: number
    /** Static thrust at full power (N). */
    staticThrust: number
    /** Thrust falls with (V / thrustZeroSpeed)^2. */
    thrustZeroSpeed: number
    /** Fraction of full power delivered at idle. */
    idlePowerFraction: number
    idleRpm: number
    maxRpm: number
    /** First-order spool time constants (s). */
    spoolUpTau: number
    spoolDownTau: number
    /** rpm filter time constant (s). */
    rpmTau: number
    propDiameter: number
  }

  surfaces: {
    elevatorMax: number
    elevatorRate: number
    aileronMax: number
    aileronRate: number
    rudderMax: number
    rudderRate: number
    flapMax: number
    flapRate: number
    /** Elevator deflection produced by trim = +-1 (rad). */
    trimRange: number
  }

  /** Flap lever positions (fractions 0..1). Informational for the input layer. */
  flapDetents: readonly number[]

  gear: {
    /** Spring rates (N/m) and dampers (N s/m) per main wheel / nose wheel. */
    mainSpring: number
    mainDamper: number
    noseSpring: number
    noseDamper: number
    /** Nose-wheel steering angle at full pedal, low speed. */
    steerMaxLowSpeed: number
    /** Nose-wheel steering angle at full pedal at and above steerFadeSpeed. */
    steerMaxHighSpeed: number
    steerFadeSpeed: number
    /** Longitudinal friction is regularised below this speed (m/s). */
    frictionSpeedEps: number
    /** Slip angle (rad) at which lateral tyre force saturates. */
    lateralSlipSaturation: number
    /** Minimum speed used in the slip-angle denominator (m/s). */
    lateralMinSpeed: number
    surfaces: Record<SurfaceType, GroundSurfaceFriction>
  }

  crash: {
    /** Gear touchdown sink rate (m/s) above which the landing is a crash. */
    hardLandingSinkRate: number
    /** Ground contact on slopes steeper than this ends the flight. */
    maxSlopeDeg: number
    /** ... but only while moving faster than this (m/s). */
    slopeMinSpeed: number
  }

  limits: {
    /** Clamp on |angular velocity| (rad/s). */
    maxAngularRate: number
    /** Clamp on |velocity| (m/s). */
    maxSpeed: number
  }
}

const MASS = 1100
const G = 9.80665

/**
 * Spring rates sized so every strut compresses by the same STATIC_COMPRESSION
 * under its share of the parked weight (CG at z = 0 between nose and mains).
 */
const STATIC_COMPRESSION = 0.05
const GEAR_DAMPING_RATIO = 0.7
const mainZ = AIRCRAFT_GEOMETRY.gear.mainLeft.z
const noseZ = AIRCRAFT_GEOMETRY.gear.nose.z
const noseLoad = (MASS * G * mainZ) / (mainZ - noseZ)
const mainLoad = (MASS * G - noseLoad) / 2
const mainSpring = mainLoad / STATIC_COMPRESSION
const noseSpring = noseLoad / STATIC_COMPRESSION
const damper = (k: number, load: number): number => 2 * GEAR_DAMPING_RATIO * Math.sqrt(k * (load / G))

export const DEFAULT_AIRCRAFT: AircraftConfig = {
  mass: MASS,
  inertia: { x: 1925, y: 2810, z: 1355 },
  wingArea: AIRCRAFT_GEOMETRY.wing.area,
  wingSpan: AIRCRAFT_GEOMETRY.wing.span,
  chord: AIRCRAFT_GEOMETRY.wing.chord,

  aero: {
    cl0: 0.4,
    clAlpha: 4.2,
    alphaCritDeg: 15,
    alphaCritNegDeg: -12,
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
  },

  engine: {
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

  gear: {
    mainSpring,
    mainDamper: damper(mainSpring, mainLoad),
    noseSpring,
    noseDamper: damper(noseSpring, noseLoad),
    steerMaxLowSpeed: 30 * DEG,
    steerMaxHighSpeed: 6 * DEG,
    steerFadeSpeed: 25,
    frictionSpeedEps: 0.1,
    lateralSlipSaturation: 0.1,
    lateralMinSpeed: 1,
    surfaces: {
      paved: { rolling: 0.02, braking: 0.6, lateral: 0.8 },
      grass: { rolling: 0.07, braking: 0.35, lateral: 0.55 },
      water: { rolling: 0.5, braking: 0, lateral: 0.5 },
    },
  },

  crash: {
    hardLandingSinkRate: 4.5,
    maxSlopeDeg: 12,
    slopeMinSpeed: 1,
  },

  limits: {
    maxAngularRate: 8,
    maxSpeed: 150,
  },
}
