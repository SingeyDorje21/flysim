/**
 * Deterministic terrain height field. Pure TypeScript (no three.js), shared by
 * physics (collisions) and the renderer (mesh). Allocation-free per call.
 *
 * World frame: +X east, +Z south, y up, sea level 0.
 *
 * Layout: an irregular island of radius ~WORLD.islandRadius centred on the
 * airport, gentle lowlands with hills growing outwards, a mountain range to
 * the east / north-east, and a seabed below 0 beyond the coast. The airport
 * plateau, the approach / departure corridors and the ring course are
 * enforced explicitly on top of the natural terrain.
 */

import {
  AIRPORT_BLEND,
  AIRPORT_FLAT_ZONE,
  APPROACH_CORRIDOR,
  DEPARTURE_CORRIDOR,
  RUNWAY,
  WORLD,
  type Rect,
} from '../../config/world'
import { RING_COURSE } from '../../game/courses'
import type { SurfaceType, TerrainSampler } from '../../simulation/types'
import { PAVED_RECTS } from '../airportLayout'

// ---------------------------------------------------------------- noise

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) * (1 / 4294967296)
}

/** Smooth value noise, roughly -1..1. One lattice cell = 1 unit. */
export function valueNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1
}

/** Fractal Brownian motion, normalised to roughly -1..1. */
export function fbm2(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let f = 1
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * f + i * 17.3, z * f + i * 31.7, seed + i * 101)
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return sum / norm
}

function ridged2(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let f = 1
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise2(x * f + i * 13.1, z * f + i * 29.9, seed + i * 211)
    sum += amp * (1 - Math.abs(n))
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return sum / norm
}

function smoothstep(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a)
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return t * t * (3 - 2 * t)
}

/** Distance from (x, z) to a rectangle, 0 inside. */
function rectDist(x: number, z: number, r: Rect): number {
  const dx = r.minX - x > 0 ? r.minX - x : x - r.maxX > 0 ? x - r.maxX : 0
  const dz = r.minZ - z > 0 ? r.minZ - z : z - r.maxZ > 0 ? z - r.maxZ : 0
  if (dx === 0 && dz === 0) return 0
  return Math.sqrt(dx * dx + dz * dz)
}

// ---------------------------------------------------------------- tuning

const SEED = WORLD.seed | 0
const SEED_COAST = SEED + 11
const SEED_HILLS = SEED + 23
const SEED_MOUNT = SEED + 37

const R = WORLD.islandRadius
const HALF_SIZE = WORLD.terrainSize / 2
const ELEV = RUNWAY.elevation

const APPROACH_CAP = ELEV + 12 // spec limit +15
const DEPARTURE_CAP = ELEV + 35 // spec limit +40
const CORRIDOR_FADE = 700

const RING_INNER = 450 // spec: 300 m horizontally
const RING_OUTER = 950
const RING_MARGIN = 100 // spec: 80 m below the ring centre
const ringX = RING_COURSE.map((r) => r.position.x)
const ringZ = RING_COURSE.map((r) => r.position.z)
const ringCap = RING_COURSE.map((r) => r.position.y - RING_MARGIN)
const RING_N = RING_COURSE.length

const WATER_THRESHOLD = 0.3

// ---------------------------------------------------------------- height

/** Terrain height with the seabed kept negative. heightAt = max(0, this). */
export function naturalHeightAt(x: number, z: number): number {
  const r = Math.sqrt(x * x + z * z)

  // Irregular coast: e > 0 inland, e < 0 at sea.
  const cn = fbm2(x * 0.00035, z * 0.00035, 3, SEED_COAST)
  const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF_SIZE
  const e = 1 - (r / R - 0.2 * cn + 3 * smoothstep(0.82, 0.98, edge))

  let h: number
  if (e <= 0) {
    // Seabed deepening away from the shore.
    h = -120 * (1 - Math.exp(5 * e))
  } else {
    const hv = fbm2(x * 0.0007, z * 0.0007, 3, SEED_HILLS)
    const hillAmp = 8 + 45 * smoothstep(1500, 5500, r)
    const hills = 8 + hillAmp * (0.5 + 0.5 * Math.max(-1, Math.min(1, hv * 1.6)))
    h = hills * smoothstep(0, 0.08, e)

    // Mountain range, east / north-east. Feature wavelengths >= ~310 m.
    const mmask = smoothstep(2200, 4200, x - 0.2 * z)
    if (mmask > 0) {
      const shape = Math.pow(ridged2(x * 0.0004, z * 0.0004, 4, SEED_MOUNT), 2.2)
      const m = mmask * smoothstep(0, 0.3, e) * 760 * shape
      h += m > 700 ? 700 : m
    }
  }

  // Approach / departure corridors: carve the terrain down below the cap.
  let d = rectDist(x, z, APPROACH_CORRIDOR)
  if (d < CORRIDOR_FADE && h > APPROACH_CAP) {
    h += (APPROACH_CAP - h) * (1 - smoothstep(0, CORRIDOR_FADE, d))
  }
  d = rectDist(x, z, DEPARTURE_CORRIDOR)
  if (d < CORRIDOR_FADE && h > DEPARTURE_CAP) {
    h += (DEPARTURE_CAP - h) * (1 - smoothstep(0, CORRIDOR_FADE, d))
  }

  // Ring course: keep terrain well below every ring.
  for (let i = 0; i < RING_N; i++) {
    const dx = x - ringX[i]
    const dz = z - ringZ[i]
    const d2 = dx * dx + dz * dz
    if (d2 < RING_OUTER * RING_OUTER && h > ringCap[i]) {
      const w = 1 - smoothstep(RING_INNER, RING_OUTER, Math.sqrt(d2))
      h += (ringCap[i] - h) * w
    }
  }

  // Airport plateau with a smooth blend to the surrounding terrain.
  const da = rectDist(x, z, AIRPORT_FLAT_ZONE)
  if (da <= 0) return ELEV
  if (da < AIRPORT_BLEND) {
    const s = smoothstep(0, AIRPORT_BLEND, da)
    h = ELEV + (h - ELEV) * s
  }
  return h
}

function isPavedAt(x: number, z: number): boolean {
  for (let i = 0; i < PAVED_RECTS.length; i++) {
    const p = PAVED_RECTS[i]
    if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return true
  }
  return false
}

export function createTerrainSampler(): TerrainSampler {
  return {
    heightAt(x: number, z: number): number {
      const h = naturalHeightAt(x, z)
      return h > 0 ? h : 0
    },
    surfaceAt(x: number, z: number): SurfaceType {
      if (isPavedAt(x, z)) return 'paved'
      return naturalHeightAt(x, z) <= WATER_THRESHOLD ? 'water' : 'grass'
    },
  }
}
