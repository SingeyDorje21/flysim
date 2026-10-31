import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  MeshLambertMaterial,
  type PerspectiveCamera,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { QualityProfile } from '../../config/quality'
import type { TerrainSampler } from '../../simulation/types'
import { TREE_STRIDE, TREE_TILE, TREE_TYPE_COUNT, placeTreeTile, type TreeTile } from './treePlacement'
import { treeTileInView, treeViewFor, treeViewTurned, type TreeView } from './treeView'

function paint(g: BufferGeometry, color: number): BufferGeometry {
  const c = new Color(color)
  const n = g.getAttribute('position').count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new BufferAttribute(arr, 3))
  return g
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const plain = parts.map((p) => (p.index ? p.toNonIndexed() : p))
  const merged = mergeGeometries(plain)
  for (const p of parts) p.dispose()
  for (const p of plain) p.dispose()
  return merged
}

/** Conifer, ~15 m: trunk and three stacked cones. */
function conifer(): BufferGeometry {
  const trunk = new CylinderGeometry(0.3, 0.45, 3.5, 6).translate(0, 1.75, 0)
  const c1 = new ConeGeometry(3.4, 6.5, 8).translate(0, 5.5, 0)
  const c2 = new ConeGeometry(2.6, 5.5, 8).translate(0, 8.8, 0)
  const c3 = new ConeGeometry(1.7, 4.5, 7).translate(0, 11.8, 0)
  return merge([paint(trunk, 0x5a3d26), paint(c1, 0x2b5a30), paint(c2, 0x30663a), paint(c3, 0x387042)])
}

/** Broadleaf, ~11 m: trunk and a lumpy rounded crown. */
function broadleaf(): BufferGeometry {
  const trunk = new CylinderGeometry(0.35, 0.55, 4.5, 6).translate(0, 2.25, 0)
  const crown = new IcosahedronGeometry(3.8, 1).scale(1, 0.85, 1).translate(0, 7.2, 0)
  const lobe1 = new IcosahedronGeometry(2.6, 0).translate(1.9, 6.2, 0.6)
  const lobe2 = new IcosahedronGeometry(2.4, 0).translate(-1.5, 6.6, -1.2)
  return merge([paint(trunk, 0x5e4630), paint(crown, 0x4f7f34), paint(lobe1, 0x5a8a3a), paint(lobe2, 0x47772f)])
}

/** Poplar, ~16 m: slim trunk and a tall narrow crown. */
function poplar(): BufferGeometry {
  const trunk = new CylinderGeometry(0.25, 0.4, 3, 6).translate(0, 1.5, 0)
  const crown = new IcosahedronGeometry(2, 1).scale(1, 3.4, 1).translate(0, 9.2, 0)
  return merge([paint(trunk, 0x6b5a46), paint(crown, 0x6a9442)])
}

const TILE_BUDGET_MS = 2.5
const TILE_CACHE = 900
const RESELECT_DISTANCE = 60
/**
 * Trees this close to the camera (m) cast shadows. The sun's shadow map only
 * covers about 340 m around the aircraft (Lighting.tsx), so trees further out
 * would be drawn into it for nothing.
 */
const SHADOW_TREE_RADIUS = 350

const _dir = new Vector3()

/**
 * Instanced trees streamed by tile around the camera, within
 * profile.treeViewDistance, placed deterministically on the shared sampler.
 * Tiles behind the camera are left out, and only the trees near the camera
 * cast shadows (a separate set of meshes, so nothing is drawn twice).
 */
