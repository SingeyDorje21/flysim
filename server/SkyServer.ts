/**
 * The one shared multiplayer sky, independent of the socket library so it can
 * be unit-tested with fake connections and a fake clock. server/index.ts wires
 * it to `ws`. Authority model: docs/adr/0002-single-shared-sky.md.
 */

import {
  collisionRadius,
  encode,
  LEADERBOARD_HZ,
  MAX_MESSAGE_BYTES,
  MAX_PLAYERS,
  parseClientMessage,
  POSE_SEND_HZ,
  PROTOCOL_VERSION,
  SERVER_TICK_HZ,
  SPAWN_GRACE_S,
  type ErrorCode,
  type GradeKind,
  type PoseData,
  type RosterEntry,
  type ServerMessage,
} from '../src/net/protocol'
import type { AircraftId } from '../src/config/aircraftCatalog'
import type { Vec3 } from '../src/simulation/types'
import {
  applyGrade,
  attitude,
  BASE_MULTIPLIER,
  gradeLanding,
  gradeTakeoff,
  LANDING_MIN_LEG_S,
  TAKEOFF_CREDIT_S,
  type Grade,
} from './scoring'

/** What the sky logic needs from a socket. */
export interface Connection {
  send(data: string): void
  close(): void
}

export interface SkyServerOptions {
  /** Milliseconds clock. */
  now?: () => number
  /** Joins allowed per IP per window. */
  joinLimit?: number
  joinWindowMs?: number
  /** Pilots in the sky at once. */
  maxPlayers?: number
  /** Inbound messages allowed per connection per second (poses are ~15/s). */
  messageRateLimit?: number
  /** Malformed messages tolerated per minute before the connection is closed. */
  maxBadMessages?: number
}

/** A pose older than this neither collides nor earns airborne time. */
const STALE_POSE_MS = 1500
/** Poses are extrapolated along their velocity to the tick time, at most this far ahead. */
const MAX_EXTRAPOLATE_MS = 200
/** Faster than any aircraft in the game (m/s); a pose that moves further than this jumped. */
const MAX_PLAUSIBLE_SPEED = 800
const JUMP_SLACK_M = 30
/** After a jump the player neither collides nor earns time for this long, so teleporting onto someone does nothing. */
const JUMP_PENALTY_MS = 1500
/** A respawn that isn't after a crash may renew the spawn grace at most this often. */
const RESPAWN_COOLDOWN_MS = 15_000
/** IPs tracked for the join rate limit; beyond this, unseen IPs are refused until entries expire. */
const MAX_TRACKED_IPS = 10_000
const BAD_MESSAGE_WINDOW_MS = 60_000

interface Player {
  id: string
  conn: Connection
  ip: string
  joined: boolean
  name: string
  aircraftId: AircraftId
  pose: PoseData | null
  poseAt: number
  /** Estimated position at the previous tick (null when not live then): collisions sweep from here. */
  tickPos: Vec3 | null
  /** Collision immunity ends at this time (ms). */
  graceUntil: number
  /** Teleport penalty: no collisions, no airborne time and no grades until this time (ms). */
  suspectUntil: number
  lastRespawnAt: number
  /** Crashed by a collision; poses can't clear it, only `respawn` can. */
  awaitingRespawn: boolean
  /** This crash already reset the score (cleared by `respawn`). */
  crashCounted: boolean
  seconds: number
  multiplier: number
  resets: number
  /** Airborne seconds of the current leg (since the last lift-off or touchdown). */
  legSeconds: number
  /** Attitude at the current leg's lift-off, or null if the leg didn't start on the ground. */
  liftoff: { pitchDeg: number; bankDeg: number } | null
  takeoffCredited: boolean
  msgWindowStart: number
  msgCount: number
  badWindowStart: number
  badMessages: number
}

export interface ClientHandle {
  onMessage(raw: string): void
  onClose(): void
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Random, non-sequential player id (ids are visible to every pilot). */
function randomId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(10))
  let id = 'p'
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length]
  return id
}

const round1 = (x: number) => Math.round(x * 10) / 10

/** A protocol 1 `create` or `join` (room codes), sent by a tab loaded before the shared sky. */
function isRoomJoin(raw: string): boolean {
  if (raw.length > MAX_MESSAGE_BYTES) return false
  try {
    const x: unknown = JSON.parse(raw)
    return typeof x === 'object' && x !== null && ['create', 'join'].includes((x as { t?: unknown }).t as string)
  } catch {
    return false
  }
}

