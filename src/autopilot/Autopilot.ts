/**
 * Autopilot and autothrust: turn the selected targets into stick and throttle
 * commands, the way a pilot would, so the flight model and its protections
 * stay in charge of the aircraft. Runs once per fixed physics step.
 *
 * Vertical: the selected altitude (or vertical speed) gives a target vertical
 * speed, which gives a target flight-path angle. Fly-by-wire aircraft get a
 * load-factor demand through the stick (their control law does the rest); the
 * trainer's stick moves the elevator, so it gets a pitch-rate loop whose
 * integral also does the trimming.
 * Lateral: heading error -> bank angle -> roll rate -> stick.
 * Speed: throttle from a PI loop on airspeed.
 * Pure TypeScript, no allocation per step.
 */

import { getAircraftConfig, type AircraftConfig } from '../config/aircraft'
import { getAircraft, type AircraftId } from '../config/aircraftCatalog'
import { GRAVITY } from '../simulation/atmosphere'
import { GEAR_DOWN_NZ_MAX, GEAR_DOWN_NZ_MIN } from '../simulation/AircraftPhysics'
import type { AircraftState, ControlInputs } from '../simulation/types'
import { autopilotTuning, type AutopilotTuning } from './tuning'
import type { AutopilotCommand, VerticalAnnunciation, VerticalMode } from './types'

const DEG2RAD = Math.PI / 180

/** Bank angle asked for per degree of heading error. */
const HEADING_GAIN = 2
/** Roll rate asked for per degree of bank error (1/s). */
const BANK_GAIN = 0.8
/** Altitude error (m) treated as "on altitude". */
const ALT_ON = 15
/** Vertical speed traded per m/s of speed outside the safe band (1/s). */
const SPEED_PROTECT_GAIN = 2

/** Trainer (direct-law) loops, per rad/s of rate error. */
const DIRECT_PITCH_P = 3
const DIRECT_PITCH_I = 3
const DIRECT_ROLL_P = 1.5
const DIRECT_ROLL_I = 0.5

/** Fly-by-wire path integral (g per rad of path error per second) and its authority (g). */
const FBW_PATH_I = 0.5
const FBW_PATH_I_MAX = 0.15
/** Fly-by-wire demand backed off per g the aircraft pulls beyond it. */
const FBW_G_DAMPING = 0.5
/** Just outside the fly-by-wire stick deadband (0.02). */
const FBW_MIN_ROLL_STICK = 0.025
/** Speed error (m/s) the autothrust may fall behind by at a thrust limit before the climb or descent gives way. */
const SPEED_PRIORITY_MARGIN = 3

/** Autothrust: throttle per m/s of speed error, and integral gain. */
const ATHR_P = 0.05
const ATHR_I = 0.02

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

export interface AutopilotOutput {
  /** Vertical mode to show on the panel (V/S switches to ALT when it captures the altitude). */
  vertical: VerticalMode
  annunciation: VerticalAnnunciation
}

export class AutopilotController {
  readonly tuning: AutopilotTuning
  private readonly config: AircraftConfig
  /** Lowest speed the vertical modes allow, clean / with flaps (m/s). */
  private readonly minSpeedClean: number
  private readonly minSpeedFlaps: number
  private readonly maxSpeed: number

  private pitchInt = 0
  private rollInt = 0
  private pathInt = 0
  private lastDn = 0
  private athrInt = 0
  private athrBase = 0
  private apWasOn = false
  private athrWasOn = false
  private readonly output: AutopilotOutput = { vertical: 'ALT', annunciation: 'ALT' }

  constructor(aircraftId: AircraftId) {
    this.tuning = autopilotTuning(aircraftId)
    this.config = getAircraftConfig(aircraftId)
    const speeds = getAircraft(aircraftId).speeds
    this.minSpeedClean = Math.max(speeds.stallClean * 1.3, speeds.approach * 1.1)
    this.minSpeedFlaps = speeds.approach * 0.9
    this.maxSpeed = speeds.maxOperating * 0.97
  }

  /** Forget the loop state (the next engagement starts fresh). */
  reset(): void {
    this.apWasOn = false
    this.athrWasOn = false
  }

