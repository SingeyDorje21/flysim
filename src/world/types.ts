/**
 * Contract between the app shell and the 3D world. Owned by the orchestrator;
 * src/world/FlightWorld.tsx implements `FlightWorld(props: FlightWorldProps)`.
 */

import type { Quality } from '../config/quality'
import type { CameraMode, RingCourseView } from '../game/types'
import type { AircraftRenderState, TerrainSampler } from '../simulation/types'

export interface FlightWorldProps {
  /** Mutated in place every frame by the simulation driver before world useFrame callbacks. Read only. */
  renderState: AircraftRenderState
  /** Same sampler instance the physics uses. */
  terrain: TerrainSampler
  quality: Quality
  cameraMode: CameraMode
  /** Ring course state in ring mode, otherwise null. nextIndex is mutated in place. */
  rings: RingCourseView | null
  /** Free-look mouse sensitivity multiplier (settings). */
  mouseSensitivity: number
  /** Sun position and sky/fog/water colours. */
  timeOfDay: TimeOfDay
}

export type TimeOfDay = 'morning' | 'noon' | 'evening'

export const TIMES_OF_DAY: readonly TimeOfDay[] = ['morning', 'noon', 'evening']
