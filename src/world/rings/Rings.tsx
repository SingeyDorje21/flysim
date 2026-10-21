import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, Mesh, MeshBasicMaterial, TorusGeometry } from 'three'
import type { RingCourseView } from '../../game/types'

/**
 * One torus per ring, perpendicular to the ring heading. The next ring is
 * bright and pulsing, later rings are semi-transparent, passed rings hidden.
 * nextIndex is read every frame (it is mutated in place by the session).
 */
export function Rings({ course }: { course: RingCourseView }) {
  const meshes = useRef<(Mesh | null)[]>([])
  const groupRef = useRef<Group>(null)
  const camera = useThree((st) => st.camera)

  const res = useMemo(() => {
    const geometries = course.rings.map((r) => new TorusGeometry(r.radius, Math.max(0.9, r.radius * 0.06), 14, 56))
    const nextMat = new MeshBasicMaterial({ color: 0xffd23a, fog: false, toneMapped: false })
    const futureMat = new MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.35, depthWrite: false })
    return { geometries, nextMat, futureMat }
  }, [course])

  useEffect(
    () => () => {
      res.geometries.forEach((g) => g.dispose())
      res.nextMat.dispose()
      res.futureMat.dispose()
    },
    [res],
  )

  useFrame(({ clock }) => {
    const next = course.nextIndex
    const t = clock.elapsedTime
    const pulse = 0.5 + 0.5 * Math.sin(t * 6)
    res.nextMat.color.setRGB(1, 0.72 + 0.2 * pulse, 0.12 + 0.3 * pulse)
    for (let i = 0; i < course.rings.length; i++) {
      const m = meshes.current[i]
      if (!m) continue
      if (i < next) {
        m.visible = false
      } else if (i === next) {
        m.visible = true
        m.material = res.nextMat
        // Enlarge the next ring with distance so it stays visible from afar (exact size inside 500 m).
        const ring = course.rings[i]
        const dx = ring.position.x - camera.position.x
        const dy = ring.position.y - camera.position.y
        const dz = ring.position.z - camera.position.z
        const far = Math.sqrt(dx * dx + dy * dy + dz * dz) / 500
        const s = (1 + 0.06 * pulse) * (far < 1 ? 1 : far > 6 ? 6 : far)
        m.scale.set(s, s, s)
      } else {
        m.visible = true
        m.material = res.futureMat
        m.scale.set(1, 1, 1)
      }
    }
  })

  return (
    <group ref={groupRef}>
      {course.rings.map((r, i) => (
        <mesh
          key={r.id}
          ref={(m) => {
            meshes.current[i] = m
          }}
          geometry={res.geometries[i]}
          material={res.futureMat}
          position={[r.position.x, r.position.y, r.position.z]}
          // The torus axis is local +Z; rotate it onto the travel direction
          // (sin h, 0, -cos h) => yaw = PI - heading.
          rotation={[0, Math.PI - (r.headingDeg * Math.PI) / 180, 0]}
          renderOrder={2}
        />
      ))}
    </group>
  )
}
