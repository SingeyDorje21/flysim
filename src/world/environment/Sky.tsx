import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  Color,
  Group,
  MeshBasicMaterial,
  SphereGeometry,
} from 'three'
import { HORIZON_COLOR, SKY_RADIUS, SUN_DIR, ZENITH_COLOR } from './constants'

/**
 * Gradient sky dome plus sun disc and glow. Drawn first with depth test off,
 * and re-centred on the camera every frame (place after the camera rig).
 */
export function Sky() {
  const ref = useRef<Group>(null)
  const camera = useThree((s) => s.camera)

  const resources = useMemo(() => {
    const dome = new SphereGeometry(SKY_RADIUS, 32, 20)
    const pos = dome.getAttribute('position')
    const colors = new Float32Array(pos.count * 3)
    const horizon = new Color(HORIZON_COLOR)
    const zenith = new Color(ZENITH_COLOR)
    const below = new Color(HORIZON_COLOR).multiplyScalar(0.92)
    const c = new Color()
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / SKY_RADIUS
      if (y >= 0) {
        // Stay pale near the horizon, deepen towards the zenith.
        c.copy(horizon).lerp(zenith, Math.pow(y, 0.55))
      } else {
        c.copy(horizon).lerp(below, Math.min(1, -y * 3))
      }
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    dome.setAttribute('color', new BufferAttribute(colors, 3))
    const domeMat = new MeshBasicMaterial({
      vertexColors: true,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })

    const sunGeo = new SphereGeometry(SKY_RADIUS * 0.028, 20, 12)
    const sunMat = new MeshBasicMaterial({ color: 0xfff6dc, fog: false, depthTest: false, depthWrite: false, toneMapped: false })
    const glowGeo = new SphereGeometry(SKY_RADIUS * 0.12, 20, 12)
    // Additive blending with transparent=false keeps the glow in the opaque
    // render list, so it is drawn before (and covered by) the terrain.
    const glowMat = new MeshBasicMaterial({
      color: 0xffe9b0,
      fog: false,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: AdditiveBlending,
      opacity: 0.18,
    })
    return { dome, domeMat, sunGeo, sunMat, glowGeo, glowMat }
  }, [])

  useEffect(
    () => () => {
      resources.dome.dispose()
      resources.domeMat.dispose()
      resources.sunGeo.dispose()
      resources.sunMat.dispose()
      resources.glowGeo.dispose()
      resources.glowMat.dispose()
    },
    [resources],
  )

  useFrame(() => {
    if (ref.current) ref.current.position.copy(camera.position)
  })

  const sunPos = SUN_DIR.clone().multiplyScalar(SKY_RADIUS * 0.9)
  return (
    <group ref={ref}>
      <mesh geometry={resources.dome} material={resources.domeMat} renderOrder={-1000} frustumCulled={false} />
      <mesh geometry={resources.glowGeo} material={resources.glowMat} position={sunPos} renderOrder={-999} frustumCulled={false} />
      <mesh geometry={resources.sunGeo} material={resources.sunMat} position={sunPos} renderOrder={-998} frustumCulled={false} />
    </group>
  )
}
