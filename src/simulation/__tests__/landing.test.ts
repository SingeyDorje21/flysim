/**
 * Landing touchdown semantics for the jets: the hard-landing check judges the
 * first contact of each main wheel (and the nose wheel, built for
 * derotation, at twice the limit), and the fly-by-wire derotation law lowers
 * the nose gently after a landing so a gentle touchdown is never turned into
 * a nose-wheel slam.
 */

import { describe, expect, it } from 'vitest'
import { getAircraft, type AircraftId } from '../../config/aircraftCatalog'
import type { AircraftPhysics } from '../AircraftPhysics'
import { CRASH_REASONS } from '../AircraftPhysics'
import { quatFromAttitude, rotateVec } from '../math'
import { airSpawn, makeAircraft, run } from './helpers'

const RAD2DEG = 180 / Math.PI

/** Landing configuration at the approach speed, `height` m (main wheels) above flat ground. */
function approach(id: AircraftId, height: number, pitchDeg: number, bankDeg = 0): AircraftPhysics {
  const info = getAircraft(id)
  const sim = makeAircraft(id, airSpawn(info.speeds.approach, { position: { x: 0, y: 30, z: 0 }, flaps: info.landingFlaps, throttle: 0 }))
  const s = sim.state
  quatFromAttitude(s.headingDeg, pitchDeg, bankDeg, s.orientation)
  // Level flight path along the heading, then drop to the wanted wheel height.
  const fwd = rotateVec(s.orientation, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 })
  const h = Math.hypot(fwd.x, fwd.z)
  s.velocity.x = (fwd.x / h) * info.speeds.approach
  s.velocity.y = 0
  s.velocity.z = (fwd.z / h) * info.speeds.approach
  sim.step()
  s.position.y -= s.heightAboveGround - height
  return sim
}

/** Flies a hands-off-style flare to touchdown and the derotation with the stick released. */
function gentleLanding(id: AircraftId) {
  // End of a flare: nose up (the Global 8000 has the least tail clearance), half a metre up,
  // sinking at 1 m/s, idle, stick released.
  const sim = approach(id, 0.5, id === "global8000" ? 5 : 7)
  sim.state.velocity.y = -1
  let touchSink = Number.NaN
  let touchPitch = Number.NaN
  let maxNoseDownRate = 0
  run(
    sim,
    15,
    (p) => p.setControls({ throttle: 0, pitch: 0 }),
    (p) => {
      const s = p.state
      if (Number.isNaN(touchSink) && s.onGround) {
        touchSink = -p.previousState.verticalSpeed
        touchPitch = s.pitchDeg
      }
      if (s.onGround && s.pitchDeg > 1) maxNoseDownRate = Math.max(maxNoseDownRate, -s.angularVelocity.x * RAD2DEG)
      return s.crashed
    },
  )
  return { sim, touchSink, touchPitch, maxNoseDownRate }
}

/** Wings `bankDeg` off level so one main wheel arrives first, at `sink` m/s. */
function mainGearSlam(id: AircraftId, sink: number, bankDeg: number) {
  const sim = approach(id, 0.05, 3, bankDeg)
  sim.state.velocity.y = -sink
  run(sim, 2, (p) => p.setControls({ throttle: 0 }), (p) => p.state.crashed || p.state.onGround)
  run(sim, 0.5, (p) => p.setControls({ throttle: 0 }), (p) => p.state.crashed)
  return sim
}

describe('jet landings: derotation and hard-landing check', () => {
  it.each(['a220', 'a350', 'global8000', 'f22'] as const)(
    '%s: a gentle touchdown and the derotation that follows are not a hard landing',
    (id) => {
      const { sim, touchSink, touchPitch, maxNoseDownRate } = gentleLanding(id)
      expect(touchSink).toBeGreaterThan(0.3)
      expect(touchSink).toBeLessThan(2.5)
      expect(sim.state.crashReason).toBeNull()
      expect(sim.state.onGround).toBe(true)
      // The derotation law lowers the nose smoothly instead of letting it fall (it fell at
      // 12-16 deg/s and hit the nose wheel at 4-6 m/s before).
      expect(touchPitch).toBeGreaterThan(4)
      expect(maxNoseDownRate).toBeLessThan(4)
    },
    30000,
  )

  it.each(['a220', 'a350', 'global8000'] as const)('%s: a 7 m/s main-gear touchdown on either main wheel breaks the gear', (id) => {
    for (const bank of [-4, 0, 4]) {
      const sim = mainGearSlam(id, 7, bank)
      expect(sim.state.crashReason, `bank ${bank}`).toBe(CRASH_REASONS.hardLanding)
    }
  })

  it('a hard 4.5 m/s A220 touchdown is survivable', () => {
    const sim = mainGearSlam('a220', 4.5, 0)
    expect(sim.state.crashReason).toBeNull()
    expect(sim.state.onGround).toBe(true)
  })

  it('a firm but normal 2.5 m/s A220 touchdown is not a hard landing', () => {
    const sim = mainGearSlam('a220', 2.5, 0)
    expect(sim.state.crashReason).toBeNull()
  })
})
