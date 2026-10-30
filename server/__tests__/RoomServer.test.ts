import { beforeEach, describe, expect, it } from 'vitest'
import {
  collisionRadius,
  encode,
  MAX_PLAYERS,
  parseServerMessage,
  PROTOCOL_VERSION,
  SERVER_TICK_HZ,
  SPAWN_GRACE_S,
  type ClientMessage,
  type ServerMessage,
} from '../../src/net/protocol'
import { RoomServer, type ClientHandle } from '../RoomServer'

let clock = 0
let codeSeq = 0
const CODES = ['ABC234', 'DEF567', 'GHJ789', 'KMN234']

function makeServer(opts = {}) {
  return new RoomServer({ now: () => clock, newCode: () => CODES[codeSeq++ % CODES.length], ...opts })
}

class FakeClient {
  inbox: ServerMessage[] = []
  closed = false
  handle: ClientHandle
  constructor(server: RoomServer, ip = '1.2.3.4') {
    this.handle = server.connect(
      {
        send: (d) => {
          const m = parseServerMessage(d)
          if (!m) throw new Error(`server sent an invalid message: ${d}`)
          this.inbox.push(m)
        },
        close: () => {
          this.closed = true
        },
      },
      ip,
    )
  }
  send(msg: ClientMessage) {
    this.handle.onMessage(encode(msg))
  }
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined
  }
  all<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[]
  }
  get id() {
    return this.last('welcome')!.id
  }
  fly(x: number, y: number, z: number, onGround = false, crashed = false) {
    this.send({
      t: 'pose',
      seq: 1,
      p: { x, y, z },
      q: { x: 0, y: 0, z: 0, w: 1 },
      v: { x: 0, y: 0, z: -50 },
      onGround,
      crashed,
    })
  }
}

function create(server: RoomServer, name = 'Ace', ip?: string) {
  const c = new FakeClient(server, ip)
  c.send({ t: 'create', v: PROTOCOL_VERSION, name, aircraftId: 'trainer' })
  return c
}
function join(server: RoomServer, code: string, name = 'Bee', ip?: string) {
  const c = new FakeClient(server, ip)
  c.send({ t: 'join', v: PROTOCOL_VERSION, code, name, aircraftId: 'trainer' })
  return c
}
/** Advance the clock by `seconds` in server ticks. */
function run(server: RoomServer, seconds: number, each?: () => void) {
  const n = Math.round(seconds * SERVER_TICK_HZ)
  for (let i = 0; i < n; i++) {
    clock += 1000 / SERVER_TICK_HZ
    each?.()
    server.tick()
  }
}

beforeEach(() => {
  clock = 1_000_000
  codeSeq = 0
})

describe('rooms', () => {
  it('create returns a code and slot 0', () => {
    const s = makeServer()
    const a = create(s)
    expect(a.last('welcome')).toMatchObject({ code: 'ABC234', slot: 0 })
    expect(a.last('roster')!.players).toHaveLength(1)
    expect(s.roomCount).toBe(1)
  })

  it('join by code puts both players in the roster with distinct slots', () => {
    const s = makeServer()
    const a = create(s)
    const b = join(s, 'abc-234')
    expect(b.last('welcome')).toMatchObject({ code: 'ABC234', slot: 1 })
    expect(a.last('roster')!.players.map((p) => p.name)).toEqual(['Ace', 'Bee'])
  })

  it('wrong code is BAD_CODE', () => {
    const s = makeServer()
    create(s)
    const b = join(s, 'ZZZ999')
    expect(b.last('error')!.code).toBe('BAD_CODE')
    expect(b.last('welcome')).toBeUndefined()
  })

  it('full room is ROOM_FULL', () => {
    const s = makeServer({ joinLimit: 100 })
    create(s)
    for (let i = 1; i < MAX_PLAYERS; i++) join(s, 'ABC234', `P${i}`)
    const late = join(s, 'ABC234', 'Late')
    expect(late.last('error')!.code).toBe('ROOM_FULL')
  })

  it('version mismatch is refused', () => {
    const s = makeServer()
    const c = new FakeClient(s)
    c.send({ t: 'create', v: PROTOCOL_VERSION + 1, name: 'Old', aircraftId: 'f22' })
    expect(c.last('error')!.code).toBe('VERSION_MISMATCH')
  })

  it('reuses a freed slot and deletes empty rooms', () => {
    const s = makeServer()
    const a = create(s)
    const b = join(s, 'ABC234')
    a.handle.onClose()
    expect(b.last('roster')!.players.map((p) => p.name)).toEqual(['Bee'])
    const c = join(s, 'ABC234', 'Cee')
    expect(c.last('welcome')!.slot).toBe(0)
    b.handle.onClose()
    c.handle.onClose()
    expect(s.roomCount).toBe(0)
  })

  it('rate-limits create/join per IP', () => {
    const s = makeServer({ joinLimit: 3 })
    for (let i = 0; i < 3; i++) join(s, 'ZZZ999', 'x', '9.9.9.9')
    expect(join(s, 'ZZZ999', 'x', '9.9.9.9').last('error')!.code).toBe('RATE_LIMITED')
    expect(join(s, 'ZZZ999', 'x', '8.8.8.8').last('error')!.code).toBe('BAD_CODE')
    clock += 61_000
    expect(join(s, 'ZZZ999', 'x', '9.9.9.9').last('error')!.code).toBe('BAD_CODE')
  })

  it('poses before joining get NOT_IN_ROOM', () => {
    const s = makeServer()
    const c = new FakeClient(s)
    c.fly(0, 100, 0)
    expect(c.last('error')!.code).toBe('NOT_IN_ROOM')
  })
})

