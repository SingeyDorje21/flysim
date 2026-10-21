import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { DirectionalLight, Object3D } from 'three'
import type { AircraftRenderState } from '../../simulation/types'
import type { QualityProfile } from '../../config/quality'
import type { TimeOfDay } from '../types'
import { environmentFor } from './constants'

const SHADOW_EXTENT = 170 // half-size of the shadow frustum (~340 m)
const SHADOW_SNAP = 4 // world snap (m) for the light target, limits shimmer
const SUN_DISTANCE = 700 // light sits this far from its target along the sun direction

interface LightingProps {
  renderState: AircraftRenderState
  profile: QualityProfile
  timeOfDay: TimeOfDay
}

/**
 * Sun + sky fill light, coloured per time of day. The sun's shadow camera
 * follows the aircraft (about 300 m of coverage). Remounted per quality (via
 * key) so the shadow map is rebuilt and the old one disposed.
 */
export function Lighting({ renderState, profile, timeOfDay }: LightingProps) {
  const look = environmentFor(timeOfDay)

  const { light, target } = useMemo(() => {
    const l = new DirectionalLight(0xffffff, 1)
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
      cam.far = 1800
      cam.updateProjectionMatrix()
      l.shadow.bias = -0.0004
      l.shadow.normalBias = 0.6
    }
    return { light: l, target: t }
  }, [profile.shadows, profile.shadowMapSize])

  useEffect(() => {
    light.color.set(look.sunColor)
    light.intensity = look.sunIntensity
  }, [light, look])

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
    const s = look.sunDirection
    target.position.set(tx, ty, tz)
    light.position.set(tx + s.x * SUN_DISTANCE, ty + s.y * SUN_DISTANCE, tz + s.z * SUN_DISTANCE)
    target.updateMatrixWorld()
  })

  return (
    <>
      <hemisphereLight args={[look.hemiSkyColor, look.hemiGroundColor, look.hemiIntensity]} />
      <primitive object={light} />
      <primitive object={target} />
    </>
  )
}
