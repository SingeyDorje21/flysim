/**
 * Pure runway and airport geometry shared by terrain, rendering, spawns,
 * challenges and navigation. Owned by the orchestrator. No three.js.
 */

import { AIRPORTS, getAirport, type AirportDef } from '../config/airports'

const DEG = Math.PI / 180

/** Unit vector along a heading in the world x/z plane (0 = north = -Z). */
export function headingVector(headingDeg: number): { x: number; z: number } {
  return { x: Math.sin(headingDeg * DEG), z: -Math.cos(headingDeg * DEG) }
}

/** Heading (0..360) from one point to another. */
export function bearingDeg(fromX: number, fromZ: number, toX: number, toZ: number): number {
  const b = Math.atan2(toX - fromX, -(toZ - fromZ)) / DEG
  return (b + 360) % 360
}

/** A rectangle rotated to a heading: `length` along the heading, `width` across it. */
export interface OrientedRect {
  cx: number
  cz: number
  headingDeg: number
  length: number
  width: number
}

/** Coordinates of (x, z) in a rect's frame: `along` the heading, `across` to the right. */
export function toLocal(r: OrientedRect, x: number, z: number): { along: number; across: number } {
  const d = headingVector(r.headingDeg)
  const dx = x - r.cx
  const dz = z - r.cz
  // Right of heading h is heading h + 90: (cos h, sin h) in x/z.
  return { along: dx * d.x + dz * d.z, across: dx * -d.z + dz * d.x }
}

export function inRect(r: OrientedRect, x: number, z: number, margin = 0): boolean {
  const { along, across } = toLocal(r, x, z)
  return Math.abs(along) <= r.length / 2 + margin && Math.abs(across) <= r.width / 2 + margin
}

export function runwayRect(a: AirportDef): OrientedRect {
  return { cx: a.center.x, cz: a.center.z, headingDeg: a.runway.headingDeg, length: a.runway.length, width: a.runway.width }
}

/** Runway designator for a direction of travel, e.g. 87 deg -> "09", 360 -> "36". */
export function designator(headingDeg: number): string {
  const n = Math.round((((headingDeg % 360) + 360) % 360) / 10)
  return String(n === 0 ? 36 : n).padStart(2, '0')
}

export interface RunwayEnd {
  airport: AirportDef
  /** e.g. "09". */
  designator: string
  /** Direction of travel when landing/taking off from this end. */
  headingDeg: number
  /** Centre of the threshold line at this end. */
  threshold: { x: number; z: number }
  /** Touchdown aiming point, 300 m (or 1/5 of the length) past the threshold. */
  aimPoint: { x: number; z: number }
}

/** Both ends of an airport's runway: [lower-numbered, higher-numbered]. */
export function runwayEnds(a: AirportDef): [RunwayEnd, RunwayEnd] {
  const make = (headingDeg: number): RunwayEnd => {
    const d = headingVector(headingDeg)
    const half = a.runway.length / 2
    const aim = Math.min(300, a.runway.length / 5)
    return {
      airport: a,
      designator: designator(headingDeg),
      headingDeg,
      threshold: { x: a.center.x - d.x * half, z: a.center.z - d.z * half },
      aimPoint: { x: a.center.x - d.x * (half - aim), z: a.center.z - d.z * (half - aim) },
    }
  }
  return [make(a.runway.headingDeg), make((a.runway.headingDeg + 180) % 360)]
}

export function getRunwayEnd(airportId: string, endDesignator: string): RunwayEnd {
  const ends = runwayEnds(getAirport(airportId))
  return ends.find((e) => e.designator === endDesignator) ?? ends[0]
}

/**
 * Paved surfaces of an airport, generated from its runway: the runway, a
 * parallel taxiway on the right of the lower-numbered direction, a connector
 * at each end and in the middle, and an apron beyond the taxiway.
 * Terrain (surfaceAt 'paved', flattening) and rendering both use this.
 */
export interface AirportLayout {
  runway: OrientedRect
  taxiway: OrientedRect
  connectors: OrientedRect[]
  apron: OrientedRect
  /** Everything paved, for point tests. */
  paved: OrientedRect[]
  /** Area to flatten to the field elevation (all paved areas plus margin for buildings). */
  flatZone: OrientedRect
}

const layoutCache = new Map<string, AirportLayout>()

