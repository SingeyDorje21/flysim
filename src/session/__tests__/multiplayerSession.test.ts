import { describe, expect, it } from 'vitest'
import { getAircraft, type AircraftId } from '../../config/aircraftCatalog'
import type { FlightResult } from '../../game/types'
import { getRunwayEnd, headingVector } from '../../game/airportGeometry'
import { HOME_PLACE, type FlightPlace } from '../../game/spawns'
import { FlightSession } from '../FlightSession'

const FRAME = 1 / 60

function session(
  online: boolean,
  onFinish: (r: FlightResult) => void = () => {},
  place: FlightPlace = HOME_PLACE,
  aircraft: AircraftId = 'trainer',
) {
  const s = new FlightSession({ mode: 'freeFlight', place, aircraft, multiplayerStart: online, onFinish })
  s.reset('freeFlight', place)
  return s
}

describe('multiplayer session hooks', () => {
  it('offline the spawn is the normal Free Flight line-up at the runway end', () => {
    const a = session(false).physics.state.position
    const b = new FlightSession({ mode: 'freeFlight', place: HOME_PLACE, onFinish: () => {} }).physics.state.position
    expect(a).toEqual(b)
  })

  it.each([
    HOME_PLACE,
    { airportId: 'central', runwayEnd: '18' },
    { airportId: 'harbor', runwayEnd: '09R' },
    { airportId: 'harbor', runwayEnd: '27L' },
  ])('online the spawn is the middle of runway $runwayEnd at $airportId, facing that way', (place) => {
    const s = session(true, () => {}, place)
    const end = getRunwayEnd(place.airportId, place.runwayEnd)
    const p = s.physics.state.position
    expect(p.x).toBeCloseTo(end.runway.rect.cx, 1)
    expect(p.z).toBeCloseTo(end.runway.rect.cz, 1)
    expect(s.physics.state.headingDeg).toBeCloseTo(end.headingDeg, 1)
    expect(s.physics.state.onGround).toBe(true)
  })

  it('an airliner that needs more than half the runway starts back from the middle, with its minimum ahead', () => {
    const place = { airportId: 'harbor', runwayEnd: '09R' }
    const s = session(true, () => {}, place, 'a350')
    const end = getRunwayEnd(place.airportId, place.runwayEnd)
    const d = headingVector(end.headingDeg)
    const p = s.physics.state.position
    const fromMiddle = (p.x - end.runway.rect.cx) * d.x + (p.z - end.runway.rect.cz) * d.z
    expect(end.runway.def.length / 2 - fromMiddle).toBeCloseTo(getAircraft('a350').minRunway, 1)
    expect(s.physics.state.headingDeg).toBeCloseTo(end.headingDeg, 1)
  })

  it('where even the full runway is short for it, an airliner lines up at the end as offline', () => {
    const online = session(true, () => {}, HOME_PLACE, 'a350').physics.state.position
    const offline = session(false, () => {}, HOME_PLACE, 'a350').physics.state.position
    expect(getRunwayEnd(HOME_PLACE.airportId, HOME_PLACE.runwayEnd).runway.def.length).toBeLessThan(
      getAircraft('a350').minRunway + 60,
    )
    expect(online.x).toBeCloseTo(offline.x, 3)
    expect(online.z).toBeCloseTo(offline.z, 3)
  })

  it('a restart keeps the mid-runway spawn, and turning it off goes back to the line-up', () => {
    const s = session(true)
    const p = { ...s.physics.state.position }
    s.frame(1, false)
    s.reset('freeFlight', HOME_PLACE)
    expect(s.physics.state.position.x).toBeCloseTo(p.x, 3)
    expect(s.physics.state.position.z).toBeCloseTo(p.z, 3)
    s.setMultiplayerStart(false)
    s.reset('freeFlight', HOME_PLACE)
    expect(s.physics.state.position).toEqual(session(false).physics.state.position)
  })

  it('forceCrash ends the flight with the mid-air reason', () => {
    let result: FlightResult | null = null
    const s = session(true, (r) => (result = r))
    s.physics.forceCrash('Mid-air collision with Bee')
    expect(s.physics.state).toMatchObject({ crashed: true, crashReason: 'Mid-air collision with Bee' })
    for (let i = 0; i < 240 && !result; i++) s.frame(FRAME, false)
    expect(result).toMatchObject({ outcome: 'failure', reason: 'Mid-air collision with Bee' })
  })

  it('forceCrash on a crashed aircraft keeps the first reason', () => {
    const s = session(true)
    s.physics.forceCrash('Terrain collision')
    s.physics.forceCrash('Mid-air collision with Bee')
    expect(s.physics.state.crashReason).toBe('Terrain collision')
  })

  it('a respawn clears the crash', () => {
    const s = session(true)
    s.physics.forceCrash('Mid-air collision with Bee')
    s.reset('freeFlight', HOME_PLACE)
    expect(s.physics.state.crashed).toBe(false)
  })
})
