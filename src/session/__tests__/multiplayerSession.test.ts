import { describe, expect, it } from 'vitest'
import type { FlightResult } from '../../game/types'
import { HOME_PLACE } from '../../game/spawns'
import { spawnSlotOffset } from '../../net/protocol'
import { FlightSession } from '../FlightSession'

const FRAME = 1 / 60

function session(spawnSlot: number | null, onFinish: (r: FlightResult) => void = () => {}) {
  const s = new FlightSession({ mode: 'freeFlight', place: HOME_PLACE, spawnSlot, onFinish })
  s.reset('freeFlight', HOME_PLACE)
  return s
}

describe('multiplayer session hooks', () => {
  it('without a slot the spawn is the normal Free Flight spawn', () => {
    const a = session(null).physics.state.position
    const b = new FlightSession({ mode: 'freeFlight', place: HOME_PLACE, onFinish: () => {} }).physics.state.position
    expect(a).toEqual(b)
  })

  it('a slot moves the spawn along and beside the runway, and restarts keep it', () => {
    const base = session(null).physics.state
    const s = session(3)
    const p = s.physics.state.position
    const { alongM, rightM } = spawnSlotOffset(3)
    expect(Math.hypot(p.x - base.position.x, p.z - base.position.z)).toBeCloseTo(Math.hypot(alongM, rightM), 1)
    expect(s.physics.state.headingDeg).toBeCloseTo(base.headingDeg, 3)
    s.frame(1, false)
    s.reset('freeFlight', HOME_PLACE)
    expect(s.physics.state.position.x).toBeCloseTo(p.x, 3)
    expect(s.physics.state.position.z).toBeCloseTo(p.z, 3)
  })

  it('every slot starts at a different place on the runway', () => {
    const spots = new Set<string>()
    for (let slot = 0; slot < 8; slot++) {
      const p = session(slot).physics.state.position
      spots.add(`${Math.round(p.x)},${Math.round(p.z)}`)
    }
    expect(spots.size).toBe(8)
  })

  it('forceCrash ends the flight with the mid-air reason', () => {
    let result: FlightResult | null = null
    const s = session(0, (r) => (result = r))
    s.physics.forceCrash('Mid-air collision with Bee')
    expect(s.physics.state).toMatchObject({ crashed: true, crashReason: 'Mid-air collision with Bee' })
    for (let i = 0; i < 240 && !result; i++) s.frame(FRAME, false)
    expect(result).toMatchObject({ outcome: 'failure', reason: 'Mid-air collision with Bee' })
  })

  it('forceCrash on a crashed aircraft keeps the first reason', () => {
    const s = session(0)
    s.physics.forceCrash('Terrain collision')
    s.physics.forceCrash('Mid-air collision with Bee')
    expect(s.physics.state.crashReason).toBe('Terrain collision')
  })

  it('a respawn clears the crash', () => {
    const s = session(2)
    s.physics.forceCrash('Mid-air collision with Bee')
    s.reset('freeFlight', HOME_PLACE)
    expect(s.physics.state.crashed).toBe(false)
  })
})
