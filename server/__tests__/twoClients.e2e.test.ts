/**
 * End to end: a real sky server on a real port, and two real WebSocket
 * clients (the same MultiplayerClient the browser uses).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { MultiplayerClient, type LocalPose, type SocketLike } from '../../src/net/client'
import { SPAWN_GRACE_S, type ServerMessage } from '../../src/net/protocol'
import { startServer } from '../index'

let server: ReturnType<typeof startServer>
let url = ''

beforeAll(async () => {
  server = startServer(0)
  await new Promise<void>((resolve) => server.http.once('listening', () => resolve()))
  url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}`
})

describe('health check', () => {
  it('answers GET /healthz with 200 on the same port', async () => {
    const res = await fetch(url.replace('ws:', 'http:') + '/healthz')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })
})
afterAll(() => server.stop())

class Pilot {
  inbox: ServerMessage[] = []
  client: MultiplayerClient
  private seq = 0
  constructor() {
    this.client = new MultiplayerClient(
      url,
      { onMessage: (m) => this.inbox.push(m), onReconnecting: () => {}, onGiveUp: () => {} },
      (u) => new WebSocket(u) as unknown as SocketLike,
    )
  }
  last<T extends ServerMessage['t']>(t: T) {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined
  }
  all<T extends ServerMessage['t']>(t: T) {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[]
  }
  get id() {
    return this.last('welcome')!.id
  }
  /** Bypasses the 15 Hz throttle by advancing a fake clock per call. */
  fly(x: number, y: number, onGround = false) {
    const pose: LocalPose = {
      position: { x, y, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: -60 },
      onGround,
      crashed: false,
    }
    this.client.sendPose(pose, (this.seq += 100))
  }
}

async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** Keep both pilots reporting poses every 50 ms for `seconds`. */
async function hold(seconds: number, each: () => void) {
  const end = Date.now() + seconds * 1000
  while (Date.now() < end) {
    each()
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('two pilots against a real sky server', () => {
  it('both join the one sky, see each other, collide, and both scores reset', async () => {
    const ace = new Pilot()
    const bee = new Pilot()
    ace.client.start({ name: 'Ace', aircraftId: 'trainer' })
    await until(() => !!ace.last('welcome'))

    bee.client.start({ name: 'Bee', aircraftId: 'f22' })
    await until(() => !!bee.last('welcome'))
    await until(() => ace.last('roster')?.players.length === 2)
    expect(ace.last('roster')!.players.map((p) => p.name)).toEqual(['Ace', 'Bee'])

    // Ace sits on the ground while Bee flies far away: only Bee earns time,
    // and each sees the other in snapshots.
    await hold(SPAWN_GRACE_S + 1.2, () => {
      ace.fly(0, 400, true)
      bee.fly(300, 400)
    })
    await until(() => !!ace.last('snapshot')?.players.some((p) => p.id === bee.id))
    expect(bee.last('snapshot')!.players.map((p) => p.id)).toEqual([ace.id])
    // The board is broadcast once a second, so it can lag the server by up to 1 s.
    const secondsOf = (id: string) => ace.last('leaderboard')!.entries.find((e) => e.id === id)!.seconds
    await until(() => secondsOf(bee.id) > SPAWN_GRACE_S - 1)
    expect(secondsOf(ace.id)).toBe(0)

    // Ace takes off; then they fly into each other.
    await hold(1.2, () => {
      ace.fly(0, 400)
      bee.fly(300, 400)
    })
    // Bee closes at 200 m/s (10 m per 50 ms): no implausible jump for the server to penalise.
    let bx = 300
    await hold(2, () => {
      bx = Math.max(0, bx - 10)
      ace.fly(0, 400)
      bee.fly(bx, 400)
    })
    await until(() => !!ace.last('collision') && !!bee.last('collision'))
    expect(new Set([ace.last('collision')!.a, ace.last('collision')!.b])).toEqual(new Set([ace.id, bee.id]))
    await until(() => ace.last('leaderboard')!.entries.every((e) => e.resets === 1))
    for (const e of ace.last('leaderboard')!.entries) expect(e).toMatchObject({ seconds: 0, score: 0 })
    // Both appear crashed to the other.
    await until(() => !!bee.last('snapshot')?.players.find((p) => p.id === ace.id)?.crashed)
    expect(ace.all('collision')).toHaveLength(1)

    ace.client.close()
    await until(() => bee.last('roster')?.players.length === 1)
    bee.client.close()
    await until(() => server.sky.playerCount === 0)
  }, 20_000)

})
