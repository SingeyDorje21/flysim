import { AircraftPhysics } from '../AircraftPhysics'
import { createFlatTerrain } from '../flatTerrain'
import type { SpawnState, TerrainSampler } from '../types'

export const DT = 1 / 120

export function airSpawn(airspeed: number, overrides: Partial<SpawnState> = {}): SpawnState {
  return {
    position: { x: 0, y: 1500, z: 0 },
    headingDeg: 90,
    pitchDeg: 0,
    airspeed,
    throttle: 0.6,
    flaps: 0,
    onGround: false,
    ...overrides,
  }
}

export function groundSpawn(overrides: Partial<SpawnState> = {}): SpawnState {
  return {
    position: { x: 0, y: 0, z: 0 },
    headingDeg: 0,
    airspeed: 0,
    throttle: 0,
    flaps: 0,
    onGround: true,
    ...overrides,
  }
}

export function makePhysics(spawn: SpawnState, terrain: TerrainSampler = createFlatTerrain(0)): AircraftPhysics {
  return new AircraftPhysics({ terrain, spawn })
}

/** Runs `seconds` of fixed steps, calling `control` before each step. Stops early if `until` returns true. */
export function run(
  sim: AircraftPhysics,
  seconds: number,
  control?: (sim: AircraftPhysics) => void,
  until?: (sim: AircraftPhysics) => boolean,
): number {
  const n = Math.round(seconds / sim.fixedDt)
  for (let i = 0; i < n; i++) {
    if (control) control(sim)
    sim.step()
    if (until && until(sim)) return i + 1
  }
  return n
}

/** Horizontal distance between two points. */
export function dist2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/** Unwrapped heading change in degrees (-180..180). */
export function headingDelta(from: number, to: number): number {
  let d = to - from
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
}

/**
 * Simple pitch autopilot holding a target vertical speed (PI on vertical
 * speed with pitch-rate damping). Returns a controller closure.
 */
export function verticalSpeedHold(targetVs: () => number, kp = 0.08, ki = 0.04, kq = 0.6) {
  let integ = 0
  return (sim: AircraftPhysics): number => {
    const s = sim.state
    const err = targetVs() - s.verticalSpeed
    integ = Math.max(-25, Math.min(25, integ + err * sim.fixedDt))
    const cmd = kp * err + ki * integ - kq * s.angularVelocity.x
    return Math.max(-1, Math.min(1, cmd))
  }
}
