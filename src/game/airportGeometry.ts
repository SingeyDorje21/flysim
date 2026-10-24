/**
 * Pure runway and airport geometry shared by terrain, rendering, spawns,
 * challenges and navigation. Owned by the orchestrator. No three.js.
 */

import { AIRPORTS, getAirport, type AirportDef, type RunwayDef } from '../config/airports'

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

/** One runway of an airport, with its world rectangle. */
export interface Runway {
  airport: AirportDef
  /** Index in `airport.runways` (0 = primary). */
  index: number
  def: RunwayDef
  rect: OrientedRect
}

const runwayCache = new Map<string, readonly Runway[]>()

/** Every runway of an airport, primary first. */
export function airportRunways(a: AirportDef): readonly Runway[] {
  const cached = runwayCache.get(a.id)
  if (cached) return cached
  const d = headingVector(a.runways[0].headingDeg)
  const right = { x: -d.z, z: d.x }
  const list = a.runways.map((def, index): Runway => {
    const along = def.along ?? 0
    const across = def.across ?? 0
    return {
      airport: a,
      index,
      def,
      rect: {
        cx: a.center.x + d.x * along + right.x * across,
        cz: a.center.z + d.z * along + right.z * across,
        headingDeg: def.headingDeg,
        length: def.length,
        width: def.width,
      },
    }
  })
  runwayCache.set(a.id, list)
  return list
}

/** The primary runway's rectangle: the frame the airport's layout and buildings use. */
export function airportFrame(a: AirportDef): OrientedRect {
  return airportRunways(a)[0].rect
}

/** The longest runway of an airport (m). */
export function longestRunway(a: AirportDef): number {
  return Math.max(...a.runways.map((r) => r.length))
}

/** Runway designator for a direction of travel, e.g. 87 deg -> "09", 360 -> "36". */
export function designator(headingDeg: number): string {
  const n = Math.round((((headingDeg % 360) + 360) % 360) / 10)
  return String(n === 0 ? 36 : n).padStart(2, '0')
}

export interface RunwayEnd {
  airport: AirportDef
  runway: Runway
  /** e.g. "09", or "09L" where parallel runways share the number. */
  designator: string
  /** Direction of travel when landing/taking off from this end. */
  headingDeg: number
  /** Centre of the threshold line at this end. */
  threshold: { x: number; z: number }
  /** Touchdown aiming point, 300 m (or 1/5 of the length) past the threshold. */
  aimPoint: { x: number; z: number }
}

/**
 * Letter for a runway among the parallels that share its number, as seen in
 * the direction of travel: left to right L, (C,) R. Empty when it is alone.
 */
function parallelSuffix(rw: Runway, headingDeg: number): string {
  const same = airportRunways(rw.airport).filter((o) => (o.def.headingDeg - rw.def.headingDeg) % 180 === 0)
  if (same.length < 2) return ''
  const d = headingVector(headingDeg)
  const lateral = (o: Runway) => o.rect.cx * -d.z + o.rect.cz * d.x
  const rank = same
    .map(lateral)
    .sort((p, q) => p - q)
    .indexOf(lateral(rw))
  if (rank === 0) return 'L'
  return rank === same.length - 1 ? 'R' : 'C'
}

/** Both ends of one runway: [lower-numbered, higher-numbered]. */
export function endsOf(rw: Runway): [RunwayEnd, RunwayEnd] {
  const make = (headingDeg: number): RunwayEnd => {
    const d = headingVector(headingDeg)
    const half = rw.def.length / 2
    const aim = Math.min(300, rw.def.length / 5)
    const { cx, cz } = rw.rect
    return {
      airport: rw.airport,
      runway: rw,
      designator: designator(headingDeg) + parallelSuffix(rw, headingDeg),
      headingDeg,
      threshold: { x: cx - d.x * half, z: cz - d.z * half },
      aimPoint: { x: cx - d.x * (half - aim), z: cz - d.z * (half - aim) },
    }
  }
  return [make(rw.def.headingDeg), make((rw.def.headingDeg + 180) % 360)]
}

/** Every runway end of an airport: the primary's two ends first, then each other runway's. */
export function runwayEnds(a: AirportDef): RunwayEnd[] {
  return airportRunways(a).flatMap(endsOf)
}

/**
 * The runway end with this designator. A bare number from before an airport
 * had parallel runways ("27") finds its first lettered end ("27L"); anything
 * else unknown falls back to the primary runway's lower-numbered end.
 */
export function getRunwayEnd(airportId: string, endDesignator: string): RunwayEnd {
  const ends = runwayEnds(getAirport(airportId))
  return (
    ends.find((e) => e.designator === endDesignator) ??
    ends.find((e) => e.designator.slice(0, 2) === endDesignator) ??
    ends[0]
  )
}

/**
 * Paved surfaces of an airport, generated from its runways: the runways, a
 * parallel taxiway on the right of the primary's lower-numbered direction, a
 * connector at each end and in the middle, an apron beyond the taxiway, and
 * connectors across to a parallel runway (a crossing runway crosses the
 * taxiway). Terrain (surfaceAt 'paved', flattening) and rendering both use this.
 */
export interface AirportLayout {
  runways: OrientedRect[]
  taxiway: OrientedRect
  connectors: OrientedRect[]
  apron: OrientedRect
  /** Everything paved, for point tests. */
  paved: OrientedRect[]
  /**
   * Areas flattened to the field elevation: first the primary zone (its paved
   * areas plus margin for buildings), then one around each other runway.
   */
  flatZones: OrientedRect[]
}

const layoutCache = new Map<string, AirportLayout>()

