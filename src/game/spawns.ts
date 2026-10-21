/**
 * Where each flight starts, for the chosen airport and runway end.
 * Free Flight and Take-off start lined up on the runway; the Landing
 * Challenge starts on a 3 degree final to it; the Ring Course is fixed.
 */

import { HOME_AIRPORT_ID } from '../config/airports'
import { SPAWNS } from '../config/world'
import type { SpawnState } from '../simulation/types'
import { GLIDE_SLOPE_DEG, getRunwayEnd, headingVector } from './airportGeometry'
import type { GameMode } from './types'

export interface FlightPlace {
  airportId: string
  /** Runway end designator, e.g. "36". */
  runwayEnd: string
}

export const HOME_PLACE: FlightPlace = { airportId: HOME_AIRPORT_ID, runwayEnd: '36' }

/** Distance down the runway from the threshold where take-offs start (m). */
const LINEUP_OFFSET = 60
/** Distance before the threshold where the landing approach starts (m). */
const FINAL_DISTANCE = 3200

export function spawnFor(mode: GameMode, place: FlightPlace): SpawnState {
  if (mode === 'rings') return SPAWNS.rings
  const end = getRunwayEnd(place.airportId, place.runwayEnd)
  const d = headingVector(end.headingDeg)
  if (mode === 'landing') {
    const toAim = FINAL_DISTANCE + Math.hypot(end.aimPoint.x - end.threshold.x, end.aimPoint.z - end.threshold.z)
    return {
      ...SPAWNS.landing,
      position: {
        x: end.threshold.x - d.x * FINAL_DISTANCE,
        y: end.airport.elevation + Math.round(toAim * Math.tan((GLIDE_SLOPE_DEG * Math.PI) / 180)),
        z: end.threshold.z - d.z * FINAL_DISTANCE,
      },
      headingDeg: end.headingDeg,
    }
  }
  const base = mode === 'takeoff' ? SPAWNS.takeoff : SPAWNS.freeFlight
  return {
    ...base,
    position: {
      x: end.threshold.x + d.x * LINEUP_OFFSET,
      y: end.airport.elevation,
      z: end.threshold.z + d.z * LINEUP_OFFSET,
    },
    headingDeg: end.headingDeg,
  }
}
