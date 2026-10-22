import { describe, expect, it } from 'vitest'
import { AIRPORTS, getAirport } from '../../config/airports'
import {
  GLIDE_SLOPE_DEG,
  airportLayout,
  approachGuidance,
  designator,
  getRunwayEnd,
  headingVector,
  inRect,
  isPavedAt,
  nearestAirport,
  runwayAt,
  airportFrame,
  airportRunways,
  runwayEnds,
  toLocal,
} from '../airportGeometry'
import { spawnFor } from '../spawns'

describe('runway geometry', () => {
  it('names runway ends from headings', () => {
    expect(designator(0)).toBe('36')
    expect(designator(90)).toBe('09')
    expect(designator(180)).toBe('18')
    expect(designator(270)).toBe('27')
    expect(designator(87)).toBe('09')
  })

  it('puts thresholds at the runway ends, landing in each direction', () => {
    const [r36, r18] = runwayEnds(getAirport('central'))
    expect(r36.designator).toBe('36')
    expect(r36.threshold.z).toBeCloseTo(800, 6)
    expect(r36.aimPoint.z).toBeCloseTo(500, 6)
    expect(r18.designator).toBe('18')
    expect(r18.threshold.z).toBeCloseTo(-800, 6)
    const [r09, r27] = runwayEnds(getAirport('harbor'))
    // The primary is the southern of two parallels: on the right flying east, on the left flying west.
    expect([r09.designator, r27.designator]).toEqual(['09R', '27L'])
    // Runway 09R is flown eastwards, so its threshold is the western end.
    expect(r09.threshold.x).toBeLessThan(getAirport('harbor').center.x)
  })

  it('gives every airport a second runway: parallels get L / R, crossing runways their own numbers', () => {
    for (const a of AIRPORTS) {
      const ends = runwayEnds(a).map((e) => e.designator)
      expect(ends.length, a.id).toBeGreaterThanOrEqual(4)
      expect(new Set(ends).size, a.id).toBe(ends.length)
    }
    expect(runwayEnds(getAirport('harbor')).map((e) => e.designator)).toEqual(['09R', '27L', '09L', '27R'])
    expect(runwayEnds(getAirport('central')).map((e) => e.designator)).toEqual(['36', '18', '09', '27'])
    // Secondary runways are parallel to the primary or cross it at 90 degrees.
    for (const a of AIRPORTS) {
      for (const r of a.runways) expect(Math.abs((r.headingDeg - a.runways[0].headingDeg) % 90), a.id).toBe(0)
    }
  })

  it('finds a lettered runway from a bare number', () => {
    expect(getRunwayEnd('harbor', '27').designator).toBe('27L')
    expect(getRunwayEnd('harbor', '27R').designator).toBe('27R')
    expect(getRunwayEnd('central', 'nonsense').designator).toBe('36')
  })

  it('handles rotated runways in local coordinates', () => {
    const a = getAirport('harbor')
    const r = airportFrame(a)
    const east = headingVector(90)
    const p = { x: a.center.x + east.x * 1000, z: a.center.z + east.z * 1000 }
    expect(toLocal(r, p.x, p.z).along).toBeCloseTo(1000, 6)
    expect(inRect(r, p.x, p.z)).toBe(true)
    expect(inRect(r, a.center.x, a.center.z + 100)).toBe(false)
  })

  it('every runway centreline and apron is paved, and nothing is paved far away', () => {
    for (const a of AIRPORTS) {
      expect(isPavedAt(a.center.x, a.center.z), a.id).toBe(true)
      const apron = airportLayout(a).apron
      expect(isPavedAt(apron.cx, apron.cz), a.id).toBe(true)
      expect(runwayAt(a.center.x, a.center.z)?.airport.id).toBe(a.id)
      for (const rw of airportRunways(a)) {
        expect(isPavedAt(rw.rect.cx, rw.rect.cz), `${a.id} runway ${rw.index}`).toBe(true)
        expect(runwayAt(rw.rect.cx, rw.rect.cz)?.airport.id).toBe(a.id)
      }
    }
    expect(isPavedAt(5000, 5000)).toBe(false)
  })

  it('airports are far enough apart that their flat zones never overlap', () => {
    for (const a of AIRPORTS) {
      for (const b of AIRPORTS) {
        if (a === b) continue
        expect(Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z), `${a.id}-${b.id}`).toBeGreaterThan(8000)
      }
    }
  })

  it('finds the nearest airport with its bearing', () => {
    const n = nearestAirport(0, 3000)
    expect(n.airport.id).toBe('central')
    expect(n.bearingDeg).toBeCloseTo(0, 6)
  })
})

describe('approach guidance', () => {
  it('locks onto the runway end ahead and measures glide-path deviation', () => {
    const end = getRunwayEnd('harbor', '27L')
    const d = headingVector(end.headingDeg)
    const out = 4000
    const aimDist = out + 300
    const onPath = end.airport.elevation + aimDist * Math.tan((GLIDE_SLOPE_DEG * Math.PI) / 180)
    const x = end.threshold.x - d.x * out
    const z = end.threshold.z - d.z * out
    const g = approachGuidance(x, onPath + 20, z, end.headingDeg)
    expect(g?.end.designator).toBe('27L')
    expect(g?.end.airport.id).toBe('harbor')
    expect(g!.distance).toBeCloseTo(out, 3)
    expect(g!.lateral).toBeCloseTo(0, 3)
    expect(g!.vertical).toBeCloseTo(20, 3)
  })

  it('ignores runways behind the aircraft or far off heading', () => {
    const end = getRunwayEnd('central', '36')
    expect(approachGuidance(end.threshold.x, 300, end.threshold.z + 3000, 180)).toBeNull()
  })
})

describe('spawns', () => {
  it('keeps the home-field take-off spawn where it always was', () => {
    const s = spawnFor('takeoff', { airportId: 'central', runwayEnd: '36' })
    expect(s.position.x).toBeCloseTo(0, 6)
    expect(s.position.z).toBeCloseTo(740, 6)
    expect(s.headingDeg).toBe(0)
    expect(s.onGround).toBe(true)
  })

  it('lines up on any runway end and starts landings on a 3 degree final', () => {
    for (const a of AIRPORTS) {
      for (const end of runwayEnds(a)) {
        const place = { airportId: a.id, runwayEnd: end.designator }
        const t = spawnFor('takeoff', place)
        expect(inRect(end.runway.rect, t.position.x, t.position.z), `${a.id} ${end.designator}`).toBe(true)
        expect(t.headingDeg).toBe(end.headingDeg)
        const l = spawnFor('landing', place)
        const g = approachGuidance(l.position.x, l.position.y, l.position.z, l.headingDeg)
        expect(g?.end.designator, `${a.id} ${end.designator}`).toBe(end.designator)
        expect(Math.abs(g!.vertical)).toBeLessThan(2)
      }
    }
  })
})
