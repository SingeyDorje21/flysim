import { describe, expect, it } from 'vitest'
import { AIRPORTS } from '../../config/airports'
import { WORLD } from '../../config/world'
import { runwayEnds } from '../../game/airportGeometry'
import {
  DEEP_SEA_CUTOFF,
  SKIRT_INDEX_COUNT,
  SKIRT_VERTEX_COUNT,
  TOP_INDEX_COUNT,
  TOP_VERTEX_COUNT,
  buildChunk,
  type ChunkData,
} from '../terrain/chunkBuilder'
import { naturalHeightAt } from '../terrain/heightField'
import { CHUNK_CELLS as N, LEAF_SIZE, ROOT_MIN, chunkSize } from '../terrain/lod'
import { createTerrainSampler } from '../terrain/terrainSampler'

const V = N + 1
const cache = new Map<string, ChunkData>()
function chunk(level: number, cx: number, cz: number): ChunkData {
  const key = `${level}:${cx}:${cz}`
  let c = cache.get(key)
  if (!c) {
    c = buildChunk(level, cx, cz)
    cache.set(key, c)
  }
  return c
}

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Height of the chunk's top-surface triangles at world (x, z), found by barycentric search over the cell's two triangles. */
function meshHeightAt(c: ChunkData, x: number, z: number): number {
  const lx = x - c.originX
  const lz = z - c.originZ
  const i = Math.min(N - 1, Math.floor(lx / c.cell))
  const j = Math.min(N - 1, Math.floor(lz / c.cell))
  const first = (j * N + i) * 6
  const p = c.positions
  for (let t = first; t < first + 6; t += 3) {
    const [a, b, d] = [c.indices[t], c.indices[t + 1], c.indices[t + 2]]
    const ax = p[a * 3]
    const az = p[a * 3 + 2]
    const bx = p[b * 3]
    const bz = p[b * 3 + 2]
    const dx = p[d * 3]
    const dz = p[d * 3 + 2]
    const det = (bz - dz) * (ax - dx) + (dx - bx) * (az - dz)
    const w1 = ((bz - dz) * (lx - dx) + (dx - bx) * (lz - dz)) / det
    const w2 = ((dz - az) * (lx - dx) + (ax - dx) * (lz - dz)) / det
    const w3 = 1 - w1 - w2
    if (w1 >= -1e-9 && w2 >= -1e-9 && w3 >= -1e-9) return w1 * p[a * 3 + 1] + w2 * p[b * 3 + 1] + w3 * p[d * 3 + 1]
  }
  throw new Error('point not in cell')
}

