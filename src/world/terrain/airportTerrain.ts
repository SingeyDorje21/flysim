/**
 * Terrain-side view of every airport (pure TS, no three.js): the flattened
 * plateau (the union of its flat zones), the smooth blend around it and the
 * approach surfaces at both ends of every runway, precomputed once from the AIRPORTS / airportLayout contract so
 * the hot height function does a few multiplications per nearby airport and a
 * bounding-box test for every other one.
 *
 * Local frame of an airport: `along` its runway heading, `across` to the right
 * (the same convention as airportGeometry.toLocal).
 */

import { AIRPORTS, type AirportClass, type AirportDef } from '../../config/airports'
import { WORLD } from '../../config/world'
import { airportLayout, isPavedAt as layoutIsPavedAt, type OrientedRect } from '../../game/airportGeometry'

/** Constraints are enforced on their region grown by this much, so every grid cell touching it obeys them. */
export const PAD = 2 * WORLD.physicsGridStep

/** Extra flat ground around the contract flatZone (also covers the old central plateau). */
export const FLAT_MARGIN = 100
/** Width (m) of the smooth blend from the plateau to the natural terrain, by class. */
export const AIRPORT_BLEND_BY_CLASS: Record<AirportClass, number> = {
  international: 600,
  military: 500,
  regional: 500,
  short: 400,
}

/** Approach surface: out to this distance from each threshold (m)... */
export const APPROACH_LENGTH = 10000
/** ...in a corridor this wide on each side of the extended centreline (m)... */
export const APPROACH_HALF_WIDTH = 750
/** ...the terrain stays below elevation + APPROACH_LIMIT + APPROACH_SLOPE * distance. */
export const APPROACH_LIMIT = 15
export const APPROACH_SLOPE = 0.03
/** The surface is carved this much lower, covering the grid triangles' interpolation (<= 1.3 m). */
export const APPROACH_CARVE_BASE = 12
/** Lateral / end fade from the capped corridor back to natural terrain (m). */
export const APPROACH_FADE = 700

export interface Box {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** A rectangle in site form: centre, heading unit vector, half extents along and across it. */
export interface SiteRect {
  cx: number
  cz: number
  dx: number
  dz: number
  halfL: number
  halfW: number
}

export interface AirportSite {
  def: AirportDef
  elevation: number
  blend: number
  /** One per runway: its frame (halfW unused), for the approach surfaces at both ends. */
  runways: SiteRect[]
  /** The contract flat zones (no margin): the plateau is their union. */
  flats: SiteRect[]
  /** Everything the airport touches: plateau, blend and every approach surface with its fade. */
  box: Box
  /** Plateau plus margin, pad and blend. */
  flatBox: Box
  /** The contract flat zones (where paved surfaces may be). */
  pavedBox: Box
}

/** Axis-aligned bounds of a rect centred at (cx, cz), heading (dx, dz), half extents (hl, hw). */
function orientedBox(cx: number, cz: number, dx: number, dz: number, hl: number, hw: number): Box {
  const ex = Math.abs(dx) * hl + Math.abs(dz) * hw
  const ez = Math.abs(dz) * hl + Math.abs(dx) * hw
  return { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez }
}

function union(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  }
}

function heading(deg: number): { x: number; z: number } {
  const r = (deg * Math.PI) / 180
  return { x: Math.sin(r), z: -Math.cos(r) }
}

function siteRect(r: OrientedRect): SiteRect {
  const d = heading(r.headingDeg)
  return { cx: r.cx, cz: r.cz, dx: d.x, dz: d.z, halfL: r.length / 2, halfW: r.width / 2 }
}

const rectBox = (r: SiteRect, growL: number, growW: number) => orientedBox(r.cx, r.cz, r.dx, r.dz, r.halfL + growL, r.halfW + growW)

export function buildSite(a: AirportDef): AirportSite {
  const layout = airportLayout(a)
  const flats = layout.flatZones.map(siteRect)
  const runways = layout.runways.map(siteRect)
  const blend = AIRPORT_BLEND_BY_CLASS[a.class]
  const g = FLAT_MARGIN + PAD + blend + 10
  const flatBox = flats.map((f) => rectBox(f, g, g)).reduce(union)
  const approachBox = runways
    .map((r) => orientedBox(r.cx, r.cz, r.dx, r.dz, r.halfL + APPROACH_LENGTH + PAD + APPROACH_FADE + 10, APPROACH_HALF_WIDTH + PAD + APPROACH_FADE + 10))
    .reduce(union)
  return {
    def: a,
    elevation: a.elevation,
    blend,
    runways,
    flats,
    box: union(flatBox, approachBox),
    flatBox,
    pavedBox: flats.map((f) => rectBox(f, 1, 1)).reduce(union),
  }
}

export const AIRPORT_SITES: readonly AirportSite[] = AIRPORTS.map(buildSite)
const N_SITES = AIRPORT_SITES.length

/** Approach-surface ceiling (m) at `distance` metres out from a threshold (the spec limit, not the carve). */
export function approachLimit(site: AirportSite, distance: number): number {
  return site.elevation + APPROACH_LIMIT + APPROACH_SLOPE * Math.max(0, distance)
}

export function inBox(b: Box, x: number, z: number): boolean {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ
}

/** Paved surface of any airport (airportGeometry.isPavedAt behind a cheap bounding-box filter). */
export function isPavedAt(x: number, z: number): boolean {
  for (let i = 0; i < N_SITES; i++) {
    if (inBox(AIRPORT_SITES[i].pavedBox, x, z)) return layoutIsPavedAt(x, z)
  }
  return false
}
