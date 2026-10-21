/**
 * Six-degree-of-freedom flight model for every flyable type (light piston
 * trainer, airliners, business jet, fighter), configured per type by
 * src/config/aircraft.ts. Pure TypeScript: no three.js, no React, no
 * Math.random, no allocation per step.
 *
 * Integration: semi-implicit Euler at a fixed step (default 1/120 s), exact
 * quaternion exponential for the attitude.
 *
 * Sign conventions are those of ./types.ts. Aerodynamic derivatives in the
 * config use the conventional aerospace meaning; they are mapped here:
 *   roll rate  P (+ right wing down) = -omega.z     torque.z = -L
 *   pitch rate Q (+ nose up)         = +omega.x     torque.x = +M
 *   yaw rate   R (+ nose right)      = -omega.y     torque.y = -N
 *
 * Systems per step: pilot inputs (with refusals) -> gear / speed brakes /
 * flaps -> engine (piston, turbofan with reverser, afterburner) -> flight
 * controls (direct, or fly-by-wire by dynamic inversion) -> actuators ->
 * forces -> integration -> crash detection -> derived state.
 */

import { getAircraftConfig, type AircraftConfig, type FbwConfig, type TurbofanEngineConfig } from '../config/aircraft'
import type { AircraftId } from '../config/aircraftCatalog'
import {
  aeroCoefficients,
  criticalAlphaDeg,
  flapShape,
  stallBlend,
  type AeroCoefficients,
} from './aerodynamics'
import { GRAVITY, airDensity, densityRatio, speedOfSound } from './atmosphere'
import {
  DEG2RAD,
  RAD2DEG,
  clamp,
  finiteOr,
  integrateQuat,
  moveTowards,
  normalizeQuat,
  quatFromAttitude,
  rotateVec,
  rotateVecInverse,
  sanitize,
} from './math'
import { copyAircraftState, createAircraftState } from './state'
import type {
  AircraftState,
  ControlInputs,
  FlightModel,
  SpawnState,
  SurfaceType,
  TerrainSampler,
  Vec3,
} from './types'

export interface AircraftPhysicsOptions {
  terrain: TerrainSampler
  spawn: SpawnState
  /** Aircraft type. Default 'trainer'. */
  aircraft?: AircraftId
  /** Fixed step (s). Default 1/120. */
  fixedDt?: number
  /** Overrides the type's parameters (tests, tuning). */
  config?: AircraftConfig
}

/** Crash reasons reported in AircraftState.crashReason. */
export const CRASH_REASONS = {
  water: 'Ditched in water',
  hardLanding: 'Hard landing',
  terrain: 'Terrain collision',
  tail: 'Tail strike',
  wingtip: 'Wingtip strike',
  propeller: 'Propeller strike',
  engine: 'Engine pod strike',
  nose: 'Nose strike',
  belly: 'Belly impact',
  numeric: 'Simulation error',
} as const

interface GearDef {
  /** Body-frame wheel-bottom point (geometry). */
  r: Vec3
  main: boolean
  spring: number
  damper: number
  /** Unloaded strut extension below the geometry point (m). */
  extension: number
}

interface StrikeDef {
  r: Vec3
  reason: string
}

const DEFAULT_DT = 1 / 120
/** Minimum CG height over the terrain above which no part of the airframe can touch the ground. */
const MIN_CLEARANCE_SKIP_HEIGHT = 15
const SLOPE_SAMPLE = 1
/** Stick deflections smaller than this count as neutral for the FBW holds. */
const FBW_DEADBAND = 0.02
/** FBW returns to the direct ground law this quickly after touchdown (s). */
const FBW_GROUND_BLEND_TIME = 0.5
/** Pitch-attitude limit gain (1/s). */
const PITCH_LIMIT_GAIN = 1
/** Load-factor limiter gain. */
const NZ_LIMIT_GAIN = 2
/** Stick-law load-factor integrator gain (1/s) and authority (g). */
const NZ_INTEGRAL_GAIN = 3
const NZ_INTEGRAL_MAX = 2
const NZ_INTEGRAL_WINDOW = 1
/** After a stick release the holds keep re-latching while the rate transient lasts (s, rad/s). */
const RELEASE_LATCH_TIME = 3
/** Fly-by-wire flare mode arms below this wheel height (m, ~50 ft) when descending with the gear down. */
const FLARE_MODE_HEIGHT = 15
/** Steepest path neutral stick holds in flare mode: a gentle descent (-1.5 deg, ~1.7 m/s at 65 m/s). */
const FLARE_MODE_PATH = -1.5 * (Math.PI / 180)
/**
 * Derotation law (as on Airbus jets): after a landing touchdown on the main
 * wheels the pitch law stays active until the nose wheel is down and lowers
 * the nose at this rate with the stick neutral (rad/s, 2.5 deg/s). Back stick
 * slows it (full back holds the attitude), forward stick doubles it.
 */
const DEROTATION_RATE = 2.5 * (Math.PI / 180)
/** Stick load-factor limits with the gear down (g). */
const GEAR_DOWN_NZ_MAX = 2
const GEAR_DOWN_NZ_MIN = 0
const G_SETTLE = 0.08
const ROLL_SETTLE_RATE = 0.03
/** AoA lead gain as a fraction of the pitch bandwidth. */
const ALPHA_LEAD_FACTOR = 0.4
/** Speed floor for g / V terms in the control laws (m/s). */
const FBW_MIN_SPEED = 30

const NEG_Z: Vec3 = Object.freeze({ x: 0, y: 0, z: -1 })
const UNIT_X: Vec3 = Object.freeze({ x: 1, y: 0, z: 0 })
const UNIT_Y: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 })

function setTmp(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x
  out.y = y
  out.z = z
  return out
}

function strikeReason(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('tail')) return CRASH_REASONS.tail
  if (n.includes('wingtip') || n.includes('wing')) return CRASH_REASONS.wingtip
  if (n.includes('engine') || n.includes('nacelle') || n.includes('pod')) return CRASH_REASONS.engine
  if (n.includes('prop')) return CRASH_REASONS.propeller
  if (n.includes('nose')) return CRASH_REASONS.nose
  if (n.includes('belly')) return CRASH_REASONS.belly
  return CRASH_REASONS.terrain
}

/** Wrap an angle to (-pi, pi]. */
function wrapPi(a: number): number {
  let x = a
  while (x > Math.PI) x -= 2 * Math.PI
  while (x <= -Math.PI) x += 2 * Math.PI
  return x
}

/** Thrust lapse sigma^n * max(0.05, 1 + m1 M + m2 M^2 + m3 M^3). */
function lapse(l: { densityExponent: number; m1: number; m2: number; m3: number }, sigma: number, mach: number): number {
  const m = Math.min(Math.max(mach, 0), 4)
  const mf = 1 + m * (l.m1 + m * (l.m2 + m * l.m3))
  return Math.pow(sigma, l.densityExponent) * Math.max(0.05, mf)
}

export class AircraftPhysics implements FlightModel {
  readonly state: AircraftState
  readonly previousState: AircraftState
  readonly fixedDt: number
  readonly config: AircraftConfig
  readonly aircraftId: AircraftId

