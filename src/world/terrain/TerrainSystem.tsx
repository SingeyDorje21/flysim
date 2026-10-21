import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import type { QualityProfile } from '../../config/quality'
import type { TerrainSampler } from '../../simulation/types'
import { TerrainStreamer } from './terrainStreamer'
import { TerrainTrees } from './TerrainTrees'
import { createTerrainMaterial } from './terrainMaterial'

/**
 * Streamed, level-of-detail terrain of the 100 km world plus its trees.
 * The finest level (within at least 1.5 km of the camera) is exactly the
 * WORLD.physicsGridStep grid that `terrain` (the shared sampler) describes,
 * so the ground drawn near the aircraft is the ground physics collides with.
 * Chunk geometry is built in Web Workers; see terrainStreamer.ts.
 */
export function TerrainSystem({ terrain, profile }: { terrain: TerrainSampler; profile: QualityProfile }) {
  const { terrainViewDistance, terrainLodBias, shadows } = profile
  const material = useMemo(() => createTerrainMaterial(), [])
  const root = useRef<Group>(null)
  const streamer = useRef<TerrainStreamer | null>(null)

  // Created in an effect (not a memo) so StrictMode's mount / unmount / mount
  // cycle gets a fresh streamer with live workers.
  useEffect(() => {
    const s = new TerrainStreamer({
      material,
      viewDistance: terrainViewDistance,
      lodBias: terrainLodBias,
      receiveShadow: shadows,
    })
    streamer.current = s
    const group = root.current
    group?.add(s.group)
    return () => {
      group?.remove(s.group)
      s.dispose()
      if (streamer.current === s) streamer.current = null
    }
  }, [material, terrainViewDistance, terrainLodBias, shadows])

  useEffect(() => () => material.dispose(), [material])

  // Default priority (0): runs after the camera rig, which is mounted earlier.
  useFrame(({ camera }) => {
    streamer.current?.update(camera.position.x, camera.position.y, camera.position.z)
  })

  return (
    <group ref={root} name="terrain-system">
      <TerrainTrees terrain={terrain} profile={profile} />
    </group>
  )
}
