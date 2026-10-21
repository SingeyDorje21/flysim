import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { DirectionalLight, Object3D } from 'three'
import type { AircraftRenderState } from '../../simulation/types'
import type { QualityProfile } from '../../config/quality'
import { SUN_DIR } from './constants'

const SHADOW_EXTENT = 170 // half-size of the shadow frustum (~340 m)
const SHADOW_SNAP = 4 // world snap (m) for the light target, limits shimmer

/**
 * Sun + sky fill light. The sun's shadow camera follows the aircraft
 * (about 300 m of coverage). Remounted per quality (via key) so the shadow
 * map is rebuilt and the old one disposed.
 */
export function Lighting({ renderState, profile }: { renderState: AircraftRenderState; profile: QualityProfile }) {
  const { light, target } = useMemo(() => {
    const l = new DirectionalLight(0xfff1dc, 2.6)
    const t = new Object3D()
    l.target = t
    l.castShadow = profile.shadows
    if (profile.shadows) {
      l.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize)
      const cam = l.shadow.camera
      cam.left = -SHADOW_EXTENT
      cam.right = SHADOW_EXTENT
      cam.top = SHADOW_EXTENT
      cam.bottom = -SHADOW_EXTENT
      cam.near = 10
      cam.far = 1500
      cam.updateProjectionMatrix()
      l.shadow.bias = -0.0004
      l.shadow.normalBias = 0.6
    }
    l.position.copy(SUN_DIR).multiplyScalar(700)
    return { light: l, target: t }
  }, [profile.shadows, profile.shadowMapSize])

  useEffect(
    () => () => {
      light.shadow.map?.dispose()
      light.dispose()
    },
    [light],
  )

  useFrame(() => {
    const p = renderState.position
    const tx = Math.round(p.x / SHADOW_SNAP) * SHADOW_SNAP
    const ty = Math.round(p.y / SHADOW_SNAP) * SHADOW_SNAP
    const tz = Math.round(p.z / SHADOW_SNAP) * SHADOW_SNAP
    target.position.set(tx, ty, tz)
    light.position.set(tx + SUN_DIR.x * 700, ty + SUN_DIR.y * 700, tz + SUN_DIR.z * 700)
    target.updateMatrixWorld()
  })

  return (
    <>
      <hemisphereLight args={[0xcfe4ff, 0x6c7a55, 1.15]} />
      <primitive object={light} />
      <primitive object={target} />
    </>
  )
}
