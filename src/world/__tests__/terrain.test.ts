import { describe, expect, it } from 'vitest'
import {
  AIRPORT_FLAT_ZONE,
  APPROACH_CORRIDOR,
  DEPARTURE_CORRIDOR,
  RUNWAY,
  WORLD,
  type Rect,
} from '../../config/world'
import { QUALITY_LEVELS, QUALITY_PROFILES } from '../../config/quality'
import { RING_COURSE } from '../../game/courses'
import { createTerrainSampler, naturalHeightAt } from '../terrain/heightField'

const terrain = createTerrainSampler()

function forEachInRect(r: Rect, step: number, fn: (x: number, z: number) => void): void {
  for (let x = r.minX; x <= r.maxX; x += step) for (let z = r.minZ; z <= r.maxZ; z += step) fn(x, z)
}

describe('terrain sampler', () => {
  it('is deterministic', () => {
    const a = createTerrainSampler()
    const b = createTerrainSampler()
    for (let i = 0; i < 500; i++) {
      const x = Math.sin(i * 12.9898) * 8000
      const z = Math.cos(i * 78.233) * 8000
      expect(a.heightAt(x, z)).toBe(b.heightAt(x, z))
      expect(a.surfaceAt(x, z)).toBe(b.surfaceAt(x, z))
      expect(a.heightAt(x, z)).toBe(a.heightAt(x, z))
    }
  })

  it('is exactly at runway elevation in the flat zone', () => {
    forEachInRect(AIRPORT_FLAT_ZONE, 25, (x, z) => {
      expect(terrain.heightAt(x, z)).toBe(RUNWAY.elevation)
    })
  })

  it('blends smoothly out of the flat zone', () => {
    const z = 0
    let prev = terrain.heightAt(AIRPORT_FLAT_ZONE.maxX, z)
    for (let x = AIRPORT_FLAT_ZONE.maxX; x < AIRPORT_FLAT_ZONE.maxX + 600; x += 5) {
      const h = terrain.heightAt(x, z)
      expect(Math.abs(h - prev)).toBeLessThan(5)
      prev = h
    }
  })

  it('keeps the approach corridor within +15 m of the runway', () => {
    let max = -Infinity
    forEachInRect(APPROACH_CORRIDOR, 25, (x, z) => {
      max = Math.max(max, terrain.heightAt(x, z))
    })
    expect(max).toBeLessThanOrEqual(RUNWAY.elevation + 15)
  })

  it('keeps the departure corridor within +40 m of the runway', () => {
    let max = -Infinity
    forEachInRect(DEPARTURE_CORRIDOR, 25, (x, z) => {
      max = Math.max(max, terrain.heightAt(x, z))
    })
    expect(max).toBeLessThanOrEqual(RUNWAY.elevation + 40)
  })

  it('keeps terrain at least 80 m below every ring within 300 m', () => {
    for (const ring of RING_COURSE) {
      let max = -Infinity
      for (let dx = -300; dx <= 300; dx += 20) {
        for (let dz = -300; dz <= 300; dz += 20) {
          if (dx * dx + dz * dz > 300 * 300) continue
          max = Math.max(max, terrain.heightAt(ring.position.x + dx, ring.position.z + dz))
        }
      }
      expect(max).toBeLessThanOrEqual(ring.position.y - 80)
    }
  })

  it('is water beyond the island and has a seabed below zero', () => {
    for (let a = 0; a < 360; a += 5) {
      const x = Math.cos((a * Math.PI) / 180) * (WORLD.terrainSize / 2 - 1)
      const z = Math.sin((a * Math.PI) / 180) * (WORLD.terrainSize / 2 - 1)
      expect(terrain.heightAt(x, z)).toBe(0)
      expect(terrain.surfaceAt(x, z)).toBe('water')
      expect(naturalHeightAt(x, z)).toBeLessThan(0)
    }
    expect(terrain.surfaceAt(20000, 20000)).toBe('water')
  })

  it('has an island of roughly the configured radius with land and sea', () => {
    let land = 0
    let sea = 0
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180
      if (terrain.surfaceAt(Math.cos(rad) * 3000, Math.sin(rad) * 3000) !== 'water') land++
      if (terrain.surfaceAt(Math.cos(rad) * (WORLD.islandRadius + 1500), Math.sin(rad) * (WORLD.islandRadius + 1500)) === 'water') sea++
    }
    expect(land).toBe(36)
    expect(sea).toBe(36)
  })

  it('has mountains up to ~700 m mainly to the east', () => {
    let eastMax = 0
    let westMax = 0
    for (let x = -7000; x <= 7000; x += 100) {
      for (let z = -7000; z <= 7000; z += 100) {
        const h = terrain.heightAt(x, z)
        if (x > 2500) eastMax = Math.max(eastMax, h)
        else if (x < -2500) westMax = Math.max(westMax, h)
      }
    }
    expect(eastMax).toBeGreaterThan(350)
    expect(eastMax).toBeLessThanOrEqual(760)
    expect(westMax).toBeLessThan(eastMax / 2)
  })

  it('reports paved surface on the runway centreline and grass beside it', () => {
    for (let z = -790; z <= 790; z += 40) {
      expect(terrain.surfaceAt(RUNWAY.centerX, z)).toBe('paved')
    }
    expect(terrain.surfaceAt(120, 120)).toBe('paved') // apron
    expect(terrain.surfaceAt(-100, 0)).toBe('grass')
  })

  it('heightAt is fast (200k calls)', () => {
    let acc = 0
    // warm up
    for (let i = 0; i < 20000; i++) acc += terrain.heightAt((i % 400) * 40 - 8000, Math.floor(i / 400) * 320 - 8000)
    const t0 = performance.now()
    for (let i = 0; i < 200_000; i++) {
      acc += terrain.heightAt((i % 448) * 35.7 - 8000, Math.floor(i / 448) * 35.7 - 8000)
    }
    const dt = performance.now() - t0
    console.log(`heightAt: 200k calls in ${dt.toFixed(1)} ms (${acc > 0 ? 'ok' : ''})`)
    expect(dt).toBeLessThan(400)
  })
})

describe('quality profiles', () => {
  it('rise monotonically from low to high', () => {
    const keys = ['terrainSegments', 'cloudCount', 'treeCount', 'shadowMapSize', 'fogFar', 'maxDpr'] as const
    for (let i = 1; i < QUALITY_LEVELS.length; i++) {
      const lo = QUALITY_PROFILES[QUALITY_LEVELS[i - 1]]
      const hi = QUALITY_PROFILES[QUALITY_LEVELS[i]]
      for (const k of keys) expect(hi[k]).toBeGreaterThan(lo[k])
      expect(Number(hi.shadows)).toBeGreaterThanOrEqual(Number(lo.shadows))
    }
  })
})