describe('malformed input', () => {
  it('drops garbage without crashing and closes after too many', () => {
    const s = makeServer({ maxBadMessages: 5 })
    const a = create(s)
    const b = join(s, 'ABC234')
    for (const raw of ['{', 'null', '[]', '{"t":"pose","p":1}']) b.handle.onMessage(raw)
    expect(b.closed).toBe(false)
    b.handle.onMessage('x'.repeat(10_000))
    expect(b.closed).toBe(true)
    expect(a.last('roster')!.players).toHaveLength(1)
    expect(() => s.tick()).not.toThrow()
  })

  it('ignores messages beyond the per-second rate limit', () => {
    const s = makeServer({ messageRateLimit: 3 })
    const c = new FakeClient(s)
    for (let i = 0; i < 5; i++) c.fly(0, 0, 0)
    expect(c.all('error')).toHaveLength(3)
  })
})

describe('airborne time and leaderboard', () => {
  it('counts only while airborne and not crashed', () => {
    const s = makeServer()
    const a = create(s)
    // Same spot throughout (no implausible jumps): only the flags change.
    run(s, 2, () => a.fly(0, 300, 0, true))
    expect(a.last('leaderboard')!.entries[0].seconds).toBe(0)
    run(s, 5, () => a.fly(0, 300, 0))
    expect(a.last('leaderboard')!.entries[0].seconds).toBeCloseTo(5, 0)
    run(s, 3, () => a.fly(0, 300, 0, false, true))
    expect(a.last('leaderboard')!.entries[0].seconds).toBeCloseTo(5, 0)
  })

  it('stops counting when poses go stale', () => {
    const s = makeServer()
    const a = create(s)
    run(s, 1, () => a.fly(0, 300, 0))
    run(s, 5)
    expect(a.last('leaderboard')!.entries[0].seconds).toBeLessThan(3)
  })

  it('a terrain crash does not reset the score (D2)', () => {
    const s = makeServer()
    const a = create(s)
    run(s, 4, () => a.fly(0, 300, 0))
    a.fly(0, 0, 0, false, true)
    run(s, 1)
    expect(a.last('leaderboard')!.entries[0]).toMatchObject({ resets: 0 })
    expect(a.last('leaderboard')!.entries[0].seconds).toBeGreaterThan(3)
  })

  it('sorts by time, longest first', () => {
    const s = makeServer()
    const a = create(s)
    const b = join(s, 'ABC234')
    run(s, 4, () => {
      a.fly(0, 300, 0, true)
      b.fly(5000, 300, 0)
    })
    expect(a.last('leaderboard')!.entries.map((e) => e.id)).toEqual([b.id, a.id])
  })
})

