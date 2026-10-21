/**
 * Throttled flight telemetry for the HUD and instruments. The flight session
 * publishes a fresh snapshot object ~30 times a second; between publishes the
 * same object is returned, which keeps useSyncExternalStore stable.
 * Owned by the orchestrator. Values are SI; angles are degrees.
 */

import { useSyncExternalStore } from 'react'
import type { AircraftId } from '../config/aircraftCatalog'
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
  nav: NavInfo
  aircraftId: AircraftId
  mach: number
  /** Fan / propeller speed fraction 0..~1.05 (jets show this as N1 %). */
  n1: number
  afterburner: boolean
  /** Gear extension 0 (up) .. 1 (down); lever position separately. */
  gearPosition: number
  gearLever: number
  /** Speed brake extension 0..1. */
  speedbrake: number
  /** Reverse thrust command 0..1. */
  reverse: number
}

export interface NavInfo {
  /** Closest airport: distance (m) and bearing (deg) from the aircraft. */
  nearest: { code: string; name: string; distance: number; bearingDeg: number } | null
  /**
   * Runway end being approached (in front, aligned, within 15 km), with
   * deviations from the extended centreline (m, + = right of it) and the
   * 3 degree glide path (m, + = above it).
   */
  approach: { code: string; runway: string; distance: number; lateral: number; vertical: number } | null
}

export const INITIAL_TELEMETRY: Readonly<TelemetrySnapshot> = deepFreeze({
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
  nav: { nearest: null, approach: null },
  aircraftId: 'trainer',
  mach: 0,
  n1: 0,
  afterburner: false,
  gearPosition: 1,
  gearLever: 1,
  speedbrake: 0,
  reverse: 0,
})

function deepFreeze<T extends object>(obj: T): T {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') deepFreeze(value)
  }
  return Object.freeze(obj)
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
