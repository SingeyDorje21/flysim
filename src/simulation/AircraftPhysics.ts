/**
 * Six-degree-of-freedom flight model for the light trainer. Pure TypeScript:
 * no three.js, no React, no Math.random, no allocation per step.
 *
 * Integration: semi-implicit Euler at a fixed step (default 1/120 s), exact
 * quaternion exponential for the attitude.
 *
 * Sign conventions are those of ./types.ts. Aerodynamic derivatives in the
 * config use the conventional aerospace meaning; they are mapped here:
 *   roll rate  P (+ right wing down) = -omega.z     torque.z = -L
 *   pitch rate Q (+ nose up)         = +omega.x     torque.x = +M
 *   yaw rate   R (+ nose right)      = -omega.y     torque.y = -N
 */

import { AIRCRAFT_GEOMETRY, CG_HEIGHT_ON_GEAR } from '../config/aircraftGeometry'
import { DEFAULT_AIRCRAFT, type AircraftConfig } from '../config/aircraft'
import { aeroCoefficients, flapShape, type AeroCoefficients } from './aerodynamics'
import { GRAVITY, airDensity } from './atmosphere'
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
  /** Fixed step (s). Default 1/120. */
  fixedDt?: number
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
/** Above this CG height over the terrain no part of the airframe can touch the ground. */
const CLEARANCE_SKIP_HEIGHT = 15
const SLOPE_SAMPLE = 1

const NEG_Z: Vec3 = Object.freeze({ x: 0, y: 0, z: -1 })
const UNIT_X: Vec3 = Object.freeze({ x: 1, y: 0, z: 0 })
const UNIT_Y: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 })

function setTmp(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x
  out.y = y
  out.z = z
  return out
}

export class AircraftPhysics implements FlightModel {
  readonly state: AircraftState
  readonly previousState: AircraftState
  readonly fixedDt: number
  readonly config: AircraftConfig