describe('collisions', () => {
  function airborneNear(s: RoomServer) {
    const a = create(s)
    const b = join(s, 'ABC234')
    // 40 m apart (clear of each other, but close enough to touch in a plausible
    // step) until both are past the spawn grace window and have scores.
    run(s, SPAWN_GRACE_S + 2, () => {
      a.fly(0, 300, 0)
      b.fly(40, 300, 0)
    })
    return { a, b }
  }

  it('touching aircraft both crash and both scores reset', () => {
    const s = makeServer()
    const { a, b } = airborneNear(s)
    expect(a.last('leaderboard')!.entries.every((e) => e.seconds > 4)).toBe(true)
    run(s, 0.1, () => {
      a.fly(0, 300, 0)
      b.fly(3, 301, 0)
    })
    const hit = a.last('collision')!
    expect(new Set([hit.a, hit.b])).toEqual(new Set([a.id, b.id]))
    expect(b.last('collision')).toEqual(hit)
    for (const e of a.last('leaderboard')!.entries) expect(e).toMatchObject({ seconds: 0, resets: 1 })
  })

  it('collides once, and stays crashed until respawn even if poses say otherwise', () => {
    const s = makeServer()
    const { a, b } = airborneNear(s)
    run(s, 2, () => {
      a.fly(0, 300, 0)
      b.fly(3, 300, 0)
    })
    expect(a.all('collision')).toHaveLength(1)
    expect(a.last('leaderboard')!.entries.every((e) => e.seconds === 0)).toBe(true)
    const snap = a.last('snapshot')!
    expect(snap.players.find((p) => p.id === b.id)!.crashed).toBe(true)
  })

  it('respawn grants grace immunity, then collisions resume', () => {
    const s = makeServer()
    const { a, b } = airborneNear(s)
    run(s, 0.1, () => {
      a.fly(0, 300, 0)
      b.fly(3, 300, 0)
    })
    a.send({ t: 'respawn' })
    b.send({ t: 'respawn' })
    run(s, SPAWN_GRACE_S - 0.5, () => {
      a.fly(0, 300, 0)
      b.fly(3, 300, 0)
    })
    expect(a.all('collision')).toHaveLength(1)
    run(s, 1, () => {
      a.fly(0, 300, 0)
      b.fly(3, 300, 0)
    })
    expect(a.all('collision')).toHaveLength(2)
  })

  it('new joiners are immune during the spawn grace window', () => {
    const s = makeServer()
    const a = create(s)
    const b = join(s, 'ABC234')
    run(s, SPAWN_GRACE_S - 0.5, () => {
      a.fly(0, 300, 0)
      b.fly(1, 300, 0)
    })
    expect(a.all('collision')).toHaveLength(0)
  })

  it('two aircraft on the ground never collide', () => {
    const s = makeServer()
    const a = create(s)
    const b = join(s, 'ABC234')
    run(s, SPAWN_GRACE_S + 1, () => {
      a.fly(0, 0, 0, true)
      b.fly(2, 0, 0, true)
    })
    expect(a.all('collision')).toHaveLength(0)
  })

  it('a landing aircraft can hit one on the ground', () => {
    const s = makeServer()
    const a = create(s)
    const b = join(s, 'ABC234')
    run(s, SPAWN_GRACE_S + 1, () => {
      a.fly(0, 0, 0, true)
      b.fly(2, 2, 0, false)
    })
    expect(a.all('collision')).toHaveLength(1)
  })

  it('aircraft far apart do not collide', () => {
    const s = makeServer()
    const { a } = airborneNear(s)
    expect(a.all('collision')).toHaveLength(0)
  })
})