export function airportLayout(a: AirportDef): AirportLayout {
  const cached = layoutCache.get(a.id)
  if (cached) return cached
  const h = a.runway.headingDeg
  const big = a.class === 'international'
  const taxiOffset = big ? 190 : 130
  const taxiWidth = big ? 23 : 18
  const apronDepth = big ? 260 : a.class === 'short' ? 110 : 170
  const apronLength = Math.min(a.runway.length * 0.45, big ? 1200 : 600)
  const d = headingVector(h)
  const right = { x: -d.z, z: d.x }
  const at = (along: number, across: number) => ({
    cx: a.center.x + d.x * along + right.x * across,
    cz: a.center.z + d.z * along + right.z * across,
  })
  const runway = runwayRect(a)
  const taxiway: OrientedRect = { ...at(0, taxiOffset), headingDeg: h, length: a.runway.length, width: taxiWidth }
  const connectorLen = taxiOffset - a.runway.width / 2
  const connectors = [-0.5, 0, 0.5].map((f) => ({
    ...at(f * (a.runway.length - taxiWidth), a.runway.width / 2 + connectorLen / 2),
    headingDeg: (h + 90) % 360,
    length: connectorLen,
    width: taxiWidth,
  }))
  const apron: OrientedRect = {
    ...at(0, taxiOffset + taxiWidth / 2 + apronDepth / 2),
    headingDeg: h,
    length: apronLength,
    width: apronDepth,
  }
  const flatWidth = 2 * (taxiOffset + taxiWidth / 2 + apronDepth + 220)
  const flatZone: OrientedRect = { ...at(0, 0), headingDeg: h, length: a.runway.length + 600, width: flatWidth }
  const layout = { runway, taxiway, connectors, apron, paved: [runway, taxiway, ...connectors, apron], flatZone }
  layoutCache.set(a.id, layout)
  return layout
}

export function isPavedAt(x: number, z: number): boolean {
  for (const a of AIRPORTS) {
    const l = airportLayout(a)
    if (!inRect(l.flatZone, x, z)) continue
    for (const r of l.paved) if (inRect(r, x, z)) return true
  }
  return false
}

/** The airport whose runway contains (x, z), or null. */
export function runwayAt(x: number, z: number, margin = 0): AirportDef | null {
  for (const a of AIRPORTS) if (inRect(runwayRect(a), x, z, margin)) return a
  return null
}

export interface NearestAirport {
  airport: AirportDef
  distance: number
  bearingDeg: number
}

export function nearestAirport(x: number, z: number): NearestAirport {
  let best: NearestAirport | null = null
  for (const a of AIRPORTS) {
    const distance = Math.hypot(a.center.x - x, a.center.z - z)
    if (!best || distance < best.distance) {
      best = { airport: a, distance, bearingDeg: bearingDeg(x, z, a.center.x, a.center.z) }
    }
  }
  return best!
}

export const GLIDE_SLOPE_DEG = 3
/** Approach guidance is offered within this distance of the threshold (m). */
export const APPROACH_RANGE = 15000

export interface ApproachGuidance {
  end: RunwayEnd
  /** Horizontal distance to the threshold, measured along the approach (m, + = before it). */
  distance: number
  /** Metres right (+) or left (-) of the extended centreline. */
  lateral: number
  /** Metres above (+) or below (-) the 3 degree glide path to the aiming point. */
  vertical: number
}

/**
 * The runway end the aircraft is most plausibly approaching: in front of it,
 * within range and roughly aligned. Null when there is none.
 */
export function approachGuidance(x: number, y: number, z: number, headingDeg: number): ApproachGuidance | null {
  let best: ApproachGuidance | null = null
  let bestScore = Infinity
  for (const a of AIRPORTS) {
    for (const end of runwayEnds(a)) {
      const d = headingVector(end.headingDeg)
      const dx = x - end.threshold.x
      const dz = z - end.threshold.z
      const distance = -(dx * d.x + dz * d.z)
      if (distance < -a.runway.length || distance > APPROACH_RANGE) continue
      const lateral = dx * -d.z + dz * d.x
      if (Math.abs(lateral) > Math.max(1500, distance * 0.25)) continue
      const headingError = Math.abs(((headingDeg - end.headingDeg + 540) % 360) - 180)
      if (headingError > 60) continue
      const toAim = distance + Math.hypot(end.aimPoint.x - end.threshold.x, end.aimPoint.z - end.threshold.z)
      const vertical = y - a.elevation - Math.max(0, toAim) * Math.tan(GLIDE_SLOPE_DEG * DEG)
      const score = Math.abs(lateral) + headingError * 20 + Math.max(0, distance) * 0.05
      if (score < bestScore) {
        bestScore = score
        best = { end, distance, lateral, vertical }
      }
    }
  }
  return best
}