export class SkyServer {
  private players: Player[] = []
  private readonly joinAttempts = new Map<string, number[]>()
  private readonly ids = new Set<string>()
  private readonly now: () => number
  private readonly joinLimit: number
  private readonly joinWindowMs: number
  private readonly maxPlayers: number
  private readonly messageRateLimit: number
  private readonly maxBadMessages: number
  private tickCount = 0

  constructor(opts: SkyServerOptions = {}) {
    this.now = opts.now ?? Date.now
    this.joinLimit = opts.joinLimit ?? 20
    this.joinWindowMs = opts.joinWindowMs ?? 60_000
    this.maxPlayers = Math.min(opts.maxPlayers ?? MAX_PLAYERS, MAX_PLAYERS)
    this.messageRateLimit = opts.messageRateLimit ?? 60
    this.maxBadMessages = opts.maxBadMessages ?? 20
  }

  get playerCount(): number {
    return this.players.length
  }

  connect(conn: Connection, ip: string): ClientHandle {
    let id = randomId()
    while (this.ids.has(id)) id = randomId()
    this.ids.add(id)
    const player: Player = {
      id,
      conn,
      ip,
      joined: false,
      name: '',
      aircraftId: 'trainer',
      pose: null,
      poseAt: 0,
      tickPos: null,
      graceUntil: 0,
      suspectUntil: 0,
      lastRespawnAt: -Infinity,
      awaitingRespawn: false,
      crashCounted: false,
      seconds: 0,
      multiplier: BASE_MULTIPLIER,
      resets: 0,
      legSeconds: 0,
      liftoff: null,
      takeoffCredited: false,
      msgWindowStart: 0,
      msgCount: 0,
      badWindowStart: 0,
      badMessages: 0,
    }
    return {
      onMessage: (raw) => this.handle(player, raw),
      onClose: () => {
        this.leave(player)
        this.ids.delete(player.id)
      },
    }
  }

  /** Advance one server tick: collisions, airborne time, take-off credit, snapshots, leaderboard. */
  tick(dtS = 1 / SERVER_TICK_HZ): void {
    const now = this.now()
    this.tickCount++
    try {
      this.collide(now)
      for (const p of this.players) {
        if (!this.isFlying(p, now)) continue
        p.seconds += dtS
        p.legSeconds += dtS
        if (p.liftoff && !p.takeoffCredited && p.legSeconds >= TAKEOFF_CREDIT_S) {
          p.takeoffCredited = true
          this.award(p, 'takeoff', gradeTakeoff(p.liftoff.pitchDeg, p.liftoff.bankDeg))
        }
      }
      this.sendSnapshots(now)
      if (this.tickCount % Math.round(SERVER_TICK_HZ / LEADERBOARD_HZ) === 0) this.sendLeaderboard()
    } catch (err) {
      console.error('sky tick failed', err)
    }
    this.pruneJoinAttempts(now)
  }

  // -------------------------------------------------------------------------

