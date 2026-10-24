/**
 * Landing assist (key 0): line the aircraft up with the runway end ahead and
 * fly the 3 degree glide path at the approach speed down to 100 ft, then hand
 * back control for the flare and touchdown. It never lands by itself.
 *
 * It only starts on an approach it can fly (not too close, too high or too far
 * off the centreline, on a runway long enough for the aircraft), and prefers
 * the runway the pilot chose. Below 250 ft the approach must be stable; if it
 * is not, it goes around (power up, climb straight ahead) and hands over at
 * 500 ft instead of leaving the pilot with a bad approach near the ground.
 *
 * Lateral: steer for the centreline, with an intercept angle that shrinks as
 * the offset does (closing it in about INTERCEPT_TIME). Vertical: the descent
 * rate that follows the glide path at the current ground speed, plus a
 * correction for being above or below it. Speed: the autothrust, with the
 * speed brake while too fast (the glide path has priority). The stick
 * and throttle work comes from the autopilot controller.
 */

import { getAircraft, type AircraftId } from '../config/aircraftCatalog'
import { approachGuidance, guidanceTo, GLIDE_SLOPE_DEG, type RunwayEnd } from '../game/airportGeometry'
import type { AircraftState, ControlInputs } from '../simulation/types'
import { AutopilotController } from './Autopilot'
import type { AutopilotCommand } from './types'

const DEG = Math.PI / 180

/** Time to close a centreline offset (s) and the largest intercept angle (deg). */
const INTERCEPT_TIME = 8
const MAX_INTERCEPT_DEG = 30
/** Time to close a glide-path error (s), and the most it may add to the path's descent (m/s) or take off it. */
const GLIDE_TIME = 12
const MAX_EXTRA_DESCENT = 6
const MAX_LESS_DESCENT = 6
/** How quickly the asked-for vertical speed may change (m/s^2): no lurch when it takes over. */
const VS_SLEW = 0.8
/** Speed above the approach speed (m/s) at which the speed brake comes out. */
const SPEEDBRAKE_MARGIN = 4

/** Engaging needs this much height (m, ~300 ft) and distance to the threshold (m). */
const MIN_HEIGHT = 90
const MIN_DISTANCE = 2000
/** Steepest descent to the aiming point it will take on (deg); the glide path is 3. */
const MAX_ENGAGE_PATH_DEG = 6
/** Largest centreline offset it will take on, as an angle from the threshold (deg), never less than the floor (m). */
const MAX_ENGAGE_OFFSET_DEG = 8
const MIN_ENGAGE_OFFSET = 150

/** Below this height (m, ~250 ft) the approach must be stable or it goes around. */
const GATE_HEIGHT = 75
/** How long it may stay unstable below the gate before going around (s). */
const UNSTABLE_GRACE = 1.5
/** Hands over at this height (m, ~100 ft) when stable: the pilot flares and lands. */
export const HANDOVER_HEIGHT = 30
/** Stable: within these of the centreline (m), path (m), track (deg), bank (deg), speed (m/s), extra sink (m/s). */
const STABLE = { lateral: 15, vertical: 10, track: 5, bank: 7, slow: 4, fast: 8, extraSink: 2 }

/** Go-around: climb rate (m/s), speed margin above the approach speed (m/s), hand-over height (m, ~500 ft). */
const GO_AROUND_VS = 3
const GO_AROUND_SPEED_MARGIN = 5
const GO_AROUND_DONE_HEIGHT = 150

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

/**
 * What happened on a step: 'stable' and 'goAroundDone' hand over (the assist
 * is then inactive); 'goAround' means it has just started a go-around.
 */
export type AssistEvent = 'stable' | 'goAround' | 'goAroundDone'

export interface AssistView {
  /** e.g. "FSRB 09". */
  runway: string
  /** Metres right (+) of the centreline and above (+) the glide path. */
  lateral: number
  vertical: number
  goingAround: boolean
}

export class LandingAssist {
  private readonly controller: AutopilotController
  private readonly approachSpeed: number
  private readonly minRunway: number
  private end: RunwayEnd | null = null
  private unstableFor = 0
  private vsTarget = 0
  private goingAround = false
  private readonly cmd: AutopilotCommand = {
    ap: true,
    athr: true,
    vertical: 'VS',
    // The glide path comes first; the speed brake takes care of excess speed.
    speedPriority: false,
    // Far below anything: V/S never "captures" it.
    targets: { speed: 0, headingDeg: 0, altitude: -1e5, verticalSpeed: 0 },
  }
  view: AssistView | null = null

  constructor(aircraftId: AircraftId) {
    this.controller = new AutopilotController(aircraftId)
    const info = getAircraft(aircraftId)
    this.approachSpeed = info.speeds.approach
    this.minRunway = info.minRunway
  }

  get active(): boolean {
    return this.end !== null
  }

