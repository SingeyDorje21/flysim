/**
 * Panel and hotkey steps for the autopilot targets, in the pilot's units:
 * 5 kt / 10 km/h, 5 degrees, 500 ft / 100 m, 500 ft/min / 1 m/s. A value
 * off the step grid (a target that followed the aircraft) snaps to the
 * next grid line in the direction of the step.
 */

import type { Units } from '../state/gameStore'
import type { TargetField } from './types'

const KT = 0.514444
const FT = 0.3048

/** [SI per display unit, step in display units] for each field and unit system. */
const STEPS: Record<TargetField, Record<Units, readonly [number, number]>> = {
  speed: { imperial: [KT, 5], metric: [1 / 3.6, 10] },
  headingDeg: { imperial: [1, 5], metric: [1, 5] },
  altitude: { imperial: [FT, 500], metric: [1, 100] },
  verticalSpeed: { imperial: [FT / 60, 500], metric: [1, 1] },
}

/** Selected altitude ceiling (m, about 65,000 ft). */
export const MAX_SELECTED_ALTITUDE = 20000
/** Vertical speed selection limit (m/s, 6,000 ft/min). */
export const MAX_SELECTED_VS = 30.48

const EPS = 1e-6

export function stepTarget(field: TargetField, value: number, dir: 1 | -1, units: Units): number {
  const [perUnit, step] = STEPS[field][units]
  const display = value / perUnit
  const next =
    dir > 0 ? Math.floor(display / step + EPS) * step + step : Math.ceil(display / step - EPS) * step - step
  let si = next * perUnit
  if (field === 'headingDeg') si = ((si % 360) + 360) % 360
  else if (field === 'altitude') si = Math.min(MAX_SELECTED_ALTITUDE, Math.max(0, si))
  else if (field === 'verticalSpeed') si = Math.min(MAX_SELECTED_VS, Math.max(-MAX_SELECTED_VS, si))
  else si = Math.max(0, si)
  return si
}
