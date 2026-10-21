import type { AircraftConfig } from '../../config/aircraft'
import type { AircraftId } from '../../config/aircraftCatalog'
import { AircraftPhysics } from '../AircraftPhysics'
import { speedOfSound } from '../atmosphere'
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

// ---------------------------------------------------------------- multi-type

/** A physics instance of the given type. */
export function makeAircraft(
  aircraft: AircraftId,
  spawn: SpawnState,
  terrain: TerrainSampler = createFlatTerrain(0),
  config?: AircraftConfig,
): AircraftPhysics {
  return new AircraftPhysics({ terrain, spawn, aircraft, config })
}

/** Airborne spawn at `altitude` and Mach `mach` (ISA), heading north. */
export function machSpawn(mach: number, altitude: number, overrides: Partial<SpawnState> = {}): SpawnState {
  return {
    position: { x: 0, y: altitude, z: 0 },
    headingDeg: 0,
    pitchDeg: 0,
    airspeed: mach * speedOfSound(altitude),
    throttle: 0.8,
    flaps: 0,
    onGround: false,
    gearUp: true,
    ...overrides,
  }
}

/** Flight-path angle (rad). */
export function flightPath(sim: AircraftPhysics): number {
  const s = sim.state
  return s.airspeed > 1 ? Math.asin(Math.max(-1, Math.min(1, s.verticalSpeed / s.airspeed))) : 0
}

/**
 * Stick command for a fly-by-wire type that asks for a flight-path angle
 * change: the FBW maps stick to pitch rate, so command a rate proportional
 * to the flight-path error.
 */
export function fbwPathStick(sim: AircraftPhysics, gammaTarget: number, gain = 0.4): number {
  const f = sim.config.fbw
  if (!f) throw new Error('not a fly-by-wire type')
  const V = Math.max(sim.state.airspeed, 30)
  const qFull = Math.min(f.maxPitchRate, (9.80665 * (f.nzMax - 1)) / V)
  const cmd = (gain * (gammaTarget - flightPath(sim))) / qFull
  return Math.max(-1, Math.min(1, cmd))
}

/** FBW altitude hold: climb/descend towards `altitude` at up to `maxVs` m/s. */
export function fbwAltitudeStick(sim: AircraftPhysics, altitude: number, maxVs = 10): number {
  const s = sim.state
  const vsTarget = Math.max(-maxVs, Math.min(maxVs, 0.08 * (altitude - s.altitude)))
  const gammaT = Math.asin(Math.max(-1, Math.min(1, vsTarget / Math.max(s.airspeed, 30))))
  return fbwPathStick(sim, gammaT)
}

/** FBW speed-on-pitch climb: nose up when faster than `machTarget`, down when slower. */
export function fbwMachClimbStick(sim: AircraftPhysics, machTarget: number, maxGammaDeg = 25): number {
  const s = sim.state
  const gammaT = Math.max(-5, Math.min(maxGammaDeg, 60 * (s.mach - machTarget))) * (Math.PI / 180)
  // Blend towards the target from the current path so the command stays smooth.
  return fbwPathStick(sim, gammaT, 0.3)
}


/** Take-off rotation: pitch up at about `rateDegS` until `pitchDegTarget`, then hold it. */
export function rotationStick(sim: AircraftPhysics, pitchDegTarget: number, rateDegS = 3): number {
  const s = sim.state
  const qT = Math.max(0, Math.min(rateDegS, 1.5 * (pitchDegTarget - s.pitchDeg))) * (Math.PI / 180)
  return Math.max(-1, Math.min(1, 0.25 + 12 * (qT - s.angularVelocity.x)))
}
