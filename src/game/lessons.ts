/**
 * Flight School lessons: a coach that walks the pilot through a take-off or
 * a landing one step at a time, tuned to the aircraft (technique.ts). Each
 * step has an instruction, the keys to press, a live gauge with its target
 * band, a completion check and corrective warnings. Implements Challenge, so
 * the session drives it like any other mode. Pure TS.
 */

import { getAircraft, type AircraftId } from '../config/aircraftCatalog'
import type { AircraftState } from '../simulation/types'
import { getRunwayEnd, guidanceTo, inRect, toLocal, type RunwayEnd } from './airportGeometry'
import type { Challenge } from './challenges'
import { FLAPS_UP_FACTOR, safePitchAtHeight, techniqueFor, type Technique } from './technique'
import type { ChallengeProgress, FlightResult, GameMode, LessonCue, LessonView, ResultStat } from './types'

const KT = 0.514444
const FT = 0.3048
/** Below this pitch on the runway the nose wheel is down (deg); brake only after that. */
export const NOSE_DOWN_PITCH_DEG = 1

interface StepContext {
  s: AircraftState
  t: Technique
  end: RunwayEnd
  /** Seconds this step has been active. */
  time: number
}

interface Step {
  title: string
  instruction(c: StepContext): string
  keys(c: StepContext): string[]
  cue(c: StepContext): LessonCue | null
  /** Goal met right now. */
  met(c: StepContext): boolean
  /** Seconds the goal must stay met before moving on (default 0). */
  hold?: number
  warning(c: StepContext): string | null
  /** Skip this step entirely for this aircraft/state. */
  skip?(c: StepContext): boolean
}

const kt = (mps: number) => Math.round(mps / KT)
const ft = (m: number) => Math.round(m / FT)

function speedCue(s: AircraftState, lo: number, hi: number, span = 25 * KT): LessonCue {
  return { label: 'Airspeed', kind: 'speed', value: s.airspeed, target: [lo, hi], range: [Math.max(0, lo - span), hi + span] }
}

function pitchCue(s: AircraftState, lo: number, hi: number, range: [number, number]): LessonCue {
  return { label: 'Nose pitch', kind: 'degrees', value: s.pitchDeg, target: [lo, hi], range }
}

function glideCue(c: StepContext): LessonCue {
  const g = guidanceTo(c.end, c.s.position.x, c.s.position.y, c.s.position.z)
  return { label: 'Above glide path', kind: 'altitude', value: g.vertical, target: [-8, 8], range: [-60, 60] }
}

function guidanceWarning(c: StepContext): string | null {
  const g = guidanceTo(c.end, c.s.position.x, c.s.position.y, c.s.position.z)
  if (g.lateral > 40) return 'Right of the centreline: bank gently left (A)'
  if (g.lateral < -40) return 'Left of the centreline: bank gently right (D)'
  if (g.vertical > 25) return 'High: lower the nose a little (W) or reduce power (F)'
  if (g.vertical < -20) return 'Low: raise the nose a little (S) and add power (R)'
  return null
}

/** Signed distance right of the runway centreline, in the direction of travel for this end. */
function rightOfCentreline(c: StepContext): number {
  const rw = c.end.runway
  const across = toLocal(rw.rect, c.s.position.x, c.s.position.z).across
  return c.end.headingDeg === rw.def.headingDeg ? across : -across
}

