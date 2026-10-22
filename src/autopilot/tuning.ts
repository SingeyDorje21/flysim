/**
 * Per-aircraft autopilot limits: how hard it may bank, climb and descend.
 * Airliner values follow normal passenger-comfort practice (25 degree bank,
 * ~2,500 ft/min climb); the trainer is gentler and the F-22 much quicker.
 */

import type { AircraftId } from '../config/aircraftCatalog'

export interface AutopilotTuning {
  maxBankDeg: number
  /** Vertical speed limits (m/s). */
  maxClimb: number
  maxDescent: number
  /** Vertical acceleration allowed when levelling off at the selected altitude (m/s^2). */
  captureAccel: number
  /** Altitude-hold gain (1/s): vertical speed asked for per metre of altitude error. */
  altGain: number
  /** Flight-path response (1/s): how quickly a vertical-speed error is corrected. */
  pathGain: number
  /** Extra load factor the vertical modes may ask for (g). */
  maxDeltaG: number
  /** Roll rate the heading mode may ask for (deg/s). */
  maxRollRateDeg: number
}

/** The autopilot cannot be engaged below this height (m, 100 ft). */
export const AP_MIN_HEIGHT = 30

const AIRLINER: AutopilotTuning = {
  maxBankDeg: 25,
  maxClimb: 12.7,
  maxDescent: 15,
  captureAccel: 0.5,
  altGain: 0.08,
  pathGain: 0.3,
  maxDeltaG: 0.2,
  maxRollRateDeg: 4,
}

const TUNING: Record<AircraftId, AutopilotTuning> = {
  trainer: {
    maxBankDeg: 20,
    maxClimb: 3.5,
    maxDescent: 4,
    captureAccel: 0.3,
    altGain: 0.15,
    pathGain: 0.8,
    maxDeltaG: 0.25,
    maxRollRateDeg: 8,
  },
  f22: {
    maxBankDeg: 30,
    maxClimb: 50,
    maxDescent: 50,
    captureAccel: 2,
    altGain: 0.1,
    pathGain: 0.4,
    maxDeltaG: 0.5,
    maxRollRateDeg: 20,
  },
  a220: AIRLINER,
  a350: AIRLINER,
  global8000: { ...AIRLINER, maxClimb: 15 },
}

export function autopilotTuning(id: AircraftId): AutopilotTuning {
  return TUNING[id]
}
