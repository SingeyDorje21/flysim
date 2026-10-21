/**
 * Pure render plan for one airport (no three.js). Everything is expressed in
 * the airport's local frame: origin = runway centre at field elevation,
 * x = across (right of the runway heading), z = -along (so heading 0 is -Z,
 * exactly like the world). The renderer rotates the group by -headingDeg.
 */

import type { AirportDef } from '../../config/airports'
import { airportLayout, headingVector, runwayEnds, runwayRect, toLocal, type OrientedRect } from '../../game/airportGeometry'

export type Rgb = readonly [number, number, number]

export const WHITE: Rgb = [0.92, 0.92, 0.9]
export const YELLOW: Rgb = [0.9, 0.7, 0.1]

/** Vertical layering above the field (m): apron < taxiway < connector < runway < markings < numbers. */
export const Y_APRON = 0.015
export const Y_TAXI = 0.022
export const Y_CONNECTOR = 0.026
export const Y_RUNWAY = 0.03
export const Y_MARK = 0.05
export const Y_TAXI_MARK = 0.04
export const Y_NUMBER = 0.056

export interface PavementPatch {
  kind: 'runway' | 'taxiway' | 'connector' | 'apron'
  /** Centre, local frame. */
  x: number
  z: number
  /** Rotation about Y relative to the runway frame (deg, heading difference). */
  relHeadingDeg: number
  /** Extent across the patch's own heading. */
  width: number
  /** Extent along the patch's own heading. */
  length: number
  y: number
  color: Rgb
}

export interface MarkingQuad {
  x: number
  z: number
  /** Across (x) and along (z) extents; markings are axis-aligned in the local frame. */
  width: number
  length: number
  y: number
  color: Rgb
}

export interface DesignatorPlacement {
  text: string
  x: number
  z: number
  /** Rotation about Y (rad): 0 for the lower-numbered end, PI for the reciprocal. */
  rotY: number
  width: number
  height: number
}

export type LightColor = 'white' | 'green' | 'red' | 'blue'

export interface LightPlacement {
  x: number
  z: number
  y: number
  color: LightColor
}

export interface PapiPlan {
  designator: string
  /** Four lights, index 0 nearest the runway. */
  lights: { x: number; z: number }[]
  /** Bar centre (local). */
  cx: number
  cz: number
}

export type BuildingKind = 'terminal' | 'gate' | 'tower' | 'tower-cab' | 'hangar' | 'shelter' | 'control'

export interface BuildingPlacement {
  kind: BuildingKind
  /** Footprint centre, local frame. */
  x: number
  z: number
  /** Footprint extent across (x) and along (z), axis-aligned in the local frame. */
  width: number
  depth: number
  /** Wall height; gable shapes add `ridge` on top. */
  height: number
  shape: 'box' | 'gable'
  ridge: number
  /** Elevation of the base above the field (tower cabs sit on the tower shaft). */
  base: number
  color: Rgb
}

export interface AirportPlan {
  airport: AirportDef
  pavement: PavementPatch[]
  markings: MarkingQuad[]
  designators: DesignatorPlacement[]
  lights: LightPlacement[]
  papi: PapiPlan[]
  buildings: BuildingPlacement[]
  windsock: { x: number; z: number }
}

/** Local frame -> world x/z for an airport. */
export function planToWorld(a: AirportDef, x: number, z: number): { x: number; z: number } {
  const d = headingVector(a.runway.headingDeg)
  const right = { x: -d.z, z: d.x }
  const along = -z
  return { x: a.center.x + d.x * along + right.x * x, z: a.center.z + d.z * along + right.z * x }
}

// ---------------------------------------------------------------- PAPI

/** Elevation-angle thresholds (deg) of the four PAPI units, innermost first. */
export const PAPI_THRESHOLDS_DEG: readonly number[] = [2.5, 2.83, 3.17, 3.5]

/**
 * Which PAPI lights show white for an eye at `angleDeg` above the units
 * (index 0 = nearest the runway). 2 white + 2 red = on the 3 degree path;
 * all white = too high; all red = too low.
 */