  private handle(p: Player, raw: string): void {
    const now = this.now()
    if (now - p.msgWindowStart >= 1000) {
      p.msgWindowStart = now
      p.msgCount = 0
    }
    if (++p.msgCount > this.messageRateLimit) return

    const msg = parseClientMessage(raw)
    if (!msg) {
      // A tab still running protocol 1 (rooms) would otherwise wait forever: tell it to reload.
      if (!p.joined && isRoomJoin(raw)) return this.error(p, 'VERSION_MISMATCH', 'Please reload the page')
      if (now - p.badWindowStart >= BAD_MESSAGE_WINDOW_MS) {
        p.badWindowStart = now
        p.badMessages = 0
      }
      if (++p.badMessages >= this.maxBadMessages) {
        this.leave(p)
        p.conn.close()
      }
      return
    }

    switch (msg.t) {
      case 'hello': {
        if (p.joined) return this.error(p, 'BAD_MESSAGE', 'Already in the sky')
        if (!this.allowJoin(p.ip, now)) return this.error(p, 'RATE_LIMITED', 'Too many attempts, wait a minute')
        if (msg.v !== PROTOCOL_VERSION) return this.error(p, 'VERSION_MISMATCH', 'Please reload the page')
        if (this.players.length >= this.maxPlayers) return this.error(p, 'SERVER_FULL', 'The sky is full, try later')
        this.enter(p, msg.name, msg.aircraftId, now)
        return
      }
      case 'pose': {
        if (!p.joined) return this.error(p, 'NOT_JOINED', 'Join the sky first')
        const { p: pos, q, v, onGround } = msg
        const prev = p.pose
        if (prev && !prev.crashed) {
          // Floor dt at the send interval: packets delayed in transit can arrive in a burst.
          const dt = Math.max(now - p.poseAt, 1000 / POSE_SEND_HZ) / 1000
          const moved = Math.hypot(pos.x - prev.p.x, pos.y - prev.p.y, pos.z - prev.p.z)
          if (moved > MAX_PLAUSIBLE_SPEED * dt + JUMP_SLACK_M) p.suspectUntil = now + JUMP_PENALTY_MS
        }
        const crashed = msg.crashed || p.awaitingRespawn
        const next: PoseData = { p: pos, q, v, onGround, crashed }
        if (crashed) {
          // Any crash (ground, water, hard landing) resets the score once.
          if (!p.crashCounted) {
            p.crashCounted = true
            this.resetScore(p)
            this.sendLeaderboard()
          }
        } else if (prev && !prev.crashed && now >= p.suspectUntil) {
          this.detectPhase(p, prev, next)
        }
        p.pose = next
        p.poseAt = now
        return
      }
      case 'respawn': {
        if (!p.joined) return this.error(p, 'NOT_JOINED', 'Join the sky first')
        const afterCrash = p.awaitingRespawn || p.pose === null || p.pose.crashed
        // Without a crash, a respawn can't be spammed to stay permanently immune.
        if (!afterCrash && now - p.lastRespawnAt < RESPAWN_COOLDOWN_MS) return
        p.awaitingRespawn = false
        p.crashCounted = false
        p.pose = null
        p.legSeconds = 0
        p.liftoff = null
        p.lastRespawnAt = now
        p.graceUntil = now + SPAWN_GRACE_S * 1000
        return
      }
    }
  }

  /** Lift-off starts a leg; touchdown after a long enough leg grades the landing. */
  private detectPhase(p: Player, prev: PoseData, next: PoseData): void {
    if (prev.onGround && !next.onGround) {
      p.liftoff = attitude(next.q)
      p.legSeconds = 0
      p.takeoffCredited = false
    } else if (!prev.onGround && next.onGround) {
      // The last airborne pose: its sink rate and bank are the touchdown's.
      if (p.legSeconds >= LANDING_MIN_LEG_S) this.award(p, 'landing', gradeLanding(-prev.v.y, attitude(prev.q).bankDeg))
      p.legSeconds = 0
      p.liftoff = null
    }
  }

  private award(p: Player, kind: GradeKind, grade: Grade): void {
    p.multiplier = applyGrade(p.multiplier, grade.delta)
    this.send(p, { t: 'grade', kind, label: grade.label, delta: grade.delta, multiplier: p.multiplier })
    this.sendLeaderboard()
  }

  private resetScore(p: Player): void {
    p.seconds = 0
    p.multiplier = BASE_MULTIPLIER
    p.resets++
    p.legSeconds = 0
    p.liftoff = null
  }

  private enter(p: Player, name: string, aircraftId: AircraftId, now: number): void {
    Object.assign(p, { joined: true, name, aircraftId, pose: null, graceUntil: now + SPAWN_GRACE_S * 1000 })
    p.seconds = 0
    p.multiplier = BASE_MULTIPLIER
    p.resets = 0
    p.awaitingRespawn = false
    p.crashCounted = false
    this.players.push(p)
    this.send(p, { t: 'welcome', id: p.id })
    this.sendRoster()
    this.sendLeaderboard()
  }

  private leave(p: Player): void {
    if (!p.joined) return
    p.joined = false
    this.players = this.players.filter((x) => x !== p)
    this.sendRoster()
    this.sendLeaderboard()
  }

  private isLive(p: Player, now: number): p is Player & { pose: PoseData } {
    return (
      p.pose !== null &&
      now - p.poseAt <= STALE_POSE_MS &&
      now >= p.suspectUntil &&
      !p.pose.crashed &&
      !p.awaitingRespawn
    )
  }

  private isFlying(p: Player, now: number): boolean {
    return this.isLive(p, now) && !p.pose.onGround
  }

  /** Where `p` is now: its last pose moved along its velocity (poses arrive at 15 Hz, unsynchronised). */
  private estimate(p: Player & { pose: PoseData }, now: number): Vec3 {
    const dt = Math.min(Math.max(now - p.poseAt, 0), MAX_EXTRAPOLATE_MS) / 1000
    const { p: pos, v } = p.pose
    return { x: pos.x + v.x * dt, y: pos.y + v.y * dt, z: pos.z + v.z * dt }
  }

