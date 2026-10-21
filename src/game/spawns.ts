/**
 * Where each flight starts, for the chosen airport, runway end and aircraft.
 * Free Flight and Take-off start lined up on the runway; the Landing
 * Challenge starts on a 3 degree final to it; the Ring Course is fixed.
 */

import { getAircraft, type AircraftId } from '../config/aircraftCatalog'
import { HOME_AIRPORT_ID } from '../config/airports'
import { SPAWNS } from '../config/world'
import type { SpawnState } from '../simulation/types'
import { GLIDE_SLOPE_DEG, getRunwayEnd, headingVector } from './airportGeometry'
import { techniqueFor } from './technique'
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

export function spawnFor(mode: GameMode, place: FlightPlace, aircraftId: AircraftId = 'trainer'): SpawnState {
  // Lessons fly the matching exercise at the aircraft's own lesson airport.
  if (mode === 'lessonTakeoff') return spawnFor('takeoff', techniqueFor(aircraftId).lessonPlace, aircraftId)
  if (mode === 'lessonLanding') return spawnFor('landing', techniqueFor(aircraftId).lessonPlace, aircraftId)
  const ac = getAircraft(aircraftId)
  const jet = ac.engineKind !== 'piston'
  if (mode === 'rings') {
    // Jets fly the course clean and faster; the trainer keeps its original spawn.
    if (!jet) return SPAWNS.rings
    return { ...SPAWNS.rings, airspeed: Math.max(ac.speeds.approach * 1.6, 100), throttle: 0.6, gearUp: true }
  }
  const end = getRunwayEnd(place.airportId, place.runwayEnd)
  const d = headingVector(end.headingDeg)
  if (mode === 'landing') {
    const toAim = FINAL_DISTANCE + Math.hypot(end.aimPoint.x - end.threshold.x, end.aimPoint.z - end.threshold.z)
    return {
      ...SPAWNS.landing,
      // Fly-by-wire jets read pitchDeg as the flight-path angle, so they start
      // established on the glide path; the trainer keeps a level nose attitude.
      pitchDeg: jet ? -GLIDE_SLOPE_DEG : SPAWNS.landing.pitchDeg,
      airspeed: ac.speeds.approach,
      flaps: ac.landingFlaps,
      throttle: jet ? 0.45 : SPAWNS.landing.throttle,
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
    // The trainer starts Free Flight clean, as before; everything else with take-off flaps.
    flaps: mode === 'freeFlight' && !jet ? base.flaps : ac.takeoffFlaps,
    position: {
      x: end.threshold.x + d.x * LINEUP_OFFSET,
      y: end.airport.elevation,
      z: end.threshold.z + d.z * LINEUP_OFFSET,
    },
    headingDeg: end.headingDeg,
  }
}