  private readonly terrain: TerrainSampler
  private readonly pending: ControlInputs = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    flaps: 0,
    brakes: 0,
    trim: 0,
    gear: 1,
    speedbrake: 0,
    reverse: 0,
  }
  private readonly gear: GearDef[]
  private readonly gearContact: boolean[]
  private readonly strikes: StrikeDef[]
  /** CG height above the ground when parked (m). */
  private readonly cgHeightOnGear: number
  private readonly clearanceSkipHeight: number
  private readonly jet: TurbofanEngineConfig | null
  private readonly fbw: FbwConfig | null

  // Precomputed filter gains.
  private readonly spoolUpGain: number
  private readonly spoolDownGain: number
  private readonly rpmGain: number
  private readonly settleGain: number

  // Scratch (no per-step allocation).
  private readonly vBody: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly tmpA: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly tmpB: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly tmpC: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly coeffs: AeroCoefficients = { cl: 0, cd: 0, stall: 0 }
  /** Sum of non-gravity forces, world frame (N). */
  private readonly force: Vec3 = { x: 0, y: 0, z: 0 }
  /** Sum of torques about the CG, body frame (N m). */
  private readonly torque: Vec3 = { x: 0, y: 0, z: 0 }
  /** Ground torque accumulated in world frame, converted at the end. */
  private readonly groundTorqueW: Vec3 = { x: 0, y: 0, z: 0 }

  // Air data at the current pose (updateAirData).
  private adSpeed = 0
  private adAlpha = 0
  private adBeta = 0
  private adRho = 0
  private adMach = 0
  private adQbar = 0
  private adGroundEffect = 0
  private adFlapFrac = 0

  // Hidden system state (all cleared by reset()).
  /** Thrust-reverser door position 0 (stowed) .. 1 (deployed). */
  private reverserPos = 0
  /** Time the afterburner has been selected with the engine ready (s). */
  private abTimer = 0
  /** Afterburner thrust fraction 0..1. */
  private abFrac = 0
  /** FBW law blend: 0 = direct ground law, 1 = flight law. */
  private fbwBlend = 0
  /** FBW flare mode (see FLARE_MODE_HEIGHT). */
  private flareArmed = false
  /**
   * Set by flare mode on a landing; while the main wheels are down and the
   * nose wheel is not, the derotation law flies the pitch. Cleared when the
   * nose wheel touches or on a go-around (never set on a take-off).
   */
  private derotationArmed = false
  /** Pitch attitude flare mode holds as a ceiling with the stick neutral (rad). */
  private flareThetaRef = 0
  /** Pitching moment of the landing gear on the last step (body, N m, + nose up). */
  private gearPitchMoment = 0
  /** Flight-path angle held with the stick neutral (rad). */
  private gammaRef = 0
  /** Bank angle held with the stick neutral (rad). */
  private bankRef = 0
  /** Load-factor error integrator of the stick law (g). */
  private nzInt = 0
  /** Time since the pitch / roll stick returned to neutral (s), capped at RELEASE_LATCH_TIME. */
  private pitchNeutralTime = 0
  private rollNeutralTime = 0

  // Per-step crash flags.
  private flagWater = false
  private flagHardLanding = false
  private flagSlope = false
  private terrainBelowCg = 0
  private nearGround = true

  constructor(opts: AircraftPhysicsOptions) {
    this.terrain = opts.terrain
    this.config = opts.config ?? getAircraftConfig(opts.aircraft ?? 'trainer')
    this.aircraftId = opts.aircraft ?? this.config.id
    const dt = opts.fixedDt
    this.fixedDt = dt !== undefined && Number.isFinite(dt) && dt > 0 && dt <= 0.05 ? dt : DEFAULT_DT

    const cfg = this.config
    const geo = cfg.geometry
    const g = geo.gear
    const weight = cfg.mass * GRAVITY
    const mainZ = (g.mainLeft.z + g.mainRight.z) / 2
    const noseLoad = (weight * mainZ) / (mainZ - g.nose.z)
    const mainLoad = (weight - noseLoad) / 2
    const gc = cfg.gear
    this.gear = [
      { r: { ...g.mainLeft }, main: true, spring: gc.mainSpring, damper: gc.mainDamper, extension: mainLoad / gc.mainSpring },
      { r: { ...g.mainRight }, main: true, spring: gc.mainSpring, damper: gc.mainDamper, extension: mainLoad / gc.mainSpring },
      { r: { ...g.nose }, main: false, spring: gc.noseSpring, damper: gc.noseDamper, extension: noseLoad / gc.noseSpring },
    ]
    this.gearContact = [false, false, false]
    this.cgHeightOnGear = -(g.mainLeft.y + g.mainRight.y) / 2

    this.strikes = []
    let radius = 0
    for (const name of Object.keys(geo.strikePoints)) {
      const r = geo.strikePoints[name]
      this.strikes.push({ r: { ...r }, reason: strikeReason(name) })
      radius = Math.max(radius, Math.hypot(r.x, r.y, r.z))
    }
    for (const gd of this.gear) radius = Math.max(radius, Math.hypot(gd.r.x, gd.r.y, gd.r.z))
    this.clearanceSkipHeight = Math.max(MIN_CLEARANCE_SKIP_HEIGHT, radius + 5)

    const e = cfg.engine
    if (e.kind === 'piston') {
      this.jet = null
      this.spoolUpGain = 1 - Math.exp(-this.fixedDt / e.spoolUpTau)
      this.spoolDownGain = 1 - Math.exp(-this.fixedDt / e.spoolDownTau)
      this.rpmGain = 1 - Math.exp(-this.fixedDt / e.rpmTau)
      this.settleGain = 1
    } else {
      this.jet = e
      this.spoolUpGain = 1
      this.spoolDownGain = 1
      this.rpmGain = 1
      this.settleGain = 1 - Math.exp(-this.fixedDt / e.settleTau)
    }
    this.fbw = cfg.fbw

    this.state = createAircraftState()
    this.previousState = createAircraftState()
    this.reset(opts.spawn)
  }

  // ---------------------------------------------------------------- inputs

  setControls(controls: Partial<ControlInputs>): void {
    if (!controls) return
    const p = this.pending
    if (controls.pitch !== undefined) p.pitch = sanitize(controls.pitch, -1, 1)
    if (controls.roll !== undefined) p.roll = sanitize(controls.roll, -1, 1)
    if (controls.yaw !== undefined) p.yaw = sanitize(controls.yaw, -1, 1)
    if (controls.throttle !== undefined) p.throttle = sanitize(controls.throttle, 0, 1)
    if (controls.flaps !== undefined) p.flaps = sanitize(controls.flaps, 0, 1)
    if (controls.brakes !== undefined) p.brakes = sanitize(controls.brakes, 0, 1)
    if (controls.trim !== undefined) p.trim = sanitize(controls.trim, -1, 1)
    // NaN gear keeps the gear down (the safe default).
    if (controls.gear !== undefined) p.gear = sanitize(controls.gear, 0, 1, 1)
    if (controls.speedbrake !== undefined) p.speedbrake = sanitize(controls.speedbrake, 0, 1)
    if (controls.reverse !== undefined) p.reverse = sanitize(controls.reverse, 0, 1)
  }

  // ----------------------------------------------------------------- reset

  reset(spawn: SpawnState): void {
    const s = this.state
    const cfg = this.config
    const fresh = createAircraftState()
    copyAircraftState(s, fresh)

    const x = finiteOr(spawn.position.x, 0)
    const z = finiteOr(spawn.position.z, 0)
    const heading = finiteOr(spawn.headingDeg, 0)
    const airspeed = clamp(finiteOr(spawn.airspeed, 0), 0, cfg.limits.maxSpeed)
    const throttle = sanitize(spawn.throttle, 0, 1)
    const flaps = cfg.flapDetents.length > 1 ? sanitize(spawn.flaps, 0, 1) : 0
    const running = spawn.engineRunning ?? true
    const gearDown = !cfg.gear.retractable || spawn.onGround || spawn.gearUp !== true
    const flapSurface = cfg.flapsWithGear ? (gearDown ? 1 : 0) : flaps

    let trim = 0
    let trimElevator = 0
    let gamma = 0
    s.position.x = x
    s.position.z = z
    if (spawn.onGround) {
      quatFromAttitude(heading, 0, 0, s.orientation)
      s.position.y = this.groundHeight(x, z) + this.cgHeightOnGear
      // Velocity along the nose (level).
      this.tmpA.x = 0
      this.tmpA.y = 0
      this.tmpA.z = -airspeed
      rotateVec(s.orientation, this.tmpA, s.velocity)
    } else {
      const pitch = clamp(finiteOr(spawn.pitchDeg ?? 0, 0), -89, 89)
      s.position.y = finiteOr(spawn.position.y, 0)
      const t = this.solveTrim(airspeed, flapSurface, s.position.y, pitch * DEG2RAD)
      if (this.fbw) {
        // Fly-by-wire: pitchDeg is the flight path, which neutral stick then holds
        // (pitchDeg 0 = level hands-off); the nose sits the trim AoA above it.
        quatFromAttitude(heading, clamp(pitch + t.alpha * RAD2DEG, -89, 89), 0, s.orientation)
        gamma = pitch * DEG2RAD
        trimElevator = t.elevator
      } else {
        // Direct controls: pitchDeg is the nose attitude; the path sits trimAlpha below it.
        quatFromAttitude(heading, pitch, 0, s.orientation)
        gamma = pitch * DEG2RAD - t.alpha
        trim = t.trim
        trimElevator = clamp(trim * cfg.surfaces.trimRange, -cfg.surfaces.elevatorMax, cfg.surfaces.elevatorMax)
      }
      // Velocity trimAlpha below the nose.
      this.tmpA.x = 0
      this.tmpA.y = -airspeed * Math.sin(t.alpha)
      this.tmpA.z = -airspeed * Math.cos(t.alpha)
      rotateVec(s.orientation, this.tmpA, s.velocity)
    }

    const c = s.controls
    c.pitch = 0
    c.roll = 0
    c.yaw = 0
    c.throttle = throttle
    c.flaps = flaps
    c.brakes = 0
    c.trim = trim
    c.gear = gearDown ? 1 : 0
    c.speedbrake = 0
    c.reverse = 0
    const p = this.pending
    p.pitch = 0
    p.roll = 0
    p.yaw = 0
    p.throttle = throttle
    p.flaps = flaps
    p.brakes = 0
    p.trim = trim
    p.gear = c.gear
    p.speedbrake = 0
    p.reverse = 0

    const sf = cfg.surfaces
    s.surfaces.elevator = trimElevator
    s.surfaces.aileron = 0
    s.surfaces.rudder = 0
    s.surfaces.flaps = flapSurface * sf.flapMax
    s.gearPosition = gearDown ? 1 : 0
    s.speedbrakePosition = 0
    s.thrustVector = 0

    // Hidden system state.
    this.reverserPos = 0
    const ab = this.jet?.afterburner ?? null
    const abOn = ab !== null && running && throttle >= ab.detent
    this.abTimer = abOn && ab ? ab.lightUpDelay : 0
    this.abFrac = abOn ? 1 : 0
    this.fbwBlend = spawn.onGround ? 0 : 1
    this.flareArmed = false
    this.derotationArmed = false
    this.flareThetaRef = 0
    this.gearPitchMoment = 0
    this.gammaRef = gamma
    this.bankRef = 0
    this.nzInt = 0
    this.pitchNeutralTime = RELEASE_LATCH_TIME
    this.rollNeutralTime = RELEASE_LATCH_TIME

    const eng = s.engine
    eng.running = running
    eng.spool = running ? this.spoolTarget(throttle, 0) : 0
    eng.afterburner = abOn
    eng.thrust = 0
    this.updateEngineSpeeds(airspeed, true)

    // Gear contact latches: settled on the ground, or clear of it.
    this.updateTerrainProximity()
    for (let i = 0; i < this.gear.length; i++) {
      this.gearContact[i] = this.nearGround && s.gearPosition >= 1 && this.gearCompression(i) > 0
    }
    this.flagWater = false
    this.flagHardLanding = false
    this.flagSlope = false

    // Evaluate forces once (no touchdown detection) to fill thrust and gForce.
    this.computeForces(false)
    this.updateDerived()
    copyAircraftState(this.previousState, s)
  }

  // ------------------------------------------------------------------ step

  step(): void {
    const s = this.state
    if (s.crashed) {
      copyAircraftState(this.previousState, s)
      return
    }
    copyAircraftState(this.previousState, s)
    const dt = this.fixedDt
    const cfg = this.config
    const weightOnWheels = this.gearContact[0] || this.gearContact[1] || this.gearContact[2]

    // Apply latched pilot inputs (with refusals).
    const c = s.controls
    const p = this.pending
    if (!cfg.gear.retractable || (weightOnWheels && p.gear < 0.5)) {
      // Fixed gear, or gear-up refused with weight on wheels: the command is discarded.
      p.gear = 1
    }
    if (cfg.flapDetents.length <= 1) p.flaps = 0
    if (cfg.speedbrake === null) p.speedbrake = 0
    if (this.jet === null || this.jet.reverser === null) p.reverse = 0
    c.pitch = p.pitch
    c.roll = p.roll
    c.yaw = p.yaw
    c.throttle = p.throttle
    c.flaps = p.flaps
    c.brakes = p.brakes
    c.trim = p.trim
    c.gear = p.gear
    c.speedbrake = p.speedbrake
    c.reverse = p.reverse

    rotateVecInverse(s.orientation, s.velocity, this.vBody)
    const fwd = Math.max(0, -this.vBody.z)
    this.updateTerrainProximity()
    this.updateAirData()

    // --- Systems: gear, speed brakes, flaps.
    const sf = cfg.surfaces
    if (cfg.gear.retractable) {
      s.gearPosition = moveTowards(s.gearPosition, c.gear >= 0.5 ? 1 : 0, dt / Math.max(cfg.gear.transitTime, 0.1))
    } else {
      s.gearPosition = 1
    }
    const sb = cfg.speedbrake
    if (sb) {
      const groundSpeed = Math.sqrt(s.velocity.x * s.velocity.x + s.velocity.z * s.velocity.z)
      const auto = sb.autoGround && weightOnWheels && c.throttle <= sb.autoMaxThrottle && groundSpeed > sb.autoMinSpeed
      const target = auto ? 1 : c.speedbrake
      s.speedbrakePosition = moveTowards(s.speedbrakePosition, target, sb.rate * dt)
    } else {
      s.speedbrakePosition = 0
    }
    const flapTarget = cfg.flapsWithGear ? s.gearPosition : c.flaps
    s.surfaces.flaps = moveTowards(s.surfaces.flaps, flapTarget * sf.flapMax, sf.flapRate * dt)

    // --- Engine.
    this.updateEngine(weightOnWheels, fwd)

    // --- Flight controls -> actuators.
    if (this.fbw) this.flyByWire(this.fbw, weightOnWheels)
    else {
      const sur = s.surfaces
      const elevCmd = clamp(c.pitch * sf.elevatorMax + c.trim * sf.trimRange, -sf.elevatorMax, sf.elevatorMax)
      sur.elevator = moveTowards(sur.elevator, elevCmd, sf.elevatorRate * dt)
      sur.aileron = moveTowards(sur.aileron, c.roll * sf.aileronMax, sf.aileronRate * dt)
      sur.rudder = moveTowards(sur.rudder, c.yaw * sf.rudderMax, sf.rudderRate * dt)
    }

    // Forces at the start-of-step state.
    this.flagWater = false
    this.flagHardLanding = false
    this.flagSlope = false
    this.computeForces(true)

    // Integrate linear motion.
    const m = cfg.mass
    const v = s.velocity
    v.x += (this.force.x / m) * dt
    v.y += (this.force.y / m - GRAVITY) * dt
    v.z += (this.force.z / m) * dt
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
    if (speed > cfg.limits.maxSpeed) {
      const k = cfg.limits.maxSpeed / speed
      v.x *= k
      v.y *= k
      v.z *= k
    }
    s.position.x += v.x * dt
    s.position.y += v.y * dt
    s.position.z += v.z * dt

    // Integrate angular motion (Euler's equations, diagonal inertia).
    const I = cfg.inertia
    const w = s.angularVelocity
    const wx = w.x
    const wy = w.y
    const wz = w.z
    const gx = wy * I.z * wz - wz * I.y * wy
    const gy = wz * I.x * wx - wx * I.z * wz
    const gz = wx * I.y * wy - wy * I.x * wx
    w.x += ((this.torque.x - gx) / I.x) * dt
    w.y += ((this.torque.y - gy) / I.y) * dt
    w.z += ((this.torque.z - gz) / I.z) * dt
    const rate = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z)
    if (rate > cfg.limits.maxAngularRate) {
      const k = cfg.limits.maxAngularRate / rate
      w.x *= k
      w.y *= k
      w.z *= k
    }
    integrateQuat(s.orientation, w.x, w.y, w.z, dt)

    s.simTime += dt

    if (!this.isFinite()) {
      this.recoverFromNumericalFault()
      return
    }

    // Crash detection on the new pose (priority: water, sink rate, strikes, slope).
    this.updateTerrainProximity()
    const strike = this.nearGround ? this.checkStrikes() : null
    let reason: string | null = null
    if (this.flagWater) reason = CRASH_REASONS.water
    else if (this.flagHardLanding) reason = CRASH_REASONS.hardLanding
    else if (strike !== null) reason = strike
    else if (this.flagSlope) reason = CRASH_REASONS.terrain

    this.updateDerived()
    if (reason !== null) this.crash(reason)
  }

  // ---------------------------------------------------------------- engine

  /** Spool demanded by the throttle (and reverse lever when the reversers are deployed). */
  private spoolTarget(throttle: number, reverse: number): number {
    const j = this.jet
    if (j === null) return throttle
    if (this.reverserPos > 0) {
      // Doors in transit: idle. Deployed: the reverse lever sets the spool.
      return this.reverserPos >= 1 && j.reverser ? reverse * j.reverser.maxSpool : 0
    }
    const ab = j.afterburner
    return ab ? Math.min(1, throttle / ab.detent) : throttle
  }

  private updateEngine(weightOnWheels: boolean, forwardSpeed: number): void {
    const s = this.state
    const c = s.controls
    const eng = s.engine
    const dt = this.fixedDt
    const j = this.jet
    if (j === null) {
      const target = eng.running ? c.throttle : 0
      eng.spool += (target - eng.spool) * (target > eng.spool ? this.spoolUpGain : this.spoolDownGain)
      eng.spool = clamp(eng.spool, 0, 1)
      this.updateEngineSpeeds(forwardSpeed, false)
      return
    }

    // Thrust reversers: ground only, throttle near idle, engine running.
    const rv = j.reverser
    if (rv) {
      const want = eng.running && weightOnWheels && c.reverse > 0.05 && c.throttle <= rv.maxThrottle
      this.reverserPos = moveTowards(this.reverserPos, want ? 1 : 0, dt / rv.deployTime)
    }

    const target = eng.running ? this.spoolTarget(c.throttle, c.reverse) : 0
    const sp = eng.spool
    if (target > sp) {
      const rate = j.spoolUpBase + j.spoolUpGain * sp
      eng.spool = sp + Math.min(rate * dt, (target - sp) * this.settleGain)
    } else {
      const rate = j.spoolDownBase + j.spoolDownGain * sp
      eng.spool = sp - Math.min(rate * dt, (sp - target) * this.settleGain)
    }
    eng.spool = clamp(eng.spool, 0, 1)

    // Afterburner: selected at the detent, lights after a short delay at high spool.
    const ab = j.afterburner
    if (ab) {
      const selected = eng.running && this.reverserPos === 0 && c.throttle >= ab.detent
      this.abTimer = selected && eng.spool >= ab.minSpool ? this.abTimer + dt : 0
      const lit = this.abTimer >= ab.lightUpDelay
      this.abFrac = moveTowards(this.abFrac, lit ? 1 : 0, dt / ab.rampTime)
      eng.afterburner = lit
    }
    this.updateEngineSpeeds(forwardSpeed, false)
  }

  /** rpm and n1 from the spool (or windmilling when stopped). */
  private updateEngineSpeeds(forwardSpeed: number, immediate: boolean): void {
    const eng = this.state.engine
    const e = this.config.engine
    if (e.kind === 'piston') {
      const target = eng.running ? e.idleRpm + (e.maxRpm - e.idleRpm) * eng.spool : clamp(forwardSpeed * 12, 0, e.idleRpm * 2)
      eng.rpm = immediate ? target : eng.rpm + (target - eng.rpm) * this.rpmGain
      eng.n1 = eng.rpm / e.maxRpm
      eng.afterburner = false
      return
    }
    eng.n1 = eng.running ? e.idleN1 + (1 - e.idleN1) * Math.sqrt(eng.spool) : clamp(forwardSpeed / 1500, 0, 0.15)
    eng.rpm = eng.n1 * e.maxFanRpm
  }

  // ------------------------------------------------------------ fly-by-wire

  /**
   * Fly-by-wire: pitch-rate / load-factor and roll-rate command laws with
   * flight-path and bank holds (auto-trim), protections, and nonlinear
   * dynamic inversion of the aero model to find the surface (and thrust
   * vector) commands. On the ground the law is direct (stick -> surface)
   * and blends into the flight law after lift-off.
   */
  private flyByWire(f: FbwConfig, weightOnWheels: boolean): void {
    const s = this.state
    const cfg = this.config
    const a = cfg.aero
    const sf = cfg.surfaces
    const c = s.controls
    const dt = this.fixedDt
    const tv = cfg.thrustVector
    const sur = s.surfaces

    // Flare mode arms when descending through FLARE_MODE_HEIGHT with the gear down (never on
    // a take-off, which climbs through it) and disarms on the ground or well above it.
    if (weightOnWheels || s.heightAboveGround > FLARE_MODE_HEIGHT + 5) this.flareArmed = false
    else if (s.heightAboveGround < FLARE_MODE_HEIGHT && s.verticalSpeed < -0.5 && s.gearPosition > 0.9) this.flareArmed = true
    // Derotation: a landing (flare mode was armed) on the main wheels with the nose wheel
    // still in the air. A bounce keeps it armed; the nose wheel or a go-around clears it.
    let mainsDown = false
    let noseDown = false
    for (let i = 0; i < this.gear.length; i++) {
      if (!this.gearContact[i]) continue
      if (this.gear[i].main) mainsDown = true
      else noseDown = true
    }
    if (this.flareArmed) this.derotationArmed = true
    if (noseDown || s.heightAboveGround > FLARE_MODE_HEIGHT + 5) this.derotationArmed = false
    const derotating = this.derotationArmed && mainsDown
    // The ground (direct) law takes over once the nose wheel is down after a landing.
    this.fbwBlend =
      weightOnWheels && !derotating
        ? moveTowards(this.fbwBlend, 0, dt / FBW_GROUND_BLEND_TIME)
        : moveTowards(this.fbwBlend, 1, dt / f.flightBlendTime)
    const blend = this.fbwBlend
    const inFlightLaw = blend >= 1

    // Direct (ground) law. Thrust vectoring is faded in with airspeed on the ground.
    const V = this.adSpeed
    let elevCmd = c.pitch * sf.elevatorMax
    let ailCmd = c.roll * sf.aileronMax
    let rudCmd = c.yaw * sf.rudderMax
    let tvCmd = tv ? c.pitch * tv.maxAngle * clamp((V - 40) / 30, 0, 1) : 0

    // Attitude and flight path.
    const q = s.orientation
    const fwdW = rotateVec(q, NEG_Z, this.tmpA)
    const theta = Math.asin(clamp(fwdW.y, -1, 1))
    const rightW = rotateVec(q, UNIT_X, this.tmpB)
    const upW = rotateVec(q, UNIT_Y, this.tmpC)
    const phi = Math.atan2(-rightW.y, upW.y)
    const vel = s.velocity
    const gamma = V > 1 ? Math.asin(clamp(vel.y / V, -1, 1)) : theta

    if (blend > 0) {
      const w = s.angularVelocity
      const I = cfg.inertia
      const P = -w.z
      const Q = w.x
      const R = -w.y
      const Vc = Math.max(V, FBW_MIN_SPEED)
      const gv = GRAVITY / Vc
      const alpha = this.adAlpha
      const beta = this.adBeta
      const qS = Math.max(this.adQbar, 1) * cfg.wingArea
      const b = cfg.wingSpan
      const cbar = cfg.chord
      const Vn = Math.max(V, 1)
      const critDeg = criticalAlphaDeg(this.adFlapFrac, a)
      const stall = stallBlend(alpha, a, critDeg)

      // ---- Pitch: command a body pitch rate.
      // Neutral stick asks for the load factor that holds the path (n0 = cos(gamma) / cos(bank),
      // bank compensation limited); full stick asks for the load-factor limits.
      const phiC = clamp(phi, -f.bankCompensationDeg * DEG2RAD, f.bankCompensationDeg * DEG2RAD)
      const cosPhiC = Math.cos(phiC)
      const cosGamma = Math.cos(gamma)
      const qTurn = gv * cosGamma * (1 / cosPhiC - cosPhiC)
      // Load-factor demand: from the stick, or (neutral) from the flight-path hold.
      const n0 = cosGamma / cosPhiC
      const stickActive = !inFlightLaw || Math.abs(c.pitch) > FBW_DEADBAND
      // Landing configuration (gear down): the stick asks for at most +2 g / 0 g, like the
      // flaps-out limits of Airbus normal law and the gear-down gains of fighter flight controls.
      const gearDownCfg = s.gearPosition > 0.5
      const nzMax = gearDownCfg ? Math.min(f.nzMax, GEAR_DOWN_NZ_MAX) : f.nzMax
      const nzMin = gearDownCfg ? Math.max(f.nzMin, GEAR_DOWN_NZ_MIN) : f.nzMin
      let nCmd: number
      if (stickActive) {
        this.gammaRef = gamma
        this.pitchNeutralTime = 0
        const sp = c.pitch
        nCmd = sp > 0 ? n0 + sp * Math.max(0, nzMax - n0) : n0 + sp * Math.max(0, n0 - nzMin)
      } else {
        this.nzInt = 0
        // Just after release the path keeps moving while the g transient decays: hold the
        // path where that transient ends, not where the stick crossed neutral.
        if (this.pitchNeutralTime < RELEASE_LATCH_TIME && Math.abs(s.gForce - n0) > G_SETTLE) this.gammaRef = gamma
        this.pitchNeutralTime = Math.min(this.pitchNeutralTime + dt, RELEASE_LATCH_TIME)
        // Flare mode (as on Airbus jets): close to the runway on a landing, neutral stick
        // never holds a level or climbing path, only a gentle descent, so a released
        // flare settles onto the runway instead of floating up and stalling.
        if (this.flareArmed) this.gammaRef = Math.min(this.gammaRef, FLARE_MODE_PATH)
        nCmd = n0 + (f.pathHoldGain * (this.gammaRef - gamma) * Math.max(0, Math.cos(phi))) / gv
      }
      const ff = gv * (nCmd - n0)
      const loadLimited = inFlightLaw && Math.abs(ff) < f.maxPitchRate
      if (stickActive && loadLimited && Math.abs(nCmd - s.gForce) < NZ_INTEGRAL_WINDOW) {
        // Load-factor limited and close to the demand: trim out the residual g error
        // (AoA / thrust geometry). Not during the onset, so it cannot wind up.
        this.nzInt = clamp(this.nzInt + NZ_INTEGRAL_GAIN * (nCmd - s.gForce) * dt, -NZ_INTEGRAL_MAX, NZ_INTEGRAL_MAX)
      } else if (stickActive) {
        this.nzInt = moveTowards(this.nzInt, 0, NZ_INTEGRAL_GAIN * dt)
      }
      let qCmd = qTurn + clamp(ff, -f.maxPitchRate, f.maxPitchRate)
      if (loadLimited) {
        // AoA lead: drive alpha towards the value the demanded g (plus the trimmed residual)
        // needs, so the g (and path) follow crisply without overshoot.
        const nNeed = nCmd + this.nzInt
        const clNeed = (nNeed * cfg.mass * GRAVITY) / (qS * Math.max(0.5, Math.cos(alpha))) - a.cl0 - a.flapCl * flapShape(this.adFlapFrac)
        const aNeed = clamp(clNeed / a.clAlpha, a.alphaCritNegDeg * DEG2RAD, critDeg * DEG2RAD)
        qCmd += ALPHA_LEAD_FACTOR * f.pitchBandwidth * (aNeed - alpha)
      }
      // Flare mode also memorizes the attitude (as Airbus flare law does): with the stick
      // neutral the nose never rises above where the pilot left it, so the aircraft does not
      // hang nose-high as the speed bleeds off at idle but settles onto the runway.
      if (!this.flareArmed || stickActive) this.flareThetaRef = theta
      else qCmd = Math.min(qCmd, PITCH_LIMIT_GAIN * (this.flareThetaRef - theta))
      // Load-factor limiter on the measured g (integral action on the error).
      qCmd = Math.min(qCmd, Q + NZ_LIMIT_GAIN * gv * (nzMax - s.gForce))
      qCmd = Math.max(qCmd, Q + NZ_LIMIT_GAIN * gv * (nzMin - s.gForce))
      // Pitch attitude limits.
      if (f.pitchLimitUpDeg !== null) qCmd = Math.min(qCmd, PITCH_LIMIT_GAIN * (f.pitchLimitUpDeg * DEG2RAD - theta))
      if (f.pitchLimitDownDeg !== null) qCmd = Math.max(qCmd, PITCH_LIMIT_GAIN * (f.pitchLimitDownDeg * DEG2RAD - theta))
      // Overspeed protection: nose-up above VMO (equivalent airspeed) or MMO.
      if (f.overspeedGain > 0) {
        const eas = V * Math.sqrt(this.adRho / 1.225)
        let over = (eas - cfg.vmo * 1.02) / cfg.vmo
        if (cfg.mmo !== null) over = Math.max(over, (this.adMach - (cfg.mmo + 0.01)) / cfg.mmo)
        if (over > 0) {
          qCmd = Math.max(qCmd, Math.min(f.maxPitchRate, f.overspeedGain * over))
          // Neutral stick then holds the protected (shallower) path instead of diving back.
          this.gammaRef = gamma
        }
      }
      // AoA protection / limiter (last: it overrides everything nose-up).
      const aProt = (critDeg - f.alphaProtMarginDeg) * DEG2RAD
      const aMax = (critDeg - f.alphaMaxMarginDeg) * DEG2RAD
      const aTarget = aProt + Math.max(0, c.pitch) * (aMax - aProt)
      qCmd = Math.min(qCmd, qTurn + f.alphaGain * (aTarget - alpha))
      if (derotating) {
        // Derotation law: neutral stick lowers the nose at DEROTATION_RATE, back stick slows
        // it (full back holds the attitude), forward stick speeds it up. The main-gear
        // moment is part of the inversion below, so the rate holds while the wheels load up.
        qCmd = -DEROTATION_RATE * (1 - clamp(c.pitch, -1, 1))
        this.gammaRef = gamma
      }

      // Dynamic inversion: pitch moment needed for the commanded pitch acceleration.
      const flapS = flapShape(this.adFlapFrac)
      const cmOther =
        a.cm0 + a.cmAlpha * Math.sin(alpha) + a.cmQ * ((Q * cbar) / (2 * Vn)) + a.flapCm * flapS + a.groundEffectCm * this.adGroundEffect
      const gxx = w.y * I.z * w.z - w.z * I.y * w.y
      const mReq = I.x * f.pitchBandwidth * (qCmd - Q) + gxx - qS * cbar * cmOther - (derotating ? this.gearPitchMoment : 0)
      const mElev = qS * cbar * a.cmElevator * sf.elevatorMax
      const thrust = Math.max(0, s.engine.thrust)
      const mTv = tv ? thrust * tv.arm * Math.sin(tv.maxAngle) : 0
      const u = clamp(mReq / Math.max(mElev + mTv, 1e-3), -1, 1)
      const fbwElev = u * sf.elevatorMax
      const fbwTv = tv ? u * tv.maxAngle : 0

      // ---- Roll: command a roll rate; neutral stick holds the bank.
      let pCmd: number
      if (!inFlightLaw || Math.abs(c.roll) > FBW_DEADBAND) {
        this.bankRef = phi
        this.rollNeutralTime = 0
        pCmd = c.roll * f.maxRollRate
      } else {
        if (this.rollNeutralTime < RELEASE_LATCH_TIME && Math.abs(P) > ROLL_SETTLE_RATE) this.bankRef = phi
        this.rollNeutralTime = Math.min(this.rollNeutralTime + dt, RELEASE_LATCH_TIME)
        if (f.bankNeutralLimitDeg !== null) {
          const lim = f.bankNeutralLimitDeg * DEG2RAD
          this.bankRef = clamp(this.bankRef, -lim, lim)
        }
        // Bank is meaningless near the vertical: just stop the roll there.
        pCmd = Math.abs(theta) > 70 * DEG2RAD ? 0 : f.bankHoldGain * wrapPi(this.bankRef - phi)
        pCmd = clamp(pCmd, -f.maxRollRate, f.maxRollRate)
      }
      if (f.bankLimitDeg !== null) {
        const lim = f.bankLimitDeg * DEG2RAD
        pCmd = Math.min(pCmd, f.bankHoldGain * (lim - phi))
        pCmd = Math.max(pCmd, f.bankHoldGain * (-lim - phi))
      }
      const stallF = 1 - 0.5 * stall
      const pHat = (P * b) / (2 * Vn)
      const rHat = (R * b) / (2 * Vn)
      const clOther = a.clBeta * beta + a.clP * stallF * pHat + a.clR * rHat
      const gzz = w.x * I.y * w.y - w.y * I.x * w.x
      const lReq = I.z * f.rollBandwidth * (pCmd - P) - gzz - qS * b * clOther
      const lAil = qS * b * a.clAileron * stallF * sf.aileronMax
      const fbwAil = clamp(lReq / Math.max(lAil, 1e-3), -1, 1) * sf.aileronMax

      // ---- Yaw: turn coordination + sideslip suppression + pedal.
      const rCmd = gv * Math.sin(phi) * Math.cos(theta) + f.betaGain * beta + c.yaw * f.maxPedalYawRate
      const cnOther = a.cnBeta * beta + a.cnP * pHat + a.cnR * rHat + a.cnAileron * sur.aileron
      const gyy = w.z * I.x * w.x - w.x * I.z * w.z
      const nReq = I.y * f.yawBandwidth * (rCmd - R) - gyy - qS * b * cnOther
      const nRud = qS * b * a.cnRudder * sf.rudderMax
      const fbwRud = clamp(nReq / Math.max(nRud, 1e-3), -1, 1) * sf.rudderMax

      elevCmd += (fbwElev - elevCmd) * blend
      ailCmd += (fbwAil - ailCmd) * blend
      rudCmd += (fbwRud - rudCmd) * blend
      tvCmd += (fbwTv - tvCmd) * blend
    } else {
      this.gammaRef = gamma
      this.bankRef = phi
      this.nzInt = 0
    }

    sur.elevator = moveTowards(sur.elevator, clamp(elevCmd, -sf.elevatorMax, sf.elevatorMax), sf.elevatorRate * dt)
    sur.aileron = moveTowards(sur.aileron, clamp(ailCmd, -sf.aileronMax, sf.aileronMax), sf.aileronRate * dt)
    sur.rudder = moveTowards(sur.rudder, clamp(rudCmd, -sf.rudderMax, sf.rudderMax), sf.rudderRate * dt)
    if (tv) s.thrustVector = moveTowards(s.thrustVector, clamp(tvCmd, -tv.maxAngle, tv.maxAngle), tv.rate * dt)
  }

  // -------------------------------------------------------------- internals

  private crash(reason: string): void {
    const s = this.state
    s.crashed = true
    s.crashReason = reason
    s.velocity.x = 0
    s.velocity.y = 0
    s.velocity.z = 0
    s.angularVelocity.x = 0
    s.angularVelocity.y = 0
    s.angularVelocity.z = 0
    s.engine.spool = 0
    s.engine.thrust = 0
    // The engine stops with the wreck (step() no longer runs to spool it down).
    s.engine.rpm = 0
    s.engine.n1 = 0
    s.engine.afterburner = false
    s.engine.running = false
    this.updateDerived()
  }

  private groundHeight(x: number, z: number): number {
    const h = this.terrain.heightAt(x, z)
    return Number.isFinite(h) ? h : 0
  }

  private updateTerrainProximity(): void {
    const s = this.state
    this.terrainBelowCg = this.groundHeight(s.position.x, s.position.z)
    this.nearGround = s.position.y - this.terrainBelowCg < this.clearanceSkipHeight
  }

  /** Strut compression (m) of gear i at the current pose; <= 0 = not touching. */
  private gearCompression(i: number): number {
    const s = this.state
    const gd = this.gear[i]
    const r = rotateVec(s.orientation, gd.r, this.tmpA)
    const px = s.position.x + r.x
    const py = s.position.y + r.y
    const pz = s.position.z + r.z
    return this.groundHeight(px, pz) - (py - gd.extension)
  }

  /** Air data at the current pose: speed, AoA, sideslip, density, Mach, dynamic pressure, ground effect. */
  private updateAirData(): void {
    const s = this.state
    const cfg = this.config
    const vb = rotateVecInverse(s.orientation, s.velocity, this.vBody)
    const V = Math.sqrt(vb.x * vb.x + vb.y * vb.y + vb.z * vb.z)
    const h = s.position.y
    this.adSpeed = V
    this.adRho = airDensity(h)
    this.adMach = V / speedOfSound(h)
    this.adQbar = 0.5 * this.adRho * V * V
    if (V > 0.1) {
      this.adAlpha = Math.atan2(-vb.y, -vb.z)
      this.adBeta = Math.asin(clamp(vb.x / V, -1, 1))
    } else {
      this.adAlpha = 0
      this.adBeta = 0
    }
    this.adFlapFrac = cfg.surfaces.flapMax > 0 ? s.surfaces.flaps / cfg.surfaces.flapMax : 0
    const wingHeight = h + cfg.wingY - this.terrainBelowCg
    const geLin = clamp(1 - wingHeight / (0.5 * cfg.wingSpan), 0, 1)
    this.adGroundEffect = geLin * geLin
  }

  /** Fills this.force (world, non-gravity) and this.torque (body). */
  private computeForces(detectTouchdown: boolean): void {
    const s = this.state
    const cfg = this.config
    const a = cfg.aero
    const q = s.orientation
    const F = this.force
    const T = this.torque
    F.x = 0
    F.y = 0
    F.z = 0
    T.x = 0
    T.y = 0
    T.z = 0

    this.updateAirData()
    const vb = this.vBody
    const V = this.adSpeed
    // Body-frame force accumulator (aero + thrust).
    let fbx = 0
    let fby = 0
    let fbz = 0

    // --- Thrust along body -Z (deflected by the thrust-vector nozzle).
    const eng = s.engine
    const e = cfg.engine
    let thrust = 0
    if (e.kind === 'piston') {
      const fwd = Math.max(0, -vb.z)
      const power = eng.running ? e.idlePowerFraction + (1 - e.idlePowerFraction) * eng.spool : 0
      const vr = fwd / e.thrustZeroSpeed
      thrust = e.staticThrust * power * Math.max(-0.15, 1 - vr * vr)
    } else if (eng.running) {
      const sigma = densityRatio(s.position.y)
      const mach = this.adMach
      const dryMax = e.staticThrust * lapse(e.dryLapse, sigma, mach)
      let gross = dryMax * (e.idleThrustFraction + (1 - e.idleThrustFraction) * eng.spool)
      const ab = e.afterburner
      if (ab && this.abFrac > 0) {
        gross += this.abFrac * Math.max(0, ab.wetThrust * lapse(ab.wetLapse, sigma, mach) - dryMax)
      }
      const rv = e.reverser
      const dep = rv ? this.reverserPos : 0
      thrust = rv ? gross * (1 - dep - dep * rv.efficiency) : gross
    }
    eng.thrust = thrust
    const tvAngle = s.thrustVector
    if (tvAngle !== 0 && cfg.thrustVector) {
      const sn = Math.sin(tvAngle)
      fby -= thrust * sn
      fbz -= thrust * Math.cos(tvAngle)
      T.x += cfg.thrustVector.arm * thrust * sn
    } else {
      fbz -= thrust
    }

    // --- Aerodynamics.
    if (V > 0.1) {
      const qbar = this.adQbar
      const S = cfg.wingArea
      const b = cfg.wingSpan
      const cbar = cfg.chord
      const alpha = this.adAlpha
      const beta = this.adBeta
      const flapFrac = this.adFlapFrac
      const ge = this.adGroundEffect
      const co = aeroCoefficients(alpha, flapFrac, ge, a, this.coeffs, this.adMach)

      let cl = co.cl
      let cd = co.cd
      const sbPos = s.speedbrakePosition
      const sb = cfg.speedbrake
      if (sb && sbPos > 0) {
        const weightOnWheels = this.gearContact[0] || this.gearContact[1]
        cl -= sbPos * (weightOnWheels ? sb.clLossGround : sb.clLossFlight) * Math.max(0, Math.sign(cl))
        cd += sbPos * sb.cd
      }
      if (cfg.gear.cd > 0) cd += cfg.gear.cd * s.gearPosition

      const qS = qbar * S
      const lift = cl * qS
      const drag = cd * qS

      // Lift is perpendicular to the flow in the plane of symmetry.
      const nyz = Math.sqrt(vb.y * vb.y + vb.z * vb.z)
      if (nyz > 1e-6) {
        fby += (lift * -vb.z) / nyz
        fbz += (lift * vb.y) / nyz
      }
      fbx -= (drag * vb.x) / V
      fby -= (drag * vb.y) / V
      fbz -= (drag * vb.z) / V

      const de = s.surfaces.elevator
      const da = s.surfaces.aileron
      const dr = s.surfaces.rudder
      fbx += qS * (a.cyBeta * beta + a.cyRudder * dr)

      const w = s.angularVelocity
      const P = -w.z
      const Q = w.x
      const R = -w.y
      const pHat = (P * b) / (2 * V)
      const qHat = (Q * cbar) / (2 * V)
      const rHat = (R * b) / (2 * V)
      const stall = co.stall
      const flapS = flapShape(flapFrac)

      const Cm = a.cm0 + a.cmAlpha * Math.sin(alpha) + a.cmQ * qHat + a.cmElevator * de + a.flapCm * flapS + a.groundEffectCm * ge
      const Cl =
        a.clBeta * beta +
        a.clP * (1 - 0.5 * stall) * pHat +
        a.clR * rHat +
        a.clAileron * (1 - 0.5 * stall) * da
      const Cn = a.cnBeta * beta + a.cnP * pHat + a.cnR * rHat + a.cnAileron * da + a.cnRudder * dr

      T.x += qS * cbar * Cm
      T.y -= qS * b * Cn
      T.z -= qS * b * Cl
    }

    rotateVec(q, setTmp(this.tmpC, fbx, fby, fbz), this.tmpC)
    F.x += this.tmpC.x
    F.y += this.tmpC.y
    F.z += this.tmpC.z

    // --- Landing gear (only when down and locked).
    if (this.nearGround && s.gearPosition >= 1) this.computeGearForces(detectTouchdown)
    else {
      for (let i = 0; i < this.gearContact.length; i++) this.gearContact[i] = false
      this.gearPitchMoment = 0
    }

    // gForce: specific force along body +Y.
    const up = rotateVec(q, UNIT_Y, this.tmpA)
    s.gForce = (F.x * up.x + F.y * up.y + F.z * up.z) / (cfg.mass * GRAVITY)
  }

  private computeGearForces(detectTouchdown: boolean): void {
    const s = this.state
    const cfg = this.config
    const gc = cfg.gear
    const q = s.orientation
    const w = s.angularVelocity
    const F = this.force
    const TW = this.groundTorqueW
    TW.x = 0
    TW.y = 0
    TW.z = 0

    // Wheel rolling direction (horizontal) for a straight wheel and the steered nose wheel.
    const fwdW = rotateVec(q, NEG_Z, this.tmpB)
    const heading = Math.atan2(fwdW.x, -fwdW.z)
    const speed = Math.sqrt(s.velocity.x * s.velocity.x + s.velocity.z * s.velocity.z)
    const fade = clamp(speed / gc.steerFadeSpeed, 0, 1)
    const steerMax = gc.steerMaxLowSpeed + (gc.steerMaxHighSpeed - gc.steerMaxLowSpeed) * fade
    const rudderFrac = cfg.surfaces.rudderMax > 0 ? s.surfaces.rudder / cfg.surfaces.rudderMax : 0
    const steer = rudderFrac * steerMax

    for (let i = 0; i < this.gear.length; i++) {
      const gd = this.gear[i]
      const r = rotateVec(q, gd.r, this.tmpA)
      const px = s.position.x + r.x
      const py = s.position.y + r.y
      const pz = s.position.z + r.z
      const h = this.groundHeight(px, pz)
      const comp = h - (py - gd.extension)
      if (comp <= 0) {
        this.gearContact[i] = false
        continue
      }

      // Contact-point velocity: v + R (omega x r_body).
      const rb = gd.r
      const cx = w.y * rb.z - w.z * rb.y
      const cy = w.z * rb.x - w.x * rb.z
      const cz = w.x * rb.y - w.y * rb.x
      const vRot = rotateVec(q, setTmp(this.tmpC, cx, cy, cz), this.tmpC)
      const vcx = s.velocity.x + vRot.x
      const vcy = s.velocity.y + vRot.y
      const vcz = s.velocity.z + vRot.z

      // The landing limit is about the main wheels; the nose wheel (the one non-main leg,
      // index 2: the order is left main, right main, nose) is built for derotation loads,
      // so it gets twice the tolerance.
      const sinkLimit = cfg.crash.hardLandingSinkRate * (gd.main ? 1 : 2)
      if (detectTouchdown && !this.gearContact[i] && -vcy > sinkLimit) {
        this.flagHardLanding = true
      }
      this.gearContact[i] = true

      const surface: SurfaceType = this.terrain.surfaceAt(px, pz)
      if (surface === 'water') this.flagWater = true
      if (detectTouchdown && speed > cfg.crash.slopeMinSpeed && this.slopeDeg(px, pz) > cfg.crash.maxSlopeDeg) {
        this.flagSlope = true
      }
      const fr = gc.surfaces[surface] ?? gc.surfaces.paved

      const normal = Math.max(0, gd.spring * comp - gd.damper * vcy)

      // Tyre axes on the horizontal plane.
      const wheelHeading = gd.main ? heading : heading + steer
      const fx = Math.sin(wheelHeading)
      const fz = -Math.cos(wheelHeading)
      // Lateral = up x forward = (fz, 0, -fx).
      const lx = fz
      const lz = -fx
      const vLong = vcx * fx + vcz * fz
      const vLat = vcx * lx + vcz * lz

      const mu = fr.rolling + (gd.main ? s.controls.brakes * fr.braking : 0)
      let fLong = -mu * normal * clamp(vLong / gc.frictionSpeedEps, -1, 1)
      const slip = vLat / Math.max(Math.abs(vLong), gc.lateralMinSpeed)
      let fLat = -fr.lateral * normal * clamp(slip / gc.lateralSlipSaturation, -1, 1)
      const maxF = Math.max(fr.lateral, mu) * normal
      const mag = Math.sqrt(fLong * fLong + fLat * fLat)
      if (mag > maxF && mag > 0) {
        const k = maxF / mag
        fLong *= k
        fLat *= k
      }

      const Fx = fx * fLong + lx * fLat
      const Fy = normal
      const Fz = fz * fLong + lz * fLat
      F.x += Fx
      F.y += Fy
      F.z += Fz
      // torque = r x F (world)
      TW.x += r.y * Fz - r.z * Fy
      TW.y += r.z * Fx - r.x * Fz
      TW.z += r.x * Fy - r.y * Fx
    }

    const tb = rotateVecInverse(q, TW, this.tmpA)
    this.gearPitchMoment = tb.x
    this.torque.x += tb.x
    this.torque.y += tb.y
    this.torque.z += tb.z
  }

  private slopeDeg(x: number, z: number): number {
    const d = SLOPE_SAMPLE
    const dx = (this.groundHeight(x + d, z) - this.groundHeight(x - d, z)) / (2 * d)
    const dz = (this.groundHeight(x, z + d) - this.groundHeight(x, z - d)) / (2 * d)
    return Math.atan(Math.sqrt(dx * dx + dz * dz)) * RAD2DEG
  }

  /** Returns the crash reason of the first strike point at or below the ground. */
  private checkStrikes(): string | null {
    const s = this.state
    for (let i = 0; i < this.strikes.length; i++) {
      const st = this.strikes[i]
      const r = rotateVec(s.orientation, st.r, this.tmpA)
      const px = s.position.x + r.x
      const py = s.position.y + r.y
      const pz = s.position.z + r.z
      if (py <= this.groundHeight(px, pz)) {
        if (this.terrain.surfaceAt(px, pz) === 'water') return CRASH_REASONS.water
        return st.reason
      }
    }
    return null
  }

  /** Trim AoA, elevator and trim lever for steady flight at `airspeed` (flight-path angle gamma). */
  private solveTrim(
    airspeed: number,
    flaps: number,
    altitude: number,
    gamma: number,
  ): { alpha: number; trim: number; elevator: number } {
    const cfg = this.config
    const a = cfg.aero
    if (airspeed < 1) return { alpha: 0, trim: 0, elevator: 0 }
    const qbar = 0.5 * airDensity(altitude) * airspeed * airspeed
    const clReq = (cfg.mass * GRAVITY * Math.cos(gamma)) / (qbar * cfg.wingArea)
    const fs = flapShape(flaps)
    let alpha = (clReq - a.cl0 - a.flapCl * fs) / a.clAlpha
    alpha = clamp(alpha, (a.alphaCritNegDeg + 2) * DEG2RAD, (criticalAlphaDeg(flaps, a) - 2) * DEG2RAD)
    const de = -(a.cm0 + a.cmAlpha * Math.sin(alpha) + a.flapCm * fs) / a.cmElevator
    const elevator = clamp(de, -cfg.surfaces.elevatorMax, cfg.surfaces.elevatorMax)
    const trim = cfg.surfaces.trimRange > 0 ? clamp(de / cfg.surfaces.trimRange, -1, 1) : 0
    return { alpha, trim, elevator }
  }

  private updateDerived(): void {
    const s = this.state
    const cfg = this.config
    const q = s.orientation
    const v = s.velocity
    const V = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
    s.airspeed = V
    s.mach = V / speedOfSound(s.position.y)
    s.groundSpeed = Math.sqrt(v.x * v.x + v.z * v.z)
    s.altitude = s.position.y
    s.verticalSpeed = v.y

    const vb = rotateVecInverse(q, v, this.vBody)
    if (V > 0.5) {
      s.angleOfAttack = Math.atan2(-vb.y, -vb.z)
      s.sideslip = Math.asin(clamp(vb.x / V, -1, 1))
    } else {
      s.angleOfAttack = 0
      s.sideslip = 0
    }

    const fwd = rotateVec(q, NEG_Z, this.tmpA)
    let heading = Math.atan2(fwd.x, -fwd.z) * RAD2DEG
    if (heading < 0) heading += 360
    if (heading >= 360) heading -= 360
    s.headingDeg = heading
    s.pitchDeg = Math.asin(clamp(fwd.y, -1, 1)) * RAD2DEG
    const right = rotateVec(q, UNIT_X, this.tmpB)
    const up = rotateVec(q, UNIT_Y, this.tmpC)
    s.bankDeg = Math.atan2(-right.y, up.y) * RAD2DEG

    // Height of the lower main wheel above the ground.
    const g = cfg.geometry.gear
    if (this.nearGround) {
      const rl = rotateVec(q, g.mainLeft, this.tmpA)
      const hl = s.position.y + rl.y - this.groundHeight(s.position.x + rl.x, s.position.z + rl.z)
      const rr = rotateVec(q, g.mainRight, this.tmpA)
      const hr = s.position.y + rr.y - this.groundHeight(s.position.x + rr.x, s.position.z + rr.z)
      s.heightAboveGround = Math.min(hl, hr)
    } else {
      s.heightAboveGround = s.position.y - this.terrainBelowCg - this.cgHeightOnGear
    }

    let contact = false
    for (let i = 0; i < this.gearContact.length; i++) contact = contact || this.gearContact[i]
    s.onGround = contact

    const a = cfg.aero
    const flapFrac = cfg.surfaces.flapMax > 0 ? s.surfaces.flaps / cfg.surfaces.flapMax : 0
    const critDeg = criticalAlphaDeg(flapFrac, a)
    const alphaDeg = s.angleOfAttack * RAD2DEG
    const flying = V >= a.stallFlagMinSpeed
    s.stalled = flying && (alphaDeg > critDeg || alphaDeg < a.alphaCritNegDeg)
    s.stallWarning =
      flying && (alphaDeg > critDeg - a.stallWarningMarginDeg || alphaDeg < a.alphaCritNegDeg + a.stallWarningMarginDeg)
  }

  private isFinite(): boolean {
    const s = this.state
    const p = s.position
    const v = s.velocity
    const q = s.orientation
    const w = s.angularVelocity
    return (
      Number.isFinite(p.x + p.y + p.z) &&
      Number.isFinite(v.x + v.y + v.z) &&
      Number.isFinite(q.x + q.y + q.z + q.w) &&
      Number.isFinite(w.x + w.y + w.z) &&
      Number.isFinite(s.engine.spool + s.engine.rpm + s.engine.thrust + s.engine.n1 + s.thrustVector) &&
      Number.isFinite(s.surfaces.elevator + s.surfaces.aileron + s.surfaces.rudder)
    )
  }

  private recoverFromNumericalFault(): void {
    const s = this.state
    copyAircraftState(s, this.previousState)
    normalizeQuat(s.orientation)
    this.crash(CRASH_REASONS.numeric)
  }
}
