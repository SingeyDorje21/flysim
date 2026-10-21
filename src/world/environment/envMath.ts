import { WORLD } from '../../config/world'
import { mulberry32 } from '../util/random'

/** Cloud layer limits (m above sea level). Every puff lies fully inside this band. */
export const CLOUD_MIN_ALT = 800
export const CLOUD_MAX_ALT = 2500

/** Largest vertical half-extent of a puff plus its offset from the cloud centre. */
const PUFF_VERTICAL_MARGIN = 230

export const PUFFS_PER_CLOUD = 7

/** Water follows the camera in steps of this size (m), so the surface never swims. */
export const WATER_SNAP = 256

/** Snap a camera coordinate down to the water grid. */
export function snapWaterCenter(v: number, step: number = WATER_SNAP): number {
  return Math.round(v / step) * step
}

export interface Puff {
  x: number
  y: number
  z: number
  /** Ellipsoid radii (m). */
  rx: number
  ry: number
  rz: number
}

export interface CloudSpec {
  x: number
  y: number
  z: number
  puffs: Puff[]
}

/**
 * Deterministic cloud layout over the whole terrain square. The same count and
 * seed always give the same clouds; every puff stays inside the altitude band.
 */
export function generateClouds(count: number, seed: number = WORLD.seed ^ 0xc10d): CloudSpec[] {
  const rnd = mulberry32(seed)
  const half = WORLD.terrainSize / 2
  const clouds: CloudSpec[] = []
  for (let c = 0; c < count; c++) {
    const cx = (rnd() * 2 - 1) * half
    const cz = (rnd() * 2 - 1) * half
    const cy = CLOUD_MIN_ALT + PUFF_VERTICAL_MARGIN + rnd() * (CLOUD_MAX_ALT - CLOUD_MIN_ALT - 2 * PUFF_VERTICAL_MARGIN)
    const size = 0.8 + rnd() * 1.0
    const puffs: Puff[] = []
    for (let p = 0; p < PUFFS_PER_CLOUD; p++) {
      const r = (90 + rnd() * 120) * size
      puffs.push({
        x: cx + (rnd() * 2 - 1) * 260 * size,
        y: cy + (rnd() - 0.4) * 50 * size * 0.6,
        z: cz + (rnd() * 2 - 1) * 190 * size,
        rx: r * 1.3,
        ry: r * 0.5,
        rz: r,
      })
    }
    clouds.push({ x: cx, y: cy, z: cz, puffs })
  }
  return clouds
}
