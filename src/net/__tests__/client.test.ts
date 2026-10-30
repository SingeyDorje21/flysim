import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MultiplayerClient } from '../client'
import { PROTOCOL_VERSION, type ServerMessage } from '../protocol'
import { FakeSocket } from './fakeSocket'

const local = {
  position: { x: 1.234567, y: 300, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
  velocity: { x: 0, y: 0, z: -60 },
  onGround: false,
  crashed: false,
}

function setup() {
  const got: ServerMessage[] = []
  const events: string[] = []
  const c = new MultiplayerClient(
    'ws://test',
    {
      onMessage: (m) => got.push(m),
      onReconnecting: (n) => events.push(`reconnecting ${n}`),
      onGiveUp: (opened) => events.push(`giveUp ${opened}`),
    },
    FakeSocket.factory,
  )
  return { c, got, events }
}

beforeEach(() => {
  FakeSocket.reset()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('MultiplayerClient', () => {
  it('sends create on open and delivers validated messages', () => {
    const { c, got } = setup()
    c.start({ kind: 'create', name: 'Ace', aircraftId: 'f22' })
    const s = FakeSocket.last
    s.open()
    expect(s.sent).toEqual([{ t: 'create', v: PROTOCOL_VERSION, name: 'Ace', aircraftId: 'f22' }])
    s.receive({ t: 'welcome', code: 'ABC234', id: 'p1', slot: 0 })
    s.onmessage?.({ data: '{"t":"welcome","code":"bad"}' })
    s.onmessage?.({ data: 42 })
    expect(got).toEqual([{ t: 'welcome', code: 'ABC234', id: 'p1', slot: 0 }])
  })

  it('throttles poses to about 15 Hz and rounds them', () => {
    const { c } = setup()
    c.start({ kind: 'join', code: 'ABC234', name: 'Bee', aircraftId: 'trainer' })
    const s = FakeSocket.last
    s.open()
    for (let t = 0; t < 1000; t += 1000 / 60) c.sendPose(local, t)
    const poses = s.sent.filter((m) => m.t === 'pose')
    expect(poses.length).toBeGreaterThanOrEqual(14)
    expect(poses.length).toBeLessThanOrEqual(16)
    expect(poses[0]).toMatchObject({ p: { x: 1.23 } })
  })

  it('sends nothing while the socket is not open', () => {
    const { c } = setup()
    c.start({ kind: 'create', name: 'Ace', aircraftId: 'f22' })
    c.sendPose(local, 0)
    c.sendRespawn()
    expect(FakeSocket.last.sent).toEqual([])
  })

  it('gives up at once when the server was never reached', () => {
    const { c, events } = setup()
    c.start({ kind: 'create', name: 'Ace', aircraftId: 'f22' })
    FakeSocket.last.drop()
    expect(events).toEqual(['giveUp false'])
    vi.runAllTimers()
    expect(FakeSocket.all).toHaveLength(1)
  })

  it('reconnects with backoff and rejoins the same room', () => {
    const { c, events } = setup()
    c.start({ kind: 'create', name: 'Ace', aircraftId: 'f22' })
    FakeSocket.last.open()
    FakeSocket.last.receive({ t: 'welcome', code: 'ABC234', id: 'p1', slot: 0 })
    FakeSocket.last.drop()
    expect(events).toEqual(['reconnecting 1'])
    vi.advanceTimersByTime(499)
    expect(FakeSocket.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(2)
    FakeSocket.last.open()
    expect(FakeSocket.last.sent[0]).toMatchObject({ t: 'join', code: 'ABC234', name: 'Ace' })
  })

  it('stops after five failed reconnects', () => {
    const { c, events } = setup()
    c.start({ kind: 'create', name: 'Ace', aircraftId: 'f22' })
    FakeSocket.last.open()
    // Each retry reaches the socket but drops before opening again.
    for (let i = 0; i < 6; i++) {
      FakeSocket.last.drop()
      vi.runOnlyPendingTimers()
    }
    expect(events.at(-1)).toBe('giveUp true')
    expect(events.filter((e) => e.startsWith('reconnecting'))).toHaveLength(5)
  })

  it('close() is final: no reconnect, no events', () => {
    const { c, events } = setup()
    c.start({ kind: 'create', name: 'Ace', aircraftId: 'f22' })
    const s = FakeSocket.last
    s.open()
    c.close()
    expect(s.closed).toBe(true)
    vi.runAllTimers()
    expect(events).toEqual([])
    expect(FakeSocket.all).toHaveLength(1)
  })
})
