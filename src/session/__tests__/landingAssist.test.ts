import { beforeEach, describe, expect, it } from 'vitest'
import { AIRCRAFT_IDS, getAircraft, type AircraftId } from '../../config/aircraftCatalog'
import { getRunwayEnd, guidanceTo, headingVector, type RunwayEnd } from '../../game/airportGeometry'
import type { FlightPlace } from '../../game/spawns'
import { resetAutopilot, useAutopilotStore } from '../../state/autopilotStore'
import { FlightSession } from '../FlightSession'

const FRAME = 1 / 60
const store = () => useAutopilotStore.getState()
const DEG = Math.PI / 180

/** Runways long enough for each type: Central Field's 1,600 m strip is too short for the jets. */
const PLACE: Record<AircraftId, FlightPlace> = {
  trainer: { airportId: 'central', runwayEnd: '36' },
  f22: { airportId: 'central', runwayEnd: '36' },
  a220: { airportId: 'harbor', runwayEnd: '09R' },
  a350: { airportId: 'harbor', runwayEnd: '09R' },
  global8000: { airportId: 'harbor', runwayEnd: '09R' },
}

interface Setup {
  back?: number
  side?: number
  offDeg?: number
  /** Metres above the glide path. */
  above?: number
  place?: FlightPlace
  /** Runway end to fly towards, when not the place's own. */
  towards?: RunwayEnd
}

/**
 * A free flight placed `back` m before the runway, `side` m right of it,
 * heading `offDeg` off, `above` m above the glide path, gear up and clean.
 */
