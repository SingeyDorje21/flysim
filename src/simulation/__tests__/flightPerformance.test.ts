import { describe, expect, it } from 'vitest'
import { DEFAULT_AIRCRAFT } from '../../config/aircraft'
import { RUNWAY, SPAWNS } from '../../config/world'
import { liftCoefficient } from '../aerodynamics'
import { airDensity } from '../atmosphere'
import { AircraftPhysics } from '../AircraftPhysics'
import { createFlatTerrain } from '../flatTerrain'
import { DEG2RAD, RAD2DEG } from '../math'
import { airSpawn, dist2d, groundSpawn, makePhysics, run, verticalSpeedHold } from './helpers'

const LOW = { x: 0, y: 300, z: 0 }

/** Decelerates at idle holding altitude until the stall flag trips. */
function measureStall(flaps: number) {
  const sim = makePhysics(airSpawn(flaps > 0 ? 34 : 40, { throttle: 0, flaps, position: LOW }))
  const ap = verticalSpeedHold(() => 0)
  let warnAlpha = Number.NaN
  let result: { speed: number; alphaDeg: number; g: number } | null = null
  run(
    sim,
    120,
    (s) => s.setControls({ throttle: 0, flaps, pitch: ap(s) }),
    (s) => {
      const a = s.state.angleOfAttack * RAD2DEG
      if (Number.isNaN(warnAlpha) && s.state.stallWarning) warnAlpha = a
      if (s.state.stalled) result = { speed: s.state.airspeed, alphaDeg: a, g: s.state.gForce }
      return result !== null
    },
  )
  if (!result) throw new Error('never stalled')
  return { ...(result as { speed: number; alphaDeg: number; g: number }), warnAlpha }
}

describe('stall', () => {
  it('clean 1 g stall at 25-30 m/s, critical AoA 14-18 deg, warning >= 2 deg earlier', () => {
    const r = measureStall(0)
    expect(r.speed).toBeGreaterThanOrEqual(25)
    expect(r.speed).toBeLessThanOrEqual(30)
    expect(r.alphaDeg).toBeGreaterThanOrEqual(14)
    expect(r.alphaDeg).toBeLessThanOrEqual(18)
    expect(r.g).toBeGreaterThan(0.9)
    expect(r.g).toBeLessThan(1.1)
    expect(r.alphaDeg - r.warnAlpha).toBeGreaterThanOrEqual(2)
  }, 20000)

  it('full flaps cut the stall speed by 10-20 %', () => {
    const clean = measureStall(0)
    const full = measureStall(1)
    const reduction = 1 - full.speed / clean.speed
    expect(reduction).toBeGreaterThanOrEqual(0.1)
    expect(reduction).toBeLessThanOrEqual(0.2)
  }, 20000)

  it('lift peaks at the critical AoA and drops visibly beyond it', () => {
    const aero = DEFAULT_AIRCRAFT.aero
    const crit = aero.alphaCritDeg * DEG2RAD
    const clCrit = liftCoefficient(crit, 0, aero)
    expect(liftCoefficient(crit - 1 * DEG2RAD, 0, aero)).toBeLessThan(clCrit)
    expect(liftCoefficient(crit + 1 * DEG2RAD, 0, aero)).toBeLessThan(clCrit)
    expect(liftCoefficient(crit + 4 * DEG2RAD, 0, aero)).toBeLessThan(0.85 * clCrit)
    // Post-stall flat plate still produces some lift and is finite everywhere.
    for (let d = -180; d <= 180; d += 5) {
      expect(Number.isFinite(liftCoefficient(d * DEG2RAD, 0.5, aero))).toBe(true)
    }
  })
})

