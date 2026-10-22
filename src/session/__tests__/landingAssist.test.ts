import { beforeEach, describe, expect, it } from 'vitest'
import { AIRCRAFT_IDS, getAircraft, type AircraftId } from '../../config/aircraftCatalog'
import { getRunwayEnd, guidanceTo, headingVector } from '../../game/airportGeometry'
import { resetAutopilot, useAutopilotStore } from '../../state/autopilotStore'
import { FlightSession } from '../FlightSession'

const FRAME = 1 / 60
const store = () => useAutopilotStore.getState()

/** A free flight placed `back` m before Central Field's runway 36, `side` m right of it, heading `offDeg` off. */
function approachSession(aircraft: AircraftId, back = 6000, side = 500, offDeg = 30) {
  const session = new FlightSession({ mode: 'freeFlight', aircraft, onFinish: () => {} })
  session.reset('freeFlight')
  const end = getRunwayEnd('central', '36')
  const d = headingVector(end.headingDeg)
  const ac = getAircraft(aircraft)
  session.physics.reset({
    position: { x: end.threshold.x - d.x * back - d.z * side, y: end.airport.elevation + 450, z: end.threshold.z - d.z * back + d.x * side },
    headingDeg: (end.headingDeg + offDeg + 360) % 360,
    pitchDeg: 0,
    airspeed: aircraft === 'trainer' ? 45 : ac.speeds.approach * 1.4,
    throttle: 0.5,
    flaps: 0,
    onGround: false,
    gearUp: true,
  })
  session.keyboard.reset({ throttle: 0.5, flaps: 0, trim: 0, gear: 0 })
  return { session, end }
}

function fly(session: FlightSession, seconds: number, until: () => boolean = () => false): void {
  for (let t = 0; t < seconds && !until(); t += FRAME) session.frame(FRAME, false)
}

describe('landing assist (key 0)', () => {
  beforeEach(() => resetAutopilot())

  for (const id of AIRCRAFT_IDS) {
    it(`${id}: lines up with the runway and the glide path, configures for landing, then hands over`, () => {
      const { session, end } = approachSession(id)
      store().requestAssist()
      fly(session, 0.1)
      expect(store().assist?.runway).toBe('FSCF 36')
      fly(session, 200, () => store().assist === null)
      expect(store().message).toMatch(/Lined up with FSCF 36 on the glide path: you have control/)
      const s = session.physics.state
      const g = guidanceTo(end, s.position.x, s.position.y, s.position.z)
      expect(Math.abs(g.lateral)).toBeLessThan(10)
      expect(Math.abs(g.vertical)).toBeLessThan(8)
      // Handed over well before the runway, with gear down and landing flaps set.
      expect(g.distance).toBeGreaterThan(800)
      expect(s.controls.gear).toBe(1)
      expect(s.controls.flaps).toBeCloseTo(getAircraft(id).landingFlaps, 5)

      // It does not keep flying: hands off, the aircraft carries on as trimmed without a jolt.
      const gForces: number[] = []
      fly(session, 8, () => {
        gForces.push(session.physics.state.gForce)
        return false
      })
      const after = session.physics.state
      const g2 = guidanceTo(end, after.position.x, after.position.y, after.position.z)
      expect(store().assist).toBeNull()
      expect(Math.abs(g2.lateral)).toBeLessThan(25)
      expect(Math.abs(g2.vertical)).toBeLessThan(25)
      expect(Math.min(...gForces)).toBeGreaterThan(0.75)
      expect(Math.max(...gForces)).toBeLessThan(1.25)
    })
  }

  it('says so when there is no runway ahead', () => {
    const { session } = approachSession('a220', 6000, 0, 180)
    store().requestAssist()
    fly(session, 0.1)
    expect(store().assist).toBeNull()
    expect(store().message).toMatch(/no runway ahead/)
  })

  it('the stick, or pressing 0 again, cancels it', () => {
    const { session } = approachSession('a220')
    store().requestAssist()
    fly(session, 2)
    expect(store().assist).not.toBeNull()
    session.keyboard.keyDown('KeyA')
    fly(session, 0.3)
    session.keyboard.keyUp('KeyA')
    expect(store().assist).toBeNull()
    expect(store().message).toBe('Landing assist off: pilot input')

    // Once the stick has centred again, 0 engages it, and 0 once more cancels it.
    fly(session, 0.5)
    store().requestAssist()
    fly(session, 1)
    expect(store().assist).not.toBeNull()
    store().requestAssist()
    fly(session, 0.1)
    expect(store().assist).toBeNull()
    expect(store().message).toBe('Landing assist off')
  })
})