describe('fast passes', () => {
  /** Pose at x along the X axis, flying at vx m/s. */
  const jet = (c: FakeClient, x: number, vx: number) =>
    c.send({ t: 'pose', seq: 1, p: { x, y: 300, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, v: { x: vx, y: 0, z: 0 }, onGround: false, crashed: false })

  function jets(s: RoomServer) {
    const a = new FakeClient(s)
    a.send({ t: 'create', v: PROTOCOL_VERSION, name: 'Ace', aircraftId: 'f22' })
    const b = new FakeClient(s)
    b.send({ t: 'join', v: PROTOCOL_VERSION, code: 'ABC234', name: 'Bee', aircraftId: 'f22' })
    return { a, b }
  }

  it('two jets that cross between ticks still collide', () => {
    const s = makeServer()
    const { a, b } = jets(s)
    // Head-on at 600 m/s each, closing 60 m per tick: far more than their ~15 m combined
    // radius. The gap goes 40 m -> -20 m (passed) at tick 100, past the spawn grace,
    // so comparing only tick positions would never see them touch.
    const r = 2 * collisionRadius('f22')
    let hitTick = -1
    for (let k = 1; k <= 110 && hitTick < 0; k++) {
      clock += 1000 / SERVER_TICK_HZ
      const xa = -3020 + 30 * k
      const xb = 3000 - 30 * k
      expect(Math.abs(xb - xa)).toBeGreaterThan(r)
      jet(a, xa, 600)
      jet(b, xb, -600)
      s.tick()
      if (a.all('collision').length) hitTick = k
    }
    expect(hitTick).toBe(101)
  })

  it('jets passing well apart do not collide', () => {
    const s = makeServer()
    const { a, b } = jets(s)
    let xa = -600
    let xb = 600
    run(s, SPAWN_GRACE_S + 2, () => {
      xa += 30
      xb -= 30
      a.send({ t: 'pose', seq: 1, p: { x: xa, y: 300, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, v: { x: 600, y: 0, z: 0 }, onGround: false, crashed: false })
      b.send({ t: 'pose', seq: 1, p: { x: xb, y: 300, z: 60 }, q: { x: 0, y: 0, z: 0, w: 1 }, v: { x: -600, y: 0, z: 0 }, onGround: false, crashed: false })
    })
    expect(a.all('collision')).toHaveLength(0)
  })
})

describe('anti-griefing', () => {
  function airborneApart(s: RoomServer) {
    const a = create(s)
    const b = join(s, 'ABC234')
    run(s, SPAWN_GRACE_S + 2, () => {
      a.fly(0, 300, 0)
      b.fly(2000, 300, 0)
    })
    return { a, b }
  }

  it('teleporting onto another pilot does not crash them or reset their score', () => {
    const s = makeServer()
    const { a, b } = airborneApart(s)
    // b jumps 2 km in one tick, right onto a, then sits there briefly.
    run(s, 1, () => {
      a.fly(0, 300, 0)
      b.fly(1, 300, 0)
    })
    expect(a.all('collision')).toHaveLength(0)
    expect(a.last('leaderboard')!.entries.find((e) => e.id === a.id)!.seconds).toBeGreaterThan(5)
  })

  it('a teleporter earns no airborne time during the penalty', () => {
    const s = makeServer()
    const { a, b } = airborneApart(s)
    const before = a.last('leaderboard')!.entries.find((e) => e.id === b.id)!.seconds
    run(s, 1, () => {
      a.fly(0, 300, 0)
      b.fly(50_000, 300, 0)
    })
    const after = a.last('leaderboard')!.entries.find((e) => e.id === b.id)!.seconds
    expect(after - before).toBeLessThan(0.2)
  })

  it('respawn spam does not keep renewing the spawn grace', () => {
    const s = makeServer()
    const { a, b } = airborneApart(s)
    b.send({ t: 'respawn' })
    run(s, SPAWN_GRACE_S + 0.5, () => {
      a.fly(0, 300, 0)
      b.fly(2000, 300, 0)
    })
    // Fly b steadily (plausible speed) to 300 m from a.
    const step = (x: number) => {
      clock += 1000 / SERVER_TICK_HZ
      a.fly(0, 300, 0)
      b.fly(x, 300, 0)
      s.tick()
    }
    for (let x = 2000; x > 300; x -= 30) step(x)
    expect(a.all('collision')).toHaveLength(0)
    // Within the cooldown, a respawn without a crash is ignored, so b is still
    // collidable when it reaches a half a second later.
    b.send({ t: 'respawn' })
    for (let x = 300; x >= 0; x -= 30) step(x)
    expect(a.all('collision')).toHaveLength(1)
  })

  it('caps the number of rooms', () => {
    const s = makeServer({ maxRooms: 2, joinLimit: 100 })
    create(s, 'A', '1.1.1.1')
    create(s, 'B', '1.1.1.2')
    expect(create(s, 'C', '1.1.1.3').last('error')!.code).toBe('SERVER_FULL')
  })

  it('caps wrong-code joins across all IPs', () => {
    const s = makeServer({ globalFailedJoinLimit: 3 })
    for (let i = 0; i < 3; i++) join(s, 'ZZZ999', 'x', `10.0.0.${i}`)
    expect(join(s, 'ZZZ999', 'x', '10.0.0.99').last('error')!.code).toBe('RATE_LIMITED')
  })

  it('gives players random, non-sequential ids', () => {
    const s = makeServer()
    const a = create(s)
    const b = join(s, 'ABC234')
    expect(a.id).toMatch(/^p[a-z0-9]{10}$/)
    expect(a.id).not.toBe(b.id)
    expect(a.id).not.toBe('p1')
  })
})
