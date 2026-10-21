import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { InstancedMesh, MeshLambertMaterial, Object3D, SphereGeometry } from 'three'
import type { QualityProfile } from '../../config/quality'
import type { TimeOfDay } from '../types'
import { environmentFor } from './constants'
import { generateClouds } from './envMath'

/** Clouds are grouped into square cells of this size (m), each one instanced mesh. */
const CELL = 20000
/** Half the diagonal of a cell, plus cloud extent: a cell is skipped when even its nearest edge is out of range. */
const CELL_RADIUS = CELL * 0.72

interface Cell {
  mesh: InstancedMesh
  cx: number
  cz: number
}

/**
 * Deterministic soft cloud puffs between 800 and 2500 m over the whole world.
 * Clouds are split into 20 km cells (one instanced mesh each), so the
 * frustum culls cells off-screen and cells beyond the fog distance are hidden.
 */
export function Clouds({ profile, timeOfDay }: { profile: QualityProfile; timeOfDay: TimeOfDay }) {
  const camera = useThree((s) => s.camera)
  const count = profile.cloudCount
  const cullDistance = profile.fogFar * 1.05

  const resources = useMemo(() => {
    const geometry = new SphereGeometry(1, 14, 10)
    const material = new MeshLambertMaterial({ color: 0xffffff })
    const clouds = generateClouds(count)

    const byCell = new Map<string, typeof clouds>()
    for (const c of clouds) {
      const key = `${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`
      const list = byCell.get(key)
      if (list) list.push(c)
      else byCell.set(key, [c])
    }

    const d = new Object3D()
    const cells: Cell[] = []
    for (const [key, list] of byCell) {
      const [ix, iz] = key.split(',').map(Number)
      const mesh = new InstancedMesh(geometry, material, list.length * list[0].puffs.length)
      let k = 0
      for (const c of list) {
        for (const p of c.puffs) {
          d.position.set(p.x, p.y, p.z)
          d.scale.set(p.rx, p.ry, p.rz)
          d.updateMatrix()
          mesh.setMatrixAt(k++, d.matrix)
        }
      }
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      cells.push({ mesh, cx: (ix + 0.5) * CELL, cz: (iz + 0.5) * CELL })
    }
    return { geometry, material, cells }
  }, [count])

  useEffect(() => {
    const look = environmentFor(timeOfDay)
    resources.material.color.set(look.cloudColor)
    resources.material.emissive.set(look.cloudShade)
    resources.material.emissiveIntensity = look.cloudShadeIntensity
  }, [resources, timeOfDay])

  useEffect(
    () => () => {
      resources.geometry.dispose()
      resources.material.dispose()
      for (const c of resources.cells) c.mesh.dispose()
    },
    [resources],
  )

  useFrame(() => {
    const p = camera.position
    const reach = cullDistance + CELL_RADIUS
    const reach2 = reach * reach
    for (const c of resources.cells) {
      const dx = c.cx - p.x
      const dz = c.cz - p.z
      c.mesh.visible = dx * dx + dz * dz < reach2
    }
  })

  return (
    <group>
      {resources.cells.map((c, i) => (
        <primitive key={i} object={c.mesh} />
      ))}
    </group>
  )
}
