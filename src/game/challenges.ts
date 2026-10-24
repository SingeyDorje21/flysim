/**
 * Game-mode rules. A Challenge watches the aircraft state after every fixed
 * physics step and eventually produces a FlightResult. Pure TS, no React.
 */

import { getAircraftConfig } from '../config/aircraft'
import { getAircraft, type AircraftId } from '../config/aircraftCatalog'
import type { AircraftState } from '../simulation/types'
import {
  endsOf,
  getRunwayEnd,
  inRect,
  nearestAirport,
  runwayAt,
  toLocal,
  type OrientedRect,
  type Runway,
  type RunwayEnd,
} from './airportGeometry'
import { LessonChallenge } from './lessons'
import { getModeInfo } from './modes'
import { HOME_PLACE, spawnFor, type FlightPlace } from './spawns'
import type { ChallengeProgress, FlightResult, GameMode, LessonView, ResultStat, RingCourseView } from './types'

export interface Challenge {
  readonly mode: GameMode
  /** Call after every fixed physics step. Does nothing once finished. */
  update(state: AircraftState, dt: number): void
  readonly progress: ChallengeProgress
  /** Set once the flight is decided. */
  readonly result: FlightResult | null
  /** Flight School coach state; only lessons have one. */
  readonly lessonView?: LessonView
  /** A lesson's approach phase: the session's approach autothrust and flare assist work while true. */
  readonly approachAssists?: boolean
}

export const TAKEOFF_TARGET_AGL = 150
/** Airborne this long before a lift-off counts (filters bounces). */
const LIFTOFF_CONFIRM = 1
const STOPPED_SPEED = 0.5
const KNOT = 0.514444

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

/** Where a touchdown happened, other than the runway the flight was cleared for. */
type TouchdownPlace = { kind: 'target' } | { kind: 'runway'; end: RunwayEnd } | { kind: 'field' }

/** Score fractions for a safe landing somewhere else, and the penalty for leaving the runway after touchdown. */
const OTHER_RUNWAY_FACTOR = 0.7
const OTHER_AIRPORT_FACTOR = 0.6
const OFF_FIELD_FACTOR = 0.5
const EXCURSION_PENALTY = 300

/** The end in use of a runway, judged from the aircraft's heading. */
function endInUse(rw: Runway, headingDeg: number): RunwayEnd {
  const [lo, hi] = endsOf(rw)
  const off = (e: RunwayEnd) => Math.abs(((headingDeg - e.headingDeg + 540) % 360) - 180)
  return off(lo) <= off(hi) ? lo : hi
}

function touchdownPlace(x: number, z: number, headingDeg: number): TouchdownPlace {
  const rw = runwayAt(x, z)
  return rw ? { kind: 'runway', end: endInUse(rw, headingDeg) } : { kind: 'field' }
}

/**
 * Free flight has no goal, but notices a landing: on a runway, or anywhere
 * on open land, once the aircraft has rolled to a stop.
 */
class FreeFlightChallenge extends BaseChallenge {
  private airborne = false
  private landedAt: string | null = null

  protected evaluate(state: AircraftState): void {
    if (!state.onGround) {
      if (state.heightAboveGround > 5) {
        this.airborne = true
        this.landedAt = null
      }
      return
    }
    if (!this.airborne || state.groundSpeed > STOPPED_SPEED) return
    const { x, z } = state.position
    const place = touchdownPlace(x, z, state.headingDeg)
    if (place.kind === 'runway') this.landedAt = `Landed on runway ${place.end.designator} at ${place.end.airport.code}`
    else this.landedAt = `Landed in the open, ${nearestAirport(x, z).airport.code} is the nearest airport`
  }

  protected describe(): Description {
    if (this.landedAt) return { objective: this.landedAt, detail: 'Full power (R) to take off again', fraction: null }
    return { objective: 'Free flight', detail: 'Explore the island - land anywhere on open ground - Esc to pause or quit', fraction: null }
  }
}

