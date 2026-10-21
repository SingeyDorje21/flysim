import { describe, expect, it } from 'vitest'
import { FLAP_DETENTS, KeyboardControls } from '../keyboard'

function run(kb: KeyboardControls, seconds: number, dt = 1 / 120) {
  let out = kb.update(0)
  for (let t = 0; t < seconds - 1e-9; t += dt) out = kb.update(dt)
  return out
}

describe('KeyboardControls', () => {
  it('ramps the stick while a key is held and re-centres on release', () => {
    const kb = new KeyboardControls()
    kb.keyDown('KeyS')
    expect(run(kb, 0.1).pitch).toBeCloseTo(0.3, 5)
    expect(run(kb, 0.5).pitch).toBe(1)
    kb.keyUp('KeyS')
    expect(run(kb, 0.5).pitch).toBe(0)
  })

  it('maps W/Up to nose down by default and flips with invertPitch', () => {
    const kb = new KeyboardControls()
    kb.keyDown('ArrowUp')
    expect(run(kb, 1).pitch).toBe(-1)
    kb.invertPitch = true
    expect(run(kb, 1).pitch).toBe(1)
  })

  it('maps roll and rudder keys to signed commands', () => {
    const kb = new KeyboardControls()
    kb.keyDown('KeyD')
    kb.keyDown('KeyQ')
    const out = run(kb, 1)
    expect(out.roll).toBe(1)
    expect(out.yaw).toBe(-1)
  })

  it('moves the throttle at a fixed rate and clamps it', () => {
    const kb = new KeyboardControls()
    kb.keyDown('KeyR')
    expect(run(kb, 0.5).throttle).toBeCloseTo(0.3, 5)
    expect(run(kb, 5).throttle).toBe(1)
    kb.keyUp('KeyR')
    kb.keyDown('PageDown')
    expect(run(kb, 5).throttle).toBe(0)
  })

  it('steps flaps one detent per press and ignores key repeat', () => {
    const kb = new KeyboardControls()
    kb.keyDown('KeyX')
    kb.keyDown('KeyX', true)
    expect(kb.update(0).flaps).toBe(FLAP_DETENTS[1])
    kb.keyUp('KeyX')
    kb.keyDown('BracketRight')
    kb.keyDown('BracketRight')
    kb.keyDown('BracketRight')
    expect(kb.update(0).flaps).toBe(1)
    kb.keyDown('KeyZ')
    expect(kb.update(0).flaps).toBe(FLAP_DETENTS[2])
  })

  it('applies brakes only while held', () => {
    const kb = new KeyboardControls()
    kb.keyDown('Space')
    expect(kb.update(0.01).brakes).toBe(1)
    kb.keyUp('Space')
    expect(kb.update(0.01).brakes).toBe(0)
  })

  it('reset centres the stick, sets the levers and releases keys', () => {
    const kb = new KeyboardControls()
    kb.keyDown('KeyS')
    kb.keyDown('KeyR')
    run(kb, 1)
    kb.reset({ throttle: 0.35, flaps: 0.34, trim: 0.2 })
    const out = kb.update(1 / 120)
    expect(out.pitch).toBe(0)
    expect(out.throttle).toBe(0.35)
    expect(out.flaps).toBe(FLAP_DETENTS[1])
    expect(out.trim).toBe(0.2)
  })

  it('releaseAll drops held keys (window blur)', () => {
    const kb = new KeyboardControls()
    kb.keyDown('KeyA')
    kb.releaseAll()
    expect(run(kb, 1).roll).toBe(0)
  })

  it('gives the same ramp for different step sizes', () => {
    const a = new KeyboardControls()
    const b = new KeyboardControls()
    a.keyDown('KeyS')
    b.keyDown('KeyS')
    expect(run(a, 0.2, 1 / 120).pitch).toBeCloseTo(run(b, 0.2, 1 / 60).pitch, 6)
  })

  it('toggles the gear lever and speed brake per press and holds reverse', () => {
    const kb = new KeyboardControls()
    expect(kb.update(0).gear).toBe(1)
    kb.keyDown('KeyG')
    expect(kb.update(0).gear).toBe(0)
    kb.keyDown('KeyG', true)
    expect(kb.update(0).gear).toBe(0)
    kb.keyUp('KeyG')
    kb.keyDown('KeyG')
    expect(kb.update(0).gear).toBe(1)
    kb.keyDown('KeyV')
    expect(kb.update(0).speedbrake).toBe(1)
    kb.keyDown('KeyY')
    expect(kb.update(0).reverse).toBe(1)
    kb.keyUp('KeyY')
    expect(kb.update(0).reverse).toBe(0)
    kb.reset({ throttle: 0.5, flaps: 0, trim: 0, gear: 0, speedbrake: 0 })
    expect(kb.update(0)).toMatchObject({ gear: 0, speedbrake: 0 })
  })

  it('recognises flight keys and ignores others', () => {
    expect(KeyboardControls.isFlightKey('KeyW')).toBe(true)
    expect(KeyboardControls.isFlightKey('KeyC')).toBe(false)
    expect(KeyboardControls.isFlightKey('Escape')).toBe(false)
  })
})
