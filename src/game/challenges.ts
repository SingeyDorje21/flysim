/**
 * Game-mode rules. A Challenge watches the aircraft state after every fixed
 * physics step and eventually produces a FlightResult. Pure TS, no React.
 */

import { RUNWAY, SPAWNS, isOnRunway } from '../config/world'
import type { AircraftState } from '../simulation/types'
import { getModeInfo } from './modes'
import type { ChallengeProgress, FlightResult, GameMode, ResultStat, RingCourseView } from './types'

export interface Challenge {
  readonly mode: GameMode
  /** Call after every fixed physics step. Does nothing once finished. */
  update(state: AircraftState, dt: number): void
  readonly progress: ChallengeProgress
  /** Set once the flight is decided. */
  readonly result: FlightResult | null
}

export const TAKEOFF_TARGET_AGL = 150
/** Airborne this long before a lift-off counts (filters bounces). */
const LIFTOFF_CONFIRM = 1
const STOPPED_SPEED = 0.5

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const finalScore = (raw: number) => Math.round(clamp(raw, 100, 1000))

interface Description {
  objective: string
  detail: string | null
  fraction: number | null
}

abstract class BaseChallenge implements Challenge {
  readonly mode: GameMode
  result: FlightResult | null = null
  protected elapsed = 0
  protected readonly timeLimit: number | null
  protected maxG = 1
  protected maxSpeed = 0
  protected distance = 0
  protected everStalled = false
  private lastX: number | null = null
  private lastZ = 0

  constructor(mode: GameMode) {
    this.mode = mode
    this.timeLimit = getModeInfo(mode).timeLimit
  }

  update(state: AircraftState, dt: number): void {
    if (this.result) return
    this.elapsed += dt
    this.track(state)
    if (state.crashed) {
      this.fail('Crashed', state.crashReason ?? 'Impact with the ground')
      return
    }
    this.evaluate(state, dt)
    if (!this.result && this.timeLimit !== null && this.elapsed > this.timeLimit) {
      this.fail('Out of time', 'The time limit ran out')
    }
  }

  get progress(): ChallengeProgress {
    const d = this.describe()
    return {
      mode: this.mode,
      objective: d.objective,
      detail: d.detail,
      fraction: d.fraction === null ? null : clamp(d.fraction, 0, 1),
      elapsed: this.elapsed,
      timeLimit: this.timeLimit,
      status: this.result ? (this.result.outcome === 'success' ? 'success' : 'failure') : 'active',
    }
  }

  protected abstract evaluate(state: AircraftState, dt: number): void
  protected abstract describe(): Description

  protected commonStats(): ResultStat[] {
    return [
      { label: 'Flight time', value: this.elapsed, kind: 'time' },
      { label: 'Distance flown', value: this.distance, kind: 'distance' },
      { label: 'Top speed', value: this.maxSpeed, kind: 'speed' },
      { label: 'Peak load', value: this.maxG, kind: 'g' },
    ]
  }

  protected fail(headline: string, reason: string): void {
    this.result = {
      mode: this.mode,
      outcome: 'failure',
      headline,
      reason,
      score: 0,
      timeSec: this.elapsed,
      stats: this.commonStats(),
    }
  }

  protected succeed(headline: string, reason: string | null, score: number, stats: ResultStat[]): void {
    this.result = {
      mode: this.mode,
      outcome: 'success',
      headline,
      reason,
      score: finalScore(score),
      timeSec: this.elapsed,
      stats: [...stats, ...this.commonStats()],
    }
  }

  private track(state: AircraftState): void {
    this.maxG = Math.max(this.maxG, state.gForce)
    this.maxSpeed = Math.max(this.maxSpeed, state.airspeed)
    if (state.stalled) this.everStalled = true
    const { x, z } = state.position
    if (this.lastX !== null) this.distance += Math.hypot(x - this.lastX, z - this.lastZ)
    this.lastX = x
    this.lastZ = z
  }
}

class FreeFlightChallenge extends BaseChallenge {
  protected evaluate(): void {}
  protected describe(): Description {
    return { objective: 'Free flight', detail: 'Explore the island - Esc to pause or quit', fraction: null }
  }
}

