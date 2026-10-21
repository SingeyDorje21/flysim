/**
 * Quadtree level-of-detail layout and selection for the streamed terrain.
 * Pure TS (no three.js) so tests can check it directly.
 *
 * Every chunk is CHUNK_CELLS x CHUNK_CELLS cells. A level-L chunk has cells of
 * WORLD.physicsGridStep * 2^L m, so level 0 IS the physics grid. The root
 * (level MAX_LEVEL) is a 122.88 km square centred on the origin; chunk origins
 * are multiples of the grid step, so every chunk vertex is a physics-grid vertex.
 */

import { WORLD } from '../../config/world'
import { TERRAIN_MAX_HEIGHT } from './heightField'

export const CHUNK_CELLS = 32
export const MAX_LEVEL = 7
/** Side of a level-0 chunk (m): 32 cells of 30 m = 960 m. */
export const LEAF_SIZE = CHUNK_CELLS * WORLD.physicsGridStep
export const ROOT_SIZE = LEAF_SIZE << MAX_LEVEL
export const ROOT_MIN = -ROOT_SIZE / 2

/** The finest level is guaranteed within this distance of the camera (m). */
export const FINE_RADIUS = 1500
/** Split distance floor: FINE_RADIUS plus a margin, independent of the quality bias. */
const SPLIT_FLOOR = FINE_RADIUS + 250
/** Split a node when the camera is closer than SPLIT_K * node size * lodBias. */
export const SPLIT_K = 1.1

/** Chunks entirely outside this square are never drawn (open ocean beyond). */
const WORLD_HALF = WORLD.terrainSize / 2

export interface LodNode {
  level: number
  cx: number
  cz: number
}

export function chunkSize(level: number): number {
  return LEAF_SIZE * 2 ** level
}

export function chunkCellSize(level: number): number {
  return WORLD.physicsGridStep * 2 ** level
}

/** World x (or z) of the chunk's minimum corner. */
export function chunkOrigin(level: number, c: number): number {
  return ROOT_MIN + c * chunkSize(level)
}

export function chunkKey(level: number, cx: number, cz: number): string {
  return `${level}:${cx}:${cz}`
}

/**
 * Distance (m) from the camera to a chunk: horizontal distance to its square,
 * combined with the camera's height above the highest possible terrain.
 * Never larger than the 3D distance to any ground point inside the chunk.
 */
export function chunkDistance(level: number, cx: number, cz: number, camX: number, camY: number, camZ: number): number {
  const size = chunkSize(level)
  const x0 = chunkOrigin(level, cx)
  const z0 = chunkOrigin(level, cz)
  const dx = camX < x0 ? x0 - camX : camX > x0 + size ? camX - x0 - size : 0
  const dz = camZ < z0 ? z0 - camZ : camZ > z0 + size ? camZ - z0 - size : 0
  const dy = camY > TERRAIN_MAX_HEIGHT ? camY - TERRAIN_MAX_HEIGHT : 0
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** True when the node should be replaced by its four children. */
export function shouldSplit(
  level: number,
  cx: number,
  cz: number,
  camX: number,
  camY: number,
  camZ: number,
  lodBias: number,
): boolean {
  if (level === 0) return false
  const d = chunkDistance(level, cx, cz, camX, camY, camZ)
  return d < Math.max(SPLIT_K * chunkSize(level) * lodBias, SPLIT_FLOOR)
}

/** True when the chunk overlaps the world square and lies within the view distance. */
export function chunkVisible(
  level: number,
  cx: number,
  cz: number,
  camX: number,
  camY: number,
  camZ: number,
  viewDistance: number,
): boolean {
  const size = chunkSize(level)
  const x0 = chunkOrigin(level, cx)
  const z0 = chunkOrigin(level, cz)
  if (x0 >= WORLD_HALF || z0 >= WORLD_HALF || x0 + size <= -WORLD_HALF || z0 + size <= -WORLD_HALF) return false
  return chunkDistance(level, cx, cz, camX, camY, camZ) <= viewDistance
}

/**
 * The ideal set of chunks (quadtree leaves) for a camera, nearest levels
 * finest. The streamer draws these, or a ready ancestor while they load.
 */
export function selectLodNodes(camX: number, camY: number, camZ: number, viewDistance: number, lodBias: number): LodNode[] {
  const out: LodNode[] = []
  const visit = (level: number, cx: number, cz: number): void => {
    if (!chunkVisible(level, cx, cz, camX, camY, camZ, viewDistance)) return
    if (shouldSplit(level, cx, cz, camX, camY, camZ, lodBias)) {
      const l = level - 1
      visit(l, cx * 2, cz * 2)
      visit(l, cx * 2 + 1, cz * 2)
      visit(l, cx * 2, cz * 2 + 1)
      visit(l, cx * 2 + 1, cz * 2 + 1)
    } else {
      out.push({ level, cx, cz })
    }
  }
  visit(MAX_LEVEL, 0, 0)
  return out
}
