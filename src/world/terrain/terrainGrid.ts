/**
 * The terrain as drawn: naturalHeightAt sampled on the mesh grid and
 * triangulated exactly like buildTerrainGeometry. Physics, trees and cameras
 * query this, so what you see is what you hit at every quality level.
 * Pure TS (no three.js).
 */

import { QUALITY_PROFILES, type Quality } from '../../config/quality'
import { WORLD } from '../../config/world'
import type { SurfaceType, TerrainSampler } from '../../simulation/types'
import { WATER_THRESHOLD, isPavedAt, naturalHeightAt } from './heightField'

export interface TerrainGrid {
  readonly segments: number
  /** Vertices per side (segments + 1). */
  readonly n: number
  readonly step: number
  /** World x and z of vertex (0, 0). */
  readonly origin: number
  /** naturalHeightAt at every vertex, row-major by z then x (seabed negative). */
  readonly heights: Float32Array
}

const grids = new Map<number, TerrainGrid>()

/** Cached per resolution; the mesh and the samplers share one grid. */
export function getTerrainGrid(segments: number): TerrainGrid {
  let grid = grids.get(segments)
  if (!grid) {
    const size = WORLD.terrainSize
    const n = segments + 1
    const step = size / segments
    const origin = -size / 2
    const heights = new Float32Array(n * n)
    for (let iz = 0; iz < n; iz++) {
      const z = origin + iz * step
      for (let ix = 0; ix < n; ix++) heights[iz * n + ix] = naturalHeightAt(origin + ix * step, z)
    }
    grid = { segments, n, step, origin, heights }
    grids.set(segments, grid)
  }
  return grid
}

/**
 * Height of the drawn surface at (x, z). Each grid cell a(0,0) b(1,0) d(0,1)
 * e(1,1) is split along the b-d diagonal into triangles (a, d, b) and
 * (b, d, e), the same split buildTerrainGeometry uses. Outside the grid the
 * natural function applies (open ocean).
 */
export function gridHeightAt(grid: TerrainGrid, x: number, z: number): number {
  const fx = (x - grid.origin) / grid.step
  const fz = (z - grid.origin) / grid.step
  if (!(fx >= 0 && fz >= 0 && fx <= grid.segments && fz <= grid.segments)) return naturalHeightAt(x, z)
  const ix = Math.min(Math.floor(fx), grid.segments - 1)
  const iz = Math.min(Math.floor(fz), grid.segments - 1)
  const u = fx - ix
  const v = fz - iz
  const h = grid.heights
  const a = iz * grid.n + ix
  const ha = h[a]
  const hb = h[a + 1]
  const hd = h[a + grid.n]
  const he = h[a + grid.n + 1]
  if (u + v <= 1) return ha + (hb - ha) * u + (hd - ha) * v
  return he + (hd - he) * (1 - u) + (hb - he) * (1 - v)
}

export function createGridTerrainSampler(segments: number): TerrainSampler {
  const grid = getTerrainGrid(segments)
  return {
    heightAt(x: number, z: number): number {
      const h = gridHeightAt(grid, x, z)
      return h > 0 ? h : 0
    },
    surfaceAt(x: number, z: number): SurfaceType {
      if (isPavedAt(x, z)) return 'paved'
      return gridHeightAt(grid, x, z) <= WATER_THRESHOLD ? 'water' : 'grass'
    },
  }
}

const byQuality = new Map<Quality, TerrainSampler>()

/** The sampler matching the mesh drawn at this quality level (cached). */
export function terrainSamplerForQuality(quality: Quality): TerrainSampler {
  let sampler = byQuality.get(quality)
  if (!sampler) {
    sampler = createGridTerrainSampler(QUALITY_PROFILES[quality].terrainSegments)
    byQuality.set(quality, sampler)
  }
  return sampler
}
