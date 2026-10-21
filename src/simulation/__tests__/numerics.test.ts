import { describe, expect, it } from 'vitest'
import { DEFAULT_AIRCRAFT } from '../../config/aircraft'
import { SPAWNS } from '../../config/world'
import { AircraftPhysics } from '../AircraftPhysics'
import { FixedTimestep } from '../FixedTimestep'
import { createFlatTerrain } from '../flatTerrain'
import { interpolatePose } from '../interpolate'
import type { AircraftState, ControlInputs } from '../types'
import { airSpawn, groundSpawn, makePhysics, run } from './helpers'

function allFinite(s: AircraftState): boolean {
  const nums = [
    s.position.x, s.position.y, s.position.z,
    s.velocity.x, s.velocity.y, s.velocity.z,
    s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w,
    s.angularVelocity.x, s.angularVelocity.y, s.angularVelocity.z,
    s.surfaces.elevator, s.surfaces.aileron, s.surfaces.rudder, s.surfaces.flaps,
    s.engine.rpm, s.engine.spool, s.engine.thrust, s.engine.n1,
    s.gearPosition, s.speedbrakePosition, s.thrustVector, s.mach,
    s.airspeed, s.groundSpeed, s.altitude, s.heightAboveGround, s.verticalSpeed,
    s.angleOfAttack, s.sideslip, s.headingDeg, s.pitchDeg, s.bankDeg, s.gForce, s.simTime,
  ]
  return nums.every(Number.isFinite)
}

/** Deterministic, time-varying pilot inputs. */
function scriptedControls(t: number): Partial<ControlInputs> {
  return {
    throttle: 0.6 + 0.4 * Math.sin(t * 0.3),
    pitch: 0.4 * Math.sin(t * 1.3),
    roll: 0.6 * Math.sin(t * 0.7),
    yaw: 0.3 * Math.sin(t * 2.1),
    flaps: t > 5 ? 1 / 3 : 0,
  }
}

