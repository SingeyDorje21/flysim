/**
 * How to fly each aircraft's take-off and landing: speeds, pitch targets,
 * flap settings and flare height, derived from the aircraft catalog. Used by
 * the Flight School lessons, the flight assists and the Flight School screen.
 * Pure TS.
 */

import { getAircraft, type AircraftId } from '../config/aircraftCatalog'
import { getAirport } from '../config/airports'
import { runwayEnds } from './airportGeometry'
import type { FlightPlace } from './spawns'

const DEG = 180 / Math.PI

export interface Technique {
  aircraftId: AircraftId
  /** Rotation speed (m/s). */
  rotateSpeed: number
  /** Pitch on the ground at which the tail touches the runway (deg). */
  tailStrikePitchDeg: number
  /** Highest safe pitch while the wheels are on the ground (deg); the assist holds this. */
  maxGroundPitchDeg: number
  /** Pitch to rotate to for lift-off (deg). */
  rotatePitchDeg: number
  /** Pitch to hold in the initial climb (deg). */
  climbPitchDeg: number
  /** Final approach speed (m/s). */
  approachSpeed: number
  /** Flap lever settings (0..1). */
  takeoffFlaps: number
  landingFlaps: number
  /** Height above the runway to start the flare (m). */
  flareHeight: number
  /** Nose attitude to hold in the flare (deg). */
  flarePitchDeg: number
  retractableGear: boolean
  /** Reverse thrust available on the landing roll. */
  reverse: boolean
  /** Airport and runway the lessons use (long enough for this aircraft). */
  lessonPlace: FlightPlace
  /** One-line handling notes for the Flight School card. */
  notes: string[]
  /** Tail strike point relative to the main wheels: height above them and distance behind (m). */
  tailAboveMain: number
  tailBehindMain: number
  /** The traffic circuit flown in the circuit lesson. */
  circuit: CircuitPlan
}

/**
 * A left-hand traffic circuit around the lesson runway: climb out, turn left
 * onto crosswind, left again onto downwind (parallel to the runway, `offset`
 * to its left), left onto base `finalLength` before the threshold, and left
 * onto final. Sized from the turn radius at the circuit speed and 25 degrees
 * of bank, so even the A350 has room for each turn.
 */
export interface CircuitPlan {
  /** Circuit height above the field (m). */
  height: number
  /** Speed to fly the circuit legs at, clean (m/s); the turns are sized for it. */
  speed: number
  /** Downwind leg distance from the runway centreline (m). */
  offset: number
  /** Base leg distance before the threshold (m): the length of the final approach. */
  finalLength: number
  /** Turn radius at the circuit speed and 25 degrees of bank (m); turns start this far early. */
  turnRadius: number
}

/** Circuit bank angle used to size the pattern (deg). */
const CIRCUIT_BANK_DEG = 25

function circuitPlan(speeds: { approach: number; rotate: number; stallClean: number }, jet: boolean): CircuitPlan {
  // Clean: comfortably above the approach speed, the speed the flaps came up at and the clean stall.
  const speed = Math.max(speeds.approach * 1.3, speeds.rotate * FLAPS_UP_FACTOR * 1.1, speeds.stallClean * 1.35)
  const turnRadius = (speed * speed) / (9.81 * Math.tan((CIRCUIT_BANK_DEG * Math.PI) / 180))
  // Downwind two turn radii out: room to roll out between the crosswind and downwind turns.
  const offset = Math.max(1200, 2 * turnRadius)
  return {
    // 1,000 ft for the trainer, 1,500 ft for the jets.
    height: jet ? 457.2 : 304.8,
    speed,
    offset,
    // Long enough to roll out of the final turn and settle on the glide path for a minute.
    finalLength: Math.max(2500, offset + 2 * turnRadius),
    turnRadius,
  }
}

/**
 * Highest safe pitch (deg) with the main wheels `height` metres above the
 * ground: the tail clears more as the aircraft climbs. 2 degrees of margin.
 */
export function safePitchAtHeight(t: Technique, height: number): number {
  return Math.atan2(t.tailAboveMain + Math.max(0, height), t.tailBehindMain) * DEG - 2
}

/** Nose-up rotation about the main wheels at which the tail strike point touches. */
function tailStrikePitch(id: AircraftId): number {
  const g = getAircraft(id).geometry
  const tail = g.strikePoints.tail
  const main = g.gear.mainLeft
  return Math.atan2(tail.y - main.y, tail.z - main.z) * DEG
}

const LESSON_AIRPORT: Record<AircraftId, string> = {
  trainer: 'central',
  f22: 'ridgeback',
  a220: 'westport',
  a350: 'harbor',
  global8000: 'southgate',
}

/** Initial climb pitch; the heavy A350 climbs flatter so it can accelerate to clean up the flaps. */
const CLIMB_PITCH: Record<AircraftId, number> = { trainer: 8, f22: 15, a220: 12, a350: 10, global8000: 12 }

/** Flaps come up above this multiple of the rotation speed. */
export const FLAPS_UP_FACTOR = 1.12
const FLARE_PITCH: Record<AircraftId, number> = { trainer: 5, f22: 9, a220: 4, a350: 4, global8000: 4 }

const NOTES: Record<AircraftId, string[]> = {
  trainer: ['Light and forgiving: small inputs, it reacts at once', 'Lands at about 65 kt with one notch of flaps'],
  f22: [
    'Very responsive: tiny inputs only',
    'Afterburner (throttle above 95%) is not needed for take-off',
    'Approach fast: about 145 kt, no flaps',
  ],
  a220: ['Fly-by-wire: the nose stays where you leave it', 'Rotate slowly; tail strike below 10 degrees on the ground'],
  a350: [
    'Very heavy: inputs take seconds to show',
    'Rotate slowly and stop at 8 degrees on the ground',
    'Needs an international runway',
  ],
  global8000: ['Short landings with full flaps and reverse', 'Rotate gently: the tail is close to the ground at 7 degrees'],
}

export function techniqueFor(id: AircraftId): Technique {
  const ac = getAircraft(id)
  const tail = tailStrikePitch(id)
  const maxGround = Math.min(12, tail - 2)
  const jet = ac.engineKind !== 'piston'
  const airport = getAirport(LESSON_AIRPORT[id])
  return {
    aircraftId: id,
    rotateSpeed: ac.speeds.rotate,
    tailStrikePitchDeg: tail,
    maxGroundPitchDeg: maxGround,
    rotatePitchDeg: Math.min(8, maxGround - 1),
    climbPitchDeg: CLIMB_PITCH[id],
    approachSpeed: ac.speeds.approach,
    takeoffFlaps: ac.takeoffFlaps,
    landingFlaps: ac.landingFlaps,
    flareHeight: jet ? 9 : 4.5,
    flarePitchDeg: FLARE_PITCH[id],
    retractableGear: ac.geometry.gear.retractable,
    reverse: jet && id !== 'f22',
    lessonPlace: { airportId: airport.id, runwayEnd: runwayEnds(airport)[0].designator },
    notes: NOTES[id],
    tailAboveMain: ac.geometry.strikePoints.tail.y - ac.geometry.gear.mainLeft.y,
    tailBehindMain: ac.geometry.strikePoints.tail.z - ac.geometry.gear.mainLeft.z,
    circuit: circuitPlan(ac.speeds, jet),
  }
}
