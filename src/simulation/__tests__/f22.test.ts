/**
 * F-22 calibration (29.4 t game weight) against the published figures:
 * 2 x F119 (120 kN dry / 160 kN wet), supercruise Mach 1.76, Mach 2.25 max,
 * 65,000 ft ceiling, +9 / -3 g.
 */

import { describe, expect, it } from 'vitest'
import { getAircraft } from '../../config/aircraftCatalog'
import { dist2d, fbwAltitudeStick, fbwMachClimbStick, groundSpawn, machSpawn, makeAircraft, rotationStick, run } from './helpers'

/** Highest dry setting: just below the afterburner detent (0.95). */
const MIL = 0.94

describe('F-22', () => {
  it('afterburner take-off lifts off within 800 m', () => {
    const info = getAircraft('f22')
    const sim = makeAircraft('f22', groundSpawn())
    let rotate = false
    let liftoff = -1
    run(
      sim,
      60,
      (s) => {
        if (s.state.airspeed >= info.speeds.rotate) rotate = true
        s.setControls({ throttle: 1, pitch: rotate ? rotationStick(s, 12, 5) : 0 })
      },
      (s) => {
        if (liftoff < 0 && rotate && !s.state.onGround) liftoff = dist2d({ x: 0, z: 0 }, s.state.position)
        return s.state.crashed || (liftoff > 0 && s.state.heightAboveGround > 15)
      },
    )
    expect(sim.state.crashed).toBe(false)
    expect(sim.state.engine.afterburner).toBe(true)
    expect(liftoff).toBeGreaterThan(200)
    expect(liftoff).toBeLessThanOrEqual(800)
  }, 30000)

  it('supercruise: Mach 1.6-1.9 level at 12 km without afterburner', () => {
    const sim = makeAircraft('f22', machSpawn(1.3, 12000, { throttle: MIL }))
    let lit = false
    run(sim, 400, (s) => s.setControls({ throttle: MIL, pitch: fbwAltitudeStick(s, 12000) }), (s) => {
      lit = lit || s.state.engine.afterburner
      return false
    })
    expect(lit).toBe(false)
    expect(Math.abs(sim.state.verticalSpeed)).toBeLessThan(1)
    expect(sim.state.mach).toBeGreaterThanOrEqual(1.6)
    expect(sim.state.mach).toBeLessThanOrEqual(1.9)
  }, 30000)

  it('with afterburner: beyond Mach 2 level at 12 km, and the drag keeps it sane (< Mach 2.4)', () => {
    const sim = makeAircraft('f22', machSpawn(1.6, 12000, { throttle: 1 }))
    run(sim, 400, (s) => s.setControls({ throttle: 1, pitch: fbwAltitudeStick(s, 12000) }))
    expect(sim.state.engine.afterburner).toBe(true)
    expect(Math.abs(sim.state.verticalSpeed)).toBeLessThan(1)
    expect(sim.state.mach).toBeGreaterThan(2)
    expect(sim.state.mach).toBeLessThan(2.4)
  }, 30000)

  it('full aft stick holds ~9 g, limited by the fly-by-wire (never beyond 9.5 g); full forward ~-3 g', () => {
    const sim = makeAircraft('f22', machSpawn(0.9, 4000, { throttle: 1 }))
    let gMax = 0
    let sum = 0
    let n = 0
    run(sim, 4, (s) => s.setControls({ pitch: 1, throttle: 1 }), (s) => {
      gMax = Math.max(gMax, s.state.gForce)
      if (s.state.simTime >= 1.2) {
        sum += s.state.gForce
        n++
      }
      return false
    })
    expect(gMax).toBeGreaterThan(8.8)
    expect(gMax).toBeLessThan(9.5)
    expect(sum / n).toBeGreaterThan(8.5)
    expect(sim.state.crashed).toBe(false)

    const push = makeAircraft('f22', machSpawn(0.9, 6000, { throttle: 1 }))
    let gMin = 9
    run(push, 4, (s) => s.setControls({ pitch: -1, throttle: 1 }), (s) => {
      gMin = Math.min(gMin, s.state.gForce)
      return false
    })
    expect(gMin).toBeLessThan(-2.5)
    expect(gMin).toBeGreaterThan(-3.6)
  })

  it('climbs above 18 km on afterburner', () => {
    const sim = makeAircraft('f22', machSpawn(1.5, 12000, { throttle: 1 }))
    let maxAlt = 0
    run(sim, 300, (s) => s.setControls({ throttle: 1, pitch: fbwMachClimbStick(s, 1.5) }), (s) => {
      maxAlt = Math.max(maxAlt, s.state.altitude)
      return maxAlt > 18500
    })
    expect(maxAlt).toBeGreaterThan(18000)
    expect(sim.state.crashed).toBe(false)
  }, 30000)
})