function takeoffSteps(id: AircraftId): Step[] {
  const f22 = id === 'f22'
  const fullPower = f22 ? 0.88 : 0.95
  return [
    {
      title: 'Power',
      instruction: () =>
        f22
          ? 'Hold R until the throttle reads about 90%. Keep it below 95% so the afterburner stays off.'
          : 'Hold R to push the throttle to 100%. Keep your hands off the stick.',
      keys: () => ['R'],
      cue: (c) => ({
        label: 'Throttle',
        kind: 'percent',
        value: c.s.controls.throttle * 100,
        target: [fullPower * 100, f22 ? 94 : 100],
        range: [0, 100],
      }),
      met: (c) => c.s.controls.throttle >= fullPower,
      warning: (c) => (c.s.controls.brakes > 0 ? 'Release the brakes (B / Space)' : null),
    },
    {
      title: 'Keep straight',
      instruction: (c) => `Accelerating. Steer with Q / E to stay on the centreline until ${kt(c.t.rotateSpeed)} kt.`,
      keys: () => ['Q', 'E'],
      cue: (c) => speedCue(c.s, c.t.rotateSpeed, c.t.rotateSpeed + 10 * KT, c.t.rotateSpeed),
      met: (c) => c.s.airspeed >= c.t.rotateSpeed - 3 * KT,
      warning: (c) => {
        const right = rightOfCentreline(c)
        if (right > 5) return 'Drifting right: press Q'
        if (right < -5) return 'Drifting left: press E'
        if (c.s.pitchDeg > 2) return `Too early: wait for ${kt(c.t.rotateSpeed)} kt before raising the nose`
        return null
      },
    },
    {
      title: 'Rotate',
      instruction: (c) =>
        `Rotate: press S gently and raise the nose to ${Math.round(c.t.rotatePitchDeg)}°. ` +
        `Never above ${Math.round(c.t.maxGroundPitchDeg)}° on the ground: the tail touches at ${Math.round(c.t.tailStrikePitchDeg)}°.`,
      keys: () => ['S', 'gently'],
      cue: (c) => pitchCue(c.s, c.t.rotatePitchDeg - 1.5, c.t.rotatePitchDeg + 1, [0, c.t.tailStrikePitchDeg + 3]),
      met: (c) => !c.s.onGround,
      hold: 1,
      warning: (c) => {
        if (c.s.onGround && c.s.pitchDeg > c.t.maxGroundPitchDeg) return 'Too much nose-up: tail strike risk! Ease off S'
        if (c.time > 6 && c.s.pitchDeg < 2) return 'Press S a little longer to lift the nose'
        return null
      },
    },
    {
      title: 'Climb',
      instruction: (c) => `Lift-off! Hold about ${c.t.climbPitchDeg}° nose-up and keep the wings level.`,
      keys: () => ['S', 'W'],
      cue: (c) => pitchCue(c.s, c.t.climbPitchDeg - 3, c.t.climbPitchDeg + 3, [-5, c.t.climbPitchDeg + 12]),
      met: (c) => c.s.heightAboveGround > 15 && c.s.verticalSpeed > 0,
      warning: (c) => {
        if (c.s.stallWarning) return 'Stall warning: lower the nose (W)'
        if (Math.abs(c.s.bankDeg) > 15) return 'Level the wings (A / D)'
        return null
      },
    },
    {
      title: 'Gear up',
      instruction: () => 'Positive climb: raise the landing gear with G.',
      keys: () => ['G'],
      cue: () => null,
      met: (c) => c.s.controls.gear < 0.5,
      skip: (c) => !c.t.retractableGear,
      warning: () => null,
    },
    {
      title: 'Flaps up',
      instruction: (c) => `Retract the flaps with Z once you are above ${kt(c.t.rotateSpeed * FLAPS_UP_FACTOR)} kt.`,
      keys: () => ['Z'],
      cue: (c) => speedCue(c.s, c.t.rotateSpeed * FLAPS_UP_FACTOR, c.t.rotateSpeed * 1.6),
      met: (c) => c.s.controls.flaps === 0,
      skip: (c) => c.t.takeoffFlaps === 0,
      warning: (c) =>
        c.s.controls.flaps < c.t.takeoffFlaps && c.s.airspeed < c.t.rotateSpeed * (FLAPS_UP_FACTOR - 0.05)
          ? 'Careful: flaps up while slow reduces lift. Keep the nose down a little'
          : null,
    },
    {
      title: 'Climb out',
      instruction: () => 'Climb to 1,000 ft above the ground.',
      keys: () => [],
      cue: (c) => ({ label: 'Height above ground', kind: 'altitude', value: c.s.heightAboveGround, target: [305, 450], range: [0, 450] }),
      met: (c) => c.s.heightAboveGround >= 305,
      warning: (c) => (c.s.verticalSpeed < 0 ? 'Descending: raise the nose a little (S)' : null),
    },
  ]
}

