/**
 * Shared simulation contracts. Owned by the orchestrator; other modules may
 * only make additive changes and must report them.
 *
 * UNITS: SI everywhere (m, s, kg, N, rad) unless a field name says Deg.
 *
 * WORLD FRAME (right-handed, same as three.js):
 *   +X = east, +Y = up, +Z = south (so north is -Z).
 *   y = 0 is sea level. The runway centre sits at x = 0, z = 0.
 *
 * BODY FRAME (origin at the centre of gravity, matches three.js object space):
 *   +X = right wing, +Y = up (canopy), +Z = tail. The nose points along -Z.
 *   `orientation` rotates body-frame vectors into the world frame, so the
 *   identity quaternion is wings level, nose pointing north. The renderer
 *   copies position + orientation straight onto the aircraft Object3D.
 *
 * ANGULAR VELOCITY (body frame, rad/s, right-hand rule):
 *   x: pitch rate, + = nose up
 *   y: yaw rate,   + = nose LEFT
 *   z: roll rate,  + = right wing UP (rolling left)
 *
 * DERIVED ATTITUDE (degrees, for instruments):
 *   heading: 0..360 clockwise from north (0 = -Z, 90 = +X)
 *   pitch:   + = nose up       = asin(forward.y), forward = q * (0,0,-1)
 *   bank:    + = right wing down = atan2(-right.y, up.y)
 *   Equivalent three.js Euler order 'YXZ': y = -heading, x = pitch, z = -bank.
 */

import type { AircraftId } from '../config/aircraftCatalog'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Quat {
  x: number
  y: number
  z: number
  w: number
}

/** Pilot commands. Physics clamps every value to its range. */
export interface ControlInputs {
  /** Elevator command -1..1. +1 = stick back = nose up. */
  pitch: number
  /** Aileron command -1..1. +1 = stick right = roll right. */
  roll: number
  /** Rudder command -1..1. +1 = right pedal = yaw nose right. */
  yaw: number
  /** Throttle lever 0..1. */
  throttle: number
  /** Flap lever 0..1 (detents at 0, 1/3, 2/3, 1). */
  flaps: number
  /** Wheel brakes 0..1. */
  brakes: number
  /** Elevator trim -1..1. + = nose-up trim. */
  trim: number
  /** Gear lever: 1 = down, 0 = up. Ignored by fixed-gear aircraft. */
  gear: number
  /** Speed brakes / spoilers 0..1. */
  speedbrake: number
  /** Reverse thrust 0..1 (jets on the ground only). */
  reverse: number
}

/** Actual control-surface positions in radians after actuator dynamics. */
export interface ControlSurfaces {
  /** + = trailing edge up (nose-up). */
  elevator: number
  /** + = roll-right deflection: right aileron trailing edge UP, left aileron trailing edge DOWN, same magnitude. */
  aileron: number
  /** + = trailing edge to the right (yaws nose right). */
  rudder: number
  /** 0..max, + = trailing edge down. */
  flaps: number
}

export interface EngineState {
  running: boolean
  /** Propeller rpm. */
  rpm: number
  /** Normalised engine power 0..1 after spool-up lag. */
  spool: number
  /** Current thrust in newtons along the body -Z axis. */
  thrust: number
  /** Fan / propeller speed as a fraction of maximum (0..~1.05). */
  n1: number
  /** Afterburner lit (afterburning engines only). */
  afterburner: boolean
}

export interface AircraftState {
  // --- Authoritative kinematic state ---
  /** CG position, world frame (m). */
  position: Vec3
  /** CG velocity, world frame (m/s). */
  velocity: Vec3
  /** Body -> world rotation, always normalised. */
  orientation: Quat
  /** Body-frame angular velocity (rad/s), see header for signs. */
  angularVelocity: Vec3

  // --- Controls and systems ---
  /** Last applied (clamped) pilot inputs. */
  controls: ControlInputs
  surfaces: ControlSurfaces
  engine: EngineState

