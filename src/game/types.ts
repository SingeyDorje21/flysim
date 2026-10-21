import type { Vec3 } from '../simulation/types'

export type GameMode = 'freeFlight' | 'takeoff' | 'landing' | 'rings' | 'lessonTakeoff' | 'lessonLanding'

/** Flight School lessons (guided, assists on). */
export const LESSON_MODES: readonly GameMode[] = ['lessonTakeoff', 'lessonLanding']

/** A live gauge for the current lesson step: the value, and the band to keep it in. */
export interface LessonCue {
  /** e.g. "Airspeed", "Pitch", "Height above ground". */
  label: string
  /** How to format value and target (SI; 'degrees' and 'percent' are plain). */
  kind: 'speed' | 'altitude' | 'degrees' | 'percent'
  value: number
  /** Target band [min, max]; the step wants the value inside it. */
  target: [number, number]
  /** Scale shown on the gauge [min, max]. */
  range: [number, number]
}

export interface LessonStepView {
  title: string
  done: boolean
}

/** What the coach panel shows (published with telemetry while a lesson runs). */
export interface LessonView {
  /** e.g. "A350-900 take-off". */
  title: string
  steps: LessonStepView[]
  /** Index of the current step; steps.length when the lesson is complete. */
  current: number
  /** Full instruction for the current step. */
  instruction: string
  /** Keys to press right now, e.g. ["R"] or ["S", "gently"]. */
  keys: string[]
  cue: LessonCue | null
  /** Corrective hint when the pilot is drifting off-target, else null. */
  warning: string | null
  /** Increments each time a step completes (for a tick animation / sound). */
  stepCounter: number
}

export type CameraMode = 'chase' | 'cockpit' | 'free'

export const CAMERA_MODES: readonly CameraMode[] = ['chase', 'cockpit', 'free']

/** One ring of the ring course. The aircraft must fly through it along headingDeg. */
export interface RingDef {
  id: number
  /** Ring centre, world frame. */
  position: Vec3
  /** Direction of travel through the ring (0 = north, clockwise). The ring plane is perpendicular to it. */
  headingDeg: number
  radius: number
}

/**
 * Live ring state for the renderer. The session mutates nextIndex in place;
 * nextIndex === rings.length means the course is complete.
 */
export interface RingCourseView {
  readonly rings: readonly RingDef[]
  nextIndex: number
}

export type ChallengeStatus = 'active' | 'success' | 'failure'

/** Objective state shown on the HUD (published with telemetry). */
export interface ChallengeProgress {
  mode: GameMode
  /** Current instruction, e.g. "Climb to 500 ft above ground". */
  objective: string
  /** Secondary line, e.g. "Ring 3 of 9", or null. */
  detail: string | null
  /** Progress bar 0..1, or null for no bar. */
  fraction: number | null
  /** Seconds since the challenge started. */
  elapsed: number
  /** Seconds allowed, or null for unlimited. */
  timeLimit: number | null
  status: ChallengeStatus
}

/** How the UI should format a stat value (raw values are SI). */
export type StatKind =
  | 'speed'
  | 'altitude'
  | 'distance'
  | 'verticalSpeed'
  | 'time'
  | 'g'
  | 'degrees'
  | 'count'
  | 'score'

export interface ResultStat {
  label: string
  /** SI value (m, m/s, s, deg for 'degrees'). */
  value: number
  kind: StatKind
}

export interface FlightResult {
  mode: GameMode
  outcome: 'success' | 'failure'
  /** e.g. "Smooth landing!" or "Crashed". */
  headline: string
  /** Failure or grading reason, e.g. "Wingtip strike". */
  reason: string | null
  /** 0..1000; 0 on failure. */
  score: number
  timeSec: number
  stats: ResultStat[]
}
