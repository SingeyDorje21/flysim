/**
 * Throttled flight telemetry for the HUD and instruments. The flight session
 * publishes a fresh snapshot object ~30 times a second; between publishes the
 * same object is returned, which keeps useSyncExternalStore stable.
 * Owned by the orchestrator. Values are SI; angles are degrees.
 */

import { useSyncExternalStore } from 'react'
import type { ChallengeProgress } from '../game/types'
import type { Vec3 } from '../simulation/types'

export interface TelemetrySnapshot {
  /** m/s */
  airspeed: number
  /** m/s */
  groundSpeed: number
  /** m above sea level */
  altitude: number
  /** m above ground (main gear) */
  heightAboveGround: number
  /** m/s, + = climbing */
  verticalSpeed: number
  headingDeg: number
  pitchDeg: number
  bankDeg: number
  angleOfAttackDeg: number
  sideslipDeg: number
  gForce: number
  /** Throttle lever 0..1 */
  throttle: number
  rpm: number
  engineRunning: boolean
  /** Flap lever 0..1 */
  flaps: number
  /** Actual flap deflection */
  flapsDeg: number
  brakes: number
  /** -1..1, + = nose-up trim */
  trim: number
  /** Applied stick and pedal commands, -1..1. */
  stick: { pitch: number; roll: number; yaw: number }
  stallWarning: boolean
  stalled: boolean
  onGround: boolean
  crashed: boolean
  crashReason: string | null
  simTime: number
  position: Vec3
  challenge: ChallengeProgress | null
}

export const INITIAL_TELEMETRY: TelemetrySnapshot = {
  airspeed: 0,
  groundSpeed: 0,
  altitude: 0,
  heightAboveGround: 0,
  verticalSpeed: 0,
  headingDeg: 0,
  pitchDeg: 0,
  bankDeg: 0,
  angleOfAttackDeg: 0,
  sideslipDeg: 0,
  gForce: 1,
  throttle: 0,
  rpm: 0,
  engineRunning: false,
  flaps: 0,
  flapsDeg: 0,
  brakes: 0,
  trim: 0,
  stick: { pitch: 0, roll: 0, yaw: 0 },
  stallWarning: false,
  stalled: false,
  onGround: true,
  crashed: false,
  crashReason: null,
  simTime: 0,
  position: { x: 0, y: 0, z: 0 },
  challenge: null,
}

let current: TelemetrySnapshot = INITIAL_TELEMETRY
const listeners = new Set<() => void>()

/** Replace the snapshot. Pass a NEW object each time; never mutate a published one. */
export function publishTelemetry(next: TelemetrySnapshot): void {
  current = next
  listeners.forEach((listener) => listener())
}

export function getTelemetry(): TelemetrySnapshot {
  return current
}

export function subscribeTelemetry(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetTelemetry(): void {
  publishTelemetry(INITIAL_TELEMETRY)
}

/** Re-renders the caller whenever a new snapshot is published (~30 Hz). */
export function useTelemetry(): TelemetrySnapshot {
  return useSyncExternalStore(subscribeTelemetry, getTelemetry, getTelemetry)
}
