/**
 * Keyboard -> ControlInputs. Keys are tracked by KeyboardEvent.code so the
 * layout does not matter. update(dt) is called once per fixed physics step,
 * which keeps the stick ramps frame-rate independent.
 */

import type { ControlInputs } from '../simulation/types'

/** Stick/pedal travel per second while a key is held. */
const AXIS_RATE = 3
/** Self-centring (and reversal) rate per second. */
const CENTRE_RATE = 5
const THROTTLE_RATE = 0.6
const TRIM_RATE = 0.4
export const FLAP_DETENTS = [0, 1 / 3, 2 / 3, 1] as const

const KEYS = {
  pitchDown: ['KeyW', 'ArrowUp'],
  pitchUp: ['KeyS', 'ArrowDown'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  throttleUp: ['KeyR', 'PageUp', 'Equal', 'NumpadAdd'],
  throttleDown: ['KeyF', 'PageDown', 'Minus', 'NumpadSubtract'],
  flapsDown: ['BracketRight', 'KeyX'],
  flapsUp: ['BracketLeft', 'KeyZ'],
  brakes: ['KeyB', 'Space'],
  trimUp: ['Period'],
  trimDown: ['Comma'],
  gear: ['KeyG'],
  speedbrake: ['KeyV'],
  reverse: ['KeyY'],
} as const

const FLIGHT_CODES: ReadonlySet<string> = new Set(Object.values(KEYS).flat())

function approach(value: number, target: number, rate: number, dt: number): number {
  // Moving back through centre uses the faster centring rate.
  const r = target === 0 || value * target < 0 ? Math.max(rate, CENTRE_RATE) : rate
  const step = r * dt
  if (value < target) return Math.min(target, value + step)
  return Math.max(target, value - step)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export class KeyboardControls {
  /** When true, Up/W pulls the nose up. */
  invertPitch = false

  private readonly pressed = new Set<string>()
  private pitch = 0
  private roll = 0
  private yaw = 0
  private throttle = 0
  private flapIndex = 0
  private trim = 0
  /** Gear lever: 1 = down. */
  private gear = 1
  private speedbrake = 0

  /** True for codes this controller uses (callers preventDefault on them). */
  static isFlightKey(code: string): boolean {
    return FLIGHT_CODES.has(code)
  }

  keyDown(code: string, repeat = false): void {
    if (!FLIGHT_CODES.has(code)) return
    this.pressed.add(code)
    if (repeat) return
    // Flap lever moves one detent per key press.
    if ((KEYS.flapsDown as readonly string[]).includes(code)) {
      this.flapIndex = Math.min(FLAP_DETENTS.length - 1, this.flapIndex + 1)
    } else if ((KEYS.flapsUp as readonly string[]).includes(code)) {
      this.flapIndex = Math.max(0, this.flapIndex - 1)
    } else if ((KEYS.gear as readonly string[]).includes(code)) {
      // The physics refuses to retract on the ground; the lever still moves.
      this.gear = this.gear > 0.5 ? 0 : 1
    } else if ((KEYS.speedbrake as readonly string[]).includes(code)) {
      this.speedbrake = this.speedbrake > 0.5 ? 0 : 1
    }
  }

  keyUp(code: string): void {
    this.pressed.delete(code)
  }

  /**
   * Follow the gear lever the physics actually accepted: a gear-up command on
   * the ground is refused, and must not come back as an automatic retraction
   * at lift-off.
   */
  syncGear(accepted: number): void {
    this.gear = accepted > 0.5 ? 1 : 0
  }

  /** Move the throttle lever (autothrust drives it in the landing lesson). */
  setThrottle(value: number): void {
    this.throttle = clamp(value, 0, 1)
  }

  /** Set the trim lever (the landing assist hands over trimmed). */
  setTrim(value: number): void {
    this.trim = clamp(value, -1, 1)
  }

  /** Put the flap lever in the detent nearest `lever` (0..1). */
  setFlaps(lever: number): void {
    let best = 0
    FLAP_DETENTS.forEach((d, i) => {
      if (Math.abs(d - lever) < Math.abs(FLAP_DETENTS[best] - lever)) best = i
    })
    this.flapIndex = best
  }

  /** Gear lever: 1 = down. */
  setGear(lever: number): void {
    this.gear = lever > 0.5 ? 1 : 0
  }

  isHeld(code: string): boolean {
    return this.pressed.has(code)
  }

  /** Release every key, e.g. when the window loses focus. */
  releaseAll(): void {
    this.pressed.clear()
  }

  /** Put the levers where the spawn wants them and centre the stick. */
  reset(initial: { throttle: number; flaps: number; trim: number; gear?: number; speedbrake?: number }): void {
    this.pressed.clear()
    this.pitch = 0
    this.roll = 0
    this.yaw = 0
    this.throttle = clamp(initial.throttle, 0, 1)
    this.trim = clamp(initial.trim, -1, 1)
    this.gear = initial.gear === undefined ? 1 : initial.gear > 0.5 ? 1 : 0
    this.speedbrake = initial.speedbrake === undefined ? 0 : initial.speedbrake > 0.5 ? 1 : 0
    let best = 0
    FLAP_DETENTS.forEach((d, i) => {
      if (Math.abs(d - initial.flaps) < Math.abs(FLAP_DETENTS[best] - initial.flaps)) best = i
    })
    this.flapIndex = best
  }

  /** Advance the ramps by dt seconds and return the resulting commands. */
  update(dt: number): ControlInputs {
    const pitchSign = this.invertPitch ? -1 : 1
    const pitchTarget = (this.axis(KEYS.pitchUp, KEYS.pitchDown)) * pitchSign
    this.pitch = approach(this.pitch, pitchTarget, AXIS_RATE, dt)
    this.roll = approach(this.roll, this.axis(KEYS.rollRight, KEYS.rollLeft), AXIS_RATE, dt)
    this.yaw = approach(this.yaw, this.axis(KEYS.yawRight, KEYS.yawLeft), AXIS_RATE, dt)
    this.throttle = clamp(this.throttle + this.axis(KEYS.throttleUp, KEYS.throttleDown) * THROTTLE_RATE * dt, 0, 1)
    this.trim = clamp(this.trim + this.axis(KEYS.trimUp, KEYS.trimDown) * TRIM_RATE * dt, -1, 1)
    return {
      pitch: this.pitch,
      roll: this.roll,
      yaw: this.yaw,
      throttle: this.throttle,
      flaps: FLAP_DETENTS[this.flapIndex],
      brakes: this.any(KEYS.brakes) ? 1 : 0,
      trim: this.trim,
      gear: this.gear,
      speedbrake: this.speedbrake,
      reverse: this.any(KEYS.reverse) ? 1 : 0,
    }
  }

  private any(codes: readonly string[]): boolean {
    return codes.some((c) => this.pressed.has(c))
  }

  private axis(positive: readonly string[], negative: readonly string[]): number {
    return (this.any(positive) ? 1 : 0) - (this.any(negative) ? 1 : 0)
  }
}
