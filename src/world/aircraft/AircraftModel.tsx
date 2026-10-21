import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group } from 'three'
import type { AircraftId } from '../../config/aircraftCatalog'
import type { CameraMode } from '../../game/types'
import type { AircraftRenderState } from '../../simulation/types'
import { createAircraftRig } from './index'
import type { AircraftRig } from './rigTypes'

interface Current {
  id: AircraftId
  shadows: boolean
  rig: AircraftRig
}

/**
 * Draws the aircraft named by renderState.aircraftId. The render state is
 * mutated in place every frame (no React re-render), so the model is swapped
 * inside useFrame: the old rig is disposed when the id (or shadow setting)
 * changes, and on unmount.
 */
export function AircraftModel({
  renderState,
  cameraMode,
  shadows,
}: {
  renderState: AircraftRenderState
  cameraMode: CameraMode
  shadows: boolean
}) {
  const holder = useMemo(() => new Group(), [])
  const current = useRef<Current | null>(null)

  useEffect(
    () => () => {
      const c = current.current
      if (c) {
        holder.remove(c.rig.root)
        c.rig.dispose()
        current.current = null
      }
    },
    [holder],
  )

  useFrame((_, dt) => {
    const rs = renderState
    let c = current.current
    if (!c || c.id !== rs.aircraftId || c.shadows !== shadows) {
      if (c) {
        holder.remove(c.rig.root)
        c.rig.dispose()
      }
      c = { id: rs.aircraftId, shadows, rig: createAircraftRig(rs.aircraftId, shadows) }
      holder.add(c.rig.root)
      current.current = c
    }
    c.rig.update(rs, cameraMode, dt)
  })

  return <primitive object={holder} />
}
