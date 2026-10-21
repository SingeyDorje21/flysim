/**
 * Airport layout shared by the terrain sampler (surfaceAt = 'paved') and the
 * renderer. Pure data, no three.js. World frame: +X east, +Z south.
 */

import { RUNWAY, type Rect } from '../config/world'

export type PavedKind = 'runway' | 'taxiway' | 'apron'

export interface PavedRect extends Rect {
  kind: PavedKind
}

const halfW = RUNWAY.width / 2
const halfL = RUNWAY.length / 2

export const RUNWAY_RECT: PavedRect = {
  kind: 'runway',
  minX: RUNWAY.centerX - halfW,
  maxX: RUNWAY.centerX + halfW,
  minZ: RUNWAY.centerZ - halfL,
  maxZ: RUNWAY.centerZ + halfL,
}

/** Parallel taxiway east of the runway plus three connectors. */
export const TAXIWAY_RECTS: readonly PavedRect[] = [
  { kind: 'taxiway', minX: 55, maxX: 70, minZ: -780, maxZ: 780 },
  { kind: 'taxiway', minX: 14, maxX: 56, minZ: -780, maxZ: -765 },
  { kind: 'taxiway', minX: 14, maxX: 56, minZ: -7.5, maxZ: 7.5 },
  { kind: 'taxiway', minX: 14, maxX: 56, minZ: 765, maxZ: 780 },
]

export const APRON_RECT: PavedRect = { kind: 'apron', minX: 69, maxX: 250, minZ: -120, maxZ: 240 }

export const PAVED_RECTS: readonly PavedRect[] = [RUNWAY_RECT, ...TAXIWAY_RECTS, APRON_RECT]

export function isPaved(x: number, z: number): boolean {
  for (let i = 0; i < PAVED_RECTS.length; i++) {
    const r = PAVED_RECTS[i]
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return true
  }
  return false
}

export interface HangarDef {
  x: number
  z: number
  /** Extent along X (depth) and Z (door width). */
  depth: number
  width: number
  color: number
}

/** Hangars east of the apron with their doors facing west. */
export const HANGARS: readonly HangarDef[] = [
  { x: 266, z: -60, depth: 30, width: 28, color: 0xb9bec4 },
  { x: 266, z: -24, depth: 30, width: 28, color: 0xc9b79b },
  { x: 266, z: 12, depth: 30, width: 28, color: 0xb9bec4 },
  { x: 266, z: 48, depth: 30, width: 28, color: 0x9fb2c4 },
]

export const TOWER_POS = { x: 150, z: -150 } as const
export const WINDSOCK_POS = { x: -42, z: 430 } as const