  /**
   * Start on the runway end ahead, preferring `prefer` (the pilot's chosen one).
   * Returns why it cannot, or null when engaged.
   */
  engage(s: AircraftState, prefer?: RunwayEnd): string | null {
    if (s.onGround || s.heightAboveGround < MIN_HEIGHT) return 'Landing assist needs 300 ft above the ground'
    const { x, y, z } = s.position
    const g = approachGuidance(x, y, z, s.headingDeg, { prefer, minLength: this.minRunway })
    if (!g) {
      return approachGuidance(x, y, z, s.headingDeg)
        ? 'Landing assist: that runway is too short for this aircraft'
        : 'Landing assist: no runway ahead (fly towards one, within 8 nm)'
    }
    if (g.distance < MIN_DISTANCE) return 'Landing assist: too close to the runway, go around'
    const aim = Math.hypot(g.end.aimPoint.x - g.end.threshold.x, g.end.aimPoint.z - g.end.threshold.z)
    const heightAboveAim = y - g.end.airport.elevation
    if (Math.atan2(heightAboveAim, g.distance + aim) / DEG > MAX_ENGAGE_PATH_DEG) {
      return 'Landing assist: too high for this approach, descend or extend first'
    }
    if (Math.abs(g.lateral) > Math.max(MIN_ENGAGE_OFFSET, g.distance * Math.tan(MAX_ENGAGE_OFFSET_DEG * DEG))) {
      return 'Landing assist: too far off the centreline, line up further out'
    }
    this.end = g.end
    this.unstableFor = 0
    this.goingAround = false
    this.vsTarget = s.verticalSpeed
    this.controller.reset()
    this.cmd.speedPriority = false
    this.view = { runway: `${g.end.airport.code} ${g.end.designator}`, lateral: g.lateral, vertical: g.vertical, goingAround: false }
    return null
  }

  cancel(): void {
    this.end = null
    this.view = null
  }

  /**
   * Fly one step: overwrites stick, throttle and speed brake in `controls`.
   * Returns what happened on this step, or null while it keeps flying.
   */
  update(s: AircraftState, controls: ControlInputs, dt: number): AssistEvent | null {
    const end = this.end
    if (!end) return null
    const g = guidanceTo(end, s.position.x, s.position.y, s.position.z)
    this.view = { runway: this.view!.runway, lateral: g.lateral, vertical: g.vertical, goingAround: this.goingAround }
    // Steer the track, not the nose: any sideslip would otherwise leave a steady offset.
    const trackDeg = Math.atan2(s.velocity.x, -s.velocity.z) / DEG
    const drift = s.groundSpeed > 1 ? wrap180(trackDeg - s.headingDeg) : 0
    const t = this.cmd.targets

    if (this.goingAround) {
      t.speed = this.approachSpeed + GO_AROUND_SPEED_MARGIN
      t.headingDeg = (end.headingDeg - drift + 720) % 360
      this.vsTarget += clamp(GO_AROUND_VS - this.vsTarget, -VS_SLEW * dt, VS_SLEW * dt)
      t.verticalSpeed = this.vsTarget
      this.controller.apply(s, this.cmd, controls, dt)
      controls.speedbrake = 0
      if (s.heightAboveGround >= GO_AROUND_DONE_HEIGHT && s.verticalSpeed > 0) {
        this.cancel()
        return 'goAroundDone'
      }
      return null
    }

    const V = Math.max(s.groundSpeed, 1)
    const intercept = clamp(Math.atan2(g.lateral, V * INTERCEPT_TIME) / DEG, -MAX_INTERCEPT_DEG, MAX_INTERCEPT_DEG)
    const pathVs = -s.groundSpeed * Math.tan(GLIDE_SLOPE_DEG * DEG)
    t.speed = this.approachSpeed
    t.headingDeg = (end.headingDeg - intercept - drift + 720) % 360
    const vs = pathVs + clamp(-g.vertical / GLIDE_TIME, -MAX_EXTRA_DESCENT, MAX_LESS_DESCENT)
    this.vsTarget += clamp(vs - this.vsTarget, -VS_SLEW * dt, VS_SLEW * dt)
    t.verticalSpeed = this.vsTarget
    this.controller.apply(s, this.cmd, controls, dt)
    // Too fast for the approach: speed brake out until within a few knots of the speed.
    controls.speedbrake = s.airspeed > this.approachSpeed + SPEEDBRAKE_MARGIN ? 1 : 0

    const speedError = s.airspeed - this.approachSpeed
    const stable =
      g.distance > 0 &&
      Math.abs(g.lateral) < STABLE.lateral &&
      Math.abs(g.vertical) < STABLE.vertical &&
      Math.abs(wrap180(trackDeg - end.headingDeg)) < STABLE.track &&
      Math.abs(s.bankDeg) < STABLE.bank &&
      speedError > -STABLE.slow &&
      speedError < STABLE.fast &&
      -s.verticalSpeed < -pathVs + STABLE.extraSink
    const h = s.heightAboveGround
    this.unstableFor = h < GATE_HEIGHT && !stable ? this.unstableFor + dt : 0
    if (h < HANDOVER_HEIGHT && stable) {
      this.cancel()
      return 'stable'
    }
    if (this.unstableFor > UNSTABLE_GRACE || (h < HANDOVER_HEIGHT && !stable)) {
      this.goingAround = true
      this.vsTarget = Math.max(this.vsTarget, s.verticalSpeed)
      // Climbing away, speed comes first: the pitch protects it while the power comes up.
      this.cmd.speedPriority = true
      this.view.goingAround = true
      return 'goAround'
    }
    return null
  }
}