  private readonly terrain: TerrainSampler
  private readonly pending: ControlInputs = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    flaps: 0,
    brakes: 0,
    trim: 0,
  }
  private readonly gear: GearDef[]
  private readonly gearContact: boolean[]
  private readonly strikes: StrikeDef[]

  // Precomputed filter gains.
  private readonly spoolUpGain: number
  private readonly spoolDownGain: number
  private readonly rpmGain: number

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

  // Per-step crash flags.
  private flagWater = false
  private flagHardLanding = false
  private flagSlope = false
  private terrainBelowCg = 0
  private nearGround = true

  constructor(opts: AircraftPhysicsOptions) {
    this.terrain = opts.terrain
    this.config = opts.config ?? DEFAULT_AIRCRAFT
    const dt = opts.fixedDt
    this.fixedDt = dt !== undefined && Number.isFinite(dt) && dt > 0 && dt <= 0.05 ? dt : DEFAULT_DT

    const cfg = this.config
    const g = AIRCRAFT_GEOMETRY.gear
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
    const sp = AIRCRAFT_GEOMETRY.strikePoints
    this.strikes = [
      { r: { ...sp.tail }, reason: CRASH_REASONS.tail },
      { r: { ...sp.leftWingtip }, reason: CRASH_REASONS.wingtip },
      { r: { ...sp.rightWingtip }, reason: CRASH_REASONS.wingtip },
      { r: { ...sp.propTip }, reason: CRASH_REASONS.propeller },
      { r: { ...sp.belly }, reason: CRASH_REASONS.belly },
    ]

    const e = cfg.engine
    this.spoolUpGain = 1 - Math.exp(-this.fixedDt / e.spoolUpTau)
    this.spoolDownGain = 1 - Math.exp(-this.fixedDt / e.spoolDownTau)
    this.rpmGain = 1 - Math.exp(-this.fixedDt / e.rpmTau)

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
    const flaps = sanitize(spawn.flaps, 0, 1)
    const running = spawn.engineRunning ?? true

    let trim = 0
    s.position.x = x
    s.position.z = z
    if (spawn.onGround) {
      quatFromAttitude(heading, 0, 0, s.orientation)
      s.position.y = this.groundHeight(x, z) + CG_HEIGHT_ON_GEAR
      // Velocity along the nose (level).
      this.tmpA.x = 0
      this.tmpA.y = 0
      this.tmpA.z = -airspeed
      rotateVec(s.orientation, this.tmpA, s.velocity)
    } else {
      const pitch = clamp(finiteOr(spawn.pitchDeg ?? 0, 0), -89, 89)
      quatFromAttitude(heading, pitch, 0, s.orientation)
      s.position.y = finiteOr(spawn.position.y, 0)
      const t = this.solveTrim(airspeed, flaps, s.position.y, pitch * DEG2RAD)
      trim = t.trim
      // Nose at the requested attitude; the flight path sits trimAlpha below it.
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
    const p = this.pending
    p.pitch = 0
    p.roll = 0
    p.yaw = 0
    p.throttle = throttle
    p.flaps = flaps
    p.brakes = 0
    p.trim = trim

    const sf = cfg.surfaces
    s.surfaces.elevator = clamp(trim * sf.trimRange, -sf.elevatorMax, sf.elevatorMax)
    s.surfaces.aileron = 0
    s.surfaces.rudder = 0
    s.surfaces.flaps = flaps * sf.flapMax

    s.engine.running = running
    s.engine.spool = running ? throttle : 0
    s.engine.rpm = this.rpmTarget(s.engine.spool, airspeed, running)
    s.engine.thrust = 0

    // Gear contact latches: settled on the ground, or clear of it.
    this.updateTerrainProximity()
    for (let i = 0; i < this.gear.length; i++) {
      this.gearContact[i] = this.nearGround && this.gearCompression(i) > 0
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

    // Apply latched pilot inputs.
    const c = s.controls
    const p = this.pending
    c.pitch = p.pitch
    c.roll = p.roll
    c.yaw = p.yaw
    c.throttle = p.throttle
    c.flaps = p.flaps
    c.brakes = p.brakes
    c.trim = p.trim

    // Actuators.
    const sf = cfg.surfaces
    const sur = s.surfaces
    const elevCmd = clamp(c.pitch * sf.elevatorMax + c.trim * sf.trimRange, -sf.elevatorMax, sf.elevatorMax)
    sur.elevator = moveTowards(sur.elevator, elevCmd, sf.elevatorRate * dt)
    sur.aileron = moveTowards(sur.aileron, c.roll * sf.aileronMax, sf.aileronRate * dt)
    sur.rudder = moveTowards(sur.rudder, c.yaw * sf.rudderMax, sf.rudderRate * dt)
    sur.flaps = moveTowards(sur.flaps, c.flaps * sf.flapMax, sf.flapRate * dt)

    // Engine spool and rpm.
    const eng = s.engine
    const target = eng.running ? c.throttle : 0
    eng.spool += (target - eng.spool) * (target > eng.spool ? this.spoolUpGain : this.spoolDownGain)
    eng.spool = clamp(eng.spool, 0, 1)
    rotateVecInverse(s.orientation, s.velocity, this.vBody)
    const fwd = Math.max(0, -this.vBody.z)
    eng.rpm += (this.rpmTarget(eng.spool, fwd, eng.running) - eng.rpm) * this.rpmGain

    // Forces at the start-of-step state.
    this.flagWater = false
    this.flagHardLanding = false
    this.flagSlope = false
    this.updateTerrainProximity()
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
    this.nearGround = s.position.y - this.terrainBelowCg < CLEARANCE_SKIP_HEIGHT
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

  private rpmTarget(spool: number, forwardSpeed: number, running: boolean): number {
    const e = this.config.engine
    if (running) return e.idleRpm + (e.maxRpm - e.idleRpm) * spool
    return clamp(forwardSpeed * 12, 0, e.idleRpm * 2)
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

    const vb = rotateVecInverse(q, s.velocity, this.vBody)
    const V = Math.sqrt(vb.x * vb.x + vb.y * vb.y + vb.z * vb.z)
    // Body-frame force accumulator (aero + thrust).
    let fbx = 0
    let fby = 0
    let fbz = 0

    // --- Thrust along body -Z.
    const eng = s.engine
    const e = cfg.engine
    const fwd = Math.max(0, -vb.z)
    const power = eng.running ? e.idlePowerFraction + (1 - e.idlePowerFraction) * eng.spool : 0
    const vr = fwd / e.thrustZeroSpeed
    const thrust = e.staticThrust * power * Math.max(-0.15, 1 - vr * vr)
    eng.thrust = thrust
    fbz -= thrust

    // --- Aerodynamics.
    if (V > 0.1) {
      const rho = airDensity(s.position.y)
      const qbar = 0.5 * rho * V * V
      const S = cfg.wingArea
      const b = cfg.wingSpan
      const cbar = cfg.chord
      const alpha = Math.atan2(-vb.y, -vb.z)
      const beta = Math.asin(clamp(vb.x / V, -1, 1))
      const flapFrac = cfg.surfaces.flapMax > 0 ? s.surfaces.flaps / cfg.surfaces.flapMax : 0
      const wingHeight = s.position.y + AIRCRAFT_GEOMETRY.wing.rootY - this.terrainBelowCg
      const geLin = clamp(1 - wingHeight / (0.5 * b), 0, 1)
      const ge = geLin * geLin
      const co = aeroCoefficients(alpha, flapFrac, ge, a, this.coeffs)

      const qS = qbar * S
      const lift = co.cl * qS
      const drag = co.cd * qS

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

    // --- Landing gear.
    if (this.nearGround) this.computeGearForces(detectTouchdown)
    else {
      for (let i = 0; i < this.gearContact.length; i++) this.gearContact[i] = false
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

      if (detectTouchdown && !this.gearContact[i] && -vcy > cfg.crash.hardLandingSinkRate) {
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

  /** Trim AoA and trim lever for steady flight at `airspeed` (flight-path angle gamma). */
  private solveTrim(airspeed: number, flaps: number, altitude: number, gamma: number): { alpha: number; trim: number } {
    const cfg = this.config
    const a = cfg.aero
    if (airspeed < 1) return { alpha: 0, trim: 0 }
    const qbar = 0.5 * airDensity(altitude) * airspeed * airspeed
    const clReq = (cfg.mass * GRAVITY * Math.cos(gamma)) / (qbar * cfg.wingArea)
    const fs = flapShape(flaps)
    let alpha = (clReq - a.cl0 - a.flapCl * fs) / a.clAlpha
    alpha = clamp(alpha, (a.alphaCritNegDeg + 2) * DEG2RAD, (a.alphaCritDeg - 2) * DEG2RAD)
    const de = -(a.cm0 + a.cmAlpha * Math.sin(alpha) + a.flapCm * fs) / a.cmElevator
    const trim = clamp(de / cfg.surfaces.trimRange, -1, 1)
    return { alpha, trim }
  }

  private updateDerived(): void {
    const s = this.state
    const cfg = this.config
    const q = s.orientation
    const v = s.velocity
    const V = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
    s.airspeed = V
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
    const g = AIRCRAFT_GEOMETRY.gear
    if (this.nearGround) {
      const rl = rotateVec(q, g.mainLeft, this.tmpA)
      const hl = s.position.y + rl.y - this.groundHeight(s.position.x + rl.x, s.position.z + rl.z)
      const rr = rotateVec(q, g.mainRight, this.tmpA)
      const hr = s.position.y + rr.y - this.groundHeight(s.position.x + rr.x, s.position.z + rr.z)
      s.heightAboveGround = Math.min(hl, hr)
    } else {
      s.heightAboveGround = s.position.y - this.terrainBelowCg - CG_HEIGHT_ON_GEAR
    }

    let contact = false
    for (let i = 0; i < this.gearContact.length; i++) contact = contact || this.gearContact[i]
    s.onGround = contact

    const a = cfg.aero
    const alphaDeg = s.angleOfAttack * RAD2DEG
    const flying = V >= a.stallFlagMinSpeed
    s.stalled = flying && (alphaDeg > a.alphaCritDeg || alphaDeg < a.alphaCritNegDeg)
    s.stallWarning =
      flying &&
      (alphaDeg > a.alphaCritDeg - a.stallWarningMarginDeg || alphaDeg < a.alphaCritNegDeg + a.stallWarningMarginDeg)
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
      Number.isFinite(s.engine.spool + s.engine.rpm + s.engine.thrust)
    )
  }

  private recoverFromNumericalFault(): void {
    const s = this.state
    copyAircraftState(s, this.previousState)
    normalizeQuat(s.orientation)
    this.crash(CRASH_REASONS.numeric)
  }
}