function landingSteps(): Step[] {
  return [
    {
      title: 'Line up',
      instruction: () => 'Follow the magenta diamonds: A / D to centre left-right, W / S to stay on the glide path.',
      keys: () => ['A', 'D', 'W', 'S'],
      cue: glideCue,
      met: (c) => {
        const g = guidanceTo(c.end, c.s.position.x, c.s.position.y, c.s.position.z)
        return Math.abs(g.lateral) < 40 && Math.abs(g.vertical) < 20
      },
      hold: 4,
      warning: guidanceWarning,
    },
    {
      title: 'Gear down',
      instruction: () => 'Lower the landing gear with G and check GEAR DOWN.',
      keys: () => ['G'],
      cue: () => null,
      met: (c) => c.s.gearPosition > 0.99,
      skip: (c) => !c.t.retractableGear || c.s.gearPosition > 0.99,
      warning: () => null,
    },
    {
      title: 'Speed',
      instruction: (c) =>
        `Autothrust is holding ${kt(c.t.approachSpeed)} kt for you. Watch the speed settle while you keep the diamonds centred.`,
      keys: () => ['A', 'D', 'W', 'S'],
      cue: (c) => speedCue(c.s, c.t.approachSpeed - 4 * KT, c.t.approachSpeed + 4 * KT),
      met: (c) => Math.abs(c.s.airspeed - c.t.approachSpeed) < 4 * KT,
      hold: 3,
      warning: guidanceWarning,
    },
    {
      title: 'Descend',
      instruction: (c) => `Keep the diamonds centred down to ${ft(c.t.flareHeight * 2)} ft. Small, early corrections.`,
      keys: () => ['A', 'D', 'W', 'S'],
      cue: glideCue,
      met: (c) => c.s.heightAboveGround < c.t.flareHeight * 2,
      warning: guidanceWarning,
    },
    {
      title: 'Flare',
      instruction: (c) =>
        `At ${ft(c.t.flareHeight)} ft the autothrust closes the throttle. Gently raise the nose to about ${c.t.flarePitchDeg}° with short presses of S (wait while it is still rising) and let it settle onto the runway.`,
      keys: () => ['S', 'gently'],
      cue: (c) => pitchCue(c.s, c.t.flarePitchDeg - 2, c.t.flarePitchDeg + 2, [-5, c.t.tailStrikePitchDeg + 3]),
      met: (c) => c.s.onGround,
      warning: (c) => {
        if (c.s.pitchDeg > safePitchAtHeight(c.t, c.s.heightAboveGround)) return 'Too much nose-up: tail strike risk! Ease off S'
        if (c.s.heightAboveGround < c.t.flareHeight && c.s.verticalSpeed < -3) return 'Sinking fast: a little more back pressure (S)'
        return null
      },
    },
    {
      title: 'Stop',
      instruction: (c) => {
        if (c.s.onGround && c.s.pitchDeg >= NOSE_DOWN_PITCH_DEG) {
          // Braking on the main wheels alone slams the nose wheel down.
          return c.t.reverse
            ? 'Touchdown! Hold Y for reverse thrust and let go of the stick: the nose wheel comes down by itself. Brake once it is down.'
            : 'Touchdown! Let go of the stick and let the nose wheel come down gently. Brake once it is down.'
        }
        return c.t.reverse ? 'Nose wheel down: hold B to brake and Y for reverse thrust.' : 'Nose wheel down: hold B to brake.'
      },
      keys: (c) => (c.t.reverse ? ['B', 'Y'] : ['B']),
      cue: (c) => ({ label: 'Ground speed', kind: 'speed', value: c.s.groundSpeed, target: [0, 2], range: [0, c.t.approachSpeed] }),
      met: (c) => c.s.onGround && c.s.groundSpeed < 2,
      warning: (c) => {
        if (c.s.onGround && c.s.pitchDeg >= NOSE_DOWN_PITCH_DEG && c.s.controls.brakes > 0) {
          return 'Wait for the nose wheel before braking'
        }
        return Math.abs(rightOfCentreline(c)) > 8 ? 'Steer back to the centreline with Q / E' : null
      },
    },
  ]
}

/** A specific, encouraging tip for the way the flight ended. */
export function coachTip(reason: string | null, t: Technique): string {
  switch (reason) {
    case 'Tail strike':
      return `Tail strike: the nose went too high on the runway. Raise it slowly with short taps of S and stop at ${Math.round(t.rotatePitchDeg)}° until the wheels leave the ground.`
    case 'Hard landing':
      return `Hard landing: you met the runway too fast. Keep ${kt(t.approachSpeed)} kt on the glide path, then start the flare at about ${ft(t.flareHeight)} ft with gentle back pressure.`
    case 'Wingtip strike':
    case 'Engine pod strike':
      return 'A wing touched the ground: keep the wings level (A / D) all the way to touchdown, and correct drift with small inputs.'
    case 'Belly impact':
      return 'Belly landing: lower the gear (G) before landing and check that the HUD says GEAR DOWN.'
    case 'Propeller strike':
    case 'Nose strike':
      return 'The nose hit first: flare by raising the nose a few degrees just before touchdown, so the main wheels land first.'
    case 'Ditched in water':
    case 'Terrain collision':
      return 'You came down short of the runway: follow the magenta diamonds and add power if you sink below the glide path.'
    case 'Runway excursion':
      return 'You left the paved runway: use Q / E (rudder) to stay on the centreline, and brake (B) only once the nose is down.'
    case 'Missed the runway':
      return 'You touched down off the runway: line up early with the diamonds and keep them centred until the flare.'
    default:
      return 'Follow the coach panel one step at a time, and keep inputs small and smooth.'
  }
}

export class LessonChallenge implements Challenge {
  readonly mode: GameMode
  result: FlightResult | null = null
  readonly technique: Technique
  private readonly steps: Step[]
  private readonly end: RunwayEnd
  private readonly title: string
  private index = 0
  private stepTime = 0
  private held = 0
  private elapsed = 0
  private warnings = 0
  private lastWarning: string | null = null
  private stepCounter = 0
  private touchdownSink: number | null = null
  private prevVs = 0
  private lastState: AircraftState | null = null