describe('take-off', () => {
  it('reaches 28 m/s in < 550 m and < 30 s; full aft stick lifts off before 750 m', () => {
    const sim = new AircraftPhysics({ terrain: createFlatTerrain(RUNWAY.elevation), spawn: SPAWNS.takeoff })
    const start = { ...sim.state.position }
    let t28 = -1
    let d28 = -1
    let liftoffT = -1
    let liftoffD = -1
    run(
      sim,
      60,
      (s) => {
        const st = s.state
        if (t28 < 0 && st.airspeed >= 28) {
          t28 = st.simTime
          d28 = dist2d(start, st.position)
        }
        if (t28 >= 0 && liftoffT < 0 && !st.onGround) {
          liftoffT = st.simTime
          liftoffD = dist2d(start, st.position)
        }
        // Full aft stick from 28 m/s until 2 s after lift-off, then a climb attitude.
        const pitch = t28 < 0 ? 0 : liftoffT < 0 || st.simTime < liftoffT + 2 ? 1 : 0.3
        s.setControls({ throttle: 1, flaps: 1 / 3, pitch })
      },
      (s) => s.state.crashed || (liftoffT > 0 && s.state.simTime > liftoffT + 25),
    )
    expect(t28).toBeGreaterThan(0)
    expect(t28).toBeLessThan(30)
    expect(d28).toBeLessThan(550)
    expect(liftoffT).toBeGreaterThan(0)
    expect(liftoffD).toBeLessThan(750)
    expect(sim.state.crashed).toBe(false)
    expect(sim.state.heightAboveGround).toBeGreaterThan(30)
  }, 20000)
})

describe('performance', () => {
  it('full-throttle level top speed is 55-68 m/s', () => {
    const sim = makePhysics(airSpawn(60, { throttle: 1, position: LOW }))
    const ap = verticalSpeedHold(() => 0)
    run(sim, 200, (s) => s.setControls({ throttle: 1, pitch: ap(s) }))
    expect(Math.abs(sim.state.verticalSpeed)).toBeLessThan(0.2)
    expect(sim.state.airspeed).toBeGreaterThanOrEqual(55)
    expect(sim.state.airspeed).toBeLessThanOrEqual(68)
  }, 20000)

  it('full-throttle climb at ~38 m/s is 2.5-5 m/s', () => {
    const cfg = DEFAULT_AIRCRAFT
    const sim = makePhysics(airSpawn(38, { throttle: 1, position: LOW }))
    const qbar = 0.5 * airDensity(LOW.y) * 38 * 38
    const alphaTarget = ((cfg.mass * 9.80665) / (qbar * cfg.wingArea) - cfg.aero.cl0) / cfg.aero.clAlpha
    let integ = 0
    let vs = 0
    let v = 0
    let n = 0
    run(sim, 60, (s) => {
      const err = alphaTarget - s.state.angleOfAttack
      integ = Math.max(-5, Math.min(5, integ + err * s.fixedDt))
      const cmd = 4 * err + 4 * integ - 0.5 * s.state.angularVelocity.x
      s.setControls({ throttle: 1, pitch: Math.max(-1, Math.min(1, cmd)) })
      if (s.state.simTime > 40) {
        vs += s.state.verticalSpeed
        v += s.state.airspeed
        n++
      }
    })
    expect(Math.abs(v / n - 38)).toBeLessThan(2)
    expect(vs / n).toBeGreaterThanOrEqual(2.5)
    expect(vs / n).toBeLessThanOrEqual(5)
  }, 20000)

  it('engine spool reaches 0.9 within 1-3 s of a 0 -> 1 throttle step', () => {
    const sim = makePhysics(groundSpawn())
    expect(sim.state.engine.spool).toBe(0)
    let t = -1
    run(
      sim,
      5,
      (s) => s.setControls({ throttle: 1, brakes: 1 }),
      (s) => {
        if (s.state.engine.spool >= 0.9) t = s.state.simTime
        return t >= 0
      },
    )
    expect(t).toBeGreaterThanOrEqual(1)
    expect(t).toBeLessThanOrEqual(3)
    expect(sim.state.engine.rpm).toBeGreaterThan(2400)
    expect(sim.state.engine.thrust).toBeGreaterThan(1500)
  })
})

describe('engine off', () => {
  it('produces no thrust and spool stays at 0', () => {
    const sim = makePhysics(airSpawn(40, { engineRunning: false, throttle: 1 }))
    run(sim, 3, (s) => s.setControls({ throttle: 1 }))
    expect(sim.state.engine.running).toBe(false)
    expect(sim.state.engine.spool).toBe(0)
    expect(sim.state.engine.thrust).toBe(0)
    expect(sim.state.engine.rpm).toBeLessThan(DEFAULT_AIRCRAFT.engine.idleRpm * 2 + 1)
  })
})