describe('FixedTimestep', () => {
  it('runs whole steps and returns alpha in [0, 1)', () => {
    const ts = new FixedTimestep({ dt: 1 / 120 })
    let n = 0
    const a1 = ts.advance(1 / 60, () => n++)
    expect(n).toBe(2)
    expect(a1).toBeGreaterThanOrEqual(0)
    expect(a1).toBeLessThan(1)
    const a2 = ts.advance(1 / 240, () => n++)
    expect(n).toBe(2)
    expect(a2).toBeCloseTo(0.5, 6)
    ts.reset()
    expect(ts.advance(0, () => n++)).toBe(0)
  })

  it('ignores NaN, infinite and negative frame times', () => {
    const ts = new FixedTimestep({ dt: 1 / 120 })
    let n = 0
    for (const bad of [Number.NaN, -1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      const a = ts.advance(bad, () => n++)
      expect(Number.isFinite(a)).toBe(true)
    }
    expect(n).toBe(0)
  })

  it('caps a 10-second frame (no spiral of death)', () => {
    const ts = new FixedTimestep({ dt: 1 / 120, maxSubSteps: 8, maxFrameDt: 0.25 })
    let n = 0
    const a = ts.advance(10, () => n++)
    expect(n).toBe(8)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(1)
    // The backlog is dropped, not carried into later frames.
    n = 0
    ts.advance(1 / 120, () => n++)
    expect(n).toBeLessThanOrEqual(2)

    const def = new FixedTimestep({ dt: 1 / 120 })
    let m = 0
    def.advance(10, () => m++)
    expect(m).toBeGreaterThan(0)
    expect(m).toBeLessThanOrEqual(20)
  })
})

describe('frame-rate independence and determinism', () => {
  const STEPS = 3600

  function runWithFrames(frames: (i: number) => number): AircraftState {
    const sim = new AircraftPhysics({ terrain: createFlatTerrain(12), spawn: SPAWNS.takeoff })
    const ts = new FixedTimestep({ dt: sim.fixedDt })
    let steps = 0
    const step = () => {
      if (steps >= STEPS) return
      sim.setControls({ throttle: 1, flaps: 1 / 3, pitch: steps > 2400 ? 0.4 : 0, yaw: 0.1 })
      sim.step()
      steps++
    }
    for (let i = 0; steps < STEPS && i < 100000; i++) ts.advance(frames(i), step)
    expect(steps).toBe(STEPS)
    return JSON.parse(JSON.stringify(sim.state)) as AircraftState
  }

  it('gives an identical state for 30, 60, 144 Hz and jittery frames', () => {
    const ref = runWithFrames(() => 1 / 60)
    expect(runWithFrames(() => 1 / 30)).toStrictEqual(ref)
    expect(runWithFrames(() => 1 / 144)).toStrictEqual(ref)
    const jitter = [0.004, 0.031, 0.0167, 0.0001, 0.05, 0.009, 0.022]
    expect(runWithFrames((i) => jitter[i % jitter.length])).toStrictEqual(ref)
  })

  it('two identical runs are bitwise equal', () => {
    const a = makePhysics(airSpawn(45))
    const b = makePhysics(airSpawn(45))
    for (let i = 0; i < 3000; i++) {
      const c = scriptedControls(i / 120)
      a.setControls(c)
      b.setControls(c)
      a.step()
      b.step()
    }
    expect(b.state).toStrictEqual(a.state)
    expect(Object.is(a.state.position.x, b.state.position.x)).toBe(true)
  })
})

describe('reset', () => {
  it('after flying, reset(spawn) equals a fresh instance; previousState equals state', () => {
    const terrain = createFlatTerrain(12)
    for (const spawn of [SPAWNS.takeoff, SPAWNS.landing, SPAWNS.rings]) {
      const flown = new AircraftPhysics({ terrain, spawn: SPAWNS.freeFlight })
      run(flown, 20, (s) => s.setControls({ ...scriptedControls(s.state.simTime), brakes: 0.5, trim: 0.7 }))
      flown.setControls({ pitch: 1, roll: -1, throttle: 0.2 })
      flown.reset(spawn)
      const fresh = new AircraftPhysics({ terrain, spawn })
      expect(flown.state).toStrictEqual(fresh.state)
      expect(flown.previousState).toStrictEqual(flown.state)
      expect(flown.previousState).not.toBe(flown.state)
      expect(flown.previousState.position).not.toBe(flown.state.position)
      expect(flown.previousState.orientation).not.toBe(flown.state.orientation)
      // Hidden state (pending inputs, gear latches, filters) must match too.
      run(flown, 5)
      run(fresh, 5)
      expect(flown.state).toStrictEqual(fresh.state)
    }
  })

  it('reset after a crash restores a flyable state', () => {
    const sim = makePhysics(groundSpawn(), createFlatTerrain(0, 'water'))
    sim.step()
    expect(sim.state.crashed).toBe(true)
    sim.reset(groundSpawn())
    expect(sim.state.crashed).toBe(false)
    expect(sim.state.crashReason).toBeNull()
    expect(sim.state.simTime).toBe(0)
  })

  it('sets trim so an airborne spawn is roughly trimmed for its speed', () => {
    const slow = makePhysics(airSpawn(36, { flaps: 1 / 3 }))
    const fast = makePhysics(airSpawn(60))
    expect(slow.state.controls.trim).toBeGreaterThan(fast.state.controls.trim)
    expect(Math.abs(slow.state.controls.trim)).toBeLessThan(1)
    expect(makePhysics(groundSpawn()).state.controls.trim).toBe(0)
  })
})

describe('numerical safety', () => {
  it('clamps out-of-range controls and zeroes NaN', () => {
    const sim = makePhysics(airSpawn(45))
    sim.setControls({
      pitch: Number.NaN,
      roll: 5,
      yaw: Number.NEGATIVE_INFINITY,
      throttle: -3,
      flaps: Number.POSITIVE_INFINITY,
      brakes: 2,
      trim: -9,
      gear: -5,
      speedbrake: 3,
      reverse: Number.NaN,
    })
    sim.step()
    // The trainer has fixed gear, no speed brakes and no reversers: those commands are discarded.
    expect(sim.state.controls).toEqual({
      pitch: 0, roll: 1, yaw: -1, throttle: 0, flaps: 1, brakes: 1, trim: -1, gear: 1, speedbrake: 0, reverse: 0,
    })
    expect(sim.state.gearPosition).toBe(1)
    expect(sim.state.speedbrakePosition).toBe(0)
    sim.setControls({ throttle: Number.NaN })
    sim.step()
    expect(sim.state.controls.throttle).toBe(0)
    expect(allFinite(sim.state)).toBe(true)
  })

  it('survives a NaN spawn and a non-finite terrain', () => {
    const terrain = { heightAt: () => Number.NaN, surfaceAt: () => 'paved' as const }
    const sim = new AircraftPhysics({
      terrain,
      spawn: { position: { x: Number.NaN, y: 100, z: 0 }, headingDeg: Number.NaN, airspeed: Number.NaN, throttle: Number.NaN, flaps: 0, onGround: false },
    })
    run(sim, 2)
    expect(allFinite(sim.state)).toBe(true)
  })

  it('extreme inputs for 60 s never produce NaN/Infinity; quaternion stays normalised; rates and speed are clamped', () => {
    const sim = makePhysics(airSpawn(70, { position: { x: 0, y: 6000, z: 0 }, throttle: 1 }))
    const lim = DEFAULT_AIRCRAFT.limits
    let worstNorm = 0
    let maxRate = 0
    let maxSpeed = 0
    let ok = true
    run(sim, 60, (s) => {
      const k = Math.floor(s.state.simTime / 0.7)
      s.setControls({
        pitch: k % 2 ? 1 : -1,
        roll: k % 3 ? 1 : -1,
        yaw: k % 5 < 2 ? 1 : -1,
        throttle: k % 4 < 2 ? 1 : 0,
        flaps: k % 7 < 3 ? 1 : 0,
        trim: k % 2 ? -1 : 1,
      })
    }, (s) => {
      const st = s.state
      const q = st.orientation
      worstNorm = Math.max(worstNorm, Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1))
      const w = st.angularVelocity
      maxRate = Math.max(maxRate, Math.hypot(w.x, w.y, w.z))
      maxSpeed = Math.max(maxSpeed, st.airspeed)
      ok = ok && allFinite(st)
      return !ok
    })
    expect(ok).toBe(true)
    expect(worstNorm).toBeLessThan(1e-9)
    expect(maxRate).toBeLessThanOrEqual(lim.maxAngularRate + 1e-9)
    expect(maxSpeed).toBeLessThanOrEqual(lim.maxSpeed + 1e-9)
  }, 20000)

  it('a hostile vertical dive is clamped to the speed limit', () => {
    const sim = makePhysics(airSpawn(140, { position: { x: 0, y: 9000, z: 0 }, pitchDeg: -89, throttle: 1 }))
    run(sim, 20, (s) => s.setControls({ throttle: 1 }))
    expect(sim.state.airspeed).toBeLessThanOrEqual(DEFAULT_AIRCRAFT.limits.maxSpeed + 1e-9)
    expect(allFinite(sim.state)).toBe(true)
  })
})