class TakeoffChallenge extends BaseChallenge {
  private airborneFor = 0
  private liftoff: { time: number; distance: number; speed: number } | null = null
  private maxCentrelineDev = 0
  private maxBank = 0
  private agl = 0
  private readonly startZ = SPAWNS.takeoff.position.z

  protected evaluate(state: AircraftState, dt: number): void {
    this.agl = state.heightAboveGround
    if (!this.liftoff) {
      if (state.onGround) {
        this.airborneFor = 0
        this.maxCentrelineDev = Math.max(this.maxCentrelineDev, Math.abs(state.position.x - RUNWAY.centerX))
        if (!isOnRunway(state.position.x, state.position.z)) {
          this.fail('Runway excursion', 'You left the runway before lifting off')
        }
        return
      }
      this.airborneFor += dt
      if (this.airborneFor >= LIFTOFF_CONFIRM) {
        this.liftoff = {
          time: this.elapsed - this.airborneFor,
          distance: this.startZ - state.position.z,
          speed: state.airspeed,
        }
      }
      return
    }
    this.maxBank = Math.max(this.maxBank, Math.abs(state.bankDeg))
    if (state.heightAboveGround >= TAKEOFF_TARGET_AGL) this.finish()
  }

  private finish(): void {
    const lo = this.liftoff!
    let score = 1000
    score -= Math.max(0, this.elapsed - 40) * 6
    score -= Math.max(0, this.maxBank - 30) * 8
    score -= Math.max(0, this.maxCentrelineDev - 3) * 12
    if (this.everStalled) score -= 250
    const s = finalScore(score)
    const headline = s >= 850 ? 'Textbook take-off!' : s >= 600 ? 'Good climb-out' : 'Airborne'
    this.succeed(headline, this.everStalled ? 'You stalled on the climb-out' : null, score, [
      { label: 'Time to 500 ft', value: this.elapsed, kind: 'time' },
      { label: 'Lift-off distance', value: lo.distance, kind: 'distance' },
      { label: 'Lift-off speed', value: lo.speed, kind: 'speed' },
      { label: 'Max bank', value: this.maxBank, kind: 'degrees' },
      { label: 'Centreline deviation', value: this.maxCentrelineDev, kind: 'distance' },
    ])
  }

  protected describe(): Description {
    if (!this.liftoff) {
      return {
        objective: 'Full power (R), rotate at 55 kt (S)',
        detail: 'Stay on the runway centreline',
        fraction: 0,
      }
    }
    return {
      objective: 'Climb to 500 ft above ground',
      detail: 'Keep the wings within 30 degrees of level',
      fraction: this.agl / TAKEOFF_TARGET_AGL,
    }
  }
}

class LandingChallenge extends BaseChallenge {
  private touchdown: { sink: number; x: number; z: number; speed: number } | null = null
  private prevVerticalSpeed = 0
  private stoppedFor = 0
  private distToAim = 0
  private groundSpeed = 0
  private readonly startDist = Math.hypot(SPAWNS.landing.position.x, SPAWNS.landing.position.z - RUNWAY.aimPointZ)

  protected evaluate(state: AircraftState, dt: number): void {
    const { x, z } = state.position
    this.groundSpeed = state.groundSpeed
    if (!this.touchdown) {
      this.distToAim = Math.hypot(x - RUNWAY.centerX, z - RUNWAY.aimPointZ)
      if (state.onGround) {
        this.touchdown = { sink: Math.max(0, -this.prevVerticalSpeed), x, z, speed: state.airspeed }
        if (!isOnRunway(x, z)) this.fail('Missed the runway', 'You touched down off the paved runway')
      }
      this.prevVerticalSpeed = state.verticalSpeed
      return
    }
    if (state.onGround && !isOnRunway(x, z)) {
      this.fail('Runway excursion', 'You rolled off the runway')
      return
    }
    this.stoppedFor = state.onGround && state.groundSpeed < STOPPED_SPEED ? this.stoppedFor + dt : 0
    if (this.stoppedFor >= 0.5) this.finish(z)
  }

