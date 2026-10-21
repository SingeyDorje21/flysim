/**
 * Deterministic tree placement by square tiles (pure TS, no three.js).
 * Trees stand on the shared sampler (heightAt), so trunks sit on the drawn
 * ground wherever the finest level of detail is drawn.
 *
 * Rules: grass only, gentle slopes, between the beach and a noisy treeline,
 * outside the airport zone (plus blend), the paved areas and the approach /
 * departure corridors. Density averages QualityProfile.treeDensity per km² of
 * suitable land, clumped into woods by forestAt.
 */

import { AIRPORT_BLEND, AIRPORT_FLAT_ZONE, APPROACH_CORRIDOR, DEPARTURE_CORRIDOR, WORLD, type Rect } from '../../config/world'
import type { TerrainSampler } from '../../simulation/types'
import { mulberry32 } from '../util/random'
import { drynessAt, forestAt } from './heightField'
import { hash2, valueNoise2 } from './noise'

export const TREE_TILE = 480
export const TREE_TYPE_COUNT = 3
export const TREE_CONIFER = 0
export const TREE_BROADLEAF = 1
export const TREE_POPLAR = 2
/** Floats per placed tree: x, y, z, rotation, width scale, height scale, tint. */
export const TREE_STRIDE = 7

const TREELINE = 1050
const MAX_SLOPE = 0.42
const MIN_HEIGHT = 3.5

function grow(r: Rect, m: number): Rect {
  return { minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m }
}
const NO_TREES: readonly Rect[] = [
  grow(AIRPORT_FLAT_ZONE, AIRPORT_BLEND * 0.5),
  grow(APPROACH_CORRIDOR, 150),
  grow(DEPARTURE_CORRIDOR, 150),
]

export function treesExcludedAt(x: number, z: number): boolean {
  for (let i = 0; i < NO_TREES.length; i++) {
    const r = NO_TREES[i]
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return true
  }
  return false
}

export interface TreeTile {
  tx: number
  tz: number
  /** Per tree type, TREE_STRIDE floats per tree. */
  trees: Float32Array[]
  counts: number[]
}

/** True when a tree may stand at (x, z); returns the ground height through `out`. */
function suitable(terrain: TerrainSampler, x: number, z: number): number {
  if (treesExcludedAt(x, z)) return NaN
  if (terrain.surfaceAt(x, z) !== 'grass') return NaN
  const h = terrain.heightAt(x, z)
  if (h < MIN_HEIGHT) return NaN
  if (h > TREELINE + 180 * valueNoise2(x * (1 / 900), z * (1 / 900), WORLD.seed + 97)) return NaN
  const s = 4
  const gx = (terrain.heightAt(x + s, z) - terrain.heightAt(x - s, z)) / (2 * s)
  const gz = (terrain.heightAt(x, z + s) - terrain.heightAt(x, z - s)) / (2 * s)
  if (gx * gx + gz * gz > MAX_SLOPE * MAX_SLOPE) return NaN
  return h
}

/** Places the trees of tile (tx, tz), which covers [tx, tx+1) * TREE_TILE on x and z. */
export function placeTreeTile(terrain: TerrainSampler, tx: number, tz: number, densityPerKm2: number): TreeTile {
  const rnd = mulberry32(Math.floor(hash2(tx, tz, WORLD.seed ^ 0x7ee5) * 4294967296))
  const areaKm2 = (TREE_TILE * TREE_TILE) / 1e6
  // Acceptance averages ~0.5 (forestAt), so twice the candidates give the target density.
  const candidates = Math.round(densityPerKm2 * areaKm2 * 2)
  const buf: number[][] = [[], [], []]
  const x0 = tx * TREE_TILE
  const z0 = tz * TREE_TILE
  for (let n = 0; n < candidates; n++) {
    const x = x0 + rnd() * TREE_TILE
    const z = z0 + rnd() * TREE_TILE
    const accept = rnd()
    const pick = rnd()
    const rot = rnd() * Math.PI * 2
    const sw = rnd()
    const sh = rnd()
    const tint = rnd()
    const forest = forestAt(x, z)
    if (accept > 0.06 + 0.94 * forest) continue
    const h = suitable(terrain, x, z)
    if (!(h === h)) continue // NaN: not suitable

    const dry = drynessAt(x, z)
    let type: number
    if (h > 380 + 220 * dry) type = TREE_CONIFER
    else if (h < 140 && pick < 0.18) type = TREE_POPLAR
    else type = pick < 0.25 + 0.35 * (1 - dry) * Math.min(1, h / 380) ? TREE_CONIFER : TREE_BROADLEAF
    // Smaller trees near the treeline and in open country.
    const vigour = (0.75 + 0.35 * forest) * (h > TREELINE - 250 ? 0.75 : 1)
    const height = vigour * (0.75 + sh * 0.6)
    const width = height * (0.85 + sw * 0.3)
    buf[type].push(x, h - 0.4, z, rot, width, height, 0.72 + tint * 0.28)
  }
  const trees = buf.map((b) => new Float32Array(b))
  return { tx, tz, trees, counts: trees.map((t) => t.length / TREE_STRIDE) }
}
