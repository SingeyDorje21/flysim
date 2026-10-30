import { describe, expect, it } from 'vitest'
import type { PoseData } from '../protocol'
import { createRemotePose, INTERP_DELAY_MS, RemotePoses } from '../remotePoses'

const pose = (x: number, extra: Partial<PoseData> = {}): PoseData => ({
  p: { x, y: 300, z: 0 },
  q: { x: 0, y: 0, z: 0, w: 1 },
  v: { x: 100, y: 0, z: 0 },
  onGround: false,
  crashed: false,
  ...extra,
})
const snap = (time: number, x: number, extra?: Partial<PoseData>) => ({
  t: 'snapshot' as const,
  time,
  players: [{ id: 'p2', ...pose(x, extra) }],
})

describe('RemotePoses', () => {
  it('knows nothing before the first snapshot', () => {
    expect(new RemotePoses().sample('p2', 0, createRemotePose())).toBe(false)
  })

  it('interpolates INTERP_DELAY_MS behind the newest snapshot', () => {
    const r = new RemotePoses()
    // Server clock 10 000 ms ahead of the local clock.
    r.ingest(snap(10_000, 0), 0)
    r.ingest(snap(10_050, 5), 50)
    r.ingest(snap(10_100, 10), 100)
    r.ingest(snap(10_150, 15), 150)
    const out = createRemotePose()
    // Local 175 -> server 10 175 - 100 = 10 075: halfway between x=5 and x=10.
    expect(r.sample('p2', 175, out)).toBe(true)
    expect(out.position.x).toBeCloseTo(7.5, 1)
    expect(INTERP_DELAY_MS).toBe(100)
  })

  it('extrapolates briefly along the velocity, then holds', () => {
    const r = new RemotePoses()
    r.ingest(snap(1000, 0), 1000)
    r.ingest(snap(1050, 5), 1050)
    const out = createRemotePose()
    r.sample('p2', 1050 + INTERP_DELAY_MS + 100, out)
    expect(out.position.x).toBeCloseTo(5 + 100 * 0.1, 1)
    r.sample('p2', 1050 + INTERP_DELAY_MS + 5000, out)
    expect(out.position.x).toBeCloseTo(5 + 100 * 0.25, 1)
  })

  it('does not extrapolate a crashed aircraft', () => {
    const r = new RemotePoses()
    r.ingest(snap(1000, 0, { crashed: true }), 1000)
    const out = createRemotePose()
    r.sample('p2', 3000, out)
    expect(out.position.x).toBe(0)
    expect(out.crashed).toBe(true)
  })

  it('snaps on a teleport (respawn) instead of sliding across the map', () => {
    const r = new RemotePoses()
    r.ingest(snap(1000, 0, { crashed: true }), 1000)
    r.ingest(snap(1050, 9000), 1050)
    const out = createRemotePose()
    r.sample('p2', 1050 + INTERP_DELAY_MS - 25, out)
    expect(out.position.x).toBe(9000)
    expect(out.crashed).toBe(false)
  })

  it('keeps orientation normalised while interpolating', () => {
    const r = new RemotePoses()
    const s = Math.SQRT1_2
    r.ingest(snap(0, 0), 0)
    r.ingest({ t: 'snapshot', time: 50, players: [{ id: 'p2', ...pose(5), q: { x: 0, y: s, z: 0, w: s } }] }, 50)
    const out = createRemotePose()
    r.sample('p2', 125, out)
    const q = out.orientation
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1)
    expect(q.y).toBeGreaterThan(0)
    expect(q.y).toBeLessThan(s)
  })

  it('retain() forgets players who left', () => {
    const r = new RemotePoses()
    r.ingest(snap(0, 0), 0)
    r.retain(['p3'])
    expect(r.has('p2')).toBe(false)
  })
})