export function papiColors(angleDeg: number): boolean[] {
  return PAPI_THRESHOLDS_DEG.map((t) => angleDeg >= t)
}

// ---------------------------------------------------------------- plan

const rectLocal = (base: OrientedRect, r: OrientedRect) => {
  const p = toLocal(base, r.cx, r.cz)
  return { x: p.across, z: -p.along }
}

function pushKeys(out: MarkingQuad[], width: number, thrAlong: number, u: number): void {
  const n = width <= 30 ? 8 : width <= 45 ? 12 : 16
  const margin = 3
  const usable = width - 2 * margin
  const slot = usable / (n + 1)
  const stripe = slot * 0.55
  const keyLen = 30
  for (let i = 0; i <= n; i++) {
    if (i === n / 2) continue
    const x = -usable / 2 + slot * (i + 0.5)
    out.push({ x, z: -(thrAlong + u * (6 + keyLen / 2)), width: stripe, length: keyLen, y: Y_MARK, color: WHITE })
  }
}

function buildMarkings(a: AirportDef, out: MarkingQuad[], designators: DesignatorPlacement[]): void {
  const { length: L, width: W } = a.runway
  const ends = runwayEnds(a)
  const rr = runwayRect(a)
  // edge lines
  const edgeX = W / 2 - 0.9
  out.push({ x: -edgeX, z: 0, width: 0.45, length: L - 4, y: Y_MARK, color: WHITE })
  out.push({ x: edgeX, z: 0, width: 0.45, length: L - 4, y: Y_MARK, color: WHITE })
  // dashed centreline (30 m dashes, 20 m gaps), clear of the threshold areas
  const clear = 80
  const dashW = Math.max(0.5, W * 0.02)
  for (let s = -L / 2 + clear; s + 30 <= L / 2 - clear; s += 50) {
    out.push({ x: 0, z: -(s + 15), width: dashW, length: 30, y: Y_MARK, color: WHITE })
  }
  const charH = Math.min(12, W * 0.22)
  for (const e of ends) {
    const thr = toLocal(rr, e.threshold.x, e.threshold.z)
    const aim = toLocal(rr, e.aimPoint.x, e.aimPoint.z)
    const u = Math.sign(aim.along - thr.along) || 1
    // threshold bar across the very end
    out.push({ x: 0, z: -(thr.along + u * 1.2), width: W - 2, length: 1.2, y: Y_MARK, color: WHITE })
    pushKeys(out, W, thr.along, u)
    const dh = charH * 1.35
    designators.push({
      text: e.designator,
      x: 0,
      z: -(thr.along + u * (6 + 30 + 10 + dh / 2)),
      rotY: u > 0 ? 0 : Math.PI,
      width: charH * 1.8,
      height: dh,
    })
    // aiming point: two broad bars centred on the end's aimPoint
    const aimDist = Math.abs(aim.along - thr.along)
    const sc = W / 45
    const aimLen = Math.min(45 * Math.min(sc, 1.3), aimDist * 0.25)
    const aimW = Math.max(2.4, 6 * Math.min(sc, 1.3))
    for (const side of [-1, 1]) {
      out.push({ x: side * W * 0.18, z: -(aim.along + u * aimLen * 0.5), width: aimW, length: aimLen, y: Y_MARK, color: WHITE })
    }
    // touchdown zone bars: groups of 3, 2, 2, 1 pairs beyond the aim point
    const tdzLen = aimLen * 0.5
    const groups: [number, number][] = [
      [-aimDist * 0.5, 3],
      [aimDist * 0.5, 2],
      [aimDist * 1.0, 2],
      [aimDist * 1.5, 1],
    ]
    for (const [dist, count] of groups) {
      const along0 = aim.along + u * dist
      if (Math.abs(along0) > L / 2 - 120) continue
      if (dist < 0 && -dist > aimDist - 40) continue
      for (let k = 0; k < count; k++) {
        for (const side of [-1, 1]) {
          out.push({
            x: side * (W * 0.18 + 3 + k * 2.2 * Math.min(sc, 1.3) + aimW * 0.5),
            z: -along0,
            width: 1.6 * Math.min(Math.max(sc, 0.8), 1.3),
            length: tdzLen,
            y: Y_MARK,
            color: WHITE,
          })
        }
      }
    }
  }
}

