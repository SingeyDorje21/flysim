/**
 * Deterministic natural height function of the 100 km world. Pure TypeScript
 * (no three.js), allocation-free per call. The physics sampler and the chunk
 * builder (also inside the terrain worker) both evaluate this exact function
 * at the WORLD.physicsGridStep vertices, so they agree bit for bit.
 *
 * World frame: +X east, +Z south (north = -Z), y up, sea level 0.
 *
 * Layout:
 * - main island of radius ~WORLD.islandRadius around the airport, with a
 *   domain-warped coast (bays, peninsulas, coves) and sandy beaches;
 * - four small islets at fixed centres off the diagonals;
 * - low rolling country around the airport, hills growing inland;
 * - four eroded mountain ranges far from the airport, peaks ~1,800 m;
 * - three river valleys whose lower reaches are sea-level channels, and two
 *   sea-level lakes (the only water is the y = 0 plane);
 * - the airport plateau, approach / departure corridors and the ring course
 *   enforced last, padded by two grid cells so the triangulated grid obeys
 *   them exactly.
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
import { isPaved } from '../airportLayout'
import { erodedFbm2, fbm2, gradNoise2, ridgedGrad2, smoothstep, valueNoise2 } from './noise'

// ---------------------------------------------------------------- helpers

/** Distance from (x, z) to a rectangle, 0 inside. */
function rectDist(x: number, z: number, r: Rect): number {
  const dx = r.minX - x > 0 ? r.minX - x : x - r.maxX > 0 ? x - r.maxX : 0
  const dz = r.minZ - z > 0 ? r.minZ - z : z - r.maxZ > 0 ? z - r.maxZ : 0
  if (dx === 0 && dz === 0) return 0
  return Math.sqrt(dx * dx + dz * dz)
}

// ---------------------------------------------------------------- tuning

const SEED = WORLD.seed | 0
const S_WARP_X = SEED + 3
const S_WARP_Z = SEED + 5
const S_COAST = SEED + 11
const S_COVE = SEED + 13
const S_BAY = SEED + 17
const S_HILLS = SEED + 23
const S_ROLL = SEED + 29
const S_RIDGE = SEED + 37
const S_ERODE = SEED + 41
const S_RANGE = SEED + 43
const S_MEANDER_X = SEED + 53
const S_MEANDER_Z = SEED + 59
const S_LAKE = SEED + 61
const S_ISLE = SEED + 67
const S_FOREST = SEED + 71
const S_MOIST = SEED + 73

const R = WORLD.islandRadius
const HALF_SIZE = WORLD.terrainSize / 2
const ELEV = RUNWAY.elevation
const STEP = WORLD.physicsGridStep

/** Constraints are enforced on their region grown by this much, so every grid cell touching it obeys them. */
const PAD = 2 * STEP

/** Upper bound of the natural height (m); used for LOD distance and tests. */
export const TERRAIN_MAX_HEIGHT = 2000
/** Grid heights at or below this count as water. */
export const WATER_THRESHOLD = 0.3

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

/** Everything the airport, corridor and ring rules can touch lies in this box. */
const CONSTRAINT_BOX: Rect = (() => {
  let minX = Math.min(APPROACH_CORRIDOR.minX, DEPARTURE_CORRIDOR.minX, AIRPORT_FLAT_ZONE.minX)
  let maxX = Math.max(APPROACH_CORRIDOR.maxX, DEPARTURE_CORRIDOR.maxX, AIRPORT_FLAT_ZONE.maxX)
  let minZ = Math.min(APPROACH_CORRIDOR.minZ, DEPARTURE_CORRIDOR.minZ, AIRPORT_FLAT_ZONE.minZ)
  let maxZ = Math.max(APPROACH_CORRIDOR.maxZ, DEPARTURE_CORRIDOR.maxZ, AIRPORT_FLAT_ZONE.maxZ)
  for (let i = 0; i < RING_N; i++) {
    minX = Math.min(minX, ringX[i])
    maxX = Math.max(maxX, ringX[i])
    minZ = Math.min(minZ, ringZ[i])
    maxZ = Math.max(maxZ, ringZ[i])
  }
  const m = Math.max(RING_OUTER, CORRIDOR_FADE + PAD, AIRPORT_BLEND + PAD) + 10
  return { minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m }
})()

// ---------------------------------------------------------------- features

interface Range {
  ax: number
  az: number
  bx: number
  bz: number
  width: number
  /** Relative peak height. */
  peak: number
}

