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
import type { Quat } from '../../src/simulation/types'
import { quatFromAttitude } from '../../src/simulation/math'
import { LANDING_MIN_LEG_S, MAX_MULTIPLIER, TAKEOFF_CREDIT_S } from '../scoring'
import { SkyServer, type ClientHandle } from '../SkyServer'

let clock = 0

function makeServer(opts = {}) {
  return new SkyServer({ now: () => clock, ...opts })
}

const LEVEL: Quat = { x: 0, y: 0, z: 0, w: 1 }

class FakeClient {
  inbox: ServerMessage[] = []
  closed = false
  handle: ClientHandle
  constructor(server: SkyServer, ip = '1.2.3.4') {
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
  /** This pilot's latest leaderboard row. */
  get score() {
    return this.last('leaderboard')!.entries.find((e) => e.id === this.id)!
  }
  fly(x: number, y: number, z: number, onGround = false, crashed = false, vy = 0, q: Quat = LEVEL) {
    this.send({ t: 'pose', seq: 1, p: { x, y, z }, q, v: { x: 0, y: vy, z: -50 }, onGround, crashed })
  }
}

function join(server: SkyServer, name = 'Ace', ip?: string) {
  const c = new FakeClient(server, ip)
  c.send({ t: 'hello', v: PROTOCOL_VERSION, name, aircraftId: 'trainer' })
  return c
}
/** Advance the clock by `seconds` in server ticks. */
function run(server: SkyServer, seconds: number, each?: () => void) {
  const n = Math.round(seconds * SERVER_TICK_HZ)
  for (let i = 0; i < n; i++) {
    clock += 1000 / SERVER_TICK_HZ
    each?.()
    server.tick()
  }
}

beforeEach(() => {
  clock = 1_000_000
})

describe('the shared sky', () => {
  it('hello puts the pilot in the one sky', () => {
    const s = makeServer()
    const a = join(s)
    expect(a.last('welcome')!.id).toMatch(/^p/)
    expect(a.last('roster')!.players).toEqual([{ id: a.id, name: 'Ace', aircraftId: 'trainer' }])
    expect(s.playerCount).toBe(1)
  })

  it('everyone who says hello sees everyone else', () => {
    const s = makeServer()
    const a = join(s, 'Ace')
    const b = join(s, 'Bee')
    expect(a.last('roster')!.players.map((p) => p.name)).toEqual(['Ace', 'Bee'])
    expect(b.last('roster')!.players.map((p) => p.name)).toEqual(['Ace', 'Bee'])
  })

  it('a full sky is SERVER_FULL', () => {
    const s = makeServer({ joinLimit: 100 })
    for (let i = 0; i < MAX_PLAYERS; i++) join(s, `P${i}`)
    expect(join(s, 'Late').last('error')!.code).toBe('SERVER_FULL')
  })

  it('a second hello on the same connection is refused', () => {
    const s = makeServer()
    const a = join(s)
    a.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Again', aircraftId: 'trainer' })
    expect(a.last('error')!.code).toBe('BAD_MESSAGE')
    expect(s.playerCount).toBe(1)
  })

  it('version mismatch is refused', () => {
    const s = makeServer()
    const c = new FakeClient(s)
    c.send({ t: 'hello', v: PROTOCOL_VERSION + 1, name: 'Old', aircraftId: 'f22' })
    expect(c.last('error')!.code).toBe('VERSION_MISMATCH')
  })

  it.each(['create', 'join'])('a tab still on protocol 1 (%s) is told to reload, not left waiting', (t) => {
    const s = makeServer()
    const c = new FakeClient(s)
    c.handle.onMessage(JSON.stringify({ t, v: 1, code: 'ABC234', name: 'Old', aircraftId: 'trainer' }))
    expect(c.last('error')!.code).toBe('VERSION_MISMATCH')
    expect(s.playerCount).toBe(0)
  })

  it('leaving updates everyone else', () => {
    const s = makeServer()
    const a = join(s, 'Ace')
    const b = join(s, 'Bee')
    a.handle.onClose()
    expect(b.last('roster')!.players.map((p) => p.name)).toEqual(['Bee'])
    b.handle.onClose()
    expect(s.playerCount).toBe(0)
  })

  it('rate-limits joins per IP', () => {
    const s = makeServer({ joinLimit: 3 })
    for (let i = 0; i < 3; i++) join(s, 'x', '9.9.9.9').handle.onClose()
    expect(join(s, 'x', '9.9.9.9').last('error')!.code).toBe('RATE_LIMITED')
    expect(join(s, 'x', '8.8.8.8').last('welcome')).toBeDefined()
    clock += 61_000
    expect(join(s, 'x', '9.9.9.9').last('welcome')).toBeDefined()
  })

  it('poses before joining get NOT_JOINED', () => {
    const s = makeServer()
    const c = new FakeClient(s)
    c.fly(0, 100, 0)
    expect(c.last('error')!.code).toBe('NOT_JOINED')
  })
})

describe('malformed input', () => {
  it('drops garbage without crashing and closes after too many', () => {
    const s = makeServer({ maxBadMessages: 5 })
    const a = join(s, 'Ace')
    const b = join(s, 'Bee')
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
  it('counts only while airborne, and a crash resets it', () => {
    const s = makeServer()
    const a = join(s)
    // Same spot throughout (no implausible jumps): only the flags change.
    run(s, 2, () => a.fly(0, 300, 0, true))
    expect(a.score.seconds).toBe(0)
    run(s, 5, () => a.fly(0, 300, 0))
    expect(a.score.seconds).toBeCloseTo(5, 0)
    expect(a.score.score).toBeCloseTo(5, 0)
    run(s, 3, () => a.fly(0, 300, 0, false, true))
    expect(a.score).toMatchObject({ seconds: 0, score: 0, multiplier: 1, resets: 1 })
  })

  it('a crash resets only once, and flying after a respawn counts again', () => {
    const s = makeServer()
    const a = join(s)
    run(s, 4, () => a.fly(0, 300, 0))
    run(s, 1, () => a.fly(0, 300, 0, false, true))
    expect(a.score.resets).toBe(1)
    a.send({ t: 'respawn' })
    run(s, 3, () => a.fly(0, 300, 0))
    expect(a.score.resets).toBe(1)
    expect(a.score.seconds).toBeCloseTo(3, 0)
  })

  it('stops counting when poses go stale', () => {
    const s = makeServer()
    const a = join(s)
    run(s, 1, () => a.fly(0, 300, 0))
    run(s, 5)
    expect(a.score.seconds).toBeLessThan(3)
  })

  it('sorts by score, highest first', () => {
    const s = makeServer()
    const a = join(s, 'Ace')
    const b = join(s, 'Bee')
    run(s, 4, () => {
      a.fly(0, 300, 0, true)
      b.fly(5000, 300, 0)
    })
    expect(a.last('leaderboard')!.entries.map((e) => e.id)).toEqual([b.id, a.id])
  })
})

describe('scoring: take-offs and landings', () => {
  /** On the ground, then airborne for `airborneS` seconds at 20 m (lift-off with attitude `q`; a bigger jump is a teleport). */
  function takeOff(s: SkyServer, a: FakeClient, airborneS: number, q: Quat = LEVEL) {
    run(s, 1, () => a.fly(0, 0, 0, true))
    run(s, airborneS, () => a.fly(0, 20, 0, false, false, 0, q))
  }
  /** One airborne pose sinking at `sink` m/s, then touchdown. */
  function touchDown(s: SkyServer, a: FakeClient, sink: number) {
    run(s, 0.05, () => a.fly(0, 1, 0, false, false, -sink))
    run(s, 1, () => a.fly(0, 0, 0, true))
  }

  it('a clean take-off raises the multiplier once the leg has lasted 10 s', () => {
    const s = makeServer()
    const a = join(s)
    takeOff(s, a, TAKEOFF_CREDIT_S - 1)
    expect(a.all('grade')).toHaveLength(0)
    run(s, 2, () => a.fly(0, 20, 0))
    expect(a.last('grade')).toMatchObject({ kind: 'takeoff', label: 'Clean take-off', delta: 0.25, multiplier: 1.25 })
    expect(a.score.multiplier).toBe(1.25)
  })

  it('a banked lift-off earns less', () => {
    const s = makeServer()
    const a = join(s)
    takeOff(s, a, TAKEOFF_CREDIT_S + 1, quatFromAttitude(0, 8, 25, { x: 0, y: 0, z: 0, w: 1 }))
    expect(a.last('grade')).toMatchObject({ label: 'Rough take-off', delta: 0.1 })
  })

  it('a short hop (a bounce) is not a take-off', () => {
    const s = makeServer()
    const a = join(s)
    takeOff(s, a, 2)
    run(s, 1, () => a.fly(0, 0, 0, true))
    run(s, 20, () => a.fly(0, 0, 0, true))
    expect(a.all('grade')).toHaveLength(0)
  })

  it('score is flying time times the multiplier', () => {
    const s = makeServer()
    const a = join(s)
    takeOff(s, a, 20)
    const { seconds, multiplier, score } = a.score
    expect(multiplier).toBe(1.25)
    expect(score).toBeCloseTo(seconds * multiplier, 0)
  })

  it.each([
    [0.5, 'Butter landing', 0.5],
    [1.5, 'Good landing', 0.3],
    [2.5, 'Firm landing', 0.1],
    [3.5, 'Hard landing', -0.25],
  ])('a touchdown sinking %s m/s is a %s (%s)', (sink, label, delta) => {
    const s = makeServer()
    const a = join(s)
    takeOff(s, a, LANDING_MIN_LEG_S + 1)
    touchDown(s, a, sink)
    expect(a.last('grade')).toMatchObject({ kind: 'landing', label, delta })
    expect(a.score.multiplier).toBeCloseTo(1.25 + delta, 5)
  })

  it('a landing after a short leg does not count', () => {
    const s = makeServer()
    const a = join(s)
    takeOff(s, a, LANDING_MIN_LEG_S - 5)
    touchDown(s, a, 0.5)
    expect(a.all('grade').map((g) => g.kind)).toEqual(['takeoff'])
  })

  it('the multiplier is capped', () => {
    const s = makeServer()
    const a = join(s)
    for (let i = 0; i < 12; i++) {
      takeOff(s, a, LANDING_MIN_LEG_S + 1)
      touchDown(s, a, 0.5)
    }
    expect(a.score.multiplier).toBe(MAX_MULTIPLIER)
  })

  it('a crash wipes the earned multiplier', () => {
    const s = makeServer()
    const a = join(s)
    takeOff(s, a, LANDING_MIN_LEG_S + 1)
    touchDown(s, a, 0.5)
    expect(a.score.multiplier).toBe(1.75)
    run(s, 0.5, () => a.fly(0, 0, 0, true, true))
    expect(a.score).toMatchObject({ multiplier: 1, seconds: 0, score: 0, resets: 1 })
  })

  it('a touchdown that crashes is not graded', () => {
    const s = makeServer()
    const a = join(s)
    takeOff(s, a, LANDING_MIN_LEG_S + 1)
    run(s, 0.05, () => a.fly(0, 1, 0, false, false, -8))
    run(s, 0.5, () => a.fly(0, 0, 0, true, true))
    expect(a.all('grade').map((g) => g.kind)).toEqual(['takeoff'])
    expect(a.score.multiplier).toBe(1)
  })

  it('only the pilot hears their own grade', () => {
    const s = makeServer()
    const a = join(s, 'Ace')
    const b = join(s, 'Bee')
    takeOff(s, a, TAKEOFF_CREDIT_S + 1)
    expect(a.all('grade')).toHaveLength(1)
    expect(b.all('grade')).toHaveLength(0)
  })
})

describe('collisions', () => {
  function airborneNear(s: SkyServer) {
    const a = join(s, 'Ace')
    const b = join(s, 'Bee')
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
    for (const e of a.last('leaderboard')!.entries) expect(e).toMatchObject({ seconds: 0, score: 0, resets: 1 })
  })

  it('collides once, resets once, and stays crashed until respawn even if poses say otherwise', () => {
    const s = makeServer()
    const { a, b } = airborneNear(s)
    run(s, 2, () => {
      a.fly(0, 300, 0)
      b.fly(3, 300, 0)
    })
    expect(a.all('collision')).toHaveLength(1)
    expect(a.last('leaderboard')!.entries.every((e) => e.seconds === 0 && e.resets === 1)).toBe(true)
    const snap = a.last('snapshot')!
    expect(snap.players.find((p) => p.id === b.id)!.crashed).toBe(true)
    // The client's own crashed poses after the collision don't count as a second reset.
    run(s, 1, () => b.fly(3, 300, 0, false, true))
    expect(b.score.resets).toBe(1)
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
    const a = join(s, 'Ace')
    const b = join(s, 'Bee')
    run(s, SPAWN_GRACE_S - 0.5, () => {
      a.fly(0, 300, 0)
      b.fly(1, 300, 0)
    })
    expect(a.all('collision')).toHaveLength(0)
  })

  it('two aircraft on the same mid-runway spawn never collide', () => {
    const s = makeServer()
    const a = join(s, 'Ace')
    const b = join(s, 'Bee')
    run(s, SPAWN_GRACE_S + 1, () => {
      a.fly(0, 0, 0, true)
      b.fly(0, 0, 0, true)
    })
    expect(a.all('collision')).toHaveLength(0)
  })

  it('a landing aircraft can hit one on the ground', () => {
    const s = makeServer()
    const a = join(s, 'Ace')
    const b = join(s, 'Bee')
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
  const jet = (c: FakeClient, x: number, vx: number, z = 0) =>
    c.send({ t: 'pose', seq: 1, p: { x, y: 300, z }, q: LEVEL, v: { x: vx, y: 0, z: 0 }, onGround: false, crashed: false })

  function jets(s: SkyServer) {
    const a = new FakeClient(s)
    a.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Ace', aircraftId: 'f22' })
    const b = new FakeClient(s)
    b.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Bee', aircraftId: 'f22' })
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
      jet(a, xa, 600)
      jet(b, xb, -600, 60)
    })
    expect(a.all('collision')).toHaveLength(0)
  })
})

describe('anti-griefing', () => {
  function airborneApart(s: SkyServer) {
    const a = join(s, 'Ace')
    const b = join(s, 'Bee')
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
    expect(a.score.seconds).toBeGreaterThan(5)
  })

  it('a teleporter earns no airborne time during the penalty', () => {
    const s = makeServer()
    const { a, b } = airborneApart(s)
    const before = b.score.seconds
    run(s, 1, () => {
      a.fly(0, 300, 0)
      b.fly(50_000, 300, 0)
    })
    expect(b.score.seconds - before).toBeLessThan(0.2)
  })

  it('a teleport onto the ground is not graded as a landing', () => {
    const s = makeServer()
    const a = join(s)
    run(s, 1, () => a.fly(0, 0, 0, true))
    run(s, LANDING_MIN_LEG_S + 1, () => a.fly(0, 20, 0))
    const grades = a.all('grade').length
    run(s, 0.05, () => a.fly(30_000, 0, 0, true))
    expect(a.all('grade')).toHaveLength(grades)
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

  it('gives players random, non-sequential ids', () => {
    const s = makeServer()
    const a = join(s, 'Ace')
    const b = join(s, 'Bee')
    expect(a.id).toMatch(/^p[a-z0-9]{10}$/)
    expect(a.id).not.toBe(b.id)
    expect(a.id).not.toBe('p1')
  })
})
