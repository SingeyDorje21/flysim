import { describe, expect, it } from 'vitest'
import { getAircraft, type AircraftId } from '../../config/aircraftCatalog'
import { CRASH_REASONS } from '../AircraftPhysics'
import type { TerrainSampler } from '../types'
import { makeAircraft, run } from './helpers'

const DEG = Math.PI / 180
/** A 3 degree field falling away to the east, grass everywhere. */
const GRADE = Math.tan(3 * DEG)
const slope: TerrainSampler = {
  heightAt: (x) => 500 - GRADE * x,
  surfaceAt: () => 'grass',
}

// Fly-by-wire airliners read the spawn pitch as the flight-path angle and hold it hands-off
// (flare mode shallows it a little near the ground).
const JETS: AircraftId[] = ['a220', 'a350', 'global8000']

function approach(id: AircraftId, headingDeg: number, pathDeg: number) {
  const ac = getAircraft(id)
  return makeAircraft(
    id,
    {
      position: { x: 0, y: 512, z: 0 },
      headingDeg,
      pitchDeg: pathDeg,
      airspeed: ac.speeds.approach,
      throttle: 0.3,
      flaps: ac.landingFlaps,
      onGround: false,
    },
    slope,
  )
}

describe('landing on sloping open ground', () => {
  for (const id of JETS) {
    it(`${id}: a gentle touchdown parallel to a downhill field is not a hard landing`, () => {
      // Slightly steeper than the field: under 1 m/s onto the grass, but more than the
      // 3.5 m/s hard-landing limit straight down.
      const sim = approach(id, 90, id === 'global8000' ? -5 : -4.5)
      run(sim, 30, undefined, (s) => s.state.onGround || s.state.crashed)
      expect(sim.state.onGround).toBe(true)
      expect(sim.state.verticalSpeed).toBeLessThan(-3.5)
      run(sim, 2)
      expect(sim.state.crashReason).toBeNull()
    })

    it(`${id}: flying steeply into rising ground breaks the gear`, () => {
      // 5 degrees down onto a 3 degree upslope: the wheels close on the grass at ~9 m/s.
      const sim = approach(id, 270, -5)
      run(sim, 30, undefined, (s) => s.state.crashed)
      expect(sim.state.crashReason).toBe(CRASH_REASONS.hardLanding)
    })
  }
})
