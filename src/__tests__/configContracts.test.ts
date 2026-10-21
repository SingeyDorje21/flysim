import { describe, expect, it } from 'vitest'
import { isOnRunway, RUNWAY, SPAWNS } from '../config/world'
import { QUALITY_LEVELS, QUALITY_PROFILES } from '../config/quality'
import { RING_COURSE } from '../game/courses'
import { GAME_MODES, getModeInfo } from '../game/modes'
import { CAMERA_MODES } from '../game/types'
import type { GameMode } from '../game/types'

/** Heading convention: 0 = north = -Z, 90 = east = +X, clockwise. */
function bearingDeg(from: { x: number; z: number }, to: { x: number; z: number }): number {
  const deg = (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI
  return (deg + 360) % 360
}
function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

describe('bearing helper (self-check)', () => {
  it('north/east/south/west', () => {
    const o = { x: 0, z: 0 }
    expect(bearingDeg(o, { x: 0, z: -10 })).toBeCloseTo(0)
    expect(bearingDeg(o, { x: 10, z: 0 })).toBeCloseTo(90)
    expect(bearingDeg(o, { x: 0, z: 10 })).toBeCloseTo(180)
    expect(bearingDeg(o, { x: -10, z: 0 })).toBeCloseTo(270)
  })
})

describe('spawns', () => {
  const modes = Object.keys(SPAWNS) as GameMode[]

  it('has a spawn for every game mode', () => {
    expect([...modes].sort()).toEqual(GAME_MODES.map((m) => m.id).sort())
  })

  it('onGround spawns sit on the runway, with runway heading, at rest', () => {
    const ground = modes.filter((m) => SPAWNS[m].onGround)
    expect([...ground].sort()).toEqual(['freeFlight', 'takeoff'])
    for (const mode of ground) {
      const sp = SPAWNS[mode]
      expect(isOnRunway(sp.position.x, sp.position.z), mode).toBe(true)
      expect(angleDiff(sp.headingDeg, RUNWAY.headingDeg), mode).toBeLessThan(1)
      expect(sp.airspeed, mode).toBe(0)
      // heading north = -Z: at least 1000 m of runway ahead
      expect(sp.position.z - (RUNWAY.centerZ - RUNWAY.length / 2), mode).toBeGreaterThan(1000)
    }
  })

  it('airborne spawns are above the runway elevation and moving', () => {
    for (const mode of modes.filter((m) => !SPAWNS[m].onGround)) {
      const sp = SPAWNS[mode]
      expect(sp.position.y, mode).toBeGreaterThan(RUNWAY.elevation + 50)
      expect(sp.airspeed, mode).toBeGreaterThan(25)
      expect(sp.throttle, mode).toBeGreaterThan(0)
    }
  })

  it('all values are finite and in range', () => {
    for (const mode of modes) {
      const sp = SPAWNS[mode]
      for (const v of [sp.position.x, sp.position.y, sp.position.z, sp.headingDeg, sp.airspeed]) {
        expect(Number.isFinite(v), mode).toBe(true)
      }
      expect(sp.throttle).toBeGreaterThanOrEqual(0)
      expect(sp.throttle).toBeLessThanOrEqual(1)
      expect(sp.flaps).toBeGreaterThanOrEqual(0)
      expect(sp.flaps).toBeLessThanOrEqual(1)
    }
  })

  it('landing spawn is on a roughly 3 degree glide path to the aim point, lined up', () => {
    const sp = SPAWNS.landing
    const dist = sp.position.z - RUNWAY.aimPointZ
    const slope = (Math.atan((sp.position.y - RUNWAY.elevation) / dist) * 180) / Math.PI
    expect(slope).toBeGreaterThan(2.5)
    expect(slope).toBeLessThan(3.5)
    expect(Math.abs(sp.position.x - RUNWAY.centerX)).toBeLessThan(RUNWAY.width / 2)
    expect(angleDiff(sp.headingDeg, RUNWAY.headingDeg)).toBeLessThan(1)
  })

  it('runway constants are self-consistent', () => {
    expect(RUNWAY.thresholdZ).toBe(RUNWAY.centerZ + RUNWAY.length / 2)
    expect(RUNWAY.aimPointZ).toBeLessThan(RUNWAY.thresholdZ)
    expect(RUNWAY.aimPointZ).toBeGreaterThan(RUNWAY.centerZ - RUNWAY.length / 2)
    expect(isOnRunway(0, RUNWAY.thresholdZ)).toBe(true)
    expect(isOnRunway(0, RUNWAY.thresholdZ + 1)).toBe(false)
    expect(isOnRunway(RUNWAY.width / 2 + 1, 0)).toBe(false)
    expect(isOnRunway(RUNWAY.width / 2 + 1, 0, 2)).toBe(true)
  })
})

describe('ring course', () => {
  it('ids run 1..n in order', () => {
    expect(RING_COURSE.length).toBeGreaterThan(0)
    RING_COURSE.forEach((r, i) => expect(r.id).toBe(i + 1))
  })

  it('radii are positive, positions finite and above the runway', () => {
    for (const r of RING_COURSE) {
      expect(r.radius).toBeGreaterThan(0)
      expect(Number.isFinite(r.radius)).toBe(true)
      for (const v of [r.position.x, r.position.y, r.position.z, r.headingDeg]) {
        expect(Number.isFinite(v)).toBe(true)
      }
      expect(r.position.y).toBeGreaterThan(RUNWAY.elevation)
      expect(r.headingDeg).toBeGreaterThanOrEqual(0)
      expect(r.headingDeg).toBeLessThan(360)
    }
  })

  it('each ring heading is within 45 degrees of the bearing from the previous point', () => {
    let prev = SPAWNS.rings.position
    for (const r of RING_COURSE) {
      const b = bearingDeg(prev, r.position)
      expect(
        angleDiff(r.headingDeg, b),
        `ring ${r.id}: heading ${r.headingDeg} vs bearing ${b.toFixed(0)}`,
      ).toBeLessThanOrEqual(45)
      prev = r.position
    }
  })

  it('rings are spaced sensibly (300 m .. 3 km)', () => {
    let prev = SPAWNS.rings.position
    for (const r of RING_COURSE) {
      const d = Math.hypot(r.position.x - prev.x, r.position.z - prev.z)
      expect(d, `ring ${r.id}`).toBeGreaterThan(300)
      expect(d, `ring ${r.id}`).toBeLessThan(3000)
      prev = r.position
    }
  })

  it('spawn faces ring 1 and the course fits the time limit at spawn speed', () => {
    const sp = SPAWNS.rings
    expect(angleDiff(sp.headingDeg, bearingDeg(sp.position, RING_COURSE[0].position))).toBeLessThan(30)
    let len = 0
    let prev = sp.position
    for (const r of RING_COURSE) {
      len += Math.hypot(r.position.x - prev.x, r.position.y - prev.y, r.position.z - prev.z)
      prev = r.position
    }
    const limit = getModeInfo('rings').timeLimit ?? Infinity
    expect(len / sp.airspeed).toBeLessThan(limit * 0.75)
  })
})

describe('game modes', () => {
  it('has unique ids and a positive or null time limit', () => {
    const ids = GAME_MODES.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of GAME_MODES) {
      if (m.timeLimit !== null) expect(m.timeLimit).toBeGreaterThan(0)
      expect(m.objectives.length).toBeGreaterThan(0)
    }
  })

  it('getModeInfo throws for an unknown mode', () => {
    expect(() => getModeInfo('nope' as GameMode)).toThrow()
  })

  it('camera mode order matches the 1/2/3 key bindings', () => {
    expect([...CAMERA_MODES]).toEqual(['chase', 'cockpit', 'free'])
  })
})