  constructor(mode: 'lessonTakeoff' | 'lessonLanding', aircraftId: AircraftId) {
    this.mode = mode
    this.technique = techniqueFor(aircraftId)
    this.end = getRunwayEnd(this.technique.lessonPlace.airportId, this.technique.lessonPlace.runwayEnd)
    this.steps = mode === 'lessonTakeoff' ? takeoffSteps(aircraftId) : landingSteps()
    this.title = `${getAircraft(aircraftId).name} ${mode === 'lessonTakeoff' ? 'take-off' : 'landing'}`
  }

  private ctx(s: AircraftState): StepContext {
    return { s, t: this.technique, end: this.end, time: this.stepTime }
  }

  update(s: AircraftState, dt: number): void {
    if (this.result) return
    this.elapsed += dt
    this.lastState = s
    const landing = this.mode === 'lessonLanding'
    if (landing && this.touchdownSink === null) {
      if (s.onGround) this.touchdownSink = Math.max(0, -this.prevVs)
      else this.prevVs = s.verticalSpeed
    }

    if (s.crashed) {
      this.fail(s.crashReason)
      return
    }
    // On the ground off the paved runway: a take-off excursion, a short or wide touchdown, or a landing-roll excursion.
    if (s.onGround && !inRect(this.end.runway.rect, s.position.x, s.position.z)) {
      this.fail(landing && this.index <= 4 ? 'Missed the runway' : 'Runway excursion')
      return
    }

    // Advance through completed (or skipped) steps.
    while (this.index < this.steps.length) {
      const step = this.steps[this.index]
      const c = this.ctx(s)
      if (step.skip?.(c)) {
        this.next()
        continue
      }
      this.stepTime += dt
      this.held = step.met(c) ? this.held + dt : 0
      if (step.met(c) && this.held >= (step.hold ?? 0)) {
        this.next()
        dt = 0
        continue
      }
      const w = step.warning(c)
      if (w && w !== this.lastWarning) this.warnings++
      this.lastWarning = w
      break
    }
    if (this.index >= this.steps.length) this.succeed()
  }

  private next(): void {
    this.index++
    this.stepTime = 0
    this.held = 0
    this.lastWarning = null
    this.stepCounter++
  }

  get lessonView(): LessonView {
    const s = this.lastState
    const done = this.index >= this.steps.length
    const step = done ? null : this.steps[this.index]
    const c = s ? this.ctx(s) : null
    return {
      title: this.title,
      steps: this.steps.map((st, i) => ({ title: st.title, done: i < this.index })),
      current: this.index,
      instruction: done ? 'Lesson complete!' : step && c ? step.instruction(c) : '',
      keys: step && c ? step.keys(c) : [],
      cue: step && c ? step.cue(c) : null,
      warning: step && c ? step.warning(c) : null,
      stepCounter: this.stepCounter,
    }
  }

  get progress(): ChallengeProgress {
    const v = this.lessonView
    return {
      mode: this.mode,
      objective: v.instruction,
      detail: `Step ${Math.min(v.current + 1, v.steps.length)} of ${v.steps.length}`,
      fraction: v.current / v.steps.length,
      elapsed: this.elapsed,
      timeLimit: null,
      status: this.result ? (this.result.outcome === 'success' ? 'success' : 'failure') : 'active',
    }
  }

  private stats(): ResultStat[] {
    const stats: ResultStat[] = [
      { label: 'Lesson time', value: this.elapsed, kind: 'time' },
      { label: 'Coach corrections', value: this.warnings, kind: 'count' },
    ]
    if (this.touchdownSink !== null) stats.unshift({ label: 'Touchdown sink rate', value: -this.touchdownSink, kind: 'verticalSpeed' })
    return stats
  }

  private succeed(): void {
    const smooth = this.touchdownSink === null || this.touchdownSink < 2
    const score = Math.max(100, Math.round(1000 - this.warnings * 60 - (smooth ? 0 : 200)))
    this.result = {
      mode: this.mode,
      outcome: 'success',
      headline: `${this.mode === 'lessonTakeoff' ? 'Take-off' : 'Landing'} lesson complete!`,
      reason:
        this.warnings === 0
          ? 'Textbook. Try the same aircraft in the challenges next.'
          : `Well done. The coach stepped in ${this.warnings} time${this.warnings === 1 ? '' : 's'}: try again for a cleaner run.`,
      score,
      timeSec: this.elapsed,
      stats: this.stats(),
    }
  }

  private fail(reason: string | null): void {
    this.result = {
      mode: this.mode,
      outcome: 'failure',
      headline: reason ?? 'Lesson ended',
      reason: coachTip(reason, this.technique),
      score: 0,
      timeSec: this.elapsed,
      stats: this.stats(),
    }
  }
}
