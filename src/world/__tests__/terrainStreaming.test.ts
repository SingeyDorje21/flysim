import { describe, expect, it } from 'vitest'
import { type Mesh, MeshBasicMaterial } from 'three'
import { QUALITY_PROFILES } from '../../config/quality'
import { chunkOrigin, chunkSize, selectLodNodes } from '../terrain/lod'
import { TerrainStreamer } from '../terrain/terrainStreamer'

interface Parsed {
  level: number
  cx: number
  cz: number
}

function parse(name: string): Parsed {
  const [level, cx, cz] = name.replace('terrain-', '').split(':').map(Number)
  return { level, cx, cz }
}

function contains(a: Parsed, b: Parsed): boolean {
  if (a.level <= b.level) return false
  const k = 2 ** (a.level - b.level)
  return Math.floor(b.cx / k) === a.cx && Math.floor(b.cz / k) === a.cz
}

describe('terrain streaming (main-thread fallback)', () => {
  it('converges to the LOD selection without overlaps, uploads a few chunks per frame and evicts with dispose', () => {
    const p = QUALITY_PROFILES.low
    const material = new MeshBasicMaterial()
    const s = new TerrainStreamer({
      material,
      viewDistance: p.terrainViewDistance,
      lodBias: p.terrainLodBias,
      receiveShadow: false,
      useWorkers: false,
      cacheSize: 150,
    })
    const cam = { x: 2000, y: 400, z: -3000 }
    let prevChildren = 0
    for (let f = 0; f < 400; f++) {
      s.update(cam.x, cam.y, cam.z)
      const n = s.group.children.length
      expect(n - prevChildren).toBeLessThanOrEqual(3)
      prevChildren = n
      const visible = (s.group.children as Mesh[]).filter((m) => m.visible).map((m) => parse(m.name))
      for (const a of visible) for (const b of visible) expect(contains(a, b)).toBe(false)
    }
    expect(s.stats.queued).toBe(0)

    // Converged: exactly the ideal selection (deep-sea chunks have no mesh).
    const visible = new Set(
      (s.group.children as Mesh[]).filter((m) => m.visible).map((m) => m.name.replace('terrain-', '')),
    )
    const ideal = selectLodNodes(cam.x, cam.y, cam.z, p.terrainViewDistance, p.terrainLodBias)
    for (const v of visible) expect(ideal.some((n) => `${n.level}:${n.cx}:${n.cz}` === v)).toBe(true)
    const here = ideal.find((n) => {
      const sz = chunkSize(n.level)
      const x0 = chunkOrigin(n.level, n.cx)
      const z0 = chunkOrigin(n.level, n.cz)
      return cam.x >= x0 && cam.x < x0 + sz && cam.z >= z0 && cam.z < z0 + sz
    })!
    expect(here.level).toBe(0)
    expect(visible.has(`0:${here.cx}:${here.cz}`)).toBe(true)

    // Fly 20 km: the cache stays bounded and evicted geometries are disposed.
    let disposed = 0
    for (const m of s.group.children as Mesh[]) m.geometry.addEventListener('dispose', () => disposed++)
    for (let f = 0; f < 200; f++) {
      cam.x += 100
      s.update(cam.x, cam.y, cam.z)
    }
    expect(s.stats.cached).toBeLessThanOrEqual(150 + 32)
    expect(disposed).toBeGreaterThan(0)

    s.dispose()
    expect(s.group.children.length).toBe(0)
    material.dispose()
  }, 30000)
})