  // --- Derived each step (read-only for consumers) ---
  /** Gear extension 0 (up) .. 1 (down and locked); always 1 for fixed gear. */
  gearPosition: number
  /** Speed brake / spoiler extension 0..1. */
  speedbrakePosition: number
  /** Pitch thrust-vector nozzle angle (rad), + = nozzle trailing edge up (nose-up moment). 0 when not fitted. */
  thrustVector: number
  /** True airspeed (m/s). No wind model, so equal to |velocity|. */
  airspeed: number
  /** Mach number (airspeed / local speed of sound). */
  mach: number
  /** Horizontal speed over ground (m/s). */
  groundSpeed: number
  /** Altitude above sea level (m) = position.y. */
  altitude: number
  /** Height of the main-gear contact points above the ground (m); ~0 when parked. */
  heightAboveGround: number
  /** Vertical speed (m/s), + = climbing. */
  verticalSpeed: number
  /** Angle of attack (rad), + = relative wind from below the nose. */
  angleOfAttack: number
  /** Sideslip angle (rad), + = relative wind from the right. */
  sideslip: number
  headingDeg: number
  pitchDeg: number
  bankDeg: number
  /** Load factor along body +Y (1 = level flight, 0 = free fall). */
  gForce: number
  /** True within a few degrees of the critical angle of attack. */
  stallWarning: boolean
  /** True beyond the critical angle of attack. */
  stalled: boolean
  /** Any gear contact point is touching the ground. */
  onGround: boolean
  /** Once true the physics freezes until reset(). */
  crashed: boolean
  crashReason: string | null
  /** Simulated seconds since the last reset. */
  simTime: number
}

export type SurfaceType = 'paved' | 'grass' | 'water'

/**
 * Pure-TS ground query shared by physics and rendering (no three.js import).
 * Must be deterministic: the same (x, z) always gives the same answer.
 */
export interface TerrainSampler {
  /** Ground elevation (m) at world x, z. Over water returns the water level (0). */
  heightAt(x: number, z: number): number
  surfaceAt(x: number, z: number): SurfaceType
}

/** Initial condition passed to FlightModel.reset(). */
export interface SpawnState {
  /** CG position. When onGround is true, y is ignored and the aircraft is placed resting on its gear. */
  position: Vec3
  headingDeg: number
  /** Default 0. Ignored when onGround (aircraft rests on its gear). */
  pitchDeg?: number
  /** Speed along the nose (m/s). */
  airspeed: number
  throttle: number
  flaps: number
  onGround: boolean
  /** Default true. */
  engineRunning?: boolean
  /** Airborne spawns only: start with the gear retracted. Default false. */
  gearUp?: boolean
}

/**
 * The flight-dynamics contract. Implemented by AircraftPhysics in
 * src/simulation/AircraftPhysics.ts:
 *   new AircraftPhysics({ terrain, spawn, aircraft?: AircraftId (default 'trainer'), fixedDt?, config? })
 * Spawns may carry gear: airborne spawns start with the gear down unless
 * SpawnState.gearUp is set.
 */
export interface FlightModel {
  /** State after the last fixed step. Treat as read-only. */
  readonly state: AircraftState
  /** State before the last fixed step, for render interpolation. */
  readonly previousState: AircraftState
  /** Fixed step length (s). Default 1/120. */
  readonly fixedDt: number
  /** Merge new pilot inputs; applied from the next step. */
  setControls(controls: Partial<ControlInputs>): void
  /** Advance exactly one fixed step. No-op while crashed. */
  step(): void
  /** Restore a fresh state at the spawn; clears all transient state. */
  reset(spawn: SpawnState): void
}

/**
 * Per-frame view of the aircraft for rendering. The simulation driver mutates
 * ONE instance in place every frame (interpolated between fixed steps) before
 * any world useFrame callback runs. Renderers must never write to it.
 */
export interface AircraftRenderState {
  position: Vec3
  orientation: Quat
  velocity: Vec3
  surfaces: ControlSurfaces
  engineRpm: number
  /** Which model to draw (constant during a flight). */
  aircraftId: AircraftId
  /** Fan speed fraction, for jet exhaust / spool effects. */
  n1: number
  afterburner: boolean
  gearPosition: number
  speedbrakePosition: number
  /** Thrust-vector nozzle angle (rad), see AircraftState.thrustVector. */
  thrustVector: number
  airspeed: number
  onGround: boolean
  crashed: boolean
  /** True while the simulation is paused or frozen; sim-driven animation (propeller) must hold still. */
  frozen: boolean
  /**
   * Increments whenever the aircraft is teleported (spawn, restart). Cameras
   * and trails must snap instead of easing when this changes.
   */
  teleportId: number
}
