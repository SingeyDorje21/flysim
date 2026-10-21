import { describe, expect, it } from 'vitest'
import { AIRPORTS } from '../../config/airports'
import { airportLayout, inRect, runwayEnds } from '../../game/airportGeometry'
import { buildAirportPlan, papiColors, planToWorld, type BuildingPlacement } from '../airport/plan'

const whiteCount = (deg: number) => papiColors(deg).filter(Boolean).length

describe('airport render plan', () => {
  it('produces a plan for every airport', () => {
    for (const a of AIRPORTS) {
      const p = buildAirportPlan(a)
      expect(p.pavement.length).toBeGreaterThanOrEqual(6)
      expect(p.markings.length).toBeGreaterThan(20)
      expect(p.lights.length).toBeGreaterThan(20)
      expect(p.papi).toHaveLength(2)
      p.papi.forEach((x) => expect(x.lights).toHaveLength(4))
      expect(p.buildings.length).toBeGreaterThan(0)
    }
  })

  it('designators match runwayEnds and read upright on approach', () => {
    for (const a of AIRPORTS) {
      const p = buildAirportPlan(a)
      const ends = runwayEnds(a)
      expect(p.designators.map((d) => d.text)).toEqual(ends.map((e) => e.designator))
      expect(p.designators[0].rotY).toBe(0)
      expect(p.designators[1].rotY).toBe(Math.PI)
      // each designator lies on its own half of the runway, near its threshold
      const d0 = planToWorld(a, p.designators[0].x, p.designators[0].z)
      const dist = (pt: { x: number; z: number }, q: { x: number; z: number }) => Math.hypot(pt.x - q.x, pt.z - q.z)
      expect(dist(d0, ends[0].threshold)).toBeLessThan(dist(d0, ends[1].threshold))
    }
  })

  it('PAPI is on the left of each end, abeam the aim point', () => {
    for (const a of AIRPORTS) {
      const ends = runwayEnds(a)
      const p = buildAirportPlan(a)
      p.papi.forEach((papi, i) => {
        const aim = ends[i].aimPoint
        const w = planToWorld(a, papi.cx, papi.cz)
        // bar centre is abeam: offset from the aim point is purely lateral
        const along = (w.x - aim.x) * Math.sin((ends[i].headingDeg * Math.PI) / 180) - (w.z - aim.z) * Math.cos((ends[i].headingDeg * Math.PI) / 180)
        expect(Math.abs(along)).toBeLessThan(0.01)
        const hr = (ends[i].headingDeg * Math.PI) / 180
        const rightOffset = (w.x - aim.x) * Math.cos(hr) + (w.z - aim.z) * Math.sin(hr)
        expect(rightOffset).toBeLessThan(-a.runway.width / 2)
      })
    }
  })

  it('PAPI colour logic', () => {
    expect(whiteCount(2.0)).toBe(0)
    expect(whiteCount(2.9)).toBe(2)
    expect(whiteCount(3.0)).toBe(2)
    expect(whiteCount(3.3)).toBe(3)
    expect(whiteCount(4.0)).toBe(4)
    expect(papiColors(3.0)).toEqual([true, true, false, false])
  })

  it('buildings are inside the flat zone and off paved areas', () => {
    for (const a of AIRPORTS) {
      const lay = airportLayout(a)
      const p = buildAirportPlan(a)
      const check = (b: BuildingPlacement) => {
        for (let i = 0; i <= 4; i++) {
          for (let j = 0; j <= 4; j++) {
            const x = b.x + (i / 2 - 1) * (b.width / 2)
            const z = b.z + (j / 2 - 1) * (b.depth / 2)
            const w = planToWorld(a, x, z)
            expect(inRect(lay.flatZone, w.x, w.z), `${a.id} ${b.kind} in flatZone`).toBe(true)
            for (const r of lay.paved) expect(inRect(r, w.x, w.z), `${a.id} ${b.kind} off pavement`).toBe(false)
          }
        }
      }
      p.buildings.forEach(check)
      check({ ...p.buildings[0], x: p.windsock.x, z: p.windsock.z, width: 1, depth: 1 })
    }
  })

  it('buildings follow the airport class', () => {
    const kinds = (id: string) => new Set(buildAirportPlan(AIRPORTS.find((a) => a.id === id)!).buildings.map((b) => b.kind))
    expect(kinds('harbor')).toContain('terminal')
    expect(kinds('harbor')).toContain('gate')
    expect(kinds('harbor')).toContain('hangar')
    expect(kinds('ridgeback')).toContain('shelter')
    expect(kinds('ridgeback')).toContain('control')
    expect(kinds('central')).not.toContain('terminal')
  })
})
