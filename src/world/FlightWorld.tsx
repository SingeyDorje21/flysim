import { QUALITY_PROFILES } from '../config/quality'
import { useMultiplayerStore } from '../state/multiplayerStore'
import { RemoteAircraft } from './remote/RemoteAircraft'
import { AircraftModel } from './aircraft/AircraftModel'
import { Airports } from './airport/Airports'
import { CameraRig } from './camera/CameraRig'
import { Clouds } from './environment/Clouds'
import { environmentFor } from './environment/constants'
import { Lighting } from './environment/Lighting'
import { Sky } from './environment/Sky'
import { Water } from './environment/Water'
import { Rings } from './rings/Rings'
import { TerrainSystem } from './terrain/TerrainSystem'
import type { FlightWorldProps } from './types'

/**
 * The whole 3D scene: sky, lighting, streamed terrain and trees, water,
 * airport, clouds, rings, aircraft and camera. Rendering only: it consumes
 * the physics state.
 *
 * The content is keyed on the quality level, so a quality change unmounts the
 * old subtree (each part disposes its GPU resources in an effect cleanup) and
 * builds a fresh one.
 */
export function FlightWorld(props: FlightWorldProps) {
  return <WorldContent key={props.quality} {...props} />
}

function WorldContent({
  renderState,
  terrain,
  quality,
  cameraMode,
  rings,
  mouseSensitivity,
  timeOfDay,
}: FlightWorldProps) {
  const profile = QUALITY_PROFILES[quality]
  const env = environmentFor(timeOfDay)
  // Multiplayer only: the roster is empty in single player, so nothing extra mounts.
  const hasOtherPilots = useMultiplayerStore((s) => s.roster.length > 1)
  return (
    <>
      <fog attach="fog" args={[env.fogColor, profile.fogFar * 0.25, profile.fogFar]} />

      {/* The camera rig runs first so everything that follows the camera sees its final pose. */}
      <CameraRig renderState={renderState} terrain={terrain} mode={cameraMode} mouseSensitivity={mouseSensitivity} />
      <Sky timeOfDay={timeOfDay} />
      <Lighting renderState={renderState} profile={profile} timeOfDay={timeOfDay} />

      <TerrainSystem terrain={terrain} profile={profile} />
      <Water profile={profile} timeOfDay={timeOfDay} />
      <Airports shadows={profile.shadows} />
      <Clouds profile={profile} timeOfDay={timeOfDay} />
      {rings && <Rings course={rings} />}
      <AircraftModel renderState={renderState} cameraMode={cameraMode} shadows={profile.shadows} />
      {hasOtherPilots && <RemoteAircraft terrain={terrain} shadows={profile.shadows} />}
    </>
  )
}