/** Mountain range axes (m), all far from the airport. */
const RANGES: readonly Range[] = [
  { ax: 10000, az: -8000, bx: 27000, bz: -25000, width: 9000, peak: 1 }, // north-east: the high range
  { ax: -15000, az: 5000, bx: -27000, bz: -9000, width: 7000, peak: 0.7 }, // west
  { ax: 14000, az: 15000, bx: 24000, bz: 26000, width: 7000, peak: 0.55 }, // south-east
  { ax: -9000, az: -21000, bx: 1000, bz: -31000, width: 6000, peak: 0.45 }, // northern highlands
]

interface River {
  xs: Float64Array
  zs: Float64Array
  /** Distance from the source to each vertex. */
  ss: Float64Array
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** River courses, source first; each runs out past the coast into the sea. */
const RIVER_PATHS: readonly (readonly [number, number])[][] = [
  // North: between the high range and the northern highlands.
  [
    [3500, -11000],
    [2500, -18000],
    [5500, -25500],
    [4000, -33000],
    [5500, -41000],
    [5000, -52000],
  ],
  // East: south of the high range.
  [
    [12500, 2500],
    [20000, 6000],
    [28000, 3500],
    [36000, 8000],
    [44000, 7000],
    [53000, 9000],
  ],
  // South-west.
  [
    [-7000, 9500],
    [-11000, 17000],
    [-18000, 24000],
    [-22000, 33000],
    [-27000, 41000],
    [-30000, 52000],
  ],
]

const RIVER_MAX_VALLEY = 1700
const MEANDER = 260

const RIVERS: readonly River[] = RIVER_PATHS.map((pts) => {
  const n = pts.length
  const xs = new Float64Array(n)
  const zs = new Float64Array(n)
  const ss = new Float64Array(n)
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i][0]
    zs[i] = pts[i][1]
    if (i > 0) ss[i] = ss[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1])
    minX = Math.min(minX, xs[i])
    maxX = Math.max(maxX, xs[i])
    minZ = Math.min(minZ, zs[i])
    maxZ = Math.max(maxZ, zs[i])
  }
  const m = RIVER_MAX_VALLEY + MEANDER + 50
  return { xs, zs, ss, minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m }
})

interface Lake {
  x: number
  z: number
  radius: number
}

/** Sea-level lakes in lowland basins. */
export const LAKES: readonly Lake[] = [
  { x: -9500, z: -6500, radius: 1200 },
  { x: 6500, z: 12500, radius: 1600 },
]
const LAKE_BLEND = 1800

interface Islet {
  x: number
  z: number
  radius: number
  peak: number
}

/** Small offshore islands, at fixed centres beyond the main coast. */
export const ISLETS: readonly Islet[] = [
  { x: -41000, z: -40000, radius: 2600, peak: 240 },
  { x: 40000, z: 37000, radius: 3200, peak: 380 },
  { x: -42000, z: 33000, radius: 1800, peak: 120 },
  { x: 36000, z: -41000, radius: 2200, peak: 190 },
]

// ---------------------------------------------------------------- pieces

/** Signed distance inland (m) from the main island coast; negative at sea. */
function mainCoast(x: number, z: number): number {
  const wx = x + 5200 * fbm2(x * (1 / 24000) + 3.1, z * (1 / 24000) - 1.7, 2, S_WARP_X)
  const wz = z + 5200 * fbm2(x * (1 / 24000) - 5.3, z * (1 / 24000) + 2.9, 2, S_WARP_Z)
  const rw = Math.sqrt(wx * wx + wz * wz)
  const cn = fbm2(wx * (1 / 15000), wz * (1 / 15000), 4, S_COAST)
  let c = R * (1 + 0.32 * cn) - rw
  // Bays and peninsulas.
  c += 2800 * fbm2(x * (1 / 8000) - 1.3, z * (1 / 8000) + 4.1, 3, S_BAY)
  // Coves and headlands only matter near the shore.
  if (c > -6000 && c < 6000) {
    c += 900 * (1 - smoothstep(3500, 6000, Math.abs(c))) * fbm2(x * (1 / 3200), z * (1 / 3200), 2, S_COVE)
  }
  // Keep the coast well inside the world square.
  const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF_SIZE
  if (edge > 0.8) c -= 14000 * smoothstep(0.8, 0.96, edge)
  return c
}

/** Mountain mask 0..~1 from the range axes. */
function rangeMask(x: number, z: number): number {
  let m = 0
  for (let i = 0; i < RANGES.length; i++) {
    const g = RANGES[i]
    const dx = g.bx - g.ax
    const dz = g.bz - g.az
    let t = ((x - g.ax) * dx + (z - g.az) * dz) / (dx * dx + dz * dz)
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const ex = x - (g.ax + dx * t)
    const ez = z - (g.az + dz * t)
    const d2 = ex * ex + ez * ez
    if (d2 >= g.width * g.width * 1.8) continue
    const w = g.width * (1 + 0.3 * valueNoise2(x * (1 / 9000), z * (1 / 9000), S_RANGE + i))
    const k = (1 - smoothstep(0.15 * w, w, Math.sqrt(d2))) * g.peak
    if (k > m) m = k
  }
  return m
}