describe('interpolatePose', () => {
  it('lerps position and takes the shortest path between orientations', () => {
    const a = makePhysics(airSpawn(45, { headingDeg: 10 })).state
    const b = JSON.parse(JSON.stringify(makePhysics(airSpawn(45, { headingDeg: 30 })).state)) as AircraftState
    b.position.x = 10
    // Same rotation, opposite quaternion sign: must not swing the long way.
    b.orientation.x = -b.orientation.x
    b.orientation.y = -b.orientation.y
    b.orientation.z = -b.orientation.z
    b.orientation.w = -b.orientation.w
    const out = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }
    interpolatePose(a, b, 0.5, out)
    expect(out.position.x).toBeCloseTo(5, 9)
    const o = out.orientation
    expect(Math.hypot(o.x, o.y, o.z, o.w)).toBeCloseTo(1, 12)
    // Halfway heading (20 deg) about world Y: q = (0, sin(-10deg), 0, cos(-10deg)) up to sign.
    const s = Math.sign(o.w)
    expect(o.y * s).toBeCloseTo(Math.sin((-10 * Math.PI) / 180), 3)
    interpolatePose(a, b, 0, out)
    expect(out.position.x).toBeCloseTo(a.position.x, 12)
    interpolatePose(a, b, 1, out)
    expect(Math.abs(out.orientation.w)).toBeCloseTo(Math.abs(b.orientation.w), 12)
  })
})
