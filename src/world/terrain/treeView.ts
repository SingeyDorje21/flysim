/**
 * Which tree tiles can be on screen. The trees' instance buffers are only
 * rewritten when the camera moves or turns, not every frame, so the test is a
 * generous horizontal cone around the look direction rather than the exact
 * frustum: wide enough that turning a little before the next rewrite never
 * shows a gap.
 */

import { TREE_TILE } from './treePlacement'

/** Extra angle (deg) beyond the frustum's half-diagonal on each side. */
const MARGIN_DEG = 30
/** Looking further up or down than this (deg) the view covers every direction. */
const STEEP_PITCH_DEG = 40
/** Distance from a tile's centre to its corner (m). */
const TILE_RADIUS = (TREE_TILE * Math.SQRT2) / 2

export interface TreeView {
  /** Camera ground position (m). */
  x: number
  z: number
  /** Horizontal look direction, unit length (zero when `halfAngle` is Infinity). */
  dirX: number
  dirZ: number
  /** Half-angle of the cone (rad); Infinity keeps every tile. */
  halfAngle: number
}

/** The view cone of a camera at (x, z) looking along (fx, fy, fz), with its vertical fov (deg) and aspect. */
export function treeViewFor(x: number, z: number, fx: number, fy: number, fz: number, fovDeg: number, aspect: number): TreeView {
  const hl = Math.hypot(fx, fz)
  const len = Math.hypot(fx, fy, fz) || 1
  if (hl / len < Math.cos((STEEP_PITCH_DEG * Math.PI) / 180)) return { x, z, dirX: 0, dirZ: 0, halfAngle: Infinity }
  const halfDiagonal = Math.atan(Math.tan((fovDeg * Math.PI) / 360) * Math.hypot(1, aspect))
  const halfAngle = halfDiagonal + (MARGIN_DEG * Math.PI) / 180
  return { x, z, dirX: fx / hl, dirZ: fz / hl, halfAngle: halfAngle >= Math.PI ? Infinity : halfAngle }
}

/** Whether any part of tree tile (tx, tz) can fall inside `view`. */
export function treeTileInView(view: TreeView, tx: number, tz: number): boolean {
  if (view.halfAngle === Infinity) return true
  const dx = (tx + 0.5) * TREE_TILE - view.x
  const dz = (tz + 0.5) * TREE_TILE - view.z
  const d = Math.hypot(dx, dz)
  // The tile under or beside the camera is always kept.
  if (d <= TILE_RADIUS * 1.5) return true
  const off = Math.acos(Math.max(-1, Math.min(1, (dx * view.dirX + dz * view.dirZ) / d)))
  // Widened by the tile's own angular size, so a tile with any corner in view counts.
  return off - Math.asin(TILE_RADIUS / d) <= view.halfAngle
}

/** Whether the camera has turned far enough since `prev` that the culled set must be rebuilt. */
export function treeViewTurned(prev: TreeView, next: TreeView, maxTurnDeg = 10): boolean {
  if ((prev.halfAngle === Infinity) !== (next.halfAngle === Infinity)) return true
  if (next.halfAngle === Infinity) return false
  return prev.dirX * next.dirX + prev.dirZ * next.dirZ < Math.cos((maxTurnDeg * Math.PI) / 180)
}
