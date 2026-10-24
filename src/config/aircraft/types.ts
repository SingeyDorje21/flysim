/**
 * Flight-model parameter schema shared by every aircraft type.
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

import type { AircraftGeometry, AircraftId } from '../aircraftCatalog'
import type { SurfaceType, Vec3 } from '../../simulation/types'

export interface GroundSurfaceFriction {
  /** Rolling-resistance coefficient (free-rolling wheel). */
  rolling: number
  /** Extra longitudinal friction coefficient at full brakes (main wheels). */
  braking: number
  /** Peak lateral (cornering) friction coefficient. */
  lateral: number
}

/**
 * Compressibility drag increment dCD(M):
 *   M <= mcrit:          0
 *   mcrit < M <= mpeak:  cdPeak * ((M - mcrit) / (mpeak - mcrit))^exponent   (drag rise)
 *   M > mpeak:           cdSupersonic + (cdPeak - cdSupersonic) * exp(-(M - mpeak) / decay)
 * Finite and smooth enough everywhere, so a dive past Mach 1 stays sane.
 */
export interface CompressibilityConfig {
  mcrit: number
  mpeak: number
  cdPeak: number
  exponent: number
  cdSupersonic: number
  decay: number
  /** Induced-drag factor grows as k * (1 + inducedMachGain * max(0, M - 0.9)) (supersonic lift is less efficient). */
  inducedMachGain: number
}

export interface AeroConfig {
  /** Lift coefficient at zero body AoA, flaps up. */
  cl0: number
  /** Lift-curve slope (per rad). */
  clAlpha: number
  /** Critical (stall) AoA, positive side, clean. */
  alphaCritDeg: number
  /** Critical AoA, negative side (a negative number). */
  alphaCritNegDeg: number
  /** Extra critical AoA with the slats out (they deploy with the first flap detent). 0 = no slats. */
  slatAlphaCritDeg: number
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
  /** Transonic / supersonic drag. null = incompressible (the piston trainer). */
  compressibility: CompressibilityConfig | null
}