describe('terrain chunks', () => {
  it('finest level equals the physics sampler (< 1 mm) at random points', () => {
    const sampler = createTerrainSampler()
    const rnd = lcg(42)
    let worst = 0
    let tested = 0
    for (let k = 0; k < 50; k++) {
      // Chunks across the island, the coast and the mountains.
      const cx = Math.floor((rnd() * 84000 - 42000 - ROOT_MIN) / LEAF_SIZE)
      const cz = Math.floor((rnd() * 84000 - 42000 - ROOT_MIN) / LEAF_SIZE)
      const c = chunk(0, cx, cz)
      if (c.empty) continue
      for (let n = 0; n < 40; n++) {
        const x = c.originX + rnd() * LEAF_SIZE
        const z = c.originZ + rnd() * LEAF_SIZE
        const m = meshHeightAt(c, x, z)
        worst = Math.max(worst, Math.abs(m - sampler.rawHeightAt(x, z)))
        worst = Math.max(worst, Math.abs(Math.max(0, m) - sampler.heightAt(x, z)))
        tested++
      }
    }
    expect(tested).toBeGreaterThan(1000)
    expect(worst).toBeLessThan(1e-3)
  })

  it('finest level equals the physics sampler on every airport plateau and threshold', () => {
    const sampler = createTerrainSampler()
    const rnd = lcg(5)
    let worst = 0
    for (const a of AIRPORTS) {
      const points = [a.center, ...runwayEnds(a).map((e) => e.threshold)]
      for (const p of points) {
        const c = chunk(0, Math.floor((p.x - ROOT_MIN) / LEAF_SIZE), Math.floor((p.z - ROOT_MIN) / LEAF_SIZE))
        expect(c.empty).toBe(false)
        for (let n = 0; n < 30; n++) {
          const x = c.originX + rnd() * LEAF_SIZE
          const z = c.originZ + rnd() * LEAF_SIZE
          worst = Math.max(worst, Math.abs(meshHeightAt(c, x, z) - sampler.rawHeightAt(x, z)))
        }
      }
    }
    expect(worst).toBeLessThan(1e-3)
  })

  it('uses the physics-grid vertices and the b-d diagonal', () => {
    const c = chunk(0, 70, 60)
    expect(c.cell).toBe(WORLD.physicsGridStep)
    for (const [i, j] of [
      [0, 0],
      [5, 17],
      [N, N],
    ]) {
      const k = j * V + i
      expect(c.positions[k * 3 + 1]).toBe(Math.fround(naturalHeightAt(c.originX + i * 30, c.originZ + j * 30)))
    }
    // First cell: (a, d, b) then (b, d, e).
    expect([...c.indices.slice(0, 6)]).toEqual([0, V, 1, 1, V, V + 1])
  })

  it('has skirts on every edge, below the surface', () => {
    for (const [l, cx, cz] of [
      [0, 75, 50],
      [2, 18, 13],
      [5, 2, 1],
    ]) {
      const c = chunk(l, cx, cz)
      expect(c.empty).toBe(false)
      expect(c.positions.length / 3).toBe(TOP_VERTEX_COUNT + SKIRT_VERTEX_COUNT)
      expect(c.indices.length).toBe(TOP_INDEX_COUNT + SKIRT_INDEX_COUNT)
      expect(c.topIndexCount).toBe(TOP_INDEX_COUNT)
      expect(c.skirtDepth).toBeGreaterThan(1)
      // Every top edge vertex has a skirt vertex straight below it.
      const p = c.positions
      const edge = new Set<string>()
      for (let k = TOP_VERTEX_COUNT; k < TOP_VERTEX_COUNT + SKIRT_VERTEX_COUNT; k++) {
        edge.add(`${p[k * 3]},${p[k * 3 + 2]}`)
      }
      const size = chunkSize(l)
      for (let t = 0; t <= N; t++) {
        const s = (t * size) / N
        for (const key of [`${s},0`, `${s},${size}`, `0,${s}`, `${size},${s}`]) expect(edge.has(key)).toBe(true)
      }
      for (let k = TOP_VERTEX_COUNT; k < TOP_VERTEX_COUNT + SKIRT_VERTEX_COUNT; k++) {
        expect(p[k * 3 + 1]).toBeLessThan(c.maxY)
      }
    }
  })

  it('has no cracks: skirts cover the edge mismatch between neighbouring levels', () => {
    const rnd = lcg(5)
    for (let l = 0; l <= 5; l++) {
      for (let trial = 0; trial < 6; trial++) {
        // A coarse chunk (level l + 1) in the mountains and the fine chunks east of it.
        const cs = chunkSize(l + 1)
        const wx = 6000 + rnd() * 24000
        const wz = -28000 + rnd() * 24000
        const ccx = Math.floor((wx - ROOT_MIN) / cs)
        const ccz = Math.floor((wz - ROOT_MIN) / cs)
        const coarse = chunk(l + 1, ccx, ccz)
        for (const half of [0, 1]) {
          const fine = chunk(l, (ccx + 1) * 2, ccz * 2 + half)
          if (coarse.empty || fine.empty) continue
          // Shared edge: coarse east edge (i = N), fine west edge (i = 0).
          for (let j = 0; j <= N; j++) {
            const fy = fine.positions[j * V * 3 + 1]
            const zc = (half * N + j) / 2 // position along the coarse edge in coarse cells
            const j0 = Math.floor(zc)
            const j1 = Math.min(N, j0 + 1)
            const ya = coarse.positions[(j0 * V + N) * 3 + 1]
            const yb = coarse.positions[(j1 * V + N) * 3 + 1]
            const cy = ya + (yb - ya) * (zc - j0)
            const gap = Math.abs(fy - cy)
            expect(gap).toBeLessThanOrEqual(Math.min(fine.skirtDepth, coarse.skirtDepth))
          }
        }
      }
    }
  })

  it('shares identical edge heights and normals with same-level neighbours', () => {
    const a = chunk(1, 34, 30)
    const b = chunk(1, 35, 30)
    for (let j = 0; j <= N; j++) {
      const ka = (j * V + N) * 3
      const kb = j * V * 3
      expect(a.positions[ka + 1]).toBe(b.positions[kb + 1])
      expect(a.normals[ka]).toBe(b.normals[kb])
      expect(a.normals[ka + 1]).toBe(b.normals[kb + 1])
    }
  })

  it('leaves deep-sea chunks empty and keeps positions local to the chunk', () => {
    const deep = chunk(0, 2, 2) // far corner of the root square, open ocean
    expect(deep.empty).toBe(true)
    expect(deep.maxY).toBeLessThan(DEEP_SEA_CUTOFF)
    const c = chunk(3, 8, 7)
    let maxXZ = 0
    for (let k = 0; k < c.positions.length; k += 3) maxXZ = Math.max(maxXZ, Math.abs(c.positions[k]), Math.abs(c.positions[k + 2]))
    expect(maxXZ).toBeLessThanOrEqual(chunkSize(3))
  })

  it('builds a chunk quickly', () => {
    buildChunk(0, 80, 40)
    const t0 = performance.now()
    let n = 0
    for (let cx = 70; cx < 78; cx++) {
      buildChunk(0, cx, 45)
      n++
    }
    const ms = (performance.now() - t0) / n
    console.log(`chunk build: ${ms.toFixed(2)} ms per 33x33 chunk`)
    expect(ms).toBeLessThan(25)
  })
})
