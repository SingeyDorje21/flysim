/**
 * Pure terrain chunk geometry builder (no three.js). Runs inside the terrain
 * worker, or on the main thread as a fallback, and directly in tests.
 *
 * A chunk is a (CHUNK_CELLS + 1)^2 vertex grid. Vertex (i, j) of a level-L
 * chunk is physics-grid vertex (I0 + i * 2^L, J0 + j * 2^L), and its height is
 * naturalHeightAt(gridIndex * STEP) - the same expression the sampler
 * evaluates - so the level-0 mesh is exactly the physics ground. Cells are
 * split along the b-d diagonal like the sampler: (a, d, b) and (b, d, e).
 *
 * Positions are stored relative to the chunk origin (Float32 keeps mm
 * precision); the renderer places the mesh at (originX, 0, originZ).
 *
 * Cracks between levels are hidden by skirts: each edge vertex is repeated
 * skirtDepth metres lower and joined to the edge by a vertical strip.
 */

import { WORLD } from '../../config/world'
import { drynessAt, forestAt, naturalHeightAt } from './heightField'
import { CHUNK_CELLS, chunkCellSize, chunkOrigin } from './lod'

const STEP = WORLD.physicsGridStep
const N = CHUNK_CELLS
const V = N + 1
/** Chunks whose highest point is below this (m) are left empty (deep sea under the water plane). */
export const DEEP_SEA_CUTOFF = -60

export const TOP_VERTEX_COUNT = V * V
export const SKIRT_VERTEX_COUNT = 4 * V
export const TOP_INDEX_COUNT = N * N * 6
export const SKIRT_INDEX_COUNT = 4 * N * 6

export interface ChunkData {
  level: number
  cx: number
  cz: number
  originX: number
  originZ: number
  /** Cell size (m). */
  cell: number
  /** Local x, y, z; the first TOP_VERTEX_COUNT vertices are the surface, row-major by z then x. */
  positions: Float32Array
  normals: Float32Array
  /** Per vertex: forest cover 0..1, dryness 0..1. */
  biome: Float32Array
  indices: Uint16Array
  /** The first topIndexCount indices are the surface; the rest are skirts. */
  topIndexCount: number
  minY: number
  maxY: number
  skirtDepth: number
  /** True when the whole chunk is deep sea: nothing to draw. */
  empty: boolean
}

/** Max deviation of an edge polyline from its own coarser (span 2 and 4) and finer (midpoint) versions. */
function edgeMismatch(
  h: Float64Array,
  start: number,
  delta: number,
  gx0: number,
  gz0: number,
  gdx: number,
  gdz: number,
  m: number,
): number {
  let err = 0
  // Against coarser neighbours: the edge vertices they skip.
  for (const span of [2, 4]) {
    for (let k = 0; k + span <= N; k += span) {
      const a = h[start + k * delta]
      const b = h[start + (k + span) * delta]
      for (let q = 1; q < span; q++) {
        const lin = a + ((b - a) * q) / span
        const e = Math.abs(h[start + (k + q) * delta] - lin)
        if (e > err) err = e
      }
    }
  }
  // Against finer neighbours: grid vertices between this edge's vertices.
  if (m > 1) {
    const half = m >> 1
    for (let k = 0; k < N; k++) {
      const a = h[start + k * delta]
      const b = h[start + (k + 1) * delta]
      const gi = gx0 + gdx * (k * m + half)
      const gj = gz0 + gdz * (k * m + half)
      const e = Math.abs(naturalHeightAt(gi * STEP, gj * STEP) - (a + b) * 0.5)
      if (e > err) err = e
    }
  }
  return err
}

