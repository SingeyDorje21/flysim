import { describe, expect, it } from 'vitest'
import { QUALITY_PROFILES } from '../../config/quality'
import { RUNWAY } from '../../config/world'
import { buildTerrainGeometry } from '../terrain/buildTerrainGeometry'
import { createGridTerrainSampler, getTerrainGrid, gridHeightAt, terrainSamplerForQuality } from '../terrain/terrainGrid'

/** Height of the rendered mesh at (x, z), found by testing its actual triangles. */
function meshHeightAt(segments: number, x: number, z: number): number {
  const geo = buildTerrainGeometry(segments)
  const pos = geo.getAttribute('position')
  const index = geo.getIndex()!
  const { origin, step, n } = getTerrainGrid(segments)
  const ix = Math.floor((x - origin) / step)
  const iz = Math.floor((z - origin) / step)
  const first = (iz * segments + ix) * 6
  for (let t = first; t < first + 6; t += 3) {
    const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
    const ax = pos.getX(a), az = pos.getZ(a)
    const bx = pos.getX(b), bz = pos.getZ(b)
    const cx = pos.getX(c), cz = pos.getZ(c)
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    const w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det
    const w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det
    const w3 = 1 - w1 - w2
    if (w1 >= -1e-9 && w2 >= -1e-9 && w3 >= -1e-9) {
      return w1 * pos.getY(a) + w2 * pos.getY(b) + w3 * pos.getY(c)
    }
  }
  throw new Error(`no triangle contains (${x}, ${z}) in cell ${ix},${iz} (n=${n})`)
}

describe('terrain grid: physics ground equals the drawn mesh', () => {
  const segments = QUALITY_PROFILES.low.terrainSegments

  it('matches the mesh triangles at arbitrary points, including hills and mountains', () => {
    const grid = getTerrainGrid(segments)
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    let maxErr = 0
    for (let i = 0; i < 400; i++) {
      const x = (rand() - 0.5) * 14000
      const z = (rand() - 0.5) * 14000
      maxErr = Math.max(maxErr, Math.abs(gridHeightAt(grid, x, z) - meshHeightAt(segments, x, z)))
    }
    expect(maxErr).toBeLessThan(1e-3)
  })

  it('sampler heights clamp the seabed to the water level and keep the runway exact', () => {
    const sampler = createGridTerrainSampler(segments)
    expect(sampler.heightAt(0, 0)).toBe(RUNWAY.elevation)
    expect(sampler.heightAt(0, RUNWAY.thresholdZ - 1)).toBe(RUNWAY.elevation)
    expect(sampler.surfaceAt(0, 0)).toBe('paved')
    expect(sampler.heightAt(7900, 7900)).toBe(0)
    expect(sampler.surfaceAt(7900, 7900)).toBe('water')
  })

  it('returns one cached sampler per quality level', () => {
    expect(terrainSamplerForQuality('medium')).toBe(terrainSamplerForQuality('medium'))
    expect(terrainSamplerForQuality('low')).not.toBe(terrainSamplerForQuality('high'))
  })
})
