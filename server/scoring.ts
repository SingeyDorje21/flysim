/**
 * Score = airborne seconds x multiplier. The multiplier starts at 1 and is
 * earned by clean take-offs and soft landings, graded by the server from the
 * poses it already receives (a client never reports its own grade). A crash
 * or a mid-air collision resets seconds and multiplier. docs/plan/universal-sky.md
 */

import { rotateVec } from '../src/simulation/math'
import type { Quat } from '../src/simulation/types'

export const BASE_MULTIPLIER = 1
export const MIN_MULTIPLIER = 0.5
export const MAX_MULTIPLIER = 5
/** A leg must stay airborne this long before its take-off counts (a bounce is not a take-off). */
export const TAKEOFF_CREDIT_S = 10
/** A leg must have been airborne this long for its landing to count (no hop farming). */
export const LANDING_MIN_LEG_S = 30

export interface Grade {
  label: string
  delta: number
}

const DEG = 180 / Math.PI

/** Pitch (nose up +) and bank magnitude in degrees. Body axes: forward -Z, right +X, up +Y. */
export function attitude(q: Quat): { pitchDeg: number; bankDeg: number } {
  const fwd = rotateVec(q, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 })
  const right = rotateVec(q, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
  const up = rotateVec(q, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 })
  return {
    pitchDeg: Math.asin(Math.max(-1, Math.min(1, fwd.y))) * DEG,
    bankDeg: Math.abs(Math.atan2(right.y, up.y)) * DEG,
  }
}

/** Graded from the attitude at lift-off: wings level and no over-rotation. */
export function gradeTakeoff(pitchDeg: number, bankDeg: number): Grade {
  if (bankDeg <= 5 && pitchDeg <= 15) return { label: 'Clean take-off', delta: 0.25 }
  if (bankDeg <= 10 && pitchDeg <= 20) return { label: 'Good take-off', delta: 0.15 }
  return { label: 'Rough take-off', delta: 0.1 }
}

/** Graded from the sink rate (m/s, positive down) and bank just before touchdown. */
export function gradeLanding(sink: number, bankDeg: number): Grade {
  if (sink < 1 && bankDeg <= 5) return { label: 'Butter landing', delta: 0.5 }
  if (sink < 2 && bankDeg <= 10) return { label: 'Good landing', delta: 0.3 }
  if (sink < 3) return { label: 'Firm landing', delta: 0.1 }
  return { label: 'Hard landing', delta: -0.25 }
}

export function applyGrade(multiplier: number, delta: number): number {
  const m = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, multiplier + delta))
  return Math.round(m * 100) / 100
}
