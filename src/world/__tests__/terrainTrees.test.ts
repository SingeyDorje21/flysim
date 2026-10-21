import { describe, expect, it } from 'vitest'
import { AIRPORT_FLAT_ZONE, APPROACH_CORRIDOR, DEPARTURE_CORRIDOR } from '../../config/world'
import { QUALITY_PROFILES } from '../../config/quality'
import { getTerrainSampler } from '../terrain/terrainSampler'
import { TREE_STRIDE, TREE_TILE, TREE_TYPE_COUNT, placeTreeTile, treesExcludedAt } from '../terrain/treePlacement'

const terrain = getTerrainSampler()
const density = QUALITY_PROFILES.high.treeDensity

function inRect(x: number, z: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ
}

describe('tree placement', () => {
  it('is deterministic per tile', () => {
    const a = placeTreeTile(terrain, 5, -9, density)
    const b = placeTreeTile(terrain, 5, -9, density)
    for (let t = 0; t < TREE_TYPE_COUNT; t++) expect([...a.trees[t]]).toEqual([...b.trees[t]])
  })

  it('stands trees on the sampler ground, on grass, gentle slopes, below the treeline and outside the airport and corridors', () => {
    let total = 0
    const types = new Set<number>()
    for (let tx = -30; tx <= 30; tx += 3) {
      for (let tz = -30; tz <= 30; tz += 3) {
        const tile = placeTreeTile(terrain, tx, tz, density)
        for (let t = 0; t < TREE_TYPE_COUNT; t++) {
          const arr = tile.trees[t]
          if (arr.length > 0) types.add(t)
          for (let k = 0; k < arr.length; k += TREE_STRIDE) {
            const x = arr[k]
            const y = arr[k + 1]
            const z = arr[k + 2]
            total++
            expect(x).toBeGreaterThanOrEqual(tx * TREE_TILE - 0.01)
            expect(x).toBeLessThanOrEqual((tx + 1) * TREE_TILE + 0.01)
            const h = terrain.heightAt(x, z)
            expect(Math.abs(y - (h - 0.4))).toBeLessThan(0.05)
            expect(terrain.surfaceAt(x, z)).toBe('grass')
            expect(h).toBeLessThan(1300)
            expect(treesExcludedAt(x, z)).toBe(false)
            expect(inRect(x, z, AIRPORT_FLAT_ZONE)).toBe(false)
            expect(inRect(x, z, APPROACH_CORRIDOR)).toBe(false)
            expect(inRect(x, z, DEPARTURE_CORRIDOR)).toBe(false)
            const g = Math.hypot(terrain.heightAt(x + 4, z) - terrain.heightAt(x - 4, z), terrain.heightAt(x, z + 4) - terrain.heightAt(x, z - 4)) / 8
            expect(g).toBeLessThan(0.5)
          }
        }
      }
    }
    expect(total).toBeGreaterThan(1000)
    expect(types.size).toBe(TREE_TYPE_COUNT)
  })

  it('averages roughly the profile density over land', () => {
    let trees = 0
    let landTiles = 0
    for (let tx = -40; tx <= 40; tx += 4) {
      for (let tz = -40; tz <= 40; tz += 4) {
        const cx = (tx + 0.5) * TREE_TILE
        const cz = (tz + 0.5) * TREE_TILE
        if (terrain.surfaceAt(cx, cz) !== 'grass' || treesExcludedAt(cx, cz)) continue
        landTiles++
        const tile = placeTreeTile(terrain, tx, tz, density)
        trees += tile.counts.reduce((a, b) => a + b, 0)
      }
    }
    const perKm2 = trees / (landTiles * (TREE_TILE / 1000) ** 2)
    expect(perKm2).toBeGreaterThan(density * 0.4)
    expect(perKm2).toBeLessThan(density * 1.6)
  })
})
