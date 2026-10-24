import { describe, expect, it } from 'vitest'
import { getAircraftConfig } from '../../config/aircraft'
import { INITIAL_TELEMETRY, type TelemetrySnapshot } from '../../state/telemetry'
import { isLanding, landingAdvice, pitchKeys, touchdownVerdict, VERDICT_SECONDS } from '../landingCoach'
import { techniqueFor } from '../technique'

const KT = 0.514444
const KEYS = pitchKeys(false)
const tech = techniqueFor('trainer')
const pathSink = (v: number) => v * Math.sin((3 * Math.PI) / 180)

/** A stable trainer final approach: on speed, on the 3 degree path and centreline, 150 m up. */
function onFinal(extra: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    ...INITIAL_TELEMETRY,
    aircraftId: 'trainer',
    onGround: false,
    heightAboveGround: 150,
    airspeed: tech.approachSpeed,
    verticalSpeed: -pathSink(tech.approachSpeed),
    flaps: tech.landingFlaps,
    gearPosition: 1,
    gearLever: 1,
    throttle: 0.3,
    pitchDeg: 0,
    nav: { nearest: null, approach: { code: 'FSCF', runway: '36', distance: 2900, lateral: 0, vertical: 0 } },
    ...extra,
  }
}

const ids = (t: TelemetrySnapshot, keys = KEYS) => landingAdvice(t, keys).map((a) => a.id)

describe('landing coach', () => {
  it('only coaches an airborne, low, descending approach outside lessons', () => {
    expect(isLanding(onFinal())).toBe(true)
    expect(isLanding(onFinal({ onGround: true }))).toBe(false)
    expect(isLanding(onFinal({ heightAboveGround: 800 }))).toBe(false)
    expect(isLanding(onFinal({ verticalSpeed: 4 }))).toBe(false)
    expect(isLanding(onFinal({ crashed: true }))).toBe(false)
    expect(isLanding(onFinal({ lesson: {} as TelemetrySnapshot['lesson'] }))).toBe(false)
    // A field landing: no runway ahead, but gear down and descending.
    expect(isLanding(onFinal({ nav: { nearest: null, approach: null } }))).toBe(true)
    expect(landingAdvice(onFinal({ onGround: true }), KEYS)).toEqual([])
  })

  it('says all is well on a stable approach', () => {
    const tips = landingAdvice(onFinal(), KEYS)
    expect(tips).toHaveLength(1)
    expect(tips[0]).toMatchObject({ id: 'ok', tone: 'good' })
  })

  it('tells the pilot what to change for speed, path, centreline and configuration', () => {
    expect(ids(onFinal({ airspeed: tech.approachSpeed + 20 * KT }))).toContain('speed')
    expect(landingAdvice(onFinal({ airspeed: tech.approachSpeed + 20 * KT }), KEYS)[0].text).toMatch(/too fast/i)
    expect(landingAdvice(onFinal({ airspeed: tech.approachSpeed - 8 * KT }), KEYS)[0].text).toMatch(/too slow/i)
    const low = onFinal({ nav: { nearest: null, approach: { code: 'FSCF', runway: '36', distance: 2900, lateral: 0, vertical: -80 } } })
    expect(ids(low)[0]).toBe('low')
    const high = onFinal({ nav: { nearest: null, approach: { code: 'FSCF', runway: '36', distance: 2900, lateral: 0, vertical: 80 } } })
    expect(ids(high)).toContain('high')
    const left = onFinal({ nav: { nearest: null, approach: { code: 'FSCF', runway: '36', distance: 2900, lateral: -150, vertical: 0 } } })
    expect(landingAdvice(left, KEYS).find((a) => a.id === 'line')?.text).toMatch(/right/)
    expect(ids(onFinal({ flaps: 0 }))).toContain('flaps')
    expect(ids(onFinal({ verticalSpeed: -8 }))).toContain('sink')
  })

  it('reminds airliner pilots about the gear first', () => {
    const a220 = techniqueFor('a220')
    const t = onFinal({ aircraftId: 'a220', airspeed: a220.approachSpeed, flaps: a220.landingFlaps, gearLever: 0, gearPosition: 0 })
    expect(ids(t)[0]).toBe('gear')
  })

  it('calls the flare near the ground, with the right key for the pitch setting', () => {
    const flare = onFinal({ heightAboveGround: tech.flareHeight * 0.8, verticalSpeed: -3, throttle: 0 })
    expect(landingAdvice(flare, KEYS)[0]).toMatchObject({ id: 'flare', tone: 'warn' })
    expect(landingAdvice(flare, KEYS)[0].text).toContain('(S)')
    expect(landingAdvice(flare, pitchKeys(true))[0].text).toContain('(W)')
    const settling = onFinal({ heightAboveGround: tech.flareHeight * 0.8, verticalSpeed: -0.6, throttle: 0 })
    expect(ids(settling)).toEqual(['hold'])
  })

  it('gives advice in words, never readings', () => {
    const cases = [
      onFinal(),
      onFinal({ airspeed: tech.approachSpeed + 30 * KT, verticalSpeed: -9, flaps: 0, bankDeg: 30 }),
      onFinal({ heightAboveGround: 2, verticalSpeed: -3, throttle: 0.5, bankDeg: 8 }),
      onFinal({ heightAboveGround: 6, verticalSpeed: 1, pitchDeg: 20 }),
    ]
    for (const t of cases) {
      const tips = landingAdvice(t, KEYS)
      expect(tips.length).toBeGreaterThan(0)
      expect(tips.length).toBeLessThanOrEqual(2)
      for (const a of tips) expect(a.text).not.toMatch(/\d/)
    }
  })
})

describe('touchdown verdict', () => {
  const limit = getAircraftConfig('trainer').crash.hardLandingSinkRate
  const landed = (sink: number, ago = 1): TelemetrySnapshot => ({
    ...INITIAL_TELEMETRY,
    aircraftId: 'trainer',
    onGround: true,
    simTime: 100,
    touchdown: { sink, simTime: 100 - ago },
  })

  it('grades the touchdown against the aircraft limit', () => {
    expect(touchdownVerdict(landed(0.5))?.title).toBe('Smooth landing!')
    expect(touchdownVerdict(landed(limit * 0.7))?.title).toBe('Firm landing')
    expect(touchdownVerdict(landed(limit * 1.3))).toMatchObject({ title: 'Hard landing', tone: 'warn' })
  })

  it('shows briefly and never after a crash', () => {
    expect(touchdownVerdict(landed(0.5, VERDICT_SECONDS + 1))).toBeNull()
    expect(touchdownVerdict({ ...landed(0.5), crashed: true })).toBeNull()
    expect(touchdownVerdict({ ...INITIAL_TELEMETRY })).toBeNull()
  })
})