  private finish(stopZ: number): void {
    const td = this.touchdown!
    const centreOffset = Math.abs(td.x - RUNWAY.centerX)
    const aimError = Math.abs(td.z - RUNWAY.aimPointZ)
    const rollout = td.z - stopZ
    let score = 1000
    score -= Math.max(0, td.sink - 0.8) * 180
    score -= Math.max(0, centreOffset - 2) * 20
    score -= Math.max(0, aimError - 120) * 0.6
    score -= Math.max(0, rollout - 900) * 0.3
    const s = finalScore(score)
    const headline = td.sink < 1 && s >= 850 ? 'Butter! Perfect landing' : s >= 650 ? 'Nice landing' : 'Landed - a bit firm'
    this.succeed(headline, td.sink > 3 ? 'Hard touchdown' : null, score, [
      { label: 'Touchdown sink rate', value: -td.sink, kind: 'verticalSpeed' },
      { label: 'Touchdown speed', value: td.speed, kind: 'speed' },
      { label: 'Centreline offset', value: centreOffset, kind: 'distance' },
      { label: 'Distance from aim point', value: aimError, kind: 'distance' },
      { label: 'Rollout', value: rollout, kind: 'distance' },
    ])
  }

  protected describe(): Description {
    if (!this.touchdown) {
      return {
        objective: 'Land on runway 36',
        detail: 'Aim for the touchdown markers past the threshold',
        fraction: 1 - this.distToAim / this.startDist,
      }
    }
    return {
      objective: 'Brake to a full stop (hold B)',
      detail: 'Stay on the runway',
      fraction: this.touchdown.speed > 0 ? 1 - this.groundSpeed / this.touchdown.speed : 1,
    }
  }
}

class RingChallenge extends BaseChallenge {
  private readonly view: RingCourseView
  private prev: { x: number; y: number; z: number } | null = null

  constructor(view: RingCourseView) {
    super('rings')
    this.view = view
    view.nextIndex = 0
  }

  protected evaluate(state: AircraftState): void {
    const p = state.position
    const ring = this.view.rings[this.view.nextIndex]
    if (ring && this.prev) {
      const h = (ring.headingDeg * Math.PI) / 180
      // Unit normal of the ring plane, pointing along the direction of travel.
      const nx = Math.sin(h)
      const nz = -Math.cos(h)
      const c = ring.position
      const dPrev = (this.prev.x - c.x) * nx + (this.prev.z - c.z) * nz
      const dCurr = (p.x - c.x) * nx + (p.z - c.z) * nz
      if (dPrev < 0 && dCurr >= 0) {
        const t = dPrev / (dPrev - dCurr)
        const ix = this.prev.x + (p.x - this.prev.x) * t
        const iy = this.prev.y + (p.y - this.prev.y) * t
        const iz = this.prev.z + (p.z - this.prev.z) * t
        if (Math.hypot(ix - c.x, iy - c.y, iz - c.z) <= ring.radius) this.view.nextIndex++
      }
    }
    this.prev = { x: p.x, y: p.y, z: p.z }
    if (this.view.nextIndex >= this.view.rings.length) this.finish()
  }

  private finish(): void {
    const score = 1000 - Math.max(0, this.elapsed - 230) * 4
    this.succeed('Course complete!', null, score, [
      { label: 'Course time', value: this.elapsed, kind: 'time' },
      { label: 'Rings', value: this.view.rings.length, kind: 'count' },
    ])
  }

  protected describe(): Description {
    const n = this.view.rings.length
    const next = this.view.nextIndex
    return {
      objective: next < n ? `Fly through ring ${next + 1}` : 'Course complete',
      detail: `Ring ${Math.min(next + 1, n)} of ${n}`,
      fraction: next / n,
    }
  }
}

/** ringView is required for 'rings' and ignored otherwise. */
export function createChallenge(mode: GameMode, ringView?: RingCourseView): Challenge {
  switch (mode) {
    case 'freeFlight':
      return new FreeFlightChallenge(mode)
    case 'takeoff':
      return new TakeoffChallenge(mode)
    case 'landing':
      return new LandingChallenge(mode)
    case 'rings':
      if (!ringView) throw new Error('Ring course needs a ring view')
      return new RingChallenge(ringView)
  }
}