describe('quality profiles', () => {
  it('has a profile for every level', () => {
    expect([...QUALITY_LEVELS]).toEqual(['low', 'medium', 'high'])
    for (const q of QUALITY_LEVELS) expect(QUALITY_PROFILES[q]).toBeDefined()
  })

  it('load rises monotonically from low to high', () => {
    const numeric = ['terrainSegments', 'cloudCount', 'treeCount', 'shadowMapSize', 'fogFar', 'maxDpr'] as const
    for (const key of numeric) {
      const [lo, mid, hi] = QUALITY_LEVELS.map((q) => QUALITY_PROFILES[q][key])
      expect(lo, key).toBeLessThan(mid)
      expect(mid, key).toBeLessThan(hi)
    }
    const sh = QUALITY_LEVELS.map((q) => QUALITY_PROFILES[q].shadows)
    expect(sh[0]).toBe(false)
    expect(sh[1] && sh[2]).toBe(true)
  })

  it('values are positive and finite', () => {
    for (const q of QUALITY_LEVELS) {
      const p = QUALITY_PROFILES[q]
      for (const v of [p.terrainSegments, p.cloudCount, p.treeCount, p.shadowMapSize, p.fogFar, p.maxDpr]) {
        expect(v).toBeGreaterThan(0)
        expect(Number.isFinite(v)).toBe(true)
      }
    }
  })
})
