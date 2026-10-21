import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'

/** Large ocean plane at y = 0 that follows the camera horizontally. */
export function Ocean() {
  const ref = useRef<Mesh>(null)
  const camera = useThree((s) => s.camera)
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(90000, 90000)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        color: 0x1d6f9a,
        roughness: 0.28,
        metalness: 0.05,
        transparent: true,
        opacity: 0.86,
      }),
    [],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const m = ref.current
    if (!m) return
    m.position.x = camera.position.x
    m.position.z = camera.position.z
  })

  return <mesh ref={ref} geometry={geometry} material={material} position={[0, 0, 0]} renderOrder={1} frustumCulled={false} />
}
