/**
 * Every airport in the world. Shared contract, owned by the orchestrator.
 * The terrain module may adjust `center` and `elevation` so each site sits on
 * suitable ground (and must report it); nothing else edits this data.
 *
 * World frame: +X east, +Z south, heading 0 = north (-Z), 90 = east (+X).
 * Each airport has one runway centred on `center`. `headingDeg` is the
 * direction of the lower-numbered runway end (e.g. 90 for runway 09/27).
 */

export type AirportClass = 'international' | 'regional' | 'short' | 'military'

export interface RunwayDef {
  /** Direction of travel when using the lower-numbered end, 0..180 (deg). */
  headingDeg: number
  length: number
  width: number
}

export interface AirportDef {
  id: string
  /** Fictional four-letter code shown on the HUD and map. */
  code: string
  name: string
  class: AirportClass
  /** Runway centre, world x/z (m). */
  center: { x: number; z: number }
  /** Flattened field elevation (m above sea level). */
  elevation: number
  runway: RunwayDef
}

export const AIRPORT_CLASS_LABEL: Record<AirportClass, string> = {
  international: 'International',
  regional: 'Regional',
  short: 'Short field',
  military: 'Air base',
}

/** The original airport; spawns, challenges and the ring course default to it. */
export const HOME_AIRPORT_ID = 'central'

export const AIRPORTS: readonly AirportDef[] = [
  {
    id: 'central',
    code: 'FSCF',
    name: 'Central Field',
    class: 'short',
    center: { x: 0, z: 0 },
    elevation: 12,
    runway: { headingDeg: 0, length: 1600, width: 30 },
  },
  {
    id: 'harbor',
    code: 'FSHI',
    name: 'Harbor International',
    class: 'international',
    center: { x: -31500, z: 11000 },
    elevation: 24,
    runway: { headingDeg: 90, length: 3400, width: 60 },
  },
  {
    id: 'northbay',
    code: 'FSNB',
    name: 'North Bay International',
    class: 'international',
    center: { x: 8000, z: -36250 },
    elevation: 31,
    runway: { headingDeg: 90, length: 3200, width: 60 },
  },
  {
    id: 'ridgeback',
    code: 'FSRB',
    name: 'Ridgeback Air Base',
    class: 'military',
    center: { x: 29500, z: 500 },
    elevation: 113,
    runway: { headingDeg: 90, length: 2800, width: 45 },
  },
  {
    id: 'westport',
    code: 'FSWP',
    name: 'Westport',
    class: 'regional',
    center: { x: -35500, z: -1750 },
    elevation: 40,
    runway: { headingDeg: 0, length: 2200, width: 45 },
  },
  {
    id: 'southgate',
    code: 'FSSG',
    name: 'Southgate',
    class: 'regional',
    center: { x: -7000, z: 30000 },
    elevation: 31,
    runway: { headingDeg: 90, length: 2200, width: 45 },
  },
  {
    id: 'eastshore',
    code: 'FSES',
    name: 'Eastshore',
    class: 'regional',
    center: { x: 32000, z: 10750 },
    elevation: 63,
    runway: { headingDeg: 0, length: 2200, width: 45 },
  },
  {
    id: 'pineridge',
    code: 'FSPR',
    name: 'Pine Ridge',
    class: 'short',
    center: { x: -3750, z: -30500 },
    elevation: 268,
    runway: { headingDeg: 0, length: 1600, width: 30 },
  },
  {
    id: 'gull',
    code: 'FSGI',
    name: 'Gull Island',
    class: 'short',
    center: { x: -41000, z: -40000 },
    elevation: 37,
    runway: { headingDeg: 0, length: 1600, width: 30 },
  },
  {
    id: 'cedar',
    code: 'FSCV',
    name: 'Cedar Valley',
    class: 'short',
    center: { x: -33250, z: -17000 },
    elevation: 43,
    runway: { headingDeg: 0, length: 1600, width: 30 },
  },
]

export function getAirport(id: string): AirportDef {
  const a = AIRPORTS.find((x) => x.id === id)
  if (!a) throw new Error(`Unknown airport: ${id}`)
  return a
}
