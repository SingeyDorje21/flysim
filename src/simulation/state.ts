import type { AircraftState } from './types'

/** A zeroed AircraftState with every nested object allocated. */
export function createAircraftState(): AircraftState {
  return {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, flaps: 0, brakes: 0, trim: 0, gear: 1, speedbrake: 0, reverse: 0 },
    surfaces: { elevator: 0, aileron: 0, rudder: 0, flaps: 0 },
    engine: { running: true, rpm: 0, spool: 0, thrust: 0, n1: 0, afterburner: false },
    gearPosition: 1,
    speedbrakePosition: 0,
    thrustVector: 0,
    airspeed: 0,
    mach: 0,
    groundSpeed: 0,
    altitude: 0,
    heightAboveGround: 0,
    verticalSpeed: 0,
    angleOfAttack: 0,
    sideslip: 0,
    headingDeg: 0,
    pitchDeg: 0,
    bankDeg: 0,
    gForce: 1,
    stallWarning: false,
    stalled: false,
    onGround: false,
    crashed: false,
    crashReason: null,
    simTime: 0,
  }
}

/** Deep copy src into dst without allocating. */
export function copyAircraftState(dst: AircraftState, src: AircraftState): void {
  dst.position.x = src.position.x
  dst.position.y = src.position.y
  dst.position.z = src.position.z
  dst.velocity.x = src.velocity.x
  dst.velocity.y = src.velocity.y
  dst.velocity.z = src.velocity.z
  dst.orientation.x = src.orientation.x
  dst.orientation.y = src.orientation.y
  dst.orientation.z = src.orientation.z
  dst.orientation.w = src.orientation.w
  dst.angularVelocity.x = src.angularVelocity.x
  dst.angularVelocity.y = src.angularVelocity.y
  dst.angularVelocity.z = src.angularVelocity.z
  const c = dst.controls
  const sc = src.controls
  c.pitch = sc.pitch
  c.roll = sc.roll
  c.yaw = sc.yaw
  c.throttle = sc.throttle
  c.flaps = sc.flaps
  c.brakes = sc.brakes
  c.trim = sc.trim
  c.gear = sc.gear
  c.speedbrake = sc.speedbrake
  c.reverse = sc.reverse
  dst.surfaces.elevator = src.surfaces.elevator
  dst.surfaces.aileron = src.surfaces.aileron
  dst.surfaces.rudder = src.surfaces.rudder
  dst.surfaces.flaps = src.surfaces.flaps
  dst.engine.running = src.engine.running
  dst.engine.rpm = src.engine.rpm
  dst.engine.spool = src.engine.spool
  dst.engine.thrust = src.engine.thrust
  dst.engine.n1 = src.engine.n1
  dst.engine.afterburner = src.engine.afterburner
  dst.gearPosition = src.gearPosition
  dst.speedbrakePosition = src.speedbrakePosition
  dst.thrustVector = src.thrustVector
  dst.airspeed = src.airspeed
  dst.mach = src.mach
  dst.groundSpeed = src.groundSpeed
  dst.altitude = src.altitude
  dst.heightAboveGround = src.heightAboveGround
  dst.verticalSpeed = src.verticalSpeed
  dst.angleOfAttack = src.angleOfAttack
  dst.sideslip = src.sideslip
  dst.headingDeg = src.headingDeg
  dst.pitchDeg = src.pitchDeg
  dst.bankDeg = src.bankDeg
  dst.gForce = src.gForce
  dst.stallWarning = src.stallWarning
  dst.stalled = src.stalled
  dst.onGround = src.onGround
  dst.crashed = src.crashed
  dst.crashReason = src.crashReason
  dst.simTime = src.simTime
}
