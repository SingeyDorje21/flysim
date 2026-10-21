import type { AircraftState, Quat, Vec3 } from './types'

/**
 * Interpolates the render pose between two fixed steps without allocating:
 * position lerp, orientation shortest-path nlerp (renormalised).
 */
export function interpolatePose(
  prev: AircraftState,
  curr: AircraftState,
  alpha: number,
  out: { position: Vec3; orientation: Quat },
): void {
  const t = Number.isFinite(alpha) ? (alpha < 0 ? 0 : alpha > 1 ? 1 : alpha) : 1
  const p0 = prev.position
  const p1 = curr.position
  out.position.x = p0.x + (p1.x - p0.x) * t
  out.position.y = p0.y + (p1.y - p0.y) * t
  out.position.z = p0.z + (p1.z - p0.z) * t

  const a = prev.orientation
  const b = curr.orientation
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
  const s = dot < 0 ? -1 : 1
  const u = 1 - t
  const x = a.x * u + b.x * s * t
  const y = a.y * u + b.y * s * t
  const z = a.z * u + b.z * s * t
  const w = a.w * u + b.w * s * t
  const len = Math.sqrt(x * x + y * y + z * z + w * w)
  const o = out.orientation
  if (len > 1e-12) {
    o.x = x / len
    o.y = y / len
    o.z = z / len
    o.w = w / len
  } else {
    o.x = b.x
    o.y = b.y
    o.z = b.z
    o.w = b.w
  }
}
