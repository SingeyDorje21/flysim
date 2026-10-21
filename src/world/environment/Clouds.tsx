import { useEffect, useMemo } from 'react'
import { InstancedMesh, MeshLambertMaterial, Object3D, SphereGeometry } from 'three'
import { WORLD } from '../../config/world'
import { mulberry32 } from '../util/random'

const PUFFS_PER_CLOUD = 7

/** Deterministic cloud puffs between 600 and 1500 m, as a single instanced mesh. */
export function Clouds({ count }: { count: number }) {
  const resources = useMemo(() => {
    const geometry = new SphereGeometry(1, 14, 10)
    const material = new MeshLambertMaterial({ color: 0xffffff, emissive: 0x8394a8, emissiveIntensity: 0.55 })
    const mesh = new InstancedMesh(geometry, material, count * PUFFS_PER_CLOUD)
    const rnd = mulberry32(WORLD.seed ^ 0xc10d)
    const d = new Object3D()
    const span = WORLD.terrainSize * 0.65
    let k = 0
    for (let c = 0; c < count; c++) {
      const cx = (rnd() * 2 - 1) * span
      const cz = (rnd() * 2 - 1) * span
      const cy = 600 + rnd() * 900
      const size = 0.7 + rnd() * 0.9
      for (let p = 0; p < PUFFS_PER_CLOUD; p++) {
        const r = (90 + rnd() * 120) * size
        d.position.set(cx + (rnd() * 2 - 1) * 220 * size, cy + (rnd() - 0.4) * 50 * size, cz + (rnd() * 2 - 1) * 160 * size)
        d.scale.set(r * 1.3, r * 0.5, r)
        d.updateMatrix()
        mesh.setMatrixAt(k++, d.matrix)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    return { mesh, geometry, material }
  }, [count])

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