/**
 * Mountain relief (m) for a range mask 0..1: a broad massif, sharp warped
 * ridge lines on top, and eroded gullies on the flanks. Shortest feature
 * wavelengths stay above ~200 m so the 30 m grid follows them faithfully.
 */
function mountainRelief(x: number, z: number, mask: number): number {
  const wx = x + 1400 * gradNoise2(x * (1 / 6000), z * (1 / 6000), S_RIDGE + 7)
  const wz = z + 1400 * gradNoise2(x * (1 / 6000) + 9.1, z * (1 / 6000) - 4.7, S_RIDGE + 9)
  const ridges = ridgedGrad2(wx * (1 / 6500), wz * (1 / 6500), 5, S_RIDGE)
  const e = erodedFbm2(x * (1 / 2600), z * (1 / 2600), 4, S_ERODE)
  const massif = mask * mask * (3 - 2 * mask)
  return 1850 * massif * (0.18 + 0.82 * ridges * ridges) + 90 * massif * e
}

/** Carves river valleys (never raises the terrain). */
function carveRivers(x: number, z: number, h: number): number {
  for (let k = 0; k < RIVERS.length; k++) {
    const rv = RIVERS[k]
    if (x < rv.minX || x > rv.maxX || z < rv.minZ || z > rv.maxZ) continue
    // Meandering: measure the distance from a gently warped point.
    const px = x + MEANDER * valueNoise2(x * (1 / 1700), z * (1 / 1700), S_MEANDER_X)
    const pz = z + MEANDER * valueNoise2(x * (1 / 1700), z * (1 / 1700), S_MEANDER_Z)
    let best = Infinity
    let bestS = 0
    const n = rv.xs.length
    for (let i = 0; i < n - 1; i++) {
      const ax = rv.xs[i]
      const az = rv.zs[i]
      const dx = rv.xs[i + 1] - ax
      const dz = rv.zs[i + 1] - az
      const len2 = dx * dx + dz * dz
      let t = ((px - ax) * dx + (pz - az) * dz) / len2
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const ex = px - (ax + dx * t)
      const ez = pz - (az + dz * t)
      const d2 = ex * ex + ez * ez
      if (d2 < best) {
        best = d2
        bestS = rv.ss[i] + t * (rv.ss[i + 1] - rv.ss[i])
      }
    }
    const total = rv.ss[n - 1]
    const f = bestS / total // 0 at the source, 1 at the far end (out at sea)
    const valley = 650 + 1000 * f
    const d = Math.sqrt(best)
    if (d >= valley) continue
    const chan = 34 + 56 * f
    // Bed: a dry creek at the source, below sea level after ~4.5 km.
    const bed = -3 + 26 * (1 - smoothstep(0, 4500, bestS))
    const bank = smoothstep(chan * 0.55, chan * 1.4, d)
    let target = bed + 4.5 * bank
    if (h > target) {
      const v = smoothstep(chan, valley, d)
      target += (h - target) * v
    }
    if (target < h) h = target
  }
  return h
}

/** Carves the sea-level lakes and flattens their shores (never raises). */
function carveLakes(x: number, z: number, h: number): number {
  for (let i = 0; i < LAKES.length; i++) {
    const l = LAKES[i]
    const dx = x - l.x
    const dz = z - l.z
    const reach = l.radius * 1.3 + LAKE_BLEND
    if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d > reach) continue
    const rr = l.radius * (1 + 0.28 * fbm2(x * (1 / 1400), z * (1 / 1400), 2, S_LAKE + i))
    let target: number
    if (d < rr) {
      const q = d / rr
      target = 1.0 - 9 * (1 - q * q)
    } else {
      target = 1.0 + 1.5 * smoothstep(rr, rr + 200, d)
      if (h > target) target += (h - target) * smoothstep(rr + 100, rr + LAKE_BLEND, d)
    }
    if (target < h) h = target
  }
  return h
}

/** Islet relief and signed distance inland; returns -Infinity far from every islet. */
let isletHeight = 0
function isletCoast(x: number, z: number): number {
  let best = -Infinity
  isletHeight = 0
  for (let i = 0; i < ISLETS.length; i++) {
    const s = ISLETS[i]
    const dx = x - s.x
    const dz = z - s.z
    const reach = s.radius * 2.2
    if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue
    const d = Math.sqrt(dx * dx + dz * dz)
    const c = s.radius * (1 + 0.3 * fbm2(x * (1 / 1500), z * (1 / 1500), 3, S_ISLE + i)) - d
    if (c > best) {
      best = c
      const k = smoothstep(0, s.radius, c)
      isletHeight = s.peak * k * k * (0.75 + 0.25 * fbm2(x * (1 / 700), z * (1 / 700), 3, S_ISLE + 50 + i))
    }
  }
  return best
}