function buildLights(a: AirportDef, lights: LightPlacement[], papi: PapiPlan[]): void {
  const { length: L, width: W } = a.runway
  const ends = runwayEnds(a)
  const rr = runwayRect(a)
  const lay = airportLayout(a)
  // edge lights every 60 m
  const n = Math.floor(L / 60)
  for (let i = 0; i <= n; i++) {
    const along = -L / 2 + (i * L) / n
    for (const side of [-1, 1]) lights.push({ x: side * (W / 2 + 1.2), z: -along, y: 0.3, color: 'white' })
  }
  const count = Math.round(W / 3) + 1
  for (const e of ends) {
    const thr = toLocal(rr, e.threshold.x, e.threshold.z)
    const aim = toLocal(rr, e.aimPoint.x, e.aimPoint.z)
    const u = Math.sign(aim.along - thr.along) || 1
    for (let i = 0; i < count; i++) {
      const x = -W / 2 + (i * W) / (count - 1)
      lights.push({ x, z: -(thr.along - u * 1.0), y: 0.3, color: 'green' })
      if (i % 2 === 0) lights.push({ x, z: -(thr.along - u * 4.0), y: 0.3, color: 'red' })
    }
    // PAPI: 4 units on the left of the landing direction, abeam the aim point
    const leftSign = -u
    const plights = [0, 1, 2, 3].map((k) => ({ x: leftSign * (W / 2 + 14 + k * 9), z: -aim.along }))
    const cx = plights.reduce((s, p) => s + p.x, 0) / 4
    papi.push({ designator: e.designator, lights: plights, cx, cz: -aim.along })
  }
  // blue taxiway edge lights every 80 m, skipping connector crossings
  const tw = lay.taxiway
  const t = rectLocal(rr, tw)
  const conns = lay.connectors.map((c) => -rectLocal(rr, c).z)
  for (let along = -tw.length / 2 + 20; along <= tw.length / 2 - 20; along += 80) {
    if (conns.some((c) => Math.abs(c - along) < tw.width / 2 + 6)) continue
    for (const side of [-1, 1]) lights.push({ x: t.x + side * (tw.width / 2 + 1), z: -along, y: 0.3, color: 'blue' })
  }
}

const CONCRETE: Rgb = [0.62, 0.62, 0.6]
const TERMINAL: Rgb = [0.72, 0.74, 0.78]
const GLASS: Rgb = [0.18, 0.26, 0.34]
const HANGAR: Rgb = [0.55, 0.58, 0.6]
const SHELTER: Rgb = [0.42, 0.44, 0.38]
const TOWER: Rgb = [0.78, 0.78, 0.76]

