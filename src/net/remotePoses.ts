/**
 * Remote aircraft poses from server snapshots, buffered and sampled about
 * INTERP_DELAY_MS in the past so the renderer interpolates between two known
 * poses instead of jumping at the snapshot rate. High-frequency data: kept
 * out of React state; the renderer samples it inside useFrame.
 */

import type { Quat, Vec3 } from '../simulation/types'
import type { PlayerId, PoseData, ServerMessage } from './protocol'

export const INTERP_DELAY_MS = 100
/** Beyond the newest sample, extrapolate along the velocity for at most this long. */
const MAX_EXTRAPOLATE_MS = 250
const MAX_SAMPLES = 20
/** Faster than this between samples is a respawn/teleport: snap instead of sliding across the map. */
const TELEPORT_SPEED = 1500

interface Sample extends PoseData {
  /** Server time (ms). */
  t: number
}

/** Mutable output of sample(); reuse one per remote aircraft (no per-frame allocation). */
export interface RemotePose {
  position: Vec3
  orientation: Quat
  velocity: Vec3
  onGround: boolean
  crashed: boolean
}

export function createRemotePose(): RemotePose {
  return {
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    onGround: true,
    crashed: false,
  }
}

export class RemotePoses {
  private readonly buffers = new Map<PlayerId, Sample[]>()
  /** serverTime - localTime (ms), smoothed. */
  private offset: number | null = null

  ingest(snapshot: Extract<ServerMessage, { t: 'snapshot' }>, localNow: number): void {
    const measured = snapshot.time - localNow
    if (this.offset === null || Math.abs(measured - this.offset) > 1000) {
      // A clock jump (e.g. a restarted server) makes the old samples meaningless.
      if (this.offset !== null) this.buffers.clear()
      this.offset = measured
    } else this.offset += (measured - this.offset) * 0.1

    for (const pl of snapshot.players) {
      let buf = this.buffers.get(pl.id)
      if (!buf) {
        buf = []
        this.buffers.set(pl.id, buf)
      }
      const last = buf[buf.length - 1]
      if (last && snapshot.time <= last.t) continue
      if (last && (isTeleport(last, pl, snapshot.time - last.t) || (last.crashed && !pl.crashed))) buf.length = 0
      buf.push({ t: snapshot.time, p: pl.p, q: pl.q, v: pl.v, onGround: pl.onGround, crashed: pl.crashed })
      if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES)
    }
  }

  has(id: PlayerId): boolean {
    return (this.buffers.get(id)?.length ?? 0) > 0
  }

  /** Writes the interpolated pose of `id` into `out`. False when nothing is known yet. */
  sample(id: PlayerId, localNow: number, out: RemotePose): boolean {
    const buf = this.buffers.get(id)
    if (!buf || buf.length === 0 || this.offset === null) return false
    const t = localNow + this.offset - INTERP_DELAY_MS

    if (t <= buf[0].t || buf.length === 1) {
      copy(buf[0], out)
      if (buf.length === 1) extrapolate(buf[0], t, out)
      return true
    }
    const last = buf[buf.length - 1]
    if (t >= last.t) {
      copy(last, out)
      extrapolate(last, t, out)
      return true
    }
    let i = buf.length - 2
    while (i > 0 && buf[i].t > t) i--
    const a = buf[i]
    const b = buf[i + 1]
    const k = (t - a.t) / (b.t - a.t)
    lerp3(a.p, b.p, k, out.position)
    lerp3(a.v, b.v, k, out.velocity)
    nlerp(a.q, b.q, k, out.orientation)
    out.onGround = a.onGround
    out.crashed = a.crashed
    return true
  }

  /** Forget players who left the room. */
  retain(ids: Iterable<PlayerId>): void {
    const keep = new Set(ids)
    for (const id of this.buffers.keys()) if (!keep.has(id)) this.buffers.delete(id)
  }

  clear(): void {
    this.buffers.clear()
    this.offset = null
  }
}

function isTeleport(a: Sample, b: PoseData, dtMs: number): boolean {
  const d = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z)
  return d > TELEPORT_SPEED * Math.max(dtMs, 1) * 0.001
}

function copy(s: Sample, out: RemotePose): void {
  out.position.x = s.p.x
  out.position.y = s.p.y
  out.position.z = s.p.z
  out.velocity.x = s.v.x
  out.velocity.y = s.v.y
  out.velocity.z = s.v.z
  out.orientation.x = s.q.x
  out.orientation.y = s.q.y
  out.orientation.z = s.q.z
  out.orientation.w = s.q.w
  out.onGround = s.onGround
  out.crashed = s.crashed
}

function extrapolate(s: Sample, t: number, out: RemotePose): void {
  if (s.crashed || t <= s.t) return
  const dt = Math.min(t - s.t, MAX_EXTRAPOLATE_MS) * 0.001
  out.position.x += s.v.x * dt
  out.position.y += s.v.y * dt
  out.position.z += s.v.z * dt
}

function lerp3(a: Vec3, b: Vec3, k: number, out: Vec3): void {
  out.x = a.x + (b.x - a.x) * k
  out.y = a.y + (b.y - a.y) * k
  out.z = a.z + (b.z - a.z) * k
}

/** Normalised lerp along the short arc; indistinguishable from slerp at snapshot spacing. */
function nlerp(a: Quat, b: Quat, k: number, out: Quat): void {
  const s = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1
  const x = a.x + (b.x * s - a.x) * k
  const y = a.y + (b.y * s - a.y) * k
  const z = a.z + (b.z * s - a.z) * k
  const w = a.w + (b.w * s - a.w) * k
  const n = Math.hypot(x, y, z, w) || 1
  out.x = x / n
  out.y = y / n
  out.z = z / n
  out.w = w / n
}