describe('control response at 45 m/s', () => {
  it('pitch +1 gives a positive (nose-up) pitch rate within 0.5 s', () => {
    const sim = makePhysics(airSpawn(45))
    const p0 = sim.state.pitchDeg
    let ok = false
    run(sim, 0.5, (s) => s.setControls({ pitch: 1 }), (s) => (ok = s.state.angularVelocity.x > 0.05))
    expect(ok).toBe(true)
    run(sim, 0.5, (s) => s.setControls({ pitch: 1 }))
    expect(sim.state.pitchDeg).toBeGreaterThan(p0)
  })

  it('roll +1 rolls right (omega.z < 0) to >= 30 deg bank within 3 s', () => {
    const sim = makePhysics(airSpawn(45))
    let reached = -1
    run(
      sim,
      3,
      (s) => s.setControls({ roll: 1 }),
      (s) => {
        if (s.state.bankDeg >= 30) reached = s.state.simTime
        return reached >= 0
      },
    )
    expect(reached).toBeGreaterThan(0)
    expect(sim.state.angularVelocity.z).toBeLessThan(0)
  })

  it('yaw +1 yaws the nose right (omega.y < 0) and increases heading', () => {
    for (const heading of [0, 90]) {
      const sim = makePhysics(airSpawn(45, { headingDeg: heading }))
      run(sim, 0.5, (s) => s.setControls({ yaw: 1 }))
      expect(sim.state.angularVelocity.y).toBeLessThan(0)
      run(sim, 1.5, (s) => s.setControls({ yaw: 1 }))
      let d = sim.state.headingDeg - heading
      if (d > 180) d -= 360
      if (d < -180) d += 360
      expect(d).toBeGreaterThan(2)
    }
  })

  it('hands-off after a bank disturbance from trimmed level flight keeps |bank| < 30 deg for 30 s', () => {
    const sim = makePhysics(airSpawn(45, { throttle: 0.45 }))
    run(sim, 0.6, (s) => s.setControls({ roll: 0.5 }))
    const disturbed = Math.abs(sim.state.bankDeg)
    expect(disturbed).toBeGreaterThan(5)
    let maxBank = 0
    run(
      sim,
      30,
      (s) => s.setControls({ roll: 0 }),
      (s) => {
        maxBank = Math.max(maxBank, Math.abs(s.state.bankDeg))
        return false
      },
    )
    expect(maxBank).toBeLessThan(30)
    expect(Math.abs(sim.state.bankDeg)).toBeLessThan(disturbed)
    expect(sim.state.crashed).toBe(false)
  })

  it('airborne spawn is trimmed: nose above the flight path, ~1 g, positive AoA below the warning', () => {
    const sim = makePhysics(airSpawn(45))
    expect(sim.state.angleOfAttack).toBeGreaterThan(0)
    expect(sim.state.stallWarning).toBe(false)
    expect(sim.state.gForce).toBeGreaterThan(0.95)
    expect(sim.state.gForce).toBeLessThan(1.05)
    expect(sim.state.pitchDeg).toBeCloseTo(0, 6)
    expect(sim.state.airspeed).toBeCloseTo(45, 6)
    run(sim, 2)
    expect(Math.abs(sim.state.angularVelocity.x)).toBeLessThan(0.05)
  })
})

describe('landing spawn', () => {
  it('hands-off for 5 s: |vertical speed| < 4 m/s and no stall', () => {
    const sim = new AircraftPhysics({ terrain: createFlatTerrain(RUNWAY.elevation), spawn: SPAWNS.landing })
    let maxVs = 0
    let stalled = false
    run(sim, 5, undefined, (s) => {
      maxVs = Math.max(maxVs, Math.abs(s.state.verticalSpeed))
      stalled = stalled || s.state.stalled
      return false
    })
    expect(maxVs).toBeLessThan(4)
    expect(stalled).toBe(false)
    expect(sim.state.crashed).toBe(false)
  })
})