/** Builds the geometry arrays of chunk (level, cx, cz). */
export function buildChunk(level: number, cx: number, cz: number): ChunkData {
  const cell = chunkCellSize(level)
  const originX = chunkOrigin(level, cx)
  const originZ = chunkOrigin(level, cz)
  const m = 1 << level // grid steps per cell
  const I0 = Math.round(originX / STEP)
  const J0 = Math.round(originZ / STEP)

  // Heights with a one-vertex border for normals: (V + 2)^2, index (j + 1) * W + (i + 1).
  const W = V + 2
  const h = new Float64Array(W * W)
  let minY = Infinity
  let maxY = -Infinity
  for (let j = -1; j <= V; j++) {
    const gz = (J0 + j * m) * STEP
    for (let i = -1; i <= V; i++) {
      const y = naturalHeightAt((I0 + i * m) * STEP, gz)
      h[(j + 1) * W + (i + 1)] = y
      if (i >= 0 && i < V && j >= 0 && j < V) {
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxY < DEEP_SEA_CUTOFF) {
    return {
      level,
      cx,
      cz,
      originX,
      originZ,
      cell,
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      biome: new Float32Array(0),
      indices: new Uint16Array(0),
      topIndexCount: 0,
      minY,
      maxY,
      skirtDepth: 0,
      empty: true,
    }
  }

  // Skirt depth from the worst mismatch any neighbouring level can show.
  const c0 = W + 1 // h index of vertex (0, 0)
  let mis = 0
  mis = Math.max(mis, edgeMismatch(h, c0, 1, I0, J0, 1, 0, m)) // north edge (j = 0)
  mis = Math.max(mis, edgeMismatch(h, c0 + N * W, 1, I0, J0 + N * m, 1, 0, m)) // south edge
  mis = Math.max(mis, edgeMismatch(h, c0, W, I0, J0, 0, 1, m)) // west edge (i = 0)
  mis = Math.max(mis, edgeMismatch(h, c0 + N, W, I0 + N * m, J0, 0, 1, m)) // east edge
  const skirtDepth = 2 + 0.04 * cell + 1.5 * mis

  const vertexCount = TOP_VERTEX_COUNT + SKIRT_VERTEX_COUNT
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const biome = new Float32Array(vertexCount * 2)
  const inv2 = 1 / (2 * cell)

  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const k = j * V + i
      const hi = (j + 1) * W + (i + 1)
      positions[k * 3] = i * cell
      positions[k * 3 + 1] = h[hi]
      positions[k * 3 + 2] = j * cell
      const nx = -(h[hi + 1] - h[hi - 1]) * inv2
      const nz = -(h[hi + W] - h[hi - W]) * inv2
      const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz)
      normals[k * 3] = nx * inv
      normals[k * 3 + 1] = inv
      normals[k * 3 + 2] = nz * inv
      const wx = originX + i * cell
      const wz = originZ + j * cell
      biome[k * 2] = forestAt(wx, wz)
      biome[k * 2 + 1] = drynessAt(wx, wz)
    }
  }

  // Skirt vertices: north edge, east edge, south edge, west edge (each V vertices).
  const edgeTop = (e: number, t: number): number => {
    if (e === 0) return t // north, i = t, j = 0
    if (e === 1) return t * V + N // east, i = N, j = t
    if (e === 2) return N * V + t // south, i = t, j = N
    return t * V // west, i = 0, j = t
  }
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < V; t++) {
      const src = edgeTop(e, t)
      const k = TOP_VERTEX_COUNT + e * V + t
      positions[k * 3] = positions[src * 3]
      positions[k * 3 + 1] = positions[src * 3 + 1] - skirtDepth
      positions[k * 3 + 2] = positions[src * 3 + 2]
      normals[k * 3] = normals[src * 3]
      normals[k * 3 + 1] = normals[src * 3 + 1]
      normals[k * 3 + 2] = normals[src * 3 + 2]
      biome[k * 2] = biome[src * 2]
      biome[k * 2 + 1] = biome[src * 2 + 1]
    }
  }

  const indices = new Uint16Array(TOP_INDEX_COUNT + SKIRT_INDEX_COUNT)
  let p = 0
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * V + i
      const b = a + 1
      const d = a + V
      const e = d + 1
      // Counter-clockwise seen from above (+Y), split along b-d.
      indices[p++] = a
      indices[p++] = d
      indices[p++] = b
      indices[p++] = b
      indices[p++] = d
      indices[p++] = e
    }
  }
  const topIndexCount = p
  // Skirt quads, wound to face outwards.
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < N; t++) {
      const t0 = edgeTop(e, t)
      const t1 = edgeTop(e, t + 1)
      const s0 = TOP_VERTEX_COUNT + e * V + t
      const s1 = s0 + 1
      // North and east edges run with increasing t one way, south and west the other.
      if (e === 0 || e === 1) {
        indices[p++] = t0
        indices[p++] = t1
        indices[p++] = s0
        indices[p++] = s0
        indices[p++] = t1
        indices[p++] = s1
      } else {
        indices[p++] = t0
        indices[p++] = s0
        indices[p++] = t1
        indices[p++] = t1
        indices[p++] = s0
        indices[p++] = s1
      }
    }
  }

  return {
    level,
    cx,
    cz,
    originX,
    originZ,
    cell,
    positions,
    normals,
    biome,
    indices,
    topIndexCount,
    minY: minY - skirtDepth,
    maxY,
    skirtDepth,
    empty: false,
  }
}
