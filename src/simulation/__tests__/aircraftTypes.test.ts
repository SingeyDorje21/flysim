/**
 * Behaviour shared by every aircraft type: settled spawns, engine spool,
 * reversers, gear, ground spoilers, fly-by-wire holds and protections,
 * determinism, frame-rate independence, reset and numerical safety.
 *
 * Targets (estimates from typical type data, documented per test):
 *  - Turbofan idle -> 95 % take-off thrust in 5-7 s for the airliners and the
 *    business jet (certification requires < 5 s to 95 % from flight idle;
 *    ground idle is slower), 2.5-5 s for the F119 (fighter engine).
 *  - Gear transit 6-10 s airliners / business jet, ~4 s F-22.
 *  - Airbus-style protections: bank <= 67 deg, back to 33 deg when released,
 *    AoA never past the critical angle.
 */

import { describe, expect, it } from 'vitest'
import { AIRCRAFT_CONFIGS, type AircraftConfig } from '../../config/aircraft'
import { AIRCRAFT_IDS, getAircraft, type AircraftId } from '../../config/aircraftCatalog'
import { AircraftPhysics, CRASH_REASONS } from '../AircraftPhysics'
import { FixedTimestep } from '../FixedTimestep'
import { createFlatTerrain } from '../flatTerrain'
import type { AircraftState, ControlInputs, SpawnState } from '../types'
import { dist2d, flightPath, groundSpawn, machSpawn, makeAircraft, run } from './helpers'

const JETS: AircraftId[] = ['f22', 'a220', 'a350', 'global8000']
const AIRLINERS: AircraftId[] = ['a220', 'a350', 'global8000']
const RAD = 180 / Math.PI