  /**
   * Overwrite the stick (AP) and throttle (A/THR) in `controls` for this step.
   * Returns the vertical mode to show; `cmd` itself is not modified.
   */
  apply(s: AircraftState, cmd: AutopilotCommand, controls: ControlInputs, dt: number): AutopilotOutput {
    if (cmd.athr) this.applyAutothrust(s, cmd.targets.speed, controls, dt)
    this.athrWasOn = cmd.athr
    if (cmd.ap) {
      if (!this.apWasOn) {
        // The trainer's integral starts at the stick the pilot was holding: no jolt on engage.
        this.pitchInt = this.config.fbw ? 0 : s.controls.pitch
        this.rollInt = 0
        this.pathInt = 0
        this.lastDn = 0
      }
      this.applyVertical(s, cmd, controls, dt)
      this.applyLateral(s, cmd.targets.headingDeg, controls, dt)
    } else {
      this.output.vertical = cmd.vertical
    }
    this.apWasOn = cmd.ap
    return this.output
  }

  private applyAutothrust(s: AircraftState, speed: number, controls: ControlInputs, dt: number): void {
    if (!this.athrWasOn) {
      this.athrBase = s.controls.throttle
      this.athrInt = 0
    }
    const error = speed - s.airspeed
    const p = error * ATHR_P
    // The integral stops winding up while the throttle is pinned at a stop.
    const raw = this.athrBase + p + this.athrInt
    if (!((raw >= 1 && error > 0) || (raw <= 0 && error < 0))) this.athrInt += error * ATHR_I * dt
    this.athrInt = clamp(this.athrInt, -1, 1)
    controls.throttle = clamp(this.athrBase + p + this.athrInt, 0, 1)
  }

  /** Target vertical speed for levelling off at an altitude `error` metres away. */
  private captureSpeed(error: number): number {
    const t = this.tuning
    const mag = Math.min(Math.abs(error) * t.altGain, Math.sqrt(2 * t.captureAccel * Math.abs(error)))
    return Math.sign(error) * mag
  }

