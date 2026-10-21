import { describe, expect, it } from 'vitest'
import { CG_HEIGHT_ON_GEAR } from '../../config/aircraftGeometry'
import { AircraftPhysics, CRASH_REASONS } from '../AircraftPhysics'
import { createFlatTerrain } from '../flatTerrain'
import { quatFromAttitude } from '../math'
import type { TerrainSampler } from '../types'
import { airSpawn, dist2d, groundSpawn, makePhysics, run } from './helpers'

describe('ground handling', () => {
  it('spawns settled on the gear with no bounce; parked with brakes it does not creep', () => {
    const terrain = createFlatTerrain(12)
    const sim = makePhysics(groundSpawn({ position: { x: 3, y: 999, z: -7 } }), terrain)
    expect(sim.state.position.y).toBe(12 + CG_HEIGHT_ON_GEAR)
    expect(sim.state.onGround).toBe(true)
    expect(sim.state.heightAboveGround).toBeCloseTo(0, 6)
    expect(sim.state.gForce).toBeCloseTo(1, 3)
    const p0 = { ...sim.state.position }
    let maxVy = 0
    run(
      sim,
      10,
      (s) => s.setControls({ brakes: 1, throttle: 0 }),
      (s) => {
        maxVy = Math.max(maxVy, Math.abs(s.state.velocity.y))
        return false
      },
    )
    expect(maxVy).toBeLessThan(0.01)
    expect(dist2d(p0, sim.state.position)).toBeLessThan(0.05)
    expect(Math.abs(sim.state.velocity.y)).toBeLessThan(0.01)
    expect(Math.abs(sim.state.heightAboveGround)).toBeLessThan(0.05)
    expect(sim.state.onGround).toBe(true)
    expect(sim.state.crashed).toBe(false)
    expect(sim.state.stallWarning).toBe(false)
  })

  it('brakes stop the aircraft from 25 m/s within 400 m', () => {
    const sim = makePhysics(groundSpawn({ airspeed: 25 }))
    const p0 = { ...sim.state.position }
    run(
      sim,
      60,
      (s) => s.setControls({ brakes: 1, throttle: 0 }),
      (s) => s.state.groundSpeed < 0.05,
    )
    expect(sim.state.groundSpeed).toBeLessThan(0.05)
    expect(dist2d(p0, sim.state.position)).toBeLessThan(400)
    expect(sim.state.crashed).toBe(false)
  })

  it('grass has more rolling resistance than pavement', () => {
    const roll = (surface: 'paved' | 'grass') => {
      const sim = makePhysics(groundSpawn({ airspeed: 15 }), createFlatTerrain(0, surface))
      run(sim, 5, (s) => s.setControls({ throttle: 0 }))
      return sim.state.groundSpeed
    }
    expect(roll('grass')).toBeLessThan(roll('paved') - 0.5)
  })

  it('nose-wheel steering turns the aircraft at taxi speed', () => {
    const sim = makePhysics(groundSpawn({ airspeed: 5, headingDeg: 90 }))
    run(sim, 3, (s) => s.setControls({ throttle: 0.3, yaw: 1 }))
    expect(sim.state.headingDeg).toBeGreaterThan(100)
    expect(sim.state.crashed).toBe(false)
  })
})

/** Spawn level just above the ground, then impose a sink rate. */
function touchdown(sink: number) {
  const sim = makePhysics(airSpawn(32, { position: { x: 0, y: CG_HEIGHT_ON_GEAR + 0.12, z: 0 }, flaps: 1 / 3, throttle: 0.2 }))
  sim.state.velocity.y -= sink
  let touchSink = Number.NaN
  run(
    sim,
    6,
    (s) => s.setControls({ throttle: 0 }),
    (s) => {
      if (Number.isNaN(touchSink) && s.state.onGround) touchSink = -s.previousState.verticalSpeed
      return s.state.crashed
    },
  )
  return { sim, touchSink }
}

