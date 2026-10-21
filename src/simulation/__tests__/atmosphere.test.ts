import { describe, expect, it } from 'vitest'
import { AIRCRAFT_CONFIGS } from '../../config/aircraft'
import { compressibilityDrag, criticalAlphaDeg } from '../aerodynamics'
import { airDensity, airPressure, airTemperature, speedOfSound } from '../atmosphere'

describe('ISA atmosphere to 20 km', () => {
  it('matches the standard tables', () => {
    // ISA table values against geopotential altitude (density kg/m^3, temperature K, speed of sound m/s).
    expect(airDensity(0)).toBeCloseTo(1.225, 4)
    expect(airTemperature(0)).toBeCloseTo(288.15, 6)
    expect(speedOfSound(0)).toBeCloseTo(340.29, 1)
    expect(airPressure(0)).toBeCloseTo(101325, 0)
    expect(airDensity(5000)).toBeCloseTo(0.7364, 3)
    expect(airDensity(11000)).toBeCloseTo(0.3639, 3)
    expect(airTemperature(11000)).toBeCloseTo(216.65, 2)
    expect(speedOfSound(11000)).toBeCloseTo(295.07, 1)
    expect(airDensity(15000)).toBeCloseTo(0.1937, 3)
    expect(airDensity(20000)).toBeCloseTo(0.088, 3)
    expect(airPressure(20000)).toBeCloseTo(5475, -1)
    expect(airTemperature(18000)).toBeCloseTo(216.65, 6)
  })

  it('is continuous at the tropopause and finite for any input', () => {
    expect(airDensity(10999.999)).toBeCloseTo(airDensity(11000.001), 6)
    for (const h of [Number.NaN, Number.POSITIVE_INFINITY, -1e9, 1e9, -500, 30000]) {
      expect(Number.isFinite(airDensity(h))).toBe(true)
      expect(Number.isFinite(speedOfSound(h))).toBe(true)
      expect(airDensity(h)).toBeGreaterThan(0)
    }
  })
})

describe('compressibility drag', () => {
  it('is zero below the critical Mach, rises past it and stays finite and bounded to Mach 2.3+', () => {
    for (const id of ['a220', 'a350', 'global8000', 'f22'] as const) {
      const c = AIRCRAFT_CONFIGS[id].aero.compressibility
      expect(c).not.toBeNull()
      if (!c) continue
      expect(compressibilityDrag(c.mcrit - 0.05, c)).toBe(0)
      expect(compressibilityDrag(c.mcrit + 0.05, c)).toBeGreaterThan(0)
      expect(compressibilityDrag(c.mcrit + 0.1, c)).toBeGreaterThan(compressibilityDrag(c.mcrit + 0.05, c))
      for (let m = 0; m <= 3; m += 0.05) {
        const d = compressibilityDrag(m, c)
        expect(Number.isFinite(d)).toBe(true)
        expect(d).toBeLessThanOrEqual(c.cdPeak + 1e-12)
      }
    }
    expect(compressibilityDrag(0.95, null)).toBe(0)
  })

  it('the F-22 has a transonic hump: peak near Mach 1.15, lower supersonic drag beyond it', () => {
    const c = AIRCRAFT_CONFIGS.f22.aero.compressibility!
    const peak = compressibilityDrag(1.15, c)
    expect(compressibilityDrag(1.7, c)).toBeLessThan(0.75 * peak)
    expect(compressibilityDrag(2.3, c)).toBeLessThan(compressibilityDrag(1.7, c))
    expect(compressibilityDrag(2.3, c)).toBeGreaterThan(0)
  })

  it('slats raise the airliner critical AoA from the first flap detent', () => {
    const a = AIRCRAFT_CONFIGS.a350.aero
    expect(criticalAlphaDeg(0, a)).toBe(a.alphaCritDeg)
    expect(criticalAlphaDeg(1 / 3, a)).toBeCloseTo(a.alphaCritDeg + a.slatAlphaCritDeg, 9)
    expect(criticalAlphaDeg(1, AIRCRAFT_CONFIGS.trainer.aero)).toBe(AIRCRAFT_CONFIGS.trainer.aero.alphaCritDeg)
  })
})
