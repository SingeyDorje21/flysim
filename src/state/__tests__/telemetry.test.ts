import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getTelemetry,
  INITIAL_TELEMETRY,
  publishTelemetry,
  resetTelemetry,
  subscribeTelemetry,
  type TelemetrySnapshot,
} from '../telemetry'

afterEach(() => resetTelemetry())

describe('telemetry store', () => {
  it('returns the same reference until the next publish', () => {
    const a = getTelemetry()
    expect(getTelemetry()).toBe(a)
    const next: TelemetrySnapshot = { ...INITIAL_TELEMETRY, airspeed: 30 }
    publishTelemetry(next)
    expect(getTelemetry()).toBe(next)
    expect(getTelemetry()).toBe(getTelemetry())
    expect(getTelemetry()).not.toBe(a)
  })

  it('notifies subscribers on publish and stops after unsubscribe', () => {
    const fn = vi.fn()
    const unsub = subscribeTelemetry(fn)
    publishTelemetry({ ...INITIAL_TELEMETRY, altitude: 5 })
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
    publishTelemetry({ ...INITIAL_TELEMETRY, altitude: 6 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('supports several subscribers and double unsubscribe', () => {
    const a = vi.fn()
    const b = vi.fn()
    const ua = subscribeTelemetry(a)
    const ub = subscribeTelemetry(b)
    publishTelemetry({ ...INITIAL_TELEMETRY })
    ua()
    ua()
    publishTelemetry({ ...INITIAL_TELEMETRY })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
    ub()
  })

  it('a subscriber may unsubscribe during notification', () => {
    const calls: string[] = []
    const unsub = subscribeTelemetry(() => {
      calls.push('a')
      unsub()
    })
    const ub = subscribeTelemetry(() => calls.push('b'))
    publishTelemetry({ ...INITIAL_TELEMETRY })
    expect(calls).toEqual(['a', 'b'])
    ub()
  })

  it('resetTelemetry restores the initial snapshot and notifies', () => {
    const fn = vi.fn()
    const unsub = subscribeTelemetry(fn)
    publishTelemetry({ ...INITIAL_TELEMETRY, airspeed: 99, crashed: true })
    resetTelemetry()
    expect(getTelemetry()).toBe(INITIAL_TELEMETRY)
    expect(getTelemetry().crashed).toBe(false)
    expect(fn).toHaveBeenCalledTimes(2)
    unsub()
  })

  it('initial snapshot is sane', () => {
    expect(INITIAL_TELEMETRY.gForce).toBe(1)
    expect(INITIAL_TELEMETRY.challenge).toBeNull()
    expect(INITIAL_TELEMETRY.onGround).toBe(true)
  })

  // Known gap (reported): INITIAL_TELEMETRY is not frozen, so a shallow copy
  // shares nested objects (stick, position) and in-place mutation corrupts it.
  it('INITIAL_TELEMETRY nested objects are protected from mutation', () => {
    expect(Object.isFrozen(INITIAL_TELEMETRY.stick)).toBe(true)
  })
})