export interface PistonEngineConfig {
  kind: 'piston'
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

/**
 * Thrust lapse T / T_static = sigma^densityExponent * max(0.05, 1 + m1 M + m2 M^2 + m3 M^3),
 * sigma = rho / rho0.
 */
export interface ThrustLapse {
  densityExponent: number
  m1: number
  m2: number
  m3: number
}

export interface ReverserConfig {
  /** Reverse thrust as a fraction of the forward gross thrust at the same spool (0.35..0.4); with maxSpool ~0.95 that is ~35 % of maximum forward thrust. */
  efficiency: number
  /** Spool (thrust fraction) commanded by full reverse. */
  maxSpool: number
  /** Reverser door transit time (s). */
  deployTime: number
  /** Reverse is only accepted with the throttle at or below this. */
  maxThrottle: number
}

export interface AfterburnerConfig {
  /** Throttle lever at or above which the afterburner is selected. */
  detent: number
  /** Total static sea-level wet thrust, all engines (N). */
  wetThrust: number
  wetLapse: ThrustLapse
  /** Dry spool must be at least this before the afterburner can light. */
  minSpool: number
  /** Delay (s) between selection (with spool >= minSpool) and light-up. */
  lightUpDelay: number
  /** Time (s) for the afterburner thrust to ramp from 0 to full once lit. */
  rampTime: number
}

export interface TurbofanEngineConfig {
  kind: 'turbofan' | 'afterburningTurbofan'
  engines: number
  /** Total static sea-level maximum dry thrust, all engines (N). */
  staticThrust: number
  dryLapse: ThrustLapse
  /** Thrust fraction at idle. */
  idleThrustFraction: number
  /** N1 at idle (fraction of max). */
  idleN1: number
  /** Fan speed at N1 = 1 (rpm), reported in EngineState.rpm. */
  maxFanRpm: number
  /**
   * Spool dynamics on the normalised spool s (0 idle .. 1 max):
   *   accelerating ds/dt = min(upBase + upGain s, (target - s) / settleTau)
   *   decelerating ds/dt = -min(downBase + downGain s, (s - target) / settleTau)
   * Slow at low N1, faster near the top, like a real fan.
   */
  spoolUpBase: number
  spoolUpGain: number
  spoolDownBase: number
  spoolDownGain: number
  settleTau: number
  reverser: ReverserConfig | null
  afterburner: AfterburnerConfig | null
}

export type EngineConfig = PistonEngineConfig | TurbofanEngineConfig

export interface SpeedbrakeConfig {
  /** Drag increment at full extension. */
  cd: number
  /** Lift-coefficient loss at full extension in flight. */
  clLossFlight: number
  /** Lift-coefficient loss at full extension with weight on wheels (ground spoilers: lift dump). */
  clLossGround: number
  /** Extension rate (fraction per second). */
  rate: number
  /** Ground spoilers deploy automatically on touchdown with the throttle at idle. */
  autoGround: boolean
  /** ... at or below this throttle ... */
  autoMaxThrottle: number
  /** ... and above this ground speed (m/s). */
  autoMinSpeed: number
}

/**
 * Fly-by-wire control law (nonlinear dynamic inversion on body rates).
 * Stick pitch commands a pitch rate scaled so that full deflection gives the
 * load-factor limit (or maxPitchRate at low speed); neutral stick holds the
 * flight path (auto-trim). Stick roll commands a roll rate; neutral holds
 * the bank angle. Pedals command sideslip-free yaw rate on top of turn
 * coordination.
 */
export interface FbwConfig {
  /** Rate-tracking bandwidths (1/s): how quickly the actual rate follows the command. */
  pitchBandwidth: number
  rollBandwidth: number
  yawBandwidth: number
  /** Pitch rate at full stick at low speed (rad/s). */
  maxPitchRate: number
  /** Roll rate at full stick (rad/s). */
  maxRollRate: number
  /** Yaw rate at full pedal on top of coordination (rad/s). */
  maxPedalYawRate: number
  /** Load-factor limits. */
  nzMax: number
  nzMin: number
  /** Flight-path hold gain with the stick neutral (1/s). */
  pathHoldGain: number
  /** Bank hold / limit gain (1/s). */
  bankHoldGain: number
  /** Turn compensation (neutral stick holds altitude) applies up to this bank. */
  bankCompensationDeg: number
  /** Hard bank limit with full stick, null = none. */
  bankLimitDeg: number | null
  /** With the stick released beyond this bank the aircraft rolls back to it, null = holds any bank. */
  bankNeutralLimitDeg: number | null
  /**
   * AoA protection / limiter, as margins below the current critical AoA
   * (which grows with the slats). Neutral stick holds at most alpha-prot,
   * full aft stick alpha-max. Negative margins put the limit beyond the
   * stall (the F-22's post-stall capability).
   */
  alphaProtMarginDeg: number
  alphaMaxMarginDeg: number
  alphaGain: number
  /** Pitch attitude limits (deg), null = none. */
  pitchLimitUpDeg: number | null
  pitchLimitDownDeg: number | null
  /** Overspeed protection: nose-up pitch rate (rad/s) per unit fractional exceedance of VMO / MMO. 0 = off. */
  overspeedGain: number
  /** Sideslip suppression gain (1/s). */
  betaGain: number
  /** Time (s) to blend from the direct ground law into the flight law after lift-off. */
  flightBlendTime: number
}

export interface ThrustVectorConfig {
  /** Max nozzle deflection (rad). */
  maxAngle: number
  /** Nozzle slew rate (rad/s). */
  rate: number
  /** Nozzle distance aft of the CG (m). */
  arm: number
}

export interface AircraftConfig {
  id: AircraftId
  /** Gross mass (kg). */
  mass: number
  /** Principal moments of inertia in body axes: x = pitch, y = yaw, z = roll (kg m^2). */
  inertia: Vec3
  wingArea: number
  wingSpan: number
  /** Mean aerodynamic chord (m). */
  chord: number
  /** Body-frame height of the wing (m), for ground effect. */
  wingY: number
  /** Gear contact and strike points (catalog geometry). */
  geometry: AircraftGeometry
  /** Speed limits used by protections: VMO as equivalent airspeed (m/s) and MMO. */
  vmo: number
  mmo: number | null