function applyConstraints(x: number, z: number, h: number): number {
  const b = CONSTRAINT_BOX
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return h

  // Approach / departure corridors: cap the terrain, padded by two cells.
  let d = rectDist(x, z, APPROACH_CORRIDOR) - PAD
  if (d < CORRIDOR_FADE && h > APPROACH_CAP) {
    h = d <= 0 ? APPROACH_CAP : h + (APPROACH_CAP - h) * (1 - smoothstep(0, CORRIDOR_FADE, d))
  }
  d = rectDist(x, z, DEPARTURE_CORRIDOR) - PAD
  if (d < CORRIDOR_FADE && h > DEPARTURE_CAP) {
    h = d <= 0 ? DEPARTURE_CAP : h + (DEPARTURE_CAP - h) * (1 - smoothstep(0, CORRIDOR_FADE, d))
  }

  // Ring course: keep the terrain well below every ring.
  for (let i = 0; i < RING_N; i++) {
    const dx = x - ringX[i]
    const dz = z - ringZ[i]
    const d2 = dx * dx + dz * dz
    if (d2 < RING_OUTER * RING_OUTER && h > ringCap[i]) {
      const w = 1 - smoothstep(RING_INNER, RING_OUTER, Math.sqrt(d2))
      h += (ringCap[i] - h) * w
    }
  }

  // Airport plateau, exact out to two cells past the zone, then a smooth blend.
  const da = rectDist(x, z, AIRPORT_FLAT_ZONE) - PAD
  if (da <= 0) return ELEV
  if (da < AIRPORT_BLEND) h = ELEV + (h - ELEV) * smoothstep(0, AIRPORT_BLEND, da)
  return h
}

// ---------------------------------------------------------------- height

/** Natural terrain height (m) with the seabed kept negative. */
export function naturalHeightAt(x: number, z: number): number {
  const cMain = mainCoast(x, z)
  const cIsle = isletCoast(x, z)
  let h: number

  if (cMain >= 0) {
    // ---- main island land
    const r = Math.sqrt(x * x + z * z)
    // Low country around the airport, rising inland.
    const basin = 0.22 + 0.78 * smoothstep(1500, 9000, Math.sqrt(x * x + z * z * 0.6))
    const beach = 2.4 * smoothstep(0, 260, cMain)
    const base = 26 * smoothstep(200, 7000, cMain)
    const hv = fbm2(x * (1 / 4300) + 0.5, z * (1 / 4300) + 0.25, 5, S_HILLS)
    const hillAmp = 150 * smoothstep(250, 5000, cMain)
    const hb = 0.42 + hv * 1.25
    // Soft floor (no crease where the hills flatten out).
    const hills = hillAmp * 0.5 * (hb + Math.sqrt(hb * hb + 0.01))
    const roll = 14 * smoothstep(150, 1500, cMain) * fbm2(x * (1 / 1300), z * (1 / 1300), 2, S_ROLL)
    h = beach + basin * (base + hills + roll)

    const mask = rangeMask(x, z) * smoothstep(600, 6000, cMain) * smoothstep(4500, 11000, r)
    if (mask > 0.002) h += mountainRelief(x, z, mask)
    h = carveLakes(x, z, h)
  } else {
    // ---- sea: shelf, then deep water
    h = -150 * (1 - Math.exp(cMain * (1 / 2200)))
  }

  // Small islands rise out of the sea floor.
  if (cIsle > -2000) {
    const hi = cIsle >= 0 ? 2.2 * smoothstep(0, 180, cIsle) + isletHeight : -150 * (1 - Math.exp(cIsle * (1 / 900)))
    if (hi > h) h = hi
  }

  if (h > -2) h = carveRivers(x, z, h)
  return applyConstraints(x, z, h)
}

/** Forest cover 0..1 (clumped woods); shared by tree placement and the ground shader. */
export function forestAt(x: number, z: number): number {
  const n = fbm2(x * (1 / 2400) + 7.1, z * (1 / 2400) - 3.3, 4, S_FOREST)
  return smoothstep(-0.08, 0.22, n)
}

/** Dryness 0..1 (dry grass patches); shared by the ground shader and tree types. */
export function drynessAt(x: number, z: number): number {
  const n = fbm2(x * (1 / 6000) - 2.2, z * (1 / 6000) + 5.4, 3, S_MOIST)
  return smoothstep(-0.25, 0.35, n)
}

export function isPavedAt(x: number, z: number): boolean {
  return isPaved(x, z)
}