function approachSession(aircraft: AircraftId, o: Setup = {}) {
  const { back = 6000, side = 500, offDeg = 30, above = 130 } = o
  const place = o.place ?? PLACE[aircraft]
  const session = new FlightSession({ mode: 'freeFlight', aircraft, place, onFinish: () => {} })
  session.reset('freeFlight')
  const end = o.towards ?? getRunwayEnd(place.airportId, place.runwayEnd)
  const d = headingVector(end.headingDeg)
  const ac = getAircraft(aircraft)
  const onPath = (back + 300) * Math.tan(3 * DEG)
  session.physics.reset({
    position: {
      x: end.threshold.x - d.x * back - d.z * side,
      y: end.airport.elevation + onPath + above,
      z: end.threshold.z - d.z * back + d.x * side,
    },
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
    it(`${id}: flies the approach to 100 ft, configured for landing, then hands over for the flare`, () => {
      const { session, end } = approachSession(id)
      store().requestAssist()
      fly(session, 0.1)
      expect(store().assist?.runway).toBe(`${end.airport.code} ${end.designator}`)
      fly(session, 300, () => store().assist === null)
      expect(store().message).toMatch(new RegExp(`Stable at 100 ft on ${end.airport.code} ${end.designator}: flare and land`))
      const s = session.physics.state
      const g = guidanceTo(end, s.position.x, s.position.y, s.position.z)
      expect(s.heightAboveGround).toBeLessThan(32)
      expect(s.heightAboveGround).toBeGreaterThan(20)
      expect(Math.abs(g.lateral)).toBeLessThan(15)
      expect(Math.abs(g.vertical)).toBeLessThan(10)
      expect(g.distance).toBeGreaterThan(0)
      expect(Math.abs(s.airspeed - getAircraft(id).speeds.approach)).toBeLessThan(5)
      expect(s.controls.gear).toBe(1)
      expect(s.controls.flaps).toBeCloseTo(getAircraft(id).landingFlaps, 5)
      expect(s.controls.speedbrake).toBe(0)

      // It lets go trimmed: hands off, no jolt in the seconds before the flare.
      const gForces: number[] = []
      fly(session, 1.5, () => {
        gForces.push(session.physics.state.gForce)
        return false
      })
      expect(store().assist).toBeNull()
      expect(Math.min(...gForces)).toBeGreaterThan(0.75)
      expect(Math.max(...gForces)).toBeLessThan(1.25)
    })
  }

  it('says so when there is no runway ahead', () => {
    const { session } = approachSession('a220', { side: 0, offDeg: 180 })
    store().requestAssist()
    fly(session, 0.1)
    expect(store().assist).toBeNull()
    expect(store().message).toMatch(/no runway ahead/)
  })

  it('refuses a runway too short for the aircraft', () => {
    const { session } = approachSession('a350', { place: PLACE.trainer })
    store().requestAssist()
    fly(session, 0.1)
    expect(store().assist).toBeNull()
    expect(store().message).toMatch(/too short for this aircraft/)
  })

  it('refuses an approach it cannot fly: too high, or too far off the centreline', () => {
    const high = approachSession('trainer', { back: 2500, side: 0, offDeg: 0, above: 250 }).session
    store().requestAssist()
    fly(high, 0.1)
    expect(store().assist).toBeNull()
    expect(store().message).toMatch(/too high/)

    const wide = approachSession('trainer', { back: 2200, side: 400, offDeg: 20, above: 0 }).session
    store().requestAssist()
    fly(wide, 0.1)
    expect(store().assist).toBeNull()
    expect(store().message).toMatch(/too far off the centreline/)
  })

  it('prefers the runway the pilot chose over a closer parallel one', () => {
    const r = getRunwayEnd('harbor', '09R')
    const l = getRunwayEnd('harbor', '09L')
    // On 09R's centreline: on its own the assist picks 09R.
    const plain = approachSession('a220', { side: 0, offDeg: 0, towards: r, place: PLACE.a220 })
    const p = plain.session.physics.state.position
    expect(Math.abs(guidanceTo(l, p.x, 0, p.z).lateral)).toBeGreaterThan(300)
    store().requestAssist()
    fly(plain.session, 0.1)
    expect(store().assist?.runway).toBe('FSHI 09R')

    resetAutopilot()
    const chosen = approachSession('a220', { side: 0, offDeg: 0, towards: r, place: { airportId: 'harbor', runwayEnd: '09L' } })
    store().requestAssist()
    fly(chosen.session, 0.1)
    expect(store().assist?.runway).toBe('FSHI 09L')
  })

  it('goes around from an approach that is unstable near the ground, then hands over climbing', () => {
    const { session, end } = approachSession('trainer')
    store().requestAssist()
    fly(session, 0.1)
    fly(session, 300, () => session.physics.state.heightAboveGround < 70 || store().assist === null)
    expect(store().assist).not.toBeNull()
    // A sudden 80 m shove off the centreline below 250 ft: it cannot be fixed before 100 ft.
    const d = headingVector(end.headingDeg)
    session.physics.state.position.x += -d.z * 80
    session.physics.state.position.z += d.x * 80
    fly(session, 10, () => store().assist?.goingAround === true)
    expect(store().message).toBe('Unstable approach: going around')
    const heights: number[] = []
    fly(session, 120, () => {
      heights.push(session.physics.state.heightAboveGround)
      return store().assist === null
    })
    const s = session.physics.state
    expect(store().message).toMatch(/Go-around complete: you have control/)
    expect(s.crashed).toBe(false)
    expect(Math.min(...heights)).toBeGreaterThan(10)
    expect(s.heightAboveGround).toBeGreaterThanOrEqual(150)
    expect(s.verticalSpeed).toBeGreaterThan(0)
  })

  it('never hands a trainer (no speed brake) over far too fast: stable at 100 ft, or a go-around', () => {
    const { session } = approachSession('trainer', { back: 3000, side: 0, offDeg: 0, above: 40 })
    session.physics.state.velocity.z *= 1.6
    store().requestAssist()
    fly(session, 0.1)
    expect(store().assist).not.toBeNull()
    fly(session, 200, () => store().assist === null)
    const s = session.physics.state
    expect(s.crashed).toBe(false)
    if (/Stable at 100 ft/.test(store().message ?? '')) {
      expect(s.airspeed - getAircraft('trainer').speeds.approach).toBeLessThan(8)
    } else {
      expect(store().message).toMatch(/Go-around complete/)
    }
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

  it('cancelling in the trainer hands over trimmed: the nose does not drop', () => {
    const { session } = approachSession('trainer', { side: 300, offDeg: 10 })
    store().requestAssist()
    fly(session, 8)
    expect(store().assist).not.toBeNull()
    const pitchBefore = session.physics.state.pitchDeg
    store().requestAssist()
    fly(session, 3)
    expect(store().assist).toBeNull()
    expect(Math.abs(session.physics.state.pitchDeg - pitchBefore)).toBeLessThan(4)
  })

  it('leaves the speed brake switch in when it lets go', () => {
    const { session } = approachSession('a220')
    session.keyboard.keyDown('KeyV')
    session.keyboard.keyUp('KeyV')
    fly(session, 0.1)
    expect(session.physics.state.controls.speedbrake).toBe(1)
    store().requestAssist()
    fly(session, 3)
    store().requestAssist()
    fly(session, 0.2)
    expect(store().assist).toBeNull()
    expect(session.physics.state.controls.speedbrake).toBe(0)
  })

  it('stays engaged in the landing lesson (the lesson autothrust steps aside)', () => {
    const session = new FlightSession({ mode: 'lessonLanding', aircraft: 'trainer', onFinish: () => {} })
    session.reset('lessonLanding')
    fly(session, 1)
    store().requestAssist()
    fly(session, 2)
    expect(store().message ?? '').not.toMatch(/throttle moved/)
    expect(store().assist).not.toBeNull()
  })
})
