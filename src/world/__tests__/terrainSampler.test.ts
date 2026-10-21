import { describe, expect, it } from 'vitest'
import {
  AIRPORT_BLEND,
  AIRPORT_FLAT_ZONE,
  APPROACH_CORRIDOR,
  DEPARTURE_CORRIDOR,
  RUNWAY,
  SPAWNS,
  WORLD,
  type Rect,
} from '../../config/world'
import { RING_COURSE } from '../../game/courses'
import { ISLETS, LAKES, naturalHeightAt } from '../terrain/heightField'
import { createTerrainSampler, getTerrainSampler } from '../terrain/terrainSampler'

const terrain = getTerrainSampler()

/** Visits a rectangle on a 7 m lattice (deliberately not aligned with the 30 m grid), edges included. */
function forEachInRect(r: Rect, step: number, fn: (x: number, z: number) => void): void {
  for (let x = r.minX; ; x = Math.min(x + step, r.maxX)) {
    for (let z = r.minZ; ; z = Math.min(z + step, r.maxZ)) {
      fn(x, z)
      if (z === r.maxZ) break
    }
    if (x === r.maxX) break
  }
}

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe('terrain sampler', () => {
  it('is a cached singleton', () => {
    expect(getTerrainSampler()).toBe(terrain)
  })

  it('is deterministic', () => {
    const a = createTerrainSampler()
    const b = createTerrainSampler()
    const rnd = lcg(7)
    for (let i = 0; i < 2000; i++) {
      const x = (rnd() - 0.5) * WORLD.terrainSize
      const z = (rnd() - 0.5) * WORLD.terrainSize
      const h = a.heightAt(x, z)
      expect(b.heightAt(x, z)).toBe(h)
      expect(terrain.heightAt(x, z)).toBe(h)
      expect(a.heightAt(x, z)).toBe(h)
      expect(b.surfaceAt(x, z)).toBe(a.surfaceAt(x, z))
      expect(h).toBeGreaterThanOrEqual(0)
    }
  })

  it('is linear inside each triangle of the 30 m grid (b-d diagonal)', () => {
    const s = WORLD.physicsGridStep
    const raw = createTerrainSampler()
    const rnd = lcg(11)
    for (let n = 0; n < 300; n++) {
      const i = Math.floor((rnd() - 0.5) * 2400)
      const j = Math.floor((rnd() - 0.5) * 2400)
      const ha = naturalHeightAt(i * s, j * s)
      const hb = naturalHeightAt((i + 1) * s, j * s)
      const hd = naturalHeightAt(i * s, (j + 1) * s)
      const he = naturalHeightAt((i + 1) * s, (j + 1) * s)
      const u = rnd()
      const v = rnd()
      const expected = u + v <= 1 ? ha + (hb - ha) * u + (hd - ha) * v : he + (hd - he) * (1 - u) + (hb - he) * (1 - v)
      expect(raw.rawHeightAt((i + u) * s, (j + v) * s)).toBeCloseTo(expected, 6)
      expect(raw.rawHeightAt(i * s, j * s)).toBe(ha)
    }
  })

  it('meets the speed budget: 200k physics-pattern calls in < 400 ms (worst-case raster < 800 ms)', () => {
    const s = createTerrainSampler()
    let acc = 0
    for (let i = 0; i < 20000; i++) acc += s.heightAt(9000 + (i % 200) * 30, -20000 + i * 0.1)
    // ~20 queries per 120 Hz physics step around an aircraft flying at 60 m/s.
    let x = 15000
    let z = -15000
    let t0 = performance.now()
    for (let i = 0; i < 200_000; i++) {
      if (i % 20 === 0) {
        x += 0.42
        z -= 0.25
      }
      acc += s.heightAt(x + (i % 5) * 2.1, z + (i % 4) * 1.7)
      acc += s.surfaceAt(x, z) === 'water' ? 1 : 0
    }
    const flight = performance.now() - t0
    // Worst case: every call in a new cell, 16 km raster over the high range.
    t0 = performance.now()
    for (let i = 0; i < 200_000; i++) acc += s.heightAt(4000 + (i % 448) * 35.7, -28000 + Math.floor(i / 448) * 35.7)
    const raster = performance.now() - t0
    console.log(`sampler: flight path 200k ${flight.toFixed(1)} ms, raster 200k ${raster.toFixed(1)} ms (${acc > 0})`)
    // The physics access pattern carries the budget; the raster is a pathological
    // worst case (two fresh corners per call) with a looser bound for loaded CI machines.
    expect(flight).toBeLessThan(400)
    expect(raster).toBeLessThan(800)
  })

  it('is exactly at runway elevation in the airport flat zone', () => {
    forEachInRect(AIRPORT_FLAT_ZONE, 7, (x, z) => {
      expect(terrain.heightAt(x, z)).toBe(RUNWAY.elevation)
    })
  })

  it('blends smoothly out of the flat zone', () => {
    for (const z of [-900, 0, 600]) {
      let prev = terrain.heightAt(AIRPORT_FLAT_ZONE.maxX, z)
      for (let x = AIRPORT_FLAT_ZONE.maxX; x < AIRPORT_FLAT_ZONE.maxX + AIRPORT_BLEND + 400; x += 5) {
        const h = terrain.heightAt(x, z)
        expect(Math.abs(h - prev)).toBeLessThan(4)
        prev = h
      }
    }
  })

  it('keeps the approach corridor within +15 m and the departure corridor within +40 m', () => {
    let app = -Infinity
    forEachInRect(APPROACH_CORRIDOR, 7, (x, z) => {
      app = Math.max(app, terrain.heightAt(x, z))
    })
    let dep = -Infinity
    forEachInRect(DEPARTURE_CORRIDOR, 7, (x, z) => {
      dep = Math.max(dep, terrain.heightAt(x, z))
    })
    expect(app).toBeLessThanOrEqual(RUNWAY.elevation + 15)
    expect(dep).toBeLessThanOrEqual(RUNWAY.elevation + 40)
  })

  it('keeps terrain at least 80 m below every ring within 300 m', () => {
    for (const ring of RING_COURSE) {
      let max = -Infinity
      for (let dx = -300; dx <= 300; dx += 9) {
        for (let dz = -300; dz <= 300; dz += 9) {
          if (dx * dx + dz * dz > 300 * 300) continue
          max = Math.max(max, terrain.heightAt(ring.position.x + dx, ring.position.z + dz))
        }
      }
      expect(max).toBeLessThanOrEqual(ring.position.y - 80)
    }
  })

  it('keeps the landing spawn path and the ring spawn clear', () => {
    const landing = SPAWNS.landing.position
    for (let z = RUNWAY.thresholdZ; z <= landing.z; z += 10) {
      // 3 degree glide path from the threshold.
      const glide = RUNWAY.elevation + (z - RUNWAY.thresholdZ) * Math.tan((3 * Math.PI) / 180)
      for (const x of [-40, 0, 40]) {
        const h = terrain.heightAt(x, z)
        expect(h).toBeLessThanOrEqual(RUNWAY.elevation + 15)
        if (z > RUNWAY.thresholdZ + 400) expect(h).toBeLessThan(glide - 10)
      }
    }
    const ring = SPAWNS.rings.position
    for (let dx = -300; dx <= 300; dx += 20) {
      for (let dz = -300; dz <= 300; dz += 20) expect(terrain.heightAt(ring.x + dx, ring.z + dz)).toBeLessThan(ring.y - 150)
    }
  })

  it('is open water beyond the island, with a seabed below zero', () => {
    for (let a = 0; a < 360; a += 3) {
      const rad = (a * Math.PI) / 180
      // The world square's inscribed circle and its edge midpoints / corners.
      for (const r of [WORLD.terrainSize / 2 - 1, WORLD.islandRadius + 9500]) {
        const x = Math.cos(rad) * r
        const z = Math.sin(rad) * r
        if (ISLETS.some((s) => Math.hypot(x - s.x, z - s.z) < s.radius * 2.2)) continue
        expect(terrain.heightAt(x, z)).toBe(0)
        expect(terrain.surfaceAt(x, z)).toBe('water')
        expect(naturalHeightAt(x, z)).toBeLessThan(0)
      }
    }
    const h = WORLD.terrainSize / 2
    for (const [x, z] of [
      [h, h],
      [-h, h],
      [h, -h],
      [-h, -h],
    ]) {
      expect(terrain.surfaceAt(x, z)).toBe('water')
    }
  })

  it('has a main island of roughly the configured radius', () => {
    let landNear = 0
    let landFar = 0
    const n = 120
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      if (terrain.surfaceAt(Math.cos(a) * 20000, Math.sin(a) * 20000) !== 'water') landNear++
      if (terrain.surfaceAt(Math.cos(a) * WORLD.islandRadius * 1.25, Math.sin(a) * WORLD.islandRadius * 1.25) !== 'water') landFar++
    }
    expect(landNear).toBeGreaterThanOrEqual(n * 0.9)
    expect(landFar).toBeLessThanOrEqual(n * 0.1)
  })

  it('has small islands offshore, separated from the main island by water', () => {
    expect(ISLETS.length).toBeGreaterThanOrEqual(3)
    for (const s of ISLETS) {
      expect(terrain.surfaceAt(s.x, s.z)).toBe('grass')
      expect(terrain.heightAt(s.x, s.z)).toBeGreaterThan(20)
      for (let a = 0; a < 360; a += 10) {
        const rad = (a * Math.PI) / 180
        const r = s.radius * 1.9
        expect(terrain.surfaceAt(s.x + Math.cos(rad) * r, s.z + Math.sin(rad) * r)).toBe('water')
      }
    }
  })

  it('has sea-level lakes surrounded by land', () => {
    for (const l of LAKES) {
      expect(terrain.surfaceAt(l.x, l.z)).toBe('water')
      for (let a = 0; a < 360; a += 30) {
        const rad = (a * Math.PI) / 180
        const r = l.radius * 1.6
        expect(terrain.surfaceAt(l.x + Math.cos(rad) * r, l.z + Math.sin(rad) * r)).toBe('grass')
      }
    }
  })

  it('has mountains up to ~1,800 m far from the airport and low country around it', () => {
    let max = 0
    let maxX = 0
    let maxZ = 0
    let nearMax = 0
    for (let x = -40000; x <= 40000; x += 150) {
      for (let z = -40000; z <= 40000; z += 150) {
        const h = naturalHeightAt(x, z)
        if (h > max) {
          max = h
          maxX = x
          maxZ = z
        }
        if (Math.hypot(x, z) < 3000) nearMax = Math.max(nearMax, h)
      }
    }
    expect(max).toBeGreaterThan(1500)
    expect(max).toBeLessThan(2000)
    expect(Math.hypot(maxX, maxZ)).toBeGreaterThan(8000)
    expect(nearMax).toBeLessThan(120)
  })

  it('reports paved surface on the runway and apron, grass beside', () => {
    for (let z = -790; z <= 790; z += 40) expect(terrain.surfaceAt(RUNWAY.centerX, z)).toBe('paved')
    expect(terrain.surfaceAt(120, 120)).toBe('paved')
    expect(terrain.surfaceAt(-100, 0)).toBe('grass')
  })
})
