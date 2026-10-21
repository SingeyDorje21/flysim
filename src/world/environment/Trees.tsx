import { useEffect, useMemo } from 'react'
import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { AIRPORT_FLAT_ZONE, WORLD } from '../../config/world'
import type { TerrainSampler } from '../../simulation/types'
import { fbm2 } from '../terrain/heightField'
import { mulberry32 } from '../util/random'

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

function buildTreeGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.35, 0.5, 3, 6)
  trunk.translate(0, 1.5, 0)
  const low = new ConeGeometry(3.2, 6.5, 8)
  low.translate(0, 5.6, 0)
  const high = new ConeGeometry(2.3, 5.5, 8)
  high.translate(0, 9.2, 0)
  const merged = mergeGeometries([paint(trunk, 0x5a3d26), paint(low, 0x2f6a35), paint(high, 0x3a7a3c)])
  trunk.dispose()
  low.dispose()
  high.dispose()
  return merged
}

const AIRPORT_MARGIN = 90

/** Instanced trees on grass, gentle slopes and mid elevations, away from the airport and flight lanes. */
export function Trees({ count, terrain, shadows }: { count: number; terrain: TerrainSampler; shadows: boolean }) {
  const resources = useMemo(() => {
    const geometry = buildTreeGeometry()
    const material = new MeshLambertMaterial({ vertexColors: true })
    const mesh = new InstancedMesh(geometry, material, count)
    const rnd = mulberry32(WORLD.seed ^ 0x7ee5)
    const d = new Object3D()
    const tint = new Color()
    let placed = 0
    let attempts = 0
    const maxAttempts = count * 60
    while (placed < count && attempts < maxAttempts) {
      attempts++
      // Denser near the middle of the island.
      const ang = rnd() * Math.PI * 2
      const rad = 250 + Math.pow(rnd(), 0.8) * 5200
      const x = Math.cos(ang) * rad
      const z = Math.sin(ang) * rad
      // Forest clusters.
      if (fbm2(x * 0.0011, z * 0.0011, 3, WORLD.seed + 91) < -0.05) continue
      if (
        x > AIRPORT_FLAT_ZONE.minX - AIRPORT_MARGIN &&
        x < AIRPORT_FLAT_ZONE.maxX + AIRPORT_MARGIN &&
        z > AIRPORT_FLAT_ZONE.minZ - AIRPORT_MARGIN &&
        z < AIRPORT_FLAT_ZONE.maxZ + AIRPORT_MARGIN
      )
        continue
      // Keep the approach / departure lanes clear.
      if (Math.abs(x) < 220 && (z > 1000 || z < -1000) && Math.abs(z) < 6200) continue
      if (terrain.surfaceAt(x, z) !== 'grass') continue
      const h = terrain.heightAt(x, z)
      if (h < 4 || h > 380) continue
      const s = 5
      const slope = Math.max(
        Math.abs(terrain.heightAt(x + s, z) - h),
        Math.abs(terrain.heightAt(x - s, z) - h),
        Math.abs(terrain.heightAt(x, z + s) - h),
        Math.abs(terrain.heightAt(x, z - s) - h),
      )
      if (slope / s > 0.3) continue
      const scale = 0.7 + rnd() * 0.9
      d.position.set(x, h - 0.2, z)
      d.rotation.set(0, rnd() * Math.PI * 2, 0)
      d.scale.set(scale * (0.9 + rnd() * 0.25), scale, scale * (0.9 + rnd() * 0.25))
      d.updateMatrix()
      mesh.setMatrixAt(placed, d.matrix)
      tint.setScalar(0.72 + rnd() * 0.28)
      mesh.setColorAt(placed, tint)
      placed++
    }
    mesh.count = placed
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.castShadow = shadows
    mesh.receiveShadow = shadows
    return { mesh, geometry, material }
  }, [count, terrain, shadows])

  useEffect(
    () => () => {
      resources.geometry.dispose()
      resources.material.dispose()
      resources.mesh.dispose()
    },
    [resources],
  )

  return <primitive object={resources.mesh} />
}
