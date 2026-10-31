/** Small allocation-free vector / quaternion helpers (plain objects, no three.js). */

import type { Quat, Vec3 } from './types'

export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Clamp to [lo, hi]; NaN or a non-number becomes `fallback` (then clamped). +-Infinity clamps. */
export function sanitize(v: unknown, lo: number, hi: number, fallback = 0): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return clamp(fallback, lo, hi)
  return clamp(v, lo, hi)
}

export function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current
  if (d > maxDelta) return current + maxDelta
  if (d < -maxDelta) return current - maxDelta
  return target
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** out = q * v * q^-1 (body -> world). `out` may alias `v`. */
export function rotateVec(q: Quat, v: Vec3, out: Vec3): Vec3 {
  const qx = q.x
  const qy = q.y
  const qz = q.z
  const qw = q.w
  const vx = v.x
  const vy = v.y
  const vz = v.z
  // t = 2 * cross(q.xyz, v); v' = v + w t + cross(q.xyz, t)
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  out.x = vx + qw * tx + (qy * tz - qz * ty)
  out.y = vy + qw * ty + (qz * tx - qx * tz)
  out.z = vz + qw * tz + (qx * ty - qy * tx)
  return out
}

/** out = q^-1 * v * q (world -> body). `out` may alias `v`. */
export function rotateVecInverse(q: Quat, v: Vec3, out: Vec3): Vec3 {
  const qx = -q.x
  const qy = -q.y
  const qz = -q.z
  const qw = q.w
  const vx = v.x
  const vy = v.y
  const vz = v.z
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  out.x = vx + qw * tx + (qy * tz - qz * ty)
  out.y = vy + qw * ty + (qz * tx - qx * tz)
  out.z = vz + qw * tz + (qx * ty - qy * tx)
  return out
}

export function normalizeQuat(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
  if (!(len > 1e-12) || !Number.isFinite(len)) {
    q.x = 0
    q.y = 0
    q.z = 0
    q.w = 1
    return q
  }
  q.x /= len
  q.y /= len
  q.z /= len
  q.w /= len
  return q
}

/**
 * Orientation from instrument angles (degrees): three.js Euler 'YXZ' with
 * y = -heading, x = pitch, z = -bank, i.e. q = qY * qX * qZ.
 */
export function quatFromAttitude(headingDeg: number, pitchDeg: number, bankDeg: number, out: Quat): Quat {
  const hy = (-headingDeg * DEG2RAD) / 2
  const hx = (pitchDeg * DEG2RAD) / 2
  const hz = (-bankDeg * DEG2RAD) / 2
  const c1 = Math.cos(hy)
  const s1 = Math.sin(hy)
  const c2 = Math.cos(hx)
  const s2 = Math.sin(hx)
  const c3 = Math.cos(hz)
  const s3 = Math.sin(hz)
  out.x = c1 * s2 * c3 + s1 * c2 * s3
  out.y = s1 * c2 * c3 - c1 * s2 * s3
  out.z = c1 * c2 * s3 - s1 * s2 * c3
  out.w = c1 * c2 * c3 + s1 * s2 * s3
  return normalizeQuat(out)
}

/**
 * q <- q * exp(omega dt / 2): integrates a BODY-frame angular velocity exactly
 * over one step (constant rate), then renormalises.
 */
export function integrateQuat(q: Quat, wx: number, wy: number, wz: number, dt: number): Quat {
  const rate = Math.sqrt(wx * wx + wy * wy + wz * wz)
  if (rate < 1e-12) return q
  const half = 0.5 * rate * dt
  const s = Math.sin(half) / rate
  const bx = wx * s
  const by = wy * s
  const bz = wz * s
  const bw = Math.cos(half)
  const x = q.x
  const y = q.y
  const z = q.z
  const w = q.w
  q.x = w * bx + x * bw + y * bz - z * by
  q.y = w * by - x * bz + y * bw + z * bx
  q.z = w * bz + x * by - y * bx + z * bw
  q.w = w * bw - x * bx - y * by - z * bz
  return normalizeQuat(q)
}