  aero: AeroConfig
  engine: EngineConfig

  surfaces: {
    elevatorMax: number
    elevatorRate: number
    aileronMax: number
    aileronRate: number
    rudderMax: number
    rudderRate: number
    flapMax: number
    flapRate: number
    /** Elevator deflection produced by trim = +-1 (rad). Ignored by fly-by-wire types (auto-trim). */
    trimRange: number
  }

  /** Flap lever positions (fractions 0..1). A single [0] means no flap lever: the lever is ignored. */
  flapDetents: readonly number[]
  /** Flaps scheduled by the flight computer: fully down with the gear down, up with it up (F-22 flaperons). */
  flapsWithGear: boolean

  /** null = none fitted (the trainer). */
  speedbrake: SpeedbrakeConfig | null

  gear: {
    /** Retractable gear; fixed gear always reports gearPosition = 1. */
    retractable: boolean
    /** Full extension or retraction time (s). */
    transitTime: number
    /** Drag increment with the gear fully down (0 when already in cd0, e.g. fixed gear). */
    cd: number
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
    /**
     * Gear touchdown sink rate (m/s) above which the landing is hard: it scores
     * badly, and GEAR_FAILURE_FACTOR times it breaks the gear (a crash).
     */
    hardLandingSinkRate: number
    /** Ground contact on slopes steeper than this ends the flight. */
    maxSlopeDeg: number
    /** ... but only while moving faster than this (m/s). */
    slopeMinSpeed: number
  }

  limits: {
    /** Clamp on |angular velocity| (rad/s). */
    maxAngularRate: number
    /** Safety clamp on |velocity| (m/s), well above the type's real top speed. */
    maxSpeed: number
  }

  /** null = direct (mechanical) controls. */
  fbw: FbwConfig | null
  /** null = no thrust vectoring. */
  thrustVector: ThrustVectorConfig | null
}

const G = 9.80665

/**
 * Gear spring-dampers sized so every strut compresses by `staticCompression`
 * under its share of the parked weight (CG between nose and mains).
 */
export function gearSprings(
  mass: number,
  geometry: AircraftGeometry,
  staticCompression: number,
  dampingRatio: number,
): { mainSpring: number; mainDamper: number; noseSpring: number; noseDamper: number } {
  const g = geometry.gear
  const mainZ = (g.mainLeft.z + g.mainRight.z) / 2
  const noseLoad = (mass * G * mainZ) / (mainZ - g.nose.z)
  const mainLoad = (mass * G - noseLoad) / 2
  const mainSpring = mainLoad / staticCompression
  const noseSpring = noseLoad / staticCompression
  const damper = (k: number, load: number): number => 2 * dampingRatio * Math.sqrt(k * (load / G))
  return {
    mainSpring,
    mainDamper: damper(mainSpring, mainLoad),
    noseSpring,
    noseDamper: damper(noseSpring, noseLoad),
  }
}

/**
 * Principal inertia from Roskam's non-dimensional radii of gyration:
 *   I_roll  = m (Rx b / 2)^2,  I_pitch = m (Ry L / 2)^2,  I_yaw = m (Rz (b + L) / 4)^2
 * Returned in our body axes (x = pitch, y = yaw, z = roll).
 */
export function inertiaFromGyration(
  mass: number,
  span: number,
  length: number,
  r: { roll: number; pitch: number; yaw: number },
): Vec3 {
  const kRoll = (r.roll * span) / 2
  const kPitch = (r.pitch * length) / 2
  const kYaw = (r.yaw * (span + length)) / 4
  return { x: mass * kPitch * kPitch, y: mass * kYaw * kYaw, z: mass * kRoll * kRoll }
}

export const PAVED_RUNWAY_FRICTION: Record<SurfaceType, GroundSurfaceFriction> = {
  paved: { rolling: 0.02, braking: 0.6, lateral: 0.8 },
  grass: { rolling: 0.07, braking: 0.35, lateral: 0.55 },
  water: { rolling: 0.5, braking: 0, lateral: 0.5 },
}