function numbers(s: AircraftState): number[] {
  return [
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
}
const allFinite = (s: AircraftState) => numbers(s).every(Number.isFinite)

/** Approach-speed airborne spawn at 1,500 m, gear down. */
function approachSpawn(id: AircraftId, overrides: Partial<SpawnState> = {}): SpawnState {
  return machSpawn(0, 1500, { airspeed: getAircraft(id).speeds.approach * 1.6, throttle: 0.5, gearUp: false, ...overrides })
}

/** Deterministic, time-varying pilot inputs exercising every system. */
function scripted(t: number): Partial<ControlInputs> {
  return {
    throttle: 0.6 + 0.4 * Math.sin(t * 0.3),
    pitch: 0.4 * Math.sin(t * 1.3),
    roll: 0.6 * Math.sin(t * 0.7),
    yaw: 0.3 * Math.sin(t * 2.1),
    flaps: t > 5 ? 1 / 3 : 0,
    speedbrake: t > 8 && t < 12 ? 1 : 0,
    gear: t > 3 ? 0 : 1,
  }
}

describe('spawns', () => {
  it.each(AIRCRAFT_IDS)('%s: ground spawn rests settled on its gear and stays parked (no creep, no jitter)', (id) => {
    const sim = makeAircraft(id, groundSpawn({ position: { x: 5, y: 999, z: 7 } }), createFlatTerrain(12))
    const st = sim.state
    expect(st.position.y).toBeCloseTo(12 - getAircraft(id).geometry.gear.mainLeft.y, 9)
    expect(st.onGround).toBe(true)
    expect(st.gearPosition).toBe(1)
    expect(st.controls.gear).toBe(1)
    expect(st.heightAboveGround).toBeCloseTo(0, 6)
    expect(st.gForce).toBeCloseTo(1, 3)
    let maxVy = 0
    run(sim, 10, (s) => s.setControls({ brakes: 1, throttle: 0 }), (s) => {
      maxVy = Math.max(maxVy, Math.abs(s.state.velocity.y))
      return false
    })
    expect(maxVy).toBeLessThan(0.01)
    // Idle thrust against the brakes only moves the regularised friction a few cm.
    expect(dist2d({ x: 5, z: 7 }, sim.state.position)).toBeLessThan(0.06)
    expect(Math.abs(sim.state.heightAboveGround)).toBeLessThan(0.05)
    expect(sim.state.onGround).toBe(true)
    expect(sim.state.crashed).toBe(false)
  })

  it.each(JETS)('%s: airborne fly-by-wire spawn holds level flight hands-off (pitchDeg = flight path)', (id) => {
    const cruise = id === 'f22' ? machSpawn(0.9, 9000, { throttle: 0.6 }) : machSpawn(0.78, 10000, { throttle: 0.7 })
    const sim = makeAircraft(id, cruise)
    expect(sim.state.gForce).toBeGreaterThan(0.97)
    expect(sim.state.gForce).toBeLessThan(1.03)
    expect(Math.abs(sim.state.verticalSpeed)).toBeLessThan(1e-6)
    expect(sim.state.angleOfAttack).toBeGreaterThan(0)
    expect(sim.state.pitchDeg).toBeCloseTo(sim.state.angleOfAttack * RAD, 6)
    const h0 = sim.state.altitude
    run(sim, 30, (s) => s.setControls({ throttle: cruise.throttle }))
    expect(Math.abs(sim.state.altitude - h0)).toBeLessThan(30)
    expect(Math.abs(sim.state.verticalSpeed)).toBeLessThan(1)
    expect(Math.abs(sim.state.bankDeg)).toBeLessThan(1)
  })

  it.each(JETS)('%s: airborne spawn has the gear down unless gearUp; controls.gear reflects it', (id) => {
    const down = makeAircraft(id, approachSpawn(id))
    expect(down.state.gearPosition).toBe(1)
    expect(down.state.controls.gear).toBe(1)
    const up = makeAircraft(id, approachSpawn(id, { gearUp: true }))
    expect(up.state.gearPosition).toBe(0)
    expect(up.state.controls.gear).toBe(0)
    run(up, 2)
    expect(up.state.gearPosition).toBe(0)
  })

  it('the trainer has fixed gear: always down, gear-up commands are discarded', () => {
    const sim = makeAircraft('trainer', machSpawn(0, 1000, { airspeed: 45, gearUp: true }))
    expect(sim.state.gearPosition).toBe(1)
    sim.setControls({ gear: 0 })
    run(sim, 2)
    expect(sim.state.gearPosition).toBe(1)
    expect(sim.state.controls.gear).toBe(1)
  })
})

describe('engines', () => {
  /** Seconds from idle to 95 % of the steady thrust on the brakes (throttle 1; F-22 just below the afterburner detent). */
  function spoolTime(id: AircraftId) {
    const throttle = id === 'f22' ? 0.94 : 1
    const steady = makeAircraft(id, groundSpawn())
    run(steady, 30, (s) => s.setControls({ throttle, brakes: 1 }))
    const full = steady.state.engine.thrust
    const sim = makeAircraft(id, groundSpawn())
    let t50 = -1
    let t95 = -1
    run(sim, 30, (s) => s.setControls({ throttle, brakes: 1 }), (s) => {
      const T = s.state.engine.thrust
      if (t50 < 0 && T >= 0.5 * full) t50 = s.state.simTime
      if (T >= 0.95 * full) t95 = s.state.simTime
      return t95 > 0
    })
    return { t50, t95, n1: sim.state.engine.n1 }
  }

  it.each(AIRLINERS)('%s: idle to 95 %% thrust in 5-7 s, slow at low N1 and faster near the top', (id) => {
    const r = spoolTime(id)
    expect(r.t95).toBeGreaterThanOrEqual(5)
    expect(r.t95).toBeLessThanOrEqual(7)
    // The second half of the thrust comes in much less time than the first half.
    expect(r.t95 - r.t50).toBeLessThan(0.6 * r.t50)
    expect(r.n1).toBeGreaterThan(0.95)
  })

  it('f22: idle to 95 % military thrust in 2.5-5 s; the afterburner lights shortly after selection', () => {
    const r = spoolTime('f22')
    expect(r.t95).toBeGreaterThanOrEqual(2.5)
    expect(r.t95).toBeLessThanOrEqual(5)

    // Airborne at military power, then into the afterburner detent.
    const sim = makeAircraft('f22', machSpawn(0.8, 6000, { throttle: 0.94 }))
    run(sim, 5, (s) => s.setControls({ throttle: 0.94 }))
    expect(sim.state.engine.afterburner).toBe(false)
    const dry = sim.state.engine.thrust
    let lit = -1
    const t0 = sim.state.simTime
    run(sim, 4, (s) => s.setControls({ throttle: 1 }), (s) => {
      if (lit < 0 && s.state.engine.afterburner) lit = s.state.simTime - t0
      return false
    })
    expect(lit).toBeGreaterThan(0.3)
    expect(lit).toBeLessThan(1.5)
    expect(sim.state.engine.thrust).toBeGreaterThan(1.25 * dry)
    // Out of the detent: the afterburner goes out at once.
    sim.setControls({ throttle: 0.9 })
    sim.step()
    expect(sim.state.engine.afterburner).toBe(false)
  })

  it.each(['a220', 'a350', 'global8000'] as AircraftId[])(
    '%s: reverse thrust (~35 %% of max forward) on the ground at idle only',
    (id) => {
      const fwd = makeAircraft(id, groundSpawn())
      run(fwd, 30, (s) => s.setControls({ throttle: 1, brakes: 1 }))
      const maxForward = fwd.state.engine.thrust

      const sim = makeAircraft(id, groundSpawn())
      run(sim, 15, (s) => s.setControls({ throttle: 0, reverse: 1, brakes: 1 }))
      const rev = -sim.state.engine.thrust / maxForward
      expect(rev).toBeGreaterThan(0.3)
      expect(rev).toBeLessThan(0.42)

      // Not with the throttle advanced.
      const hot = makeAircraft(id, groundSpawn())
      run(hot, 10, (s) => s.setControls({ throttle: 0.5, reverse: 1, brakes: 1 }))
      expect(hot.state.engine.thrust).toBeGreaterThan(0)

      // Never in the air.
      const air = makeAircraft(id, approachSpawn(id, { throttle: 0 }))
      let minThrust = Number.POSITIVE_INFINITY
      run(air, 10, (s) => s.setControls({ throttle: 0, reverse: 1 }), (s) => {
        minThrust = Math.min(minThrust, s.state.engine.thrust)
        return false
      })
      expect(minThrust).toBeGreaterThan(0)
    },
  )

  it('types without reversers ignore the reverse lever', () => {
    for (const id of ['trainer', 'f22'] as AircraftId[]) {
      const sim = makeAircraft(id, groundSpawn())
      run(sim, 5, (s) => s.setControls({ throttle: 0, reverse: 1, brakes: 1 }))
      expect(sim.state.controls.reverse).toBe(0)
      expect(sim.state.engine.thrust).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('landing gear', () => {
  it.each(JETS)('%s: gear up is refused with weight on wheels (the command is discarded)', (id) => {
    const sim = makeAircraft(id, groundSpawn())
    sim.setControls({ gear: 0 })
    run(sim, 3)
    expect(sim.state.controls.gear).toBe(1)
    expect(sim.state.gearPosition).toBe(1)
    expect(sim.state.onGround).toBe(true)
  })

  it.each(JETS)('%s: gear retracts and extends in the type transit time and adds drag when down', (id) => {
    const expected = { f22: [3.5, 4.5], a220: [6, 10], a350: [6, 10], global8000: [6, 10] } as Record<string, number[]>
    const sim = makeAircraft(id, approachSpawn(id))
    let tUp = -1
    run(sim, 15, (s) => s.setControls({ gear: 0 }), (s) => {
      if (s.state.gearPosition === 0) tUp = s.state.simTime
      return tUp > 0
    })
    expect(tUp).toBeGreaterThanOrEqual(expected[id][0])
    expect(tUp).toBeLessThanOrEqual(expected[id][1])
    const t0 = sim.state.simTime
    let tDown = -1
    run(sim, 15, (s) => s.setControls({ gear: 1 }), (s) => {
      if (s.state.gearPosition === 1) tDown = s.state.simTime - t0
      return tDown > 0
    })
    expect(tDown).toBeCloseTo(tUp, 1)

    // Gear drag: idle deceleration over 10 s is larger with the gear down.
    const decel = (gearUp: boolean) => {
      const s2 = makeAircraft(id, approachSpawn(id, { gearUp, throttle: 0 }))
      run(s2, 10, (s) => s.setControls({ throttle: 0 }))
      return s2.state.airspeed
    }
    expect(decel(false)).toBeLessThan(decel(true) - 0.3)
  })

  it.each(JETS)('%s: a gear-up landing is a belly / pod strike crash', (id) => {
    const info = getAircraft(id)
    const sim = makeAircraft(
      id,
      machSpawn(0, -info.geometry.gear.mainLeft.y + 3, {
        airspeed: info.speeds.approach,
        throttle: 0.3,
        gearUp: true,
        flaps: info.landingFlaps,
        pitchDeg: -2,
      }),
    )
    // A gentle push so ground effect cannot float it.
    run(sim, 20, (s) => s.setControls({ throttle: 0.3, pitch: -0.05 }), (s) => s.state.crashed)
    expect(sim.state.crashed).toBe(true)
    expect([CRASH_REASONS.belly, CRASH_REASONS.engine, CRASH_REASONS.tail, CRASH_REASONS.nose]).toContain(
      sim.state.crashReason,
    )
  })

  it.each([
    ['a350', 2.5, 4.5],
    ['a220', 2.5, 4.5],
    ['global8000', 2.5, 4.5],
    ['f22', 3, 5],
  ] as [AircraftId, number, number][])('%s: a %s m/s touchdown survives, %s m/s is a hard landing', (id, soft, hard) => {
    const touch = (sink: number) => {
      const info = getAircraft(id)
      const sim = makeAircraft(
        id,
        machSpawn(0, -info.geometry.gear.mainLeft.y + 0.3, { airspeed: info.speeds.approach, throttle: 0.3, gearUp: false, flaps: info.landingFlaps }),
      )
      sim.state.velocity.y -= sink
      run(sim, 4, (s) => s.setControls({ throttle: 0 }), (s) => s.state.crashed)
      return sim.state
    }
    const ok = touch(soft)
    expect(ok.crashed).toBe(false)
    expect(ok.onGround).toBe(true)
    expect(touch(hard).crashReason).toBe(CRASH_REASONS.hardLanding)
  })
})

describe('speed brakes and ground spoilers', () => {
  it.each(JETS)('%s: ground spoilers deploy on the landing roll at idle, not with power on', (id) => {
    const info = getAircraft(id)
    const idle = makeAircraft(id, groundSpawn({ airspeed: info.speeds.approach, flaps: info.landingFlaps }))
    run(idle, 1.5, (s) => s.setControls({ throttle: 0 }))
    expect(idle.state.speedbrakePosition).toBeGreaterThan(0.99)
    const power = makeAircraft(id, groundSpawn({ airspeed: info.speeds.approach, flaps: info.landingFlaps }))
    run(power, 1.5, (s) => s.setControls({ throttle: 0.6 }))
    expect(power.state.speedbrakePosition).toBe(0)
  })

  it.each(JETS)('%s: in-flight speed brakes add drag', (id) => {
    const decel = (sb: number) => {
      const sim = makeAircraft(id, approachSpawn(id, { throttle: 0 }))
      run(sim, 10, (s) => s.setControls({ throttle: 0, speedbrake: sb }))
      expect(sim.state.speedbrakePosition).toBeCloseTo(sb, 6)
      return sim.state.airspeed
    }
    expect(decel(1)).toBeLessThan(decel(0) - 1)
  })
})

describe('fly-by-wire', () => {
  it.each(AIRLINERS)('%s: bank protection: full stick stops near 67 deg, released it returns to 33 deg', (id) => {
    const sim = makeAircraft(id, machSpawn(0, 3000, { airspeed: getAircraft(id).speeds.approach * 2, throttle: 0.6, gearUp: true }))
    let maxBank = 0
    run(sim, 25, (s) => s.setControls({ roll: 1 }), (s) => {
      maxBank = Math.max(maxBank, Math.abs(s.state.bankDeg))
      return false
    })
    expect(maxBank).toBeGreaterThan(60)
    expect(maxBank).toBeLessThan(70)
    run(sim, 30, (s) => s.setControls({ roll: 0 }))
    expect(Math.abs(sim.state.bankDeg)).toBeGreaterThan(29)
    expect(Math.abs(sim.state.bankDeg)).toBeLessThan(36)
    expect(sim.state.crashed).toBe(false)
  })

  it.each(AIRLINERS)('%s: AoA protection: full aft stick at idle never stalls', (id) => {
    const sim = makeAircraft(id, machSpawn(0, 3000, { airspeed: getAircraft(id).speeds.stallClean * 1.5, throttle: 0, gearUp: true }))
    let maxAlpha = 0
    let stalled = false
    run(sim, 60, (s) => s.setControls({ pitch: 1, throttle: 0 }), (s) => {
      maxAlpha = Math.max(maxAlpha, s.state.angleOfAttack * RAD)
      stalled = stalled || s.state.stalled
      return false
    })
    expect(stalled).toBe(false)
    expect(maxAlpha).toBeLessThan(AIRCRAFT_CONFIGS[id].aero.alphaCritDeg)
    expect(maxAlpha).toBeGreaterThan(AIRCRAFT_CONFIGS[id].aero.alphaCritDeg - 4)
  })

  it.each(AIRLINERS)('%s: overspeed protection pitches up at full throttle and settles without oscillating', (id) => {
    const cfg = AIRCRAFT_CONFIGS[id]
    const sim = makeAircraft(id, machSpawn((cfg.mmo ?? 0.85) - 0.02, 11000, { throttle: 1 }))
    let gMin = 9
    let gMax = -9
    let maxMach = 0
    run(sim, 240, (s) => s.setControls({ throttle: 1 }), (s) => {
      if (s.state.simTime > 20) {
        gMin = Math.min(gMin, s.state.gForce)
        gMax = Math.max(gMax, s.state.gForce)
        maxMach = Math.max(maxMach, s.state.mach)
      }
      return false
    })
    expect(maxMach).toBeLessThan((cfg.mmo ?? 1) + 0.03)
    expect(gMin).toBeGreaterThan(0.85)
    expect(gMax).toBeLessThan(1.15)
  })

  it.each(JETS)('%s: auto-trim: after a pitch input the released stick holds the new flight path', (id) => {
    const sim = makeAircraft(id, id === 'f22' ? machSpawn(0.7, 5000, { throttle: 0.7 }) : machSpawn(0.6, 5000, { throttle: 0.8, gearUp: true }))
    run(sim, 3, (s) => s.setControls({ pitch: 0.3 }))
    run(sim, 2, (s) => s.setControls({ pitch: 0 }))
    const g0 = flightPath(sim)
    expect(g0 * RAD).toBeGreaterThan(1)
    run(sim, 10, (s) => s.setControls({ pitch: 0 }))
    expect(Math.abs(flightPath(sim) - g0) * RAD).toBeLessThan(1)
  })

  it('airliners are sluggish and the F-22 is crisp in roll', () => {
    const timeTo30 = (id: AircraftId, spawn: SpawnState) => {
      const sim = makeAircraft(id, spawn)
      let t = -1
      run(sim, 10, (s) => s.setControls({ roll: 1 }), (s) => {
        if (s.state.bankDeg >= 30) t = s.state.simTime
        return t > 0
      })
      return t
    }
    const a350 = timeTo30('a350', machSpawn(0.6, 5000, { throttle: 0.8 }))
    const f22 = timeTo30('f22', machSpawn(0.6, 5000, { throttle: 0.8 }))
    expect(a350).toBeGreaterThan(2)
    expect(f22).toBeLessThan(0.6)
    // The airliner's pitch inertia dwarfs the fighter's.
    expect(AIRCRAFT_CONFIGS.a350.inertia.x).toBeGreaterThan(50 * AIRCRAFT_CONFIGS.f22.inertia.x)
  })

  it('f22: no bank limit (full stick rolls through 90 deg in < 1.5 s); thrust vectoring adds pitch authority at low speed', () => {
    const sim = makeAircraft('f22', machSpawn(0.6, 5000, { throttle: 0.8 }))
    let t90 = -1
    run(sim, 3, (s) => s.setControls({ roll: 1 }), (s) => {
      if (Math.abs(s.state.bankDeg) >= 90) t90 = s.state.simTime
      return t90 > 0
    })
    expect(t90).toBeGreaterThan(0)
    expect(t90).toBeLessThan(1.5)

    const slow = makeAircraft('f22', machSpawn(0, 3000, { airspeed: 90, throttle: 1 }))
    let maxTv = 0
    run(slow, 2, (s) => s.setControls({ pitch: 1, throttle: 1 }), (s) => {
      maxTv = Math.max(maxTv, s.state.thrustVector)
      return false
    })
    expect(maxTv * RAD).toBeGreaterThan(10)
    expect(maxTv * RAD).toBeLessThanOrEqual(20 + 1e-9)
    // Without thrust vectoring the same pull is slower.
    const cfg: AircraftConfig = { ...AIRCRAFT_CONFIGS.f22, thrustVector: null }
    const pitchRate = (c?: AircraftConfig) => {
      const s2 = makeAircraft('f22', machSpawn(0, 3000, { airspeed: 60, throttle: 1, gearUp: true }), undefined, c)
      run(s2, 0.4, (s) => s.setControls({ pitch: 1, throttle: 1 }))
      return s2.state.angularVelocity.x
    }
    expect(pitchRate()).toBeGreaterThan(1.3 * pitchRate(cfg))
  })
})

describe('determinism, frame rate and reset (every type)', () => {
  const STEPS = 2400

  function runWithFrames(id: AircraftId, frames: (i: number) => number): AircraftState {
    const sim = new AircraftPhysics({ terrain: createFlatTerrain(12), spawn: groundSpawn({ flaps: getAircraft(id).takeoffFlaps }), aircraft: id })
    const ts = new FixedTimestep({ dt: sim.fixedDt })
    let steps = 0
    const step = () => {
      if (steps >= STEPS) return
      sim.setControls({ throttle: 1, flaps: getAircraft(id).takeoffFlaps, pitch: steps > 1800 ? 0.6 : 0, yaw: 0.05, gear: steps > 2200 ? 0 : 1 })
      sim.step()
      steps++
    }
    for (let i = 0; steps < STEPS && i < 100000; i++) ts.advance(frames(i), step)
    expect(steps).toBe(STEPS)
    return JSON.parse(JSON.stringify(sim.state)) as AircraftState
  }

  it.each(JETS)('%s: identical state for 30, 60, 144 Hz and jittery frames', (id) => {
    const ref = runWithFrames(id, () => 1 / 60)
    expect(runWithFrames(id, () => 1 / 30)).toStrictEqual(ref)
    expect(runWithFrames(id, () => 1 / 144)).toStrictEqual(ref)
    const jitter = [0.004, 0.031, 0.0167, 0.0001, 0.05, 0.009, 0.022]
    expect(runWithFrames(id, (i) => jitter[i % jitter.length])).toStrictEqual(ref)
  })

  it.each(JETS)('%s: two identical runs are bitwise equal', (id) => {
    const a = makeAircraft(id, approachSpawn(id))
    const b = makeAircraft(id, approachSpawn(id))
    for (let i = 0; i < 3000; i++) {
      const c = scripted(i / 120)
      a.setControls(c)
      b.setControls(c)
      a.step()
      b.step()
    }
    expect(b.state).toStrictEqual(a.state)
  })

  it.each(AIRCRAFT_IDS)('%s: reset(spawn) after flying equals a fresh instance, hidden state included', (id) => {
    const terrain = createFlatTerrain(12)
    const spawns: SpawnState[] = [groundSpawn({ flaps: getAircraft(id).takeoffFlaps }), approachSpawn(id), approachSpawn(id, { gearUp: true, throttle: 1 })]
    for (const spawn of spawns) {
      const flown = new AircraftPhysics({ terrain, spawn: approachSpawn(id, { throttle: 1 }), aircraft: id })
      run(flown, 20, (s) => s.setControls({ ...scripted(s.state.simTime), brakes: 0.5, trim: 0.7, reverse: 1 }))
      flown.setControls({ pitch: 1, roll: -1, throttle: 0.2, gear: 0, speedbrake: 1 })
      flown.reset(spawn)
      const fresh = new AircraftPhysics({ terrain, spawn, aircraft: id })
      expect(flown.state).toStrictEqual(fresh.state)
      expect(flown.previousState).toStrictEqual(flown.state)
      run(flown, 5)
      run(fresh, 5)
      expect(flown.state).toStrictEqual(fresh.state)
    }
  })
})

describe('numerical safety (every type)', () => {
  it.each(AIRCRAFT_IDS)('%s: extreme inputs for 60 s never produce NaN; quaternion normalised; rates and speed clamped', (id) => {
    const cfg = AIRCRAFT_CONFIGS[id]
    const sim = makeAircraft(id, machSpawn(0, 8000, { airspeed: Math.min(cfg.limits.maxSpeed * 0.6, 250), throttle: 1 }))
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
        gear: k % 6 < 3 ? 1 : 0,
        speedbrake: k % 3 ? 0 : 1,
        reverse: k % 2,
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
    expect(maxRate).toBeLessThanOrEqual(cfg.limits.maxAngularRate + 1e-9)
    expect(maxSpeed).toBeLessThanOrEqual(cfg.limits.maxSpeed + 1e-9)
  })

  it.each(AIRCRAFT_IDS)('%s: a vertical full-power dive stays finite and inside the type speed clamp', (id) => {
    const cfg = AIRCRAFT_CONFIGS[id]
    const sim = makeAircraft(id, machSpawn(0, 15000, { airspeed: cfg.limits.maxSpeed * 0.9, pitchDeg: -89, throttle: 1 }))
    run(sim, 30, (s) => s.setControls({ throttle: 1, pitch: -1 }), (s) => s.state.crashed)
    expect(allFinite(sim.state)).toBe(true)
    expect(sim.state.airspeed).toBeLessThanOrEqual(cfg.limits.maxSpeed + 1e-9)
  })

  it.each(AIRCRAFT_IDS)('%s: NaN spawn, NaN controls and non-finite terrain stay finite', (id) => {
    const terrain = { heightAt: () => Number.NaN, surfaceAt: () => 'paved' as const }
    const sim = new AircraftPhysics({
      terrain,
      aircraft: id,
      spawn: { position: { x: Number.NaN, y: 3000, z: 0 }, headingDeg: Number.NaN, airspeed: Number.NaN, throttle: Number.NaN, flaps: Number.NaN, onGround: false },
    })
    sim.setControls({ pitch: Number.NaN, gear: Number.NaN, speedbrake: Number.NaN, reverse: Number.POSITIVE_INFINITY, throttle: Number.NaN })
    run(sim, 2)
    expect(allFinite(sim.state)).toBe(true)
    expect(sim.state.controls.gear).toBe(1)
  })
})
