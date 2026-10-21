import { describe, expect, it } from 'vitest'
import { AIRPORTS, HOME_AIRPORT_ID, type AirportDef } from '../../config/airports'
import { RUNWAY } from '../../config/world'
import { QUALITY_PROFILES } from '../../config/quality'
import { airportLayout, inRect, runwayEnds, toLocal, type OrientedRect } from '../../game/airportGeometry'
import {
  AIRPORT_SITES,
  APPROACH_HALF_WIDTH,
  APPROACH_LENGTH,
  FLAT_MARGIN,
  approachLimit,
} from '../terrain/airportTerrain'
import { WATER_THRESHOLD, baseHeightAt } from '../terrain/heightField'
import { getTerrainSampler } from '../terrain/terrainSampler'
import { TREE_FREE_APPROACH, TREE_STRIDE, TREE_TILE, TREE_TYPE_COUNT, placeTreeTile, treesExcludedAt } from '../terrain/treePlacement'

const terrain = getTerrainSampler()
const DEG = Math.PI / 180

/** World point at (along, across) in an oriented rect's frame. */
function at(r: OrientedRect, along: number, across: number): { x: number; z: number } {
  const dx = Math.sin(r.headingDeg * DEG)
  const dz = -Math.cos(r.headingDeg * DEG)
  return { x: r.cx + dx * along - dz * across, z: r.cz + dz * along + dx * across }
}

