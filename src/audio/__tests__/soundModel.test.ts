import { describe, expect, it } from 'vitest'
import { SoundEventDetector, soundLevels, type AudioFrame } from '../soundModel'

const DT = 1 / 60

function frame(over: Partial<AudioFrame> = {}): AudioFrame {
  return {
    engineKind: 'piston',
    n1: 0.26,
    afterburner: false,
    rpm: 700,
    spool: 0,
    engineRunning: true,
    throttle: 0,
    flaps: 0,
    airspeed: 0,
    groundSpeed: 0,
    verticalSpeed: 0,
    onGround: true,
    stallWarning: false,
    crashed: false,
    ringsPassed: 0,
    teleportId: 1,
    frozen: false,
    lessonStep: 0,
    ...over,
  }
}

describe('soundLevels', () => {
  it('raises engine pitch, volume and brightness with power', () => {
    const idle = soundLevels(frame())
    const full = soundLevels(frame({ rpm: 2700, spool: 1 }))
    expect(full.engineFreq).toBeGreaterThan(idle.engineFreq)
    expect(full.engineGain).toBeGreaterThan(idle.engineGain)
    expect(full.engineCutoff).toBeGreaterThan(idle.engineCutoff)
  })

  it('adds wind with airspeed and tyre rumble only on the ground', () => {
    expect(soundLevels(frame({ airspeed: 5 })).windGain).toBe(0)
    expect(soundLevels(frame({ airspeed: 60, onGround: false })).windGain).toBeGreaterThan(0.2)
    expect(soundLevels(frame({ groundSpeed: 20 })).rollGain).toBeGreaterThan(0)
    expect(soundLevels(frame({ groundSpeed: 20, onGround: false })).rollGain).toBe(0)
  })

  it('jets use a turbine whine and roar instead of the piston drone, afterburner adds a rumble', () => {
    const idle = soundLevels(frame({ engineKind: 'turbofan', n1: 0.25 }))
    const full = soundLevels(frame({ engineKind: 'turbofan', n1: 1 }))
    expect(idle.engineGain).toBe(0)
    expect(full.whineFreq).toBeGreaterThan(idle.whineFreq)
    expect(full.roarGain).toBeGreaterThan(idle.roarGain)
    expect(full.afterburnerGain).toBe(0)
    expect(soundLevels(frame({ engineKind: 'afterburningTurbofan', n1: 1, afterburner: true })).afterburnerGain).toBeGreaterThan(0)
    expect(soundLevels(frame()).whineGain + soundLevels(frame()).roarGain).toBe(0)
  })

  it('sounds the stall horn only when airborne', () => {
    expect(soundLevels(frame({ stallWarning: true, onGround: false })).hornOn).toBe(true)
    expect(soundLevels(frame({ stallWarning: true, onGround: true })).hornOn).toBe(false)
  })

  it('goes quiet once the engine stops or the aircraft crashes', () => {
    expect(soundLevels(frame({ engineRunning: false })).engineGain).toBe(0)
    const wreck = soundLevels(frame({ crashed: true, airspeed: 60, onGround: false, stallWarning: true }))
    expect(wreck.engineGain + wreck.windGain + wreck.rollGain).toBe(0)
    expect(wreck.hornOn).toBe(false)
  })
})

describe('SoundEventDetector', () => {
  it('reports a touchdown after a real flight with the sink rate', () => {
    const d = new SoundEventDetector()
    d.detect(frame({ onGround: false }), DT)
    for (let i = 0; i < 120; i++) d.detect(frame({ onGround: false, verticalSpeed: -1.5 }), DT)
    const events = d.detect(frame({ onGround: true, groundSpeed: 30 }), DT)
    expect(events).toEqual([{ type: 'touchdown', sink: 1.5, groundSpeed: 30 }])
  })

  it('ignores short hops (bounces on the take-off roll)', () => {
    const d = new SoundEventDetector()
    d.detect(frame(), DT)
    d.detect(frame({ onGround: false }), DT)
    expect(d.detect(frame({ onGround: true }), DT)).toEqual([])
  })

  it('clicks every 10% of throttle travel', () => {
    const d = new SoundEventDetector()
    d.detect(frame(), DT)
    expect(d.detect(frame({ throttle: 0.04 }), DT)).toEqual([])
    expect(d.detect(frame({ throttle: 0.06 }), DT)).toEqual([{ type: 'throttle' }])
    expect(d.detect(frame({ throttle: 0.07 }), DT)).toEqual([])
  })

  it('reports flaps, ring passes and the crash once', () => {
    const d = new SoundEventDetector()
    d.detect(frame({ onGround: false }), DT)
    expect(d.detect(frame({ onGround: false, flaps: 1 / 3 }), DT)).toEqual([{ type: 'flaps' }])
    expect(d.detect(frame({ onGround: false, flaps: 1 / 3, ringsPassed: 1 }), DT)).toEqual([{ type: 'ring' }])
    expect(d.detect(frame({ crashed: true, flaps: 1 / 3, ringsPassed: 1 }), DT)).toEqual([{ type: 'crash' }])
    expect(d.detect(frame({ crashed: true, flaps: 1 / 3, ringsPassed: 1 }), DT)).toEqual([])
  })

  it('stays silent while frozen and on a teleport', () => {
    const d = new SoundEventDetector()
    d.detect(frame(), DT)
    expect(d.detect(frame({ throttle: 0.5, frozen: true }), DT)).toEqual([])
    // A restart (new teleportId) must not replay a "throttle" or "touchdown" event.
    expect(d.detect(frame({ teleportId: 2, onGround: false, throttle: 0.9 }), DT)).toEqual([])
  })
})
