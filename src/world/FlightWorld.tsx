import { QUALITY_PROFILES } from '../config/quality'
import { AircraftModel } from './aircraft/AircraftModel'
import { Airport } from './airport/Airport'
import { CameraRig } from './camera/CameraRig'
import { HORIZON_COLOR } from './environment/constants'
import { Clouds } from './environment/Clouds'
import { Lighting } from './environment/Lighting'
import { Sky } from './environment/Sky'
import { Trees } from './environment/Trees'
import { Rings } from './rings/Rings'
import { Ocean } from './terrain/Ocean'
import { TerrainMesh } from './terrain/TerrainMesh'
import type { FlightWorldProps } from './types'

/**
 * The whole 3D scene: sky, lighting, terrain, ocean, airport, trees, clouds,
 * rings, aircraft and camera. Rendering only: it consumes the physics state.
 *
 * The content is keyed on the quality level, so a quality change unmounts the
 * old subtree (each part disposes its geometries, materials and textures in
 * an effect cleanup) and builds a fresh one.
 */
export function FlightWorld(props: FlightWorldProps) {
  return <WorldContent key={props.quality} {...props} />
}

function WorldContent({ renderState, terrain, quality, cameraMode, rings, mouseSensitivity }: FlightWorldProps) {
  const profile = QUALITY_PROFILES[quality]
  return (
    <>
      <fog attach="fog" args={[HORIZON_COLOR, profile.fogFar * 0.2, profile.fogFar]} />

      {/* The camera rig runs first so everything that follows the camera sees its final pose. */}
      <CameraRig renderState={renderState} terrain={terrain} mode={cameraMode} mouseSensitivity={mouseSensitivity} />
      <Sky />
      <Lighting renderState={renderState} profile={profile} />

      <TerrainMesh segments={profile.terrainSegments} shadows={profile.shadows} />
      <Ocean />
      <Airport shadows={profile.shadows} />
      <Trees count={profile.treeCount} terrain={terrain} shadows={profile.shadows} />
      <Clouds count={profile.cloudCount} />
      {rings && <Rings course={rings} />}
      <AircraftModel renderState={renderState} cameraMode={cameraMode} shadows={profile.shadows} />
    </>
  )
}
