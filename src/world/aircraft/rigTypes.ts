import type { Group, Object3D, Vector3 } from 'three'
import type { AircraftId } from '../../config/aircraftCatalog'
import type { CameraMode } from '../../game/types'
import type { AircraftRenderState } from '../../simulation/types'

export type LegName = 'nose' | 'mainLeft' | 'mainRight'

/** One wheel, recorded so tests can check wheel bottoms against the gear contract. */
export interface RigWheel {
  leg: LegName
  /** Object whose world matrix carries the wheel (identity when down). */
  group: Object3D
  /** Wheel centre in `group` local space with the gear down. */
  centre: Vector3
  radius: number
  halfWidth: number
}

/** A built, animatable aircraft model. Pure three.js: no React. */
export interface AircraftRig {
  id: AircraftId
  /** Add to the scene; update() writes its pose. */
  root: Group
  update(rs: AircraftRenderState, cameraMode: CameraMode, dt: number): void
  dispose(): void
  wheels: RigWheel[]
  /** Is this body-frame point inside the fuselage or wing volume? */
  insideEnvelope(p: Vector3): boolean
}
