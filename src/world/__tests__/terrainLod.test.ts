import { describe, expect, it } from 'vitest'
import { QUALITY_LEVELS, QUALITY_PROFILES } from '../../config/quality'
import { WORLD } from '../../config/world'
import { TERRAIN_MAX_HEIGHT } from '../terrain/heightField'
import { FINE_RADIUS, chunkOrigin, chunkSize, chunkVisible, selectLodNodes, type LodNode } from '../terrain/lod'
import { getTerrainSampler } from '../terrain/terrainSampler'

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function leafAt(nodes: LodNode[], x: number, z: number): LodNode[] {
  return nodes.filter((n) => {
    const s = chunkSize(n.level)
    const x0 = chunkOrigin(n.level, n.cx)
    const z0 = chunkOrigin(n.level, n.cz)
    return x >= x0 && x < x0 + s && z >= z0 && z < z0 + s
  })
}

const terrain = getTerrainSampler()

describe('terrain level of detail', () => {
  it('never uses a coarse level within 1.5 km of the camera', () => {
    const rnd = lcg(3)
    for (const q of QUALITY_LEVELS) {
      const p = QUALITY_PROFILES[q]
      for (let trial = 0; trial < 40; trial++) {
        const cx = (rnd() - 0.5) * 90000
        const cz = (rnd() - 0.5) * 90000
        const cy = trial % 2 === 0 ? terrain.heightAt(cx, cz) + 2 : rnd() * TERRAIN_MAX_HEIGHT
        const nodes = selectLodNodes(cx, cy, cz, p.terrainViewDistance, p.terrainLodBias)
        for (let k = 0; k < 60; k++) {
          const a = rnd() * Math.PI * 2
          const r = Math.sqrt(rnd()) * FINE_RADIUS
          const x = cx + Math.cos(a) * r
          const z = cz + Math.sin(a) * r
          if (Math.abs(x) >= WORLD.terrainSize / 2 || Math.abs(z) >= WORLD.terrainSize / 2) continue
          const hit = leafAt(nodes, x, z)
          expect(hit.length).toBe(1)
          expect(hit[0].level).toBe(0)
        }
      }
    }
  })

  it('also holds in 3D for a camera above the highest terrain', () => {
    const p = QUALITY_PROFILES.low
    for (const cy of [TERRAIN_MAX_HEIGHT + 500, TERRAIN_MAX_HEIGHT + 1200]) {
      const nodes = selectLodNodes(500, cy, -700, p.terrainViewDistance, p.terrainLodBias)
      for (let x = -1500; x <= 2500; x += 50) {
        for (let z = -2700; z <= 1300; z += 50) {
          const d = Math.hypot(x - 500, terrain.heightAt(x, z) - cy, z + 700)
          if (d <= FINE_RADIUS) expect(leafAt(nodes, x, z)[0].level).toBe(0)
        }
      }
    }
  })

  it('covers the visible world exactly once, within the view distance', () => {
    const rnd = lcg(9)
    for (const q of QUALITY_LEVELS) {
      const p = QUALITY_PROFILES[q]
      const cx = 3000
      const cz = -12000
      const nodes = selectLodNodes(cx, 300, cz, p.terrainViewDistance, p.terrainLodBias)
      for (const n of nodes) expect(chunkVisible(n.level, n.cx, n.cz, cx, 300, cz, p.terrainViewDistance)).toBe(true)
      for (let k = 0; k < 2000; k++) {
        const a = rnd() * Math.PI * 2
        const r = Math.sqrt(rnd()) * (p.terrainViewDistance - 100)
        const x = cx + Math.cos(a) * r
        const z = cz + Math.sin(a) * r
        if (Math.abs(x) >= WORLD.terrainSize / 2 || Math.abs(z) >= WORLD.terrainSize / 2) continue
        expect(leafAt(nodes, x, z).length).toBe(1)
      }
      console.log(`LOD ${q}: ${nodes.length} chunks, levels ${[...new Set(nodes.map((n) => n.level))].sort().join(',')}`)
      expect(nodes.length).toBeLessThan(400)
    }
  })

  it('keeps finer detail further out with a higher bias', () => {
    const fine = (bias: number) =>
      selectLodNodes(0, 100, 0, 30000, bias).filter((n) => n.level === 0).length
    expect(fine(1.4)).toBeGreaterThan(fine(0.75))
  })
})

describe('quality profiles', () => {
  it('raise the load from low to high', () => {
    const keys = [
      'terrainViewDistance',
      'terrainLodBias',
      'treeDensity',
      'treeViewDistance',
      'cloudCount',
      'shadowMapSize',
      'fogFar',
      'maxDpr',
    ] as const
    for (let i = 1; i < QUALITY_LEVELS.length; i++) {
      const lo = QUALITY_PROFILES[QUALITY_LEVELS[i - 1]]
      const hi = QUALITY_PROFILES[QUALITY_LEVELS[i]]
      for (const k of keys) expect(hi[k]).toBeGreaterThan(lo[k])
      expect(Number(hi.shadows)).toBeGreaterThanOrEqual(Number(lo.shadows))
    }
  })
})