function buildBuildings(a: AirportDef, out: BuildingPlacement[]): void {
  const lay = airportLayout(a)
  const rr = runwayRect(a)
  const ap = toLocal(rr, lay.apron.cx, lay.apron.cz)
  const apronFar = ap.across + lay.apron.width / 2
  const apronAlong = ap.along
  const apronHalf = lay.apron.length / 2
  // buildings are placed by (along, across-distance-from-apron-far-edge, ...)
  const put = (b: Omit<BuildingPlacement, 'x' | 'z' | 'base' | 'ridge' | 'shape'> & { along: number; off: number; base?: number; ridge?: number; shape?: 'box' | 'gable' }) => {
    out.push({
      kind: b.kind,
      x: apronFar + b.off,
      z: -(apronAlong + b.along),
      width: b.width,
      depth: b.depth,
      height: b.height,
      shape: b.shape ?? 'box',
      ridge: b.ridge ?? 0,
      base: b.base ?? 0,
      color: b.color,
    })
  }
  const towerAt = (along: number, off: number, h: number, size: number) => {
    out.push(
      { kind: 'tower', x: apronFar + off, z: -(apronAlong + along), width: size, depth: size, height: h, shape: 'box', ridge: 0, base: 0, color: TOWER },
      { kind: 'tower-cab', x: apronFar + off, z: -(apronAlong + along), width: size * 1.7, depth: size * 1.7, height: size * 0.6, shape: 'box', ridge: 0, base: h, color: GLASS },
    )
  }
  switch (a.class) {
    case 'international': {
      put({ kind: 'terminal', along: 0, off: 26 + 22.5, width: 45, depth: 320, height: 14, color: TERMINAL })
      for (let i = 0; i < 6; i++) {
        put({ kind: 'gate', along: -125 + i * 50, off: 18, width: 16, depth: 8, height: 6, color: GLASS })
      }
      towerAt(Math.min(apronHalf + 50, 450), 60, 38, 9)
      for (const s of [-1, 1]) {
        put({ kind: 'hangar', along: s * 340, off: 20 + 27.5, width: 55, depth: 70, height: 14, shape: 'gable', ridge: 4, color: HANGAR })
      }
      break
    }
    case 'regional': {
      put({ kind: 'terminal', along: 0, off: 20 + 15, width: 30, depth: 90, height: 9, color: TERMINAL })
      towerAt(80, 45, 18, 6)
      put({ kind: 'hangar', along: -150, off: 20 + 20, width: 40, depth: 50, height: 10, shape: 'gable', ridge: 3, color: HANGAR })
      break
    }
    case 'short': {
      for (const s of [-1, 1]) {
        put({ kind: 'hangar', along: s * 45, off: 20 + 14, width: 28, depth: 24, height: 7, shape: 'gable', ridge: 3, color: HANGAR })
      }
      break
    }
    case 'military': {
      for (const along of [-240, -80, 80, 240]) {
        put({ kind: 'shelter', along, off: 20 + 17, width: 24, depth: 34, height: 5, shape: 'gable', ridge: 4, color: SHELTER })
      }
      towerAt(360, 50, 22, 7)
      put({ kind: 'control', along: 0, off: 20 + 8, width: 15, depth: 40, height: 6, color: CONCRETE })
      break
    }
  }
}

/** Everything needed to draw one airport, in its local frame. Pure. */
export function buildAirportPlan(a: AirportDef): AirportPlan {
  const lay = airportLayout(a)
  const rr = runwayRect(a)
  const h = a.runway.headingDeg
  const pav = (kind: PavementPatch['kind'], r: OrientedRect, y: number, color: Rgb): PavementPatch => {
    const p = rectLocal(rr, r)
    return { kind, x: p.x, z: p.z, relHeadingDeg: r.headingDeg - h, width: r.width, length: r.length, y, color }
  }
  const pavement: PavementPatch[] = [
    pav('apron', lay.apron, Y_APRON, [0.3, 0.3, 0.31]),
    pav('taxiway', lay.taxiway, Y_TAXI, [0.2, 0.2, 0.21]),
    ...lay.connectors.map((c) => pav('connector', c, Y_CONNECTOR, [0.2, 0.2, 0.21])),
    pav('runway', lay.runway, Y_RUNWAY, [0.13, 0.13, 0.14]),
  ]
  const markings: MarkingQuad[] = []
  const designators: DesignatorPlacement[] = []
  buildMarkings(a, markings, designators)
  // yellow taxi centrelines
  for (const r of [lay.taxiway, ...lay.connectors]) {
    const p = rectLocal(rr, r)
    const rel = (((r.headingDeg - h) % 360) + 360) % 360
    const across = rel === 90 || rel === 270
    markings.push({
      x: p.x,
      z: p.z,
      width: across ? r.length : 0.3,
      length: across ? 0.3 : r.length,
      y: Y_TAXI_MARK,
      color: YELLOW,
    })
  }
  const lights: LightPlacement[] = []
  const papi: PapiPlan[] = []
  buildLights(a, lights, papi)
  const buildings: BuildingPlacement[] = []
  buildBuildings(a, buildings)
  const windsock = { x: -(a.runway.width / 2 + 70), z: a.runway.length / 2 - 250 }
  return { airport: a, pavement, markings, designators, lights, papi, buildings, windsock }
}
