/**
 * World layout shared by terrain generation, physics spawns and challenges.
 * World frame: +X east, +Y up, +Z south (north = -Z). Owned by the orchestrator.
 */

import type { GameMode } from '../game/types'
import type { SpawnState } from '../simulation/types'

export const WORLD = {
  /** Seed for every procedural generator. */
  seed: 1337,
  seaLevel: 0,
  /** The main island is roughly this radius around the origin (m). */
  islandRadius: 38000,
  /** Side length of the generated world square (m). Open ocean beyond. */
  terrainSize: 100000,
  /**
   * Spacing (m) of the fixed triangulated grid the physics collides with.
   * The nearest terrain level of detail is drawn on exactly this grid, so the
   * ground you see near the aircraft is the ground you hit.
   */
  physicsGridStep: 30,
} as const

/**
 * Runway 36/18. Aircraft take off and land heading north (towards -Z).
 * The runway-36 threshold (southern end) is at z = +length/2.
 */
export const RUNWAY = {
  centerX: 0,
  centerZ: 0,
  elevation: 12,
  length: 1600,
  width: 30,
  /** Direction of runway 36 (take-off/landing direction). */
  headingDeg: 0,
  /** z of the runway-36 threshold (southern end). */
  thresholdZ: 800,
  /** Touchdown aiming point, 300 m past the threshold. */
  aimPointZ: 500,
} as const

/** Axis-aligned rectangle; the terrain is exactly RUNWAY.elevation inside it. */
export interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** Flat airport plateau (runway, taxiway, apron, buildings). */
export const AIRPORT_FLAT_ZONE: Rect = { minX: -350, maxX: 550, minZ: -1150, maxZ: 1150 }
/** Width (m) of the smooth blend from the plateau to natural terrain. */
export const AIRPORT_BLEND = 400

/** Final approach from the south: terrain here must stay below RUNWAY.elevation + 15 m. */
export const APPROACH_CORRIDOR: Rect = { minX: -500, maxX: 500, minZ: 1150, maxZ: 6000 }
/** Departure to the north: terrain here must stay below RUNWAY.elevation + 40 m. */
export const DEPARTURE_CORRIDOR: Rect = { minX: -600, maxX: 600, minZ: -5000, maxZ: -1150 }

/** Point at the runway-36 end where take-offs start. */
const RUNWAY_START_Z = RUNWAY.thresholdZ - 60

const BASE_SPAWNS: Record<'freeFlight' | 'takeoff' | 'landing' | 'rings', SpawnState> = {
  freeFlight: {
    position: { x: 0, y: 0, z: RUNWAY_START_Z },
    headingDeg: 0,
    airspeed: 0,
    throttle: 0,
    flaps: 0,
    onGround: true,
  },
  takeoff: {
    position: { x: 0, y: 0, z: RUNWAY_START_Z },
    headingDeg: 0,
    airspeed: 0,
    throttle: 0,
    flaps: 1 / 3,
    onGround: true,
  },
  landing: {
    // ~3 degree glide path: 3.2 km out, ~170 m above the runway.
    position: { x: 0, y: RUNWAY.elevation + 170, z: RUNWAY.thresholdZ + 3200 },
    headingDeg: 0,
    pitchDeg: 0,
    airspeed: 36,
    throttle: 0.35,
    flaps: 1 / 3,
    onGround: false,
  },
  rings: {
    position: { x: 0, y: 260, z: 1900 },
    headingDeg: 0,
    pitchDeg: 0,
    airspeed: 50,
    throttle: 0.7,
    flaps: 0,
    onGround: false,
  },
}

/** Lessons start like the matching challenges (spawnFor moves them to the lesson airport). */
export const SPAWNS: Record<GameMode, SpawnState> = {
  ...BASE_SPAWNS,
  lessonTakeoff: BASE_SPAWNS.takeoff,
  lessonLanding: BASE_SPAWNS.landing,
  lessonCircuit: BASE_SPAWNS.takeoff,
}

export function isOnRunway(x: number, z: number, margin = 0): boolean {
  return (
    Math.abs(x - RUNWAY.centerX) <= RUNWAY.width / 2 + margin &&
    Math.abs(z - RUNWAY.centerZ) <= RUNWAY.length / 2 + margin
  )
}
