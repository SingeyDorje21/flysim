import { describe, expect, it } from 'vitest'
import { WORLD } from '../../config/world'
import { TIMES_OF_DAY } from '../types'
import { environmentFor } from '../environment/constants'
import {
  CLOUD_MAX_ALT,
  CLOUD_MIN_ALT,
  generateClouds,
  PUFFS_PER_CLOUD,
  snapWaterCenter,
  WATER_SNAP,
} from '../environment/envMath'

describe('environmentFor', () => {
  it('returns valid, distinct looks with unit sun vectors', () => {
    const seenFog = new Set<number>()
    for (const t of TIMES_OF_DAY) {
      const look = environmentFor(t)
      expect(look.sunDirection.length()).toBeCloseTo(1, 6)
      expect(look.sunDirection.y).toBeGreaterThan(0)
      expect(look.sunIntensity).toBeGreaterThan(0)
      for (const c of [look.fogColor, look.horizonColor, look.zenithColor, look.waterDeep, look.waterShallow]) {
        expect(Number.isInteger(c)).toBe(true)
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(0xffffff)
      }
      seenFog.add(look.fogColor)
    }
    expect(seenFog.size).toBe(3)
  })

  it('puts the sun low in the east in the morning, high at noon, low in the west in the evening', () => {
    const m = environmentFor('morning').sunDirection
    const n = environmentFor('noon').sunDirection
    const e = environmentFor('evening').sunDirection
    expect(m.y).toBeLessThan(n.y)
    expect(e.y).toBeLessThan(n.y)
    expect(m.x).toBeGreaterThan(0.5)
    expect(e.x).toBeLessThan(-0.5)
  })

  it('is pure', () => {
    expect(environmentFor('noon')).toBe(environmentFor('noon'))
  })
})

describe('generateClouds', () => {
  it('is deterministic', () => {
    expect(generateClouds(40)).toEqual(generateClouds(40))
  })

  it('keeps every puff inside the altitude band and the world', () => {
    const clouds = generateClouds(160)
    expect(clouds).toHaveLength(160)
    for (const c of clouds) {
      expect(c.puffs).toHaveLength(PUFFS_PER_CLOUD)
      expect(Math.abs(c.x)).toBeLessThanOrEqual(WORLD.terrainSize / 2)
      expect(Math.abs(c.z)).toBeLessThanOrEqual(WORLD.terrainSize / 2)
      for (const p of c.puffs) {
        expect(p.y - p.ry).toBeGreaterThanOrEqual(CLOUD_MIN_ALT)
        expect(p.y + p.ry).toBeLessThanOrEqual(CLOUD_MAX_ALT)
      }
    }
  })
})

describe('snapWaterCenter', () => {
  it('snaps to the grid and is stable within a cell', () => {
    expect(snapWaterCenter(0)).toBe(0)
    expect(snapWaterCenter(WATER_SNAP * 3 + 10)).toBe(WATER_SNAP * 3)
    expect(snapWaterCenter(WATER_SNAP * 3 + 100)).toBe(WATER_SNAP * 3)
    expect(snapWaterCenter(-WATER_SNAP * 2 - 20)).toBe(-WATER_SNAP * 2)
    expect(Math.abs(snapWaterCenter(12345.6) - 12345.6)).toBeLessThanOrEqual(WATER_SNAP / 2)
  })
})