  private applyVertical(s: AircraftState, cmd: AutopilotCommand, controls: ControlInputs, dt: number): void {
    const t = this.tuning
    const out = this.output
    const altError = cmd.targets.altitude - s.altitude
    const capture = this.captureSpeed(altError)
    let mode = cmd.vertical
    if (mode === 'VS') {
      const sel = cmd.targets.verticalSpeed
      // Heading for the selected altitude and close enough to start levelling off: capture it.
      if (sel !== 0 && Math.sign(sel) === Math.sign(altError) && Math.abs(capture) <= Math.abs(sel)) mode = 'ALT'
    }
    let vs: number
    if (mode === 'VS') {
      vs = cmd.targets.verticalSpeed
      out.annunciation = 'V/S'
    } else {
      vs = capture
      const limited = clamp(vs, -t.maxDescent, t.maxClimb)
      out.annunciation = Math.abs(altError) < ALT_ON ? 'ALT' : limited !== vs ? (vs > 0 ? 'CLB' : 'DES') : 'ALT*'
    }
    out.vertical = mode
    vs = clamp(vs, -t.maxDescent, t.maxClimb)

    // Speed protection: never trade the speed away for the vertical target.
    // Gear or flaps out is landing configuration (the F-22 has no flaps): approach speeds are fine.
    const minSpeed = s.controls.flaps > 0 || s.gearPosition > 0.5 ? this.minSpeedFlaps : this.minSpeedClean
    if (s.airspeed < minSpeed) vs = Math.min(vs, -(minSpeed - s.airspeed) * SPEED_PROTECT_GAIN)
    if (s.airspeed > this.maxSpeed) vs = Math.max(vs, (s.airspeed - this.maxSpeed) * SPEED_PROTECT_GAIN)
    if (cmd.athr && cmd.speedPriority !== false) {
      // Speed priority: at full (or idle) thrust the climb (or descent) is reduced so the
      // selected speed still holds, as an airliner's climb modes do.
      const slow = cmd.targets.speed - s.airspeed - SPEED_PRIORITY_MARGIN
      const fast = s.airspeed - cmd.targets.speed - SPEED_PRIORITY_MARGIN
      if (vs > 0 && slow > 0 && s.controls.throttle > 0.99) vs = Math.max(0, vs - slow * SPEED_PROTECT_GAIN)
      if (vs < 0 && fast > 0 && s.controls.throttle < 0.01) vs = Math.min(0, vs + fast * SPEED_PROTECT_GAIN)
    }

    const V = Math.max(s.airspeed, 1)
    const gamma = Math.asin(clamp(s.velocity.y / V, -1, 1))
    const gammaCmd = Math.asin(clamp(vs / V, -0.5, 0.5))
    const gammaError = gammaCmd - gamma
    const maxDg = t.maxDeltaG
    const bank = s.bankDeg * DEG2RAD
    const fbw = this.config.fbw
    if (fbw) {
      this.pathInt = clamp(this.pathInt + FBW_PATH_I * gammaError * dt, -FBW_PATH_I_MAX, FBW_PATH_I_MAX)
      const n0 = Math.cos(gamma) / Math.max(0.5, Math.cos(bank))
      // Damped on the measured load factor: the control law's own g loop lags the demand.
      const dnPath = (V / GRAVITY) * t.pathGain * gammaError + this.pathInt
      const dn = clamp(dnPath - FBW_G_DAMPING * (s.gForce - n0 - this.lastDn), -maxDg, maxDg)
      this.lastDn = dn
      // The stick asks for load factor between the limits; neutral is what holds the path.
      const gearDown = s.gearPosition > 0.5
      const nzMax = gearDown ? Math.min(fbw.nzMax, GEAR_DOWN_NZ_MAX) : fbw.nzMax
      const nzMin = gearDown ? Math.max(fbw.nzMin, GEAR_DOWN_NZ_MIN) : fbw.nzMin
      controls.pitch = clamp(dn >= 0 ? dn / Math.max(0.1, nzMax - n0) : dn / Math.max(0.1, n0 - nzMin), -1, 1)
    } else {
      // Pitch rate that turns the path at the asked rate, plus what a level turn needs.
      const qTurn = (GRAVITY / V) * (1 / Math.max(0.5, Math.cos(bank)) - Math.cos(bank))
      const maxQ = (maxDg * GRAVITY) / V
      const qCmd = clamp(t.pathGain * gammaError, -maxQ, maxQ) + qTurn
      const qError = qCmd - s.angularVelocity.x
      this.pitchInt = clamp(this.pitchInt + DIRECT_PITCH_I * qError * dt, -1, 1)
      controls.pitch = clamp(DIRECT_PITCH_P * qError + this.pitchInt, -1, 1)
    }
  }

  private applyLateral(s: AircraftState, headingDeg: number, controls: ControlInputs, dt: number): void {
    const t = this.tuning
    const error = wrap180(headingDeg - s.headingDeg)
    const bankCmd = clamp(error * HEADING_GAIN, -t.maxBankDeg, t.maxBankDeg)
    const rateCmd = clamp((bankCmd - s.bankDeg) * BANK_GAIN, -t.maxRollRateDeg, t.maxRollRateDeg)
    const fbw = this.config.fbw
    if (fbw) {
      let stick = clamp((rateCmd * DEG2RAD) / fbw.maxRollRate, -1, 1)
      // A small correction would fall inside the control law's deadband (where it just holds
      // the bank), so a bank error worth correcting always gets at least a minimum input.
      if (Math.abs(stick) < FBW_MIN_ROLL_STICK && Math.abs(bankCmd - s.bankDeg) > 1) {
        stick = Math.sign(rateCmd) * FBW_MIN_ROLL_STICK
      }
      controls.roll = stick
    } else {
      // Roll rate P (+ right wing down) = -omega.z.
      const rateError = rateCmd * DEG2RAD + s.angularVelocity.z
      this.rollInt = clamp(this.rollInt + DIRECT_ROLL_I * rateError * dt, -0.3, 0.3)
      controls.roll = clamp(DIRECT_ROLL_P * rateError + this.rollInt, -1, 1)
    }
  }
}
