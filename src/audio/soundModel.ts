/**
 * Pure sound logic: continuous mix levels and one-shot events from the
 * aircraft state. FlightAudio turns these into WebAudio nodes; keeping the
 * rules here makes them testable without an AudioContext.
 */

import type { EngineKind } from '../config/aircraftCatalog'

export interface AudioFrame {
  engineKind: EngineKind
  /** Fan speed fraction (jets). */
  n1: number
  afterburner: boolean
  rpm: number
  spool: number
  engineRunning: boolean
  /** Throttle lever 0..1. */
  throttle: number
  /** Flap lever 0..1. */
  flaps: number
  airspeed: number
  groundSpeed: number
  verticalSpeed: number
  onGround: boolean
  stallWarning: boolean
  crashed: boolean
  ringsPassed: number
  /** Changes on spawn/restart; resets event detection. */
  teleportId: number
  /** Paused or on the results screen: everything goes quiet. */
  frozen: boolean
  /** Flight School step counter (0 outside lessons); a change plays a chime. */
  lessonStep: number
  /** Autopilot disconnect counter; a change sounds the disconnect warning. */
  apDisconnects?: number
}

export interface SoundLevels {
  /** Fundamental of the engine/propeller note (Hz). */
  engineFreq: number
  engineGain: number
  /** Low-pass cutoff of the engine (Hz): brighter at high power. */
  engineCutoff: number
  windGain: number
  windFreq: number
  rollGain: number
  hornOn: boolean
  /** Jet turbine whine: pitch (Hz) and level. */
  whineFreq: number
  whineGain: number
  /** Jet exhaust roar (low band-passed noise). */
  roarGain: number
  /** Afterburner rumble. */
  afterburnerGain: number
}

export type SoundEvent =
  | { type: 'touchdown'; sink: number; groundSpeed: number }
  | { type: 'crash' }
  | { type: 'ring' }
  | { type: 'flaps' }
  | { type: 'throttle' }
  | { type: 'step' }
  | { type: 'apOff' }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function soundLevels(f: AudioFrame): SoundLevels {
  const alive = !f.crashed
  const engineOn = alive && f.engineRunning
  const jet = f.engineKind !== 'piston'
  const piston = engineOn && !jet
  // Four-cylinder four-stroke: two firing pulses per revolution.
  const engineFreq = Math.max(15, (f.rpm / 60) * 2)
  const wind = clamp01((f.airspeed - 12) / 55)
  const n1 = clamp01(f.n1)
  return {
    engineFreq,
    engineGain: piston ? 0.12 + 0.28 * clamp01(f.spool) : 0,
    whineFreq: 400 + 2600 * n1,
    whineGain: engineOn && jet ? 0.02 + 0.06 * n1 : 0,
    roarGain: engineOn && jet ? 0.05 + 0.35 * n1 * n1 : 0,
    afterburnerGain: engineOn && jet && f.afterburner ? 0.45 : 0,
    engineCutoff: 250 + 1800 * clamp01(f.spool) + f.rpm * 0.2,
    windGain: alive ? wind * wind * 0.4 : 0,
    windFreq: 300 + f.airspeed * 18,
    rollGain: alive && f.onGround ? clamp01(f.groundSpeed / 25) * 0.3 : 0,
    hornOn: alive && f.stallWarning && !f.onGround,
  }
}

/** Airborne at least this long before a ground contact counts as a landing. */
const MIN_AIRBORNE = 1

export class SoundEventDetector {
  private prev: AudioFrame | null = null
  private airborneFor = 0
  private throttleStep = 0

  detect(f: AudioFrame, dt: number): SoundEvent[] {
    const prev = this.prev
    if (!prev || prev.teleportId !== f.teleportId) {
      this.prev = { ...f }
      this.airborneFor = 0
      this.throttleStep = Math.round(f.throttle * 10)
      return []
    }
    const events: SoundEvent[] = []
    if (!f.frozen) {
      if (f.crashed && !prev.crashed) events.push({ type: 'crash' })
      if (!f.crashed) {
        if (f.onGround && !prev.onGround && this.airborneFor >= MIN_AIRBORNE) {
          events.push({ type: 'touchdown', sink: Math.max(0, -prev.verticalSpeed), groundSpeed: f.groundSpeed })
        }
        if (f.ringsPassed > prev.ringsPassed) events.push({ type: 'ring' })
        if (f.lessonStep > prev.lessonStep) events.push({ type: 'step' })
        if ((f.apDisconnects ?? 0) > (prev.apDisconnects ?? 0)) events.push({ type: 'apOff' })
        if (f.flaps !== prev.flaps) events.push({ type: 'flaps' })
        // A detent click every 10% of throttle travel.
        const step = Math.round(f.throttle * 10)
        if (step !== this.throttleStep) {
          this.throttleStep = step
          events.push({ type: 'throttle' })
        }
      }
      this.airborneFor = f.onGround ? 0 : this.airborneFor + dt
    }
    this.prev = { ...f }
    return events
  }
}
