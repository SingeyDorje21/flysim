import type { Vec3 } from '../simulation/types'

export type GameMode = 'freeFlight' | 'takeoff' | 'landing' | 'rings'

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