/** Flat ground kept beside a secondary runway (m, each side of its edge). */
const SECONDARY_FLAT_SIDE = 150
/** Flat ground kept beyond each runway end (m). */
const FLAT_END = 300

export function airportLayout(a: AirportDef): AirportLayout {
  const cached = layoutCache.get(a.id)
  if (cached) return cached
  const rws = airportRunways(a)
  const primary = rws[0].def
  const h = primary.headingDeg
  const big = a.class === 'international'
  const taxiOffset = big ? 190 : 130
  const taxiWidth = big ? 23 : 18
  const apronDepth = big ? 260 : a.class === 'short' ? 110 : 170
  const apronLength = Math.min(primary.length * 0.45, big ? 1200 : 600)
  const d = headingVector(h)
  const right = { x: -d.z, z: d.x }
  const at = (along: number, across: number) => ({
    cx: a.center.x + d.x * along + right.x * across,
    cz: a.center.z + d.z * along + right.z * across,
  })
  const taxiway: OrientedRect = { ...at(0, taxiOffset), headingDeg: h, length: primary.length, width: taxiWidth }
  const connectorLen = taxiOffset - primary.width / 2
  const connectors: OrientedRect[] = [-0.5, 0, 0.5].map((f) => ({
    ...at(f * (primary.length - taxiWidth), primary.width / 2 + connectorLen / 2),
    headingDeg: (h + 90) % 360,
    length: connectorLen,
    width: taxiWidth,
  }))
  // A parallel runway gets connectors across from the primary's facing edge.
  for (const rw of rws.slice(1)) {
    if ((rw.def.headingDeg - h) % 180 !== 0) continue
    const across = rw.def.across ?? 0
    const side = Math.sign(across)
    const near = (side * primary.width) / 2
    const far = across - (side * rw.def.width) / 2
    for (const f of [-0.45, 0, 0.45]) {
      connectors.push({
        ...at((rw.def.along ?? 0) + f * (rw.def.length - taxiWidth), (near + far) / 2),
        headingDeg: (h + 90) % 360,
        length: Math.abs(far - near),
        width: taxiWidth,
      })
    }
  }
  const apron: OrientedRect = {
    ...at(0, taxiOffset + taxiWidth / 2 + apronDepth / 2),
    headingDeg: h,
    length: apronLength,
    width: apronDepth,
  }
  const flatWidth = 2 * (taxiOffset + taxiWidth / 2 + apronDepth + 220)
  const flatZones: OrientedRect[] = [{ ...at(0, 0), headingDeg: h, length: primary.length + 2 * FLAT_END, width: flatWidth }]
  for (const rw of rws.slice(1)) {
    flatZones.push({ ...rw.rect, length: rw.def.length + 2 * FLAT_END, width: rw.def.width + 2 * SECONDARY_FLAT_SIDE })
  }
  const runways = rws.map((r) => r.rect)
  const layout = { runways, taxiway, connectors, apron, paved: [...runways, taxiway, ...connectors, apron], flatZones }
  layoutCache.set(a.id, layout)
  return layout
}

export function isPavedAt(x: number, z: number): boolean {
  for (const a of AIRPORTS) {
    const l = airportLayout(a)
    if (!l.flatZones.some((f) => inRect(f, x, z))) continue
    for (const r of l.paved) if (inRect(r, x, z)) return true
  }
  return false
}

/** The runway (of any airport) that contains (x, z), or null. */
export function runwayAt(x: number, z: number, margin = 0): Runway | null {
  for (const a of AIRPORTS) {
    for (const rw of airportRunways(a)) if (inRect(rw.rect, x, z, margin)) return rw
  }
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

/** Guidance to one specific runway end (no alignment checks). */
export function guidanceTo(end: RunwayEnd, x: number, y: number, z: number): ApproachGuidance {
  const d = headingVector(end.headingDeg)
  const dx = x - end.threshold.x
  const dz = z - end.threshold.z
  const distance = -(dx * d.x + dz * d.z)
  const lateral = dx * -d.z + dz * d.x
  const toAim = distance + Math.hypot(end.aimPoint.x - end.threshold.x, end.aimPoint.z - end.threshold.z)
  const vertical = y - end.airport.elevation - Math.max(0, toAim) * Math.tan(GLIDE_SLOPE_DEG * DEG)
  return { end, distance, lateral, vertical }
}

export interface ApproachOptions {
  /** Take this runway end whenever it qualifies (the one the pilot chose). */
  prefer?: RunwayEnd
  /** Skip runways shorter than this (m). */
  minLength?: number
}

/**
 * The runway end the aircraft is most plausibly approaching: in front of it,
 * within range and roughly aligned. Null when there is none.
 */
export function approachGuidance(
  x: number,
  y: number,
  z: number,
  headingDeg: number,
  options: ApproachOptions = {},
): ApproachGuidance | null {
  let best: ApproachGuidance | null = null
  let bestScore = Infinity
  for (const a of AIRPORTS) {
    for (const end of runwayEnds(a)) {
      if (options.minLength !== undefined && end.runway.def.length < options.minLength) continue
      const g = guidanceTo(end, x, y, z)
      if (g.distance < -end.runway.def.length || g.distance > APPROACH_RANGE) continue
      if (Math.abs(g.lateral) > Math.max(1500, g.distance * 0.25)) continue
      const headingError = Math.abs(((headingDeg - end.headingDeg + 540) % 360) - 180)
      if (headingError > 60) continue
      const p = options.prefer
      if (p && end.airport.id === p.airport.id && end.designator === p.designator) return g
      const score = Math.abs(g.lateral) + headingError * 20 + Math.max(0, g.distance) * 0.05
      if (score < bestScore) {
        bestScore = score
        best = g
      }
    }
  }
  return best
}