class TakeoffChallenge extends BaseChallenge {
  private airborneFor = 0
  private liftoff: { time: number; distance: number; speed: number } | null = null
  private maxCentrelineDev = 0
  private maxBank = 0
  private agl = 0
  private readonly rect: OrientedRect
  /** Start position, measured along the runway heading. */
  private readonly startAlong: number

  /** Rotation speed hint for the objective (knots). */
  private readonly rotateKt: number

  constructor(place: FlightPlace, aircraftId: AircraftId) {
    super('takeoff')
    this.rect = getRunwayEnd(place.airportId, place.runwayEnd).runway.rect
    const start = spawnFor('takeoff', place, aircraftId).position
    this.startAlong = this.along(start.x, start.z)
    this.rotateKt = Math.round(getAircraft(aircraftId).speeds.rotate / KNOT)
  }

  /** Signed distance along the direction of the take-off. */
  private along(x: number, z: number): number {
    // Runway rects point along the lower-numbered end; the take-off may use the other one.
    return toLocal(this.rect, x, z).along
  }

  protected evaluate(state: AircraftState, dt: number): void {
    this.agl = state.heightAboveGround
    const { x, z } = state.position
    if (!this.liftoff) {
      if (state.onGround) {
        this.airborneFor = 0
        this.maxCentrelineDev = Math.max(this.maxCentrelineDev, Math.abs(toLocal(this.rect, x, z).across))
        if (!inRect(this.rect, x, z)) {
          this.fail('Runway excursion', 'You left the runway before lifting off')
        }
        return
      }
      this.airborneFor += dt
      if (this.airborneFor >= LIFTOFF_CONFIRM) {
        this.liftoff = {
          time: this.elapsed - this.airborneFor,
          distance: Math.abs(this.along(x, z) - this.startAlong),
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
        objective: `Full power (R), rotate at ${this.rotateKt} kt (S)`,
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
  private touchdown: { sink: number; x: number; z: number; speed: number; on: TouchdownPlace } | null = null
  private prevVerticalSpeed = 0
  private stoppedFor = 0
  private distToAim = 0
  private groundSpeed = 0
  /** Rolled off the cleared runway after touching down on it. */
  private excursion = false
  private readonly end: RunwayEnd
  private readonly rect: OrientedRect
  private readonly startDist: number
  /** Touchdown sink rate (m/s) above which this aircraft's landing counts as hard. */
  private readonly hardSink: number

  constructor(place: FlightPlace, aircraftId: AircraftId) {
    super('landing')
    this.hardSink = getAircraftConfig(aircraftId).crash.hardLandingSinkRate
    this.end = getRunwayEnd(place.airportId, place.runwayEnd)
    this.rect = this.end.runway.rect
    const start = spawnFor('landing', place, aircraftId).position
    this.startDist = Math.hypot(start.x - this.end.aimPoint.x, start.z - this.end.aimPoint.z)
  }

  private onTargetRunway(x: number, z: number): boolean {
    return inRect(this.rect, x, z)
  }

  protected evaluate(state: AircraftState, dt: number): void {
    const { x, z } = state.position
    this.groundSpeed = state.groundSpeed
    if (!this.touchdown) {
      this.distToAim = Math.hypot(x - this.end.aimPoint.x, z - this.end.aimPoint.z)
      if (state.onGround) {
        // Anywhere on land counts as a landing (water is a crash); the cleared runway scores best.
        this.touchdown = {
          sink: Math.max(0, -this.prevVerticalSpeed),
          x,
          z,
          speed: state.airspeed,
          on: this.onTargetRunway(x, z) ? { kind: 'target' } : touchdownPlace(x, z, state.headingDeg),
        }
      }
      this.prevVerticalSpeed = state.verticalSpeed
      return
    }
    if (this.touchdown.on.kind === 'target' && state.onGround && !this.onTargetRunway(x, z)) this.excursion = true
    this.stoppedFor = state.onGround && state.groundSpeed < STOPPED_SPEED ? this.stoppedFor + dt : 0
    if (this.stoppedFor >= 0.5) this.finish(x, z)
  }

  private finish(stopX: number, stopZ: number): void {
    const td = this.touchdown!
    const rollout = Math.hypot(stopX - td.x, stopZ - td.z)
    const common: ResultStat[] = [
      { label: 'Touchdown sink rate', value: -td.sink, kind: 'verticalSpeed' },
      { label: 'Touchdown speed', value: td.speed, kind: 'speed' },
    ]
    const sinkPenalty = Math.max(0, td.sink - 0.8) * 180
    const hard = td.sink > this.hardSink ? 'Hard touchdown' : null
    if (td.on.kind !== 'target') {
      // Safe but not where you were cleared to land: a fraction of the touchdown score.
      const p = td.on
      const base = 1000 - sinkPenalty
      const cleared = `${this.end.airport.code} ${this.end.designator}`
      if (p.kind === 'field') {
        this.succeed('Field landing', hard ?? `Safe, but off the runway (cleared for ${cleared})`, base * OFF_FIELD_FACTOR, [
          ...common,
          { label: 'Distance from the runway', value: Math.hypot(td.x - this.end.aimPoint.x, td.z - this.end.aimPoint.z), kind: 'distance' },
          { label: 'Rollout', value: rollout, kind: 'distance' },
        ])
      } else {
        const sameAirport = p.end.airport.id === this.end.airport.id
        this.succeed(
          sameAirport ? `Landed on runway ${p.end.designator}` : `Diverted to ${p.end.airport.name}`,
          hard ?? `You were cleared for ${cleared}`,
          base * (sameAirport ? OTHER_RUNWAY_FACTOR : OTHER_AIRPORT_FACTOR),
          [...common, { label: 'Rollout', value: rollout, kind: 'distance' }],
        )
      }
      return
    }
    const tdLocal = toLocal(this.rect, td.x, td.z)
    const aimLocal = toLocal(this.rect, this.end.aimPoint.x, this.end.aimPoint.z)
    const centreOffset = Math.abs(tdLocal.across)
    const aimError = Math.abs(tdLocal.along - aimLocal.along)
    let score = 1000 - sinkPenalty
    score -= Math.max(0, centreOffset - 2) * 20
    score -= Math.max(0, aimError - 120) * 0.6
    score -= Math.max(0, rollout - 900) * 0.3
    if (this.excursion) score -= EXCURSION_PENALTY
    const s = finalScore(score)
    const headline = td.sink < 1 && s >= 850 ? 'Butter! Perfect landing' : s >= 650 ? 'Nice landing' : 'Landed - a bit firm'
    this.succeed(headline, this.excursion ? 'You rolled off the runway' : hard, score, [
      ...common,
      { label: 'Centreline offset', value: centreOffset, kind: 'distance' },
      { label: 'Distance from aim point', value: aimError, kind: 'distance' },
      { label: 'Rollout', value: rollout, kind: 'distance' },
    ])
  }

  protected describe(): Description {
    if (!this.touchdown) {
      return {
        objective: `Land on runway ${this.end.designator} at ${this.end.airport.code}`,
        detail: 'Aim for the touchdown markers past the threshold',
        fraction: 1 - this.distToAim / this.startDist,
      }
    }
    return {
      objective: 'Brake to a full stop (hold B)',
      detail: this.touchdown.on.kind === 'target' ? 'Stay on the runway' : 'Keep it straight and slow down',
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

/**
 * ringView is required for 'rings' and ignored otherwise. `place` is the
 * airport and runway end for take-off and landing (defaults to the home field).
 */
export function createChallenge(
  mode: GameMode,
  ringView?: RingCourseView,
  place: FlightPlace = HOME_PLACE,
  aircraftId: AircraftId = 'trainer',
): Challenge {
  switch (mode) {
    case 'freeFlight':
      return new FreeFlightChallenge(mode)
    case 'takeoff':
      return new TakeoffChallenge(place, aircraftId)
    case 'landing':
      return new LandingChallenge(place, aircraftId)
    case 'lessonTakeoff':
    case 'lessonLanding':
    case 'lessonCircuit':
      return new LessonChallenge(mode, aircraftId)
    case 'rings':
      if (!ringView) throw new Error('Ring course needs a ring view')
      return new RingChallenge(ringView)
  }
}