describe('crashes', () => {
  it('a 1.5 m/s sink touchdown survives', () => {
    const { sim, touchSink } = touchdown(1.5)
    expect(touchSink).toBeGreaterThan(1.2)
    expect(sim.state.crashed).toBe(false)
    expect(sim.state.onGround).toBe(true)
  })

  it('a 6 m/s sink touchdown is a hard-landing crash', () => {
    const { sim } = touchdown(6)
    expect(sim.state.crashed).toBe(true)
    expect(sim.state.crashReason).toBe(CRASH_REASONS.hardLanding)
    expect(sim.state.crashReason).toBe('Hard landing')
  })

  it('touching water ditches', () => {
    const water = createFlatTerrain(0, 'water')
    const parked = makePhysics(groundSpawn(), water)
    parked.step()
    expect(parked.state.crashReason).toBe('Ditched in water')

    // Even a firm arrival on water is reported as ditching, not a hard landing.
    const sim = makePhysics(airSpawn(32, { position: { x: 0, y: CG_HEIGHT_ON_GEAR + 0.12, z: 0 } }), water)
    sim.state.velocity.y = -6
    run(sim, 2, undefined, (s) => s.state.crashed)
    expect(sim.state.crashReason).toBe('Ditched in water')
  })

  it('a tail strike ends the flight', () => {
    const sim = makePhysics(groundSpawn())
    quatFromAttitude(0, 15, 0, sim.state.orientation)
    sim.step()
    expect(sim.state.crashed).toBe(true)
    expect(sim.state.crashReason).toBe(CRASH_REASONS.tail)
  })

  it('a wingtip strike ends the flight', () => {
    const sim = makePhysics(groundSpawn({ airspeed: 10 }))
    quatFromAttitude(0, 0, 20, sim.state.orientation)
    run(sim, 1, undefined, (s) => s.state.crashed)
    expect(sim.state.crashed).toBe(true)
    expect(sim.state.crashReason).toBe(CRASH_REASONS.wingtip)
  })

  it('gear contact on a slope steeper than 12 deg while moving is a terrain collision', () => {
    const slope = 20 * (Math.PI / 180)
    // Plane rising to the east; the aircraft is banked to match it.
    const terrain: TerrainSampler = { heightAt: (x) => x * Math.tan(slope), surfaceAt: () => 'grass' }
    const sim = makePhysics(airSpawn(20, { headingDeg: 0, position: { x: 0, y: 0, z: 0 } }), terrain)
    quatFromAttitude(0, 0, -20, sim.state.orientation)
    sim.state.position.y = CG_HEIGHT_ON_GEAR / Math.cos(slope) + 0.1
    sim.state.velocity.x = 0
    sim.state.velocity.y = -1
    sim.state.velocity.z = -20
    run(sim, 2, undefined, (s) => s.state.crashed)
    expect(sim.state.crashReason).toBe('Terrain collision')
  })

  it('after a crash step() is a no-op and velocities are zeroed', () => {
    const { sim } = touchdown(6)
    expect(sim.state.crashed).toBe(true)
    const frozen = JSON.parse(JSON.stringify(sim.state))
    expect(sim.state.velocity).toEqual({ x: 0, y: 0, z: 0 })
    expect(sim.state.angularVelocity).toEqual({ x: 0, y: 0, z: 0 })
    sim.setControls({ throttle: 1, pitch: 1 })
    run(sim, 1)
    expect(JSON.parse(JSON.stringify(sim.state))).toEqual(frozen)
    expect(sim.previousState).toEqual(sim.state)
  })

  it('reset clears a crash', () => {
    const { sim } = touchdown(6)
    sim.reset(groundSpawn())
    expect(sim.state.crashed).toBe(false)
    expect(sim.state.crashReason).toBeNull()
    run(sim, 1)
    expect(sim.state.crashed).toBe(false)
  })
})

describe('AircraftPhysics construction', () => {
  it('uses a 1/120 default step and honours a custom one', () => {
    const terrain = createFlatTerrain()
    expect(new AircraftPhysics({ terrain, spawn: groundSpawn() }).fixedDt).toBeCloseTo(1 / 120, 12)
    expect(new AircraftPhysics({ terrain, spawn: groundSpawn(), fixedDt: 1 / 60 }).fixedDt).toBeCloseTo(1 / 60, 12)
  })
})
