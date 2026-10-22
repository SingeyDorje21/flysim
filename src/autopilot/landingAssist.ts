/**
 * Landing assist (key 0): line the aircraft up with the runway end ahead and
 * settle it on the 3 degree glide path at the approach speed, then hand back
 * control. It never flares or lands: once the aircraft has been aligned for a
 * moment (or gets low), it lets go and the pilot flies the rest.
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
const INTERCEPT_TIME = 10
const MAX_INTERCEPT_DEG = 30
/** Time to close a glide-path error (s), and the most it may add to the path's descent (m/s) or take off it. */
const GLIDE_TIME = 12
const MAX_EXTRA_DESCENT = 6
const MAX_LESS_DESCENT = 6
/** How quickly the asked-for vertical speed may change (m/s^2): no lurch when it takes over. */
const VS_SLEW = 0.8
/** Aligned: within these of the centreline (m), path (m), track (deg), bank (deg), speed (m/s)... */
const ALIGNED = { lateral: 10, vertical: 8, heading: 2, bank: 3, speed: 3 }
/** ...for this long (s). */
const ALIGNED_HOLD = 2
/** Speed above the approach speed (m/s) at which the speed brake comes out. */
const SPEEDBRAKE_MARGIN = 4
/** Never below this height (m): the assist lets go, aligned or not. */
const RELEASE_HEIGHT = 60
/** Engaging needs this much height (m) and distance to the threshold (m). */
const MIN_HEIGHT = 60
const MIN_DISTANCE = 1500

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

export type AssistRelease = 'aligned' | 'low'

export interface AssistView {
  /** e.g. "FSRB 09". */
  runway: string
  /** Metres right (+) of the centreline and above (+) the glide path. */
  lateral: number
  vertical: number
}

export class LandingAssist {
  private readonly controller: AutopilotController
  private readonly approachSpeed: number
  private end: RunwayEnd | null = null
  private alignedFor = 0
  private vsTarget = 0
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
    this.approachSpeed = getAircraft(aircraftId).speeds.approach
  }

  get active(): boolean {
    return this.end !== null
  }

  /** Start on the runway end ahead. Returns why it cannot, or null when engaged. */
  engage(s: AircraftState): string | null {
    if (s.onGround || s.heightAboveGround < MIN_HEIGHT) return 'Landing assist needs 200 ft above the ground'
    const g = approachGuidance(s.position.x, s.position.y, s.position.z, s.headingDeg)
    if (!g) return 'Landing assist: no runway ahead (fly towards one, within 8 nm)'
    if (g.distance < MIN_DISTANCE) return 'Landing assist: too close to the runway, go around'
    this.end = g.end
    this.alignedFor = 0
    this.vsTarget = s.verticalSpeed
    this.controller.reset()
    this.view = { runway: `${g.end.airport.code} ${g.end.designator}`, lateral: g.lateral, vertical: g.vertical }
    return null
  }

  cancel(): void {
    this.end = null
    this.view = null
  }

  /**
   * Fly one step: overwrites stick and throttle in `controls`. Returns why it
   * let go on this step (it is then inactive), or null while it keeps flying.
   */
  update(s: AircraftState, controls: ControlInputs, dt: number): AssistRelease | null {
    const end = this.end
    if (!end) return null
    const g = guidanceTo(end, s.position.x, s.position.y, s.position.z)
    this.view = { runway: this.view!.runway, lateral: g.lateral, vertical: g.vertical }

    const V = Math.max(s.groundSpeed, 1)
    const intercept = clamp(Math.atan2(g.lateral, V * INTERCEPT_TIME) / DEG, -MAX_INTERCEPT_DEG, MAX_INTERCEPT_DEG)
    const pathVs = -s.groundSpeed * Math.tan(GLIDE_SLOPE_DEG * DEG)
    const t = this.cmd.targets
    t.speed = this.approachSpeed
    // Steer the track, not the nose: any sideslip would otherwise leave a steady offset.
    const trackDeg = Math.atan2(s.velocity.x, -s.velocity.z) / DEG
    const drift = s.groundSpeed > 1 ? wrap180(trackDeg - s.headingDeg) : 0
    t.headingDeg = (end.headingDeg - intercept - drift + 720) % 360
    const vs = pathVs + clamp(-g.vertical / GLIDE_TIME, -MAX_EXTRA_DESCENT, MAX_LESS_DESCENT)
    this.vsTarget += clamp(vs - this.vsTarget, -VS_SLEW * dt, VS_SLEW * dt)
    t.verticalSpeed = this.vsTarget
    this.controller.apply(s, this.cmd, controls, dt)
    // Too fast for the approach: speed brake out until within a few knots of the speed.
    controls.speedbrake = s.airspeed > this.approachSpeed + SPEEDBRAKE_MARGIN ? 1 : 0

    const aligned =
      Math.abs(g.lateral) < ALIGNED.lateral &&
      Math.abs(g.vertical) < ALIGNED.vertical &&
      Math.abs(wrap180(trackDeg - end.headingDeg)) < ALIGNED.heading &&
      Math.abs(s.bankDeg) < ALIGNED.bank &&
      Math.abs(s.airspeed - this.approachSpeed) < ALIGNED.speed
    this.alignedFor = aligned ? this.alignedFor + dt : 0
    const release: AssistRelease | null =
      this.alignedFor >= ALIGNED_HOLD ? 'aligned' : s.heightAboveGround < RELEASE_HEIGHT ? 'low' : null
    if (release) this.cancel()
    return release
  }
}