/** Visits an oriented rect (grown by `grow`) on a lattice of `step` m, edges included. */
function forEachInOriented(r: OrientedRect, step: number, fn: (x: number, z: number) => void, grow = 0): void {
  const hl = r.length / 2 + grow
  const hw = r.width / 2 + grow
  for (let u = -hl; ; u = Math.min(u + step, hl)) {
    for (let v = -hw; ; v = Math.min(v + step, hw)) {
      const p = at(r, u, v)
      fn(p.x, p.z)
      if (v === hw) break
    }
    if (u === hl) break
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Natural (pre-constraint) heights over an airport's flat zone, 30 m lattice. */
function naturalOverZone(a: AirportDef): number[] {
  const out: number[] = []
  forEachInOriented(airportLayout(a).flatZone, 30, (x, z) => out.push(baseHeightAt(x, z)))
  return out
}

describe('airport terrain', () => {
  it('keeps the central field as before: elevation 12, runway 36/18 at the origin', () => {
    const c = AIRPORTS.find((a) => a.id === HOME_AIRPORT_ID)!
    expect(c.elevation).toBe(RUNWAY.elevation)
    expect(c.center).toEqual({ x: RUNWAY.centerX, z: RUNWAY.centerZ })
    expect(c.runway.headingDeg).toBe(0)
  })

  for (const a of AIRPORTS) {
    describe(a.name, () => {
      const layout = airportLayout(a)
      const site = AIRPORT_SITES.find((s) => s.def.id === a.id)!

      it('is exactly at its elevation over the flat zone (plus margin)', () => {
        forEachInOriented(
          layout.flatZone,
          7,
          (x, z) => {
            expect(terrain.heightAt(x, z)).toBe(a.elevation)
            expect(terrain.surfaceAt(x, z)).not.toBe('water')
          },
          FLAT_MARGIN,
        )
      })

      it('sits on land, at an elevation close to the natural ground', () => {
        const nat = naturalOverZone(a)
        // On land everywhere under the zone: no fill into the sea.
        expect(Math.min(...nat)).toBeGreaterThan(WATER_THRESHOLD)
        const med = median(nat)
        const cutFill = Math.max(...nat.map((h) => Math.abs(h - a.elevation)))
        if (a.id === HOME_AIRPORT_ID) {
          // Fixed by design at 12 m over low country.
          expect(Math.abs(med - a.elevation)).toBeLessThan(25)
        } else {
          expect(Math.abs(med - a.elevation)).toBeLessThan(5)
        }
        // No tall cliffs: the plateau never cuts or fills more than this.
        expect(cutFill).toBeLessThan(60)
      })

      it('blends smoothly into the surrounding terrain, which is mostly land', () => {
        const fz = layout.flatZone
        const hl = fz.length / 2 + FLAT_MARGIN
        const hw = fz.width / 2 + FLAT_MARGIN
        let water = 0
        let n = 0
        // Walk outwards along both axes and the diagonals from the plateau edge.
        const rays: [number, number, number, number][] = []
        for (const f of [-0.8, -0.3, 0, 0.4, 0.9]) {
          rays.push([f * hl, hw, 0, 1], [f * hl, -hw, 0, -1])
        }
        for (const f of [-0.7, 0, 0.6]) rays.push([hl, f * hw, 1, 0], [-hl, f * hw, -1, 0])
        rays.push([hl, hw, Math.SQRT1_2, Math.SQRT1_2], [-hl, -hw, -Math.SQRT1_2, -Math.SQRT1_2])
        for (const [u0, v0, du, dv] of rays) {
          let prev = a.elevation
          for (let t = 0; t <= site.blend + 300; t += 5) {
            const p = at(fz, u0 + du * t, v0 + dv * t)
            const h = terrain.heightAt(p.x, p.z)
            expect(Math.abs(h - prev)).toBeLessThan(4)
            prev = h
            if (t <= site.blend) {
              n++
              if (baseHeightAt(p.x, p.z) <= WATER_THRESHOLD) water++
            }
          }
        }
        expect(water / n).toBeLessThan(0.05)
      })

      it('keeps the approach surface clear at both runway ends', () => {
        for (const end of runwayEnds(a)) {
          const dx = Math.sin(end.headingDeg * DEG)
          const dz = -Math.cos(end.headingDeg * DEG)
          let worst = -Infinity
          for (let s = 0; s <= APPROACH_LENGTH; s += 23) {
            for (let l = -APPROACH_HALF_WIDTH; l <= APPROACH_HALF_WIDTH; l += 37.5) {
              // `s` metres out from the threshold (against the landing direction), `l` to the side.
              const x = end.threshold.x - dx * s - dz * l
              const z = end.threshold.z - dz * s + dx * l
              worst = Math.max(worst, terrain.heightAt(x, z) - approachLimit(site, s))
            }
          }
          expect(worst, `${a.id} ${end.designator}`).toBeLessThanOrEqual(0)
        }
      })

      it('reports paved on the runway centreline, taxiway and apron, grass or water just outside', () => {
        const rw = layout.runway
        for (let u = -rw.length / 2 + 1; u <= rw.length / 2 - 1; u += 20) {
          const p = at(rw, u, 0)
          expect(terrain.surfaceAt(p.x, p.z)).toBe('paved')
        }
        for (const r of [layout.taxiway, layout.apron, ...layout.connectors]) {
          const c = at(r, 0, 0)
          expect(terrain.surfaceAt(c.x, c.z)).toBe('paved')
        }
        const ap = layout.apron
        for (const [u, v] of [
          [-ap.length / 2 + 2, -ap.width / 2 + 2],
          [ap.length / 2 - 2, ap.width / 2 - 2],
        ]) {
          const p = at(ap, u, v)
          expect(terrain.surfaceAt(p.x, p.z)).toBe('paved')
        }
        const outside = [
          at(rw, 0, -rw.width / 2 - 5), // left of the runway (the taxiway is on the right)
          at(rw, rw.length / 2 + 5, 0), // past both ends
          at(rw, -rw.length / 2 - 5, 0),
          at(ap, 0, ap.width / 2 + 5), // behind the apron
          at(ap, ap.length / 2 + 5, 0),
        ]
        for (const p of outside) expect(['grass', 'water']).toContain(terrain.surfaceAt(p.x, p.z))
      })

      it('grows no trees in the flat zone, on paved ground or near the thresholds', () => {
        forEachInOriented(layout.flatZone, 25, (x, z) => expect(treesExcludedAt(x, z)).toBe(true), FLAT_MARGIN)
        for (const end of runwayEnds(a)) {
          const dx = Math.sin(end.headingDeg * DEG)
          const dz = -Math.cos(end.headingDeg * DEG)
          for (let s = 0; s <= TREE_FREE_APPROACH; s += 50) {
            for (let l = -APPROACH_HALF_WIDTH; l <= APPROACH_HALF_WIDTH; l += 50) {
              expect(treesExcludedAt(end.threshold.x - dx * s - dz * l, end.threshold.z - dz * s + dx * l)).toBe(true)
            }
          }
        }
        // Placed trees on every tile touching the plateau and the near approaches.
        const density = QUALITY_PROFILES.high.treeDensity
        const reach = a.runway.length / 2 + TREE_FREE_APPROACH
        const r = Math.max(reach, layout.flatZone.width / 2 + 400)
        const t0x = Math.floor((a.center.x - r) / TREE_TILE)
        const t1x = Math.floor((a.center.x + r) / TREE_TILE)
        const t0z = Math.floor((a.center.z - r) / TREE_TILE)
        const t1z = Math.floor((a.center.z + r) / TREE_TILE)
        let checked = 0
        for (let tx = t0x; tx <= t1x; tx += 2) {
          for (let tz = t0z; tz <= t1z; tz++) {
            const tile = placeTreeTile(terrain, tx, tz, density)
            for (let t = 0; t < TREE_TYPE_COUNT; t++) {
              const arr = tile.trees[t]
              for (let k = 0; k < arr.length; k += TREE_STRIDE) {
                const x = arr[k]
                const z = arr[k + 2]
                checked++
                expect(inRect(layout.flatZone, x, z, FLAT_MARGIN)).toBe(false)
                expect(terrain.surfaceAt(x, z)).toBe('grass')
                const { along, across } = toLocal(layout.runway, x, z)
                const out = Math.abs(along) - a.runway.length / 2
                expect(out <= TREE_FREE_APPROACH && Math.abs(across) <= APPROACH_HALF_WIDTH).toBe(false)
              }
            }
          }
        }
        // Woods do grow around every field, so the checks above are not vacuous.
        expect(checked).toBeGreaterThan(0)
      })
    })
  }
})