  /**
   * Closest approach of two aircraft over the last tick, each moving in a
   * straight line from its previous tick position to its current one. Fast
   * jets close tens of metres per tick, more than their combined radius, so
   * comparing only the end positions would let them pass through each other.
   */
  private static closestApproach(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): number {
    const r0x = a0.x - b0.x
    const r0y = a0.y - b0.y
    const r0z = a0.z - b0.z
    const dx = a1.x - b1.x - r0x
    const dy = a1.y - b1.y - r0y
    const dz = a1.z - b1.z - r0z
    const dd = dx * dx + dy * dy + dz * dz
    const t = dd > 0 ? Math.min(1, Math.max(0, -(r0x * dx + r0y * dy + r0z * dz) / dd)) : 0
    return Math.hypot(r0x + dx * t, r0y + dy * t, r0z + dz * t)
  }

  private collide(now: number): void {
    const ps = this.players
    const pos = new Map<Player, Vec3>()
    for (const p of ps) if (this.isLive(p, now)) pos.set(p, this.estimate(p, now))
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]
        const b = ps[j]
        if (!this.isLive(a, now) || !this.isLive(b, now)) continue
        if (now < a.graceUntil || now < b.graceUntil) continue
        // Two aircraft on the ground never collide (shared mid-runway spawns).
        if (a.pose.onGround && b.pose.onGround) continue
        const r = collisionRadius(a.aircraftId) + collisionRadius(b.aircraftId)
        const a1 = pos.get(a)!
        const b1 = pos.get(b)!
        if (SkyServer.closestApproach(a.tickPos ?? a1, a1, b.tickPos ?? b1, b1) >= r) continue
        for (const x of [a, b]) {
          x.awaitingRespawn = true
          x.crashCounted = true
          x.pose.crashed = true
          this.resetScore(x)
        }
        this.broadcast({ t: 'collision', a: a.id, b: b.id })
        this.sendLeaderboard()
      }
    }
    // Next tick sweeps from here; a player who wasn't live (stale, penalised, crashed) starts fresh.
    for (const p of ps) p.tickPos = this.isLive(p, now) ? (pos.get(p) ?? null) : null
  }

  private sendSnapshots(now: number): void {
    for (const p of this.players) {
      const players = this.players
        .filter((x): x is Player & { pose: PoseData } => x !== p && x.pose !== null)
        .map((x) => ({ id: x.id, ...x.pose }))
      this.send(p, { t: 'snapshot', time: now, players })
    }
  }

  private sendRoster(): void {
    const players: RosterEntry[] = this.players.map(({ id, name, aircraftId }) => ({ id, name, aircraftId }))
    this.broadcast({ t: 'roster', players })
  }

  private sendLeaderboard(): void {
    const entries = this.players
      .map(({ id, seconds, multiplier, resets }) => ({
        id,
        score: round1(seconds * multiplier),
        seconds: round1(seconds),
        multiplier,
        resets,
      }))
      .sort((a, b) => b.score - a.score)
    this.broadcast({ t: 'leaderboard', entries })
  }

  private allowJoin(ip: string, now: number): boolean {
    const known = this.joinAttempts.get(ip)
    if (!known && this.joinAttempts.size >= MAX_TRACKED_IPS) {
      this.pruneJoinAttempts(now, true)
      if (this.joinAttempts.size >= MAX_TRACKED_IPS) return false
    }
    const recent = (known ?? []).filter((t) => now - t < this.joinWindowMs)
    const allowed = recent.length < this.joinLimit
    if (allowed) recent.push(now)
    this.joinAttempts.set(ip, recent)
    return allowed
  }

  private pruneJoinAttempts(now: number, force = false): void {
    if (!force && this.tickCount % (SERVER_TICK_HZ * 60) !== 0) return
    for (const [ip, times] of this.joinAttempts) {
      if (times.every((t) => now - t >= this.joinWindowMs)) this.joinAttempts.delete(ip)
    }
  }

  private error(p: Player, code: ErrorCode, message: string): void {
    this.send(p, { t: 'error', code, message })
  }

  private broadcast(msg: ServerMessage): void {
    const data = encode(msg)
    for (const p of this.players) p.conn.send(data)
  }

  private send(p: Player, msg: ServerMessage): void {
    p.conn.send(encode(msg))
  }
}