export function TerrainTrees({ terrain, profile }: { terrain: TerrainSampler; profile: QualityProfile }) {
  const { treeDensity, treeViewDistance, shadows } = profile

  const res = useMemo(() => {
    const geometries = [conifer(), broadleaf(), poplar()]
    const material = new MeshLambertMaterial({ vertexColors: true })
    // Room for every tile in view at full forest cover.
    const reach = treeViewDistance + TREE_TILE
    const capacity = Math.ceil((treeDensity * Math.PI * reach * reach * 1.15) / 1e6) + 64
    // Twice the average for the shadow casters: one dense forest can fill the whole circle.
    const nearCapacity = Math.ceil((treeDensity * Math.PI * SHADOW_TREE_RADIUS ** 2 * 2) / 1e6) + 64
    const build = (g: BufferGeometry, name: string, size: number, castShadow: boolean) => {
      const mesh = new InstancedMesh(g, material, size)
      mesh.name = name
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.setColorAt(0, new Color(1, 1, 1))
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.castShadow = castShadow
      mesh.receiveShadow = false
      return mesh
    }
    const near = geometries.map((g, i) => build(g, `trees-near-${i}`, nearCapacity, shadows))
    const far = geometries.map((g, i) => build(g, `trees-${i}`, capacity, false))
    return { geometries, material, near, far, meshes: [...near, ...far], capacity, nearCapacity }
  }, [treeDensity, treeViewDistance, shadows])

  const state = useMemo(
    () => ({
      tiles: new Map<string, TreeTile & { used: number }>(),
      wanted: [] as [number, number][],
      shown: '',
      lastX: Infinity,
      lastZ: Infinity,
      frame: 0,
      lastWrite: -Infinity,
      dirty: true,
      density: treeDensity,
      view: null as TreeView | null,
    }),
    [treeDensity],
  )

  useEffect(
    () => () => {
      for (const m of res.meshes) m.dispose()
      for (const g of res.geometries) g.dispose()
      res.material.dispose()
      state.tiles.clear()
    },
    [res, state],
  )

  useFrame(({ camera }) => {
    state.frame++
    const cx = camera.position.x
    const cz = camera.position.z
    const r = treeViewDistance

    // Rewrite the instances when the camera turns, so the culled set follows the view.
    camera.getWorldDirection(_dir)
    const cam = camera as PerspectiveCamera
    const view = treeViewFor(cx, cz, _dir.x, _dir.y, _dir.z, cam.fov ?? 65, cam.aspect ?? 1)
    if (!state.view || treeViewTurned(state.view, view)) {
      state.view = view
      state.dirty = true
    }

    // Wanted tiles, nearest first, when the camera has moved.
    if ((cx - state.lastX) ** 2 + (cz - state.lastZ) ** 2 > RESELECT_DISTANCE * RESELECT_DISTANCE) {
      state.lastX = cx
      state.lastZ = cz
      const t0x = Math.floor((cx - r) / TREE_TILE)
      const t1x = Math.floor((cx + r) / TREE_TILE)
      const t0z = Math.floor((cz - r) / TREE_TILE)
      const t1z = Math.floor((cz + r) / TREE_TILE)
      const list: [number, number, number][] = []
      for (let tz = t0z; tz <= t1z; tz++) {
        for (let tx = t0x; tx <= t1x; tx++) {
          const px = Math.max(tx * TREE_TILE, Math.min(cx, (tx + 1) * TREE_TILE))
          const pz = Math.max(tz * TREE_TILE, Math.min(cz, (tz + 1) * TREE_TILE))
          const d2 = (px - cx) ** 2 + (pz - cz) ** 2
          if (d2 <= r * r) list.push([tx, tz, d2])
        }
      }
      list.sort((a, b) => a[2] - b[2])
      state.wanted = list.map(([tx, tz]) => [tx, tz])
      state.view = view
      state.dirty = true
    }

    // Place missing tiles within a small time budget.
    const start = performance.now()
    let missing = false
    for (const [tx, tz] of state.wanted) {
      const key = `${tx}:${tz}`
      if (state.tiles.has(key)) continue
      if (performance.now() - start > TILE_BUDGET_MS) {
        missing = true
        break
      }
      state.tiles.set(key, { ...placeTreeTile(terrain, tx, tz, state.density), used: state.frame })
      state.dirty = true
    }

    // While tiles are still loading, refresh the instances every few frames only.
    if (!state.dirty || (missing && state.frame - state.lastWrite < 8)) return
    state.dirty = false
    state.lastWrite = state.frame

    // Rewrite the instance buffers from the ready wanted tiles in view.
    const counts = new Array<number>(TREE_TYPE_COUNT).fill(0)
    const nearCounts = new Array<number>(TREE_TYPE_COUNT).fill(0)
    const shadowR2 = SHADOW_TREE_RADIUS * SHADOW_TREE_RADIUS
    for (const [tx, tz] of state.wanted) {
      const tile = state.tiles.get(`${tx}:${tz}`)
      if (!tile) continue
      tile.used = state.frame
      if (state.view && !treeTileInView(state.view, tx, tz)) continue
      for (let t = 0; t < TREE_TYPE_COUNT; t++) {
        const src = tile.trees[t]
        for (let k = 0; k < src.length; k += TREE_STRIDE) {
          // Only trees within the view distance (tiles reach a little beyond it).
          if ((src[k] - state.lastX) ** 2 + (src[k + 2] - state.lastZ) ** 2 > r * r) continue
          const near = (src[k] - cx) ** 2 + (src[k + 2] - cz) ** 2 <= shadowR2
          const mesh = near ? res.near[t] : res.far[t]
          const used = near ? nearCounts : counts
          if (used[t] >= (near ? res.nearCapacity : res.capacity)) continue
          const m = mesh.instanceMatrix.array as Float32Array
          const col = mesh.instanceColor!.array as Float32Array
          const i = used[t]++
          const rot = src[k + 3]
          const sw = src[k + 4]
          const sh = src[k + 5]
          const c = Math.cos(rot)
          const s = Math.sin(rot)
          const o = i * 16
          m[o] = c * sw
          m[o + 1] = 0
          m[o + 2] = -s * sw
          m[o + 3] = 0
          m[o + 4] = 0
          m[o + 5] = sh
          m[o + 6] = 0
          m[o + 7] = 0
          m[o + 8] = s * sw
          m[o + 9] = 0
          m[o + 10] = c * sw
          m[o + 11] = 0
          m[o + 12] = src[k]
          m[o + 13] = src[k + 1]
          m[o + 14] = src[k + 2]
          m[o + 15] = 1
          const tint = src[k + 6]
          col[i * 3] = tint
          col[i * 3 + 1] = tint
          col[i * 3 + 2] = tint
        }
      }
    }
    for (let t = 0; t < TREE_TYPE_COUNT; t++) {
      for (const [mesh, n] of [
        [res.near[t], nearCounts[t]],
        [res.far[t], counts[t]],
      ] as const) {
        mesh.count = n
        mesh.instanceMatrix.clearUpdateRanges()
        mesh.instanceMatrix.addUpdateRange(0, n * 16)
        mesh.instanceMatrix.needsUpdate = true
        const ic = mesh.instanceColor!
        ic.clearUpdateRanges()
        ic.addUpdateRange(0, n * 3)
        ic.needsUpdate = true
      }
    }

    // Bound the tile cache.
    if (state.tiles.size > TILE_CACHE) {
      const old = [...state.tiles.entries()].sort((a, b) => a[1].used - b[1].used)
      for (let i = 0; i < old.length - TILE_CACHE; i++) state.tiles.delete(old[i][0])
    }
  })

  return (
    <>
      {res.meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </>
  )
}
