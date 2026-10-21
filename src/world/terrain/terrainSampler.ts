/**
 * The single ground sampler shared by physics, cameras, trees and challenges.
 * Pure TS (no three.js).
 *
 * heightAt / surfaceAt describe the TRIANGULATED WORLD.physicsGridStep grid
 * of naturalHeightAt, which is exactly the mesh drawn at the finest level of
 * detail (see chunkBuilder.ts): vertex (i, j) sits at world (i * STEP, j * STEP)
 * and each cell a(i, j) b(i+1, j) d(i, j+1) e(i+1, j+1) is split along the
 * b-d diagonal into triangles (a, d, b) and (b, d, e).
 *
 * Corner heights are memoised in a direct-mapped cache, so the ~20 queries per
 * physics step around the aircraft cost a few multiplications each.
 */

import { WORLD } from '../../config/world'
import type { SurfaceType, TerrainSampler } from '../../simulation/types'
import { isPavedAt } from './airportTerrain'
import { WATER_THRESHOLD, naturalHeightAt } from './heightField'

export const GRID_STEP = WORLD.physicsGridStep
const INV_STEP = 1 / GRID_STEP

const CACHE_BITS = 16
const CACHE_SIZE = 1 << CACHE_BITS
const CACHE_MASK = CACHE_SIZE - 1
/** Never a real grid index (|index| < 2^21 for any world coordinate). */
const EMPTY = 0x7fffffff

/** naturalHeightAt at grid vertex (i, j), memoised. */
export interface GridHeights {
  vertex(i: number, j: number): number
}

export function createGridHeights(): GridHeights {
  const keyI = new Int32Array(CACHE_SIZE).fill(EMPTY)
  const keyJ = new Int32Array(CACHE_SIZE)
  const val = new Float64Array(CACHE_SIZE)
  return {
    vertex(i: number, j: number): number {
      const slot = (Math.imul(i, 0x9e3779b1) ^ Math.imul(j, 0x85ebca6b)) >>> (32 - CACHE_BITS)
      const s = slot & CACHE_MASK
      if (keyI[s] === i && keyJ[s] === j) return val[s]
      const h = naturalHeightAt(i * GRID_STEP, j * GRID_STEP)
      keyI[s] = i
      keyJ[s] = j
      val[s] = h
      return h
    },
  }
}

/**
 * Height of the triangulated grid at (x, z), seabed negative (not clamped).
 * Same split as the chunk mesh: u + v <= 1 is triangle (a, d, b).
 */
export function triangulatedHeight(grid: GridHeights, x: number, z: number): number {
  const fx = x * INV_STEP
  const fz = z * INV_STEP
  const i = Math.floor(fx)
  const j = Math.floor(fz)
  const u = fx - i
  const v = fz - j
  const hb = grid.vertex(i + 1, j)
  const hd = grid.vertex(i, j + 1)
  if (u + v <= 1) {
    const ha = grid.vertex(i, j)
    return ha + (hb - ha) * u + (hd - ha) * v
  }
  const he = grid.vertex(i + 1, j + 1)
  return he + (hd - he) * (1 - u) + (hb - he) * (1 - v)
}

/** A fresh sampler with its own corner cache. */
export function createTerrainSampler(): TerrainSampler & { rawHeightAt(x: number, z: number): number } {
  const grid = createGridHeights()
  return {
    heightAt(x: number, z: number): number {
      const h = triangulatedHeight(grid, x, z)
      return h > 0 ? h : 0
    },
    surfaceAt(x: number, z: number): SurfaceType {
      if (isPavedAt(x, z)) return 'paved'
      return triangulatedHeight(grid, x, z) <= WATER_THRESHOLD ? 'water' : 'grass'
    },
    rawHeightAt(x: number, z: number): number {
      return triangulatedHeight(grid, x, z)
    },
  }
}

let shared: TerrainSampler | null = null

/** The cached singleton used by physics, cameras and the world. */
export function getTerrainSampler(): TerrainSampler {
  if (!shared) shared = createTerrainSampler()
  return shared
}
