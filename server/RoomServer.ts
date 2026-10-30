/**
 * Multiplayer room logic, independent of the socket library so it can be
 * unit-tested with fake connections and a fake clock. server/index.ts wires
 * it to `ws`. Authority model: docs/adr/0001-multiplayer-room-server.md.
 */

import {
  collisionRadius,
  encode,
  generateRoomCode,
  LEADERBOARD_HZ,
  MAX_PLAYERS,
  parseClientMessage,
  POSE_SEND_HZ,
  PROTOCOL_VERSION,
  SERVER_TICK_HZ,
  SPAWN_GRACE_S,
  type ErrorCode,
  type PoseData,
  type RosterEntry,
  type ServerMessage,
} from '../src/net/protocol'
import type { AircraftId } from '../src/config/aircraftCatalog'
import type { Vec3 } from '../src/simulation/types'

/** What the room logic needs from a socket. */
export interface Connection {
  send(data: string): void
  close(): void
}

export interface RoomServerOptions {
  /** Milliseconds clock. */
  now?: () => number
  /** Room code source (tests pass a deterministic one). */
  newCode?: () => string
  /** create+join attempts allowed per IP per window. */
  joinLimit?: number
  joinWindowMs?: number
  /** Wrong-code joins allowed per window across the whole server (slows code guessing from many IPs). */
  globalFailedJoinLimit?: number
  /** Rooms open at once. */
  maxRooms?: number
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
  room: Room | null
  name: string
  aircraftId: AircraftId
  slot: number
  pose: PoseData | null
  poseAt: number
  /** Estimated position at the previous tick (null when not live then): collisions sweep from here. */
  tickPos: Vec3 | null
  /** Collision immunity ends at this time (ms). */
  graceUntil: number
  /** Teleport penalty: no collisions and no airborne time until this time (ms). */
  suspectUntil: number
  lastRespawnAt: number
  /** Crashed by a collision; poses can't clear it, only `respawn` can. */
  awaitingRespawn: boolean
  seconds: number
  resets: number
  msgWindowStart: number
  msgCount: number
  badWindowStart: number
  badMessages: number
}

interface Room {
  code: string
  players: Player[]
}

export interface ClientHandle {
  onMessage(raw: string): void
  onClose(): void
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Random, non-sequential player id (ids are visible to every player in a room). */
function randomId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(10))
  let id = 'p'
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length]
  return id
}

export class RoomServer {
  private readonly rooms = new Map<string, Room>()
  private readonly joinAttempts = new Map<string, number[]>()
  private readonly ids = new Set<string>()
  private failedJoins: number[] = []
  private readonly now: () => number
  private readonly newCode: () => string
  private readonly joinLimit: number
  private readonly joinWindowMs: number
  private readonly globalFailedJoinLimit: number
  private readonly maxRooms: number
  private readonly messageRateLimit: number
  private readonly maxBadMessages: number
  private tickCount = 0

  constructor(opts: RoomServerOptions = {}) {
    this.now = opts.now ?? Date.now
    this.newCode = opts.newCode ?? (() => generateRoomCode())
    this.joinLimit = opts.joinLimit ?? 20
    this.joinWindowMs = opts.joinWindowMs ?? 60_000
    this.globalFailedJoinLimit = opts.globalFailedJoinLimit ?? 300
    this.maxRooms = opts.maxRooms ?? 200
    this.messageRateLimit = opts.messageRateLimit ?? 60
    this.maxBadMessages = opts.maxBadMessages ?? 20
  }

  get roomCount(): number {
    return this.rooms.size
  }

  connect(conn: Connection, ip: string): ClientHandle {
    let id = randomId()
    while (this.ids.has(id)) id = randomId()
    this.ids.add(id)
    const player: Player = {
      id,
      conn,
      ip,
      room: null,
      name: '',
      aircraftId: 'trainer',
      slot: 0,
      pose: null,
      poseAt: 0,
      tickPos: null,
      graceUntil: 0,
      suspectUntil: 0,
      lastRespawnAt: -Infinity,
      awaitingRespawn: false,
      seconds: 0,
      resets: 0,
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

  /** Advance one server tick: collisions, airborne time, snapshots, leaderboard. */
  tick(dtS = 1 / SERVER_TICK_HZ): void {
    const now = this.now()
    this.tickCount++
    const leaderboardDue = this.tickCount % Math.round(SERVER_TICK_HZ / LEADERBOARD_HZ) === 0
    for (const room of this.rooms.values()) {
      // One broken room must not take the others down.
      try {
        this.collide(room, now)
        for (const p of room.players) {
          if (this.isFlying(p, now)) p.seconds += dtS
        }
        this.sendSnapshots(room, now)
        if (leaderboardDue) this.sendLeaderboard(room)
      } catch (err) {
        console.error(`room ${room.code} tick failed`, err)
      }
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
      case 'create':
      case 'join': {
        if (p.room) return this.error(p, 'BAD_MESSAGE', 'Already in a room')
        if (!this.allowJoin(p.ip, now)) return this.error(p, 'RATE_LIMITED', 'Too many attempts, wait a minute')
        if (msg.v !== PROTOCOL_VERSION) return this.error(p, 'VERSION_MISMATCH', 'Please reload the page')
        let room: Room | undefined
        if (msg.t === 'create') {
          if (this.rooms.size >= this.maxRooms) return this.error(p, 'SERVER_FULL', 'The server is full, try later')
          room = { code: this.uniqueCode(), players: [] }
          this.rooms.set(room.code, room)
        } else {
          this.failedJoins = this.failedJoins.filter((t) => now - t < this.joinWindowMs)
          if (this.failedJoins.length >= this.globalFailedJoinLimit)
            return this.error(p, 'RATE_LIMITED', 'Too many attempts, wait a minute')
          room = this.rooms.get(msg.code)
          if (!room) {
            this.failedJoins.push(now)
            return this.error(p, 'BAD_CODE', 'No room with that code')
          }
          if (room.players.length >= MAX_PLAYERS) return this.error(p, 'ROOM_FULL', 'That room is full')
        }
        this.enter(p, room, msg.name, msg.aircraftId, now)
        return
      }
      case 'pose': {
        if (!p.room) return this.error(p, 'NOT_IN_ROOM', 'Join a room first')
        const { p: pos, q, v, onGround, crashed } = msg
        const prev = p.pose
        if (prev && !prev.crashed) {
          // Floor dt at the send interval: packets delayed in transit can arrive in a burst.
          const dt = Math.max(now - p.poseAt, 1000 / POSE_SEND_HZ) / 1000
          const moved = Math.hypot(pos.x - prev.p.x, pos.y - prev.p.y, pos.z - prev.p.z)
          if (moved > MAX_PLAUSIBLE_SPEED * dt + JUMP_SLACK_M) p.suspectUntil = now + JUMP_PENALTY_MS
        }
        p.pose = { p: pos, q, v, onGround, crashed: crashed || p.awaitingRespawn }
        p.poseAt = now
        return
      }
      case 'respawn': {
        if (!p.room) return this.error(p, 'NOT_IN_ROOM', 'Join a room first')
        const afterCrash = p.awaitingRespawn || p.pose === null || p.pose.crashed
        // Without a crash, a respawn can't be spammed to stay permanently immune.
        if (!afterCrash && now - p.lastRespawnAt < RESPAWN_COOLDOWN_MS) return
        p.awaitingRespawn = false
        p.pose = null
        p.lastRespawnAt = now
        p.graceUntil = now + SPAWN_GRACE_S * 1000
        return
      }
    }
  }

  private enter(p: Player, room: Room, name: string, aircraftId: AircraftId, now: number): void {
    const used = new Set(room.players.map((x) => x.slot))
    let slot = 0
    while (used.has(slot)) slot++
    Object.assign(p, { room, name, aircraftId, slot, pose: null, graceUntil: now + SPAWN_GRACE_S * 1000 })
    p.seconds = 0
    p.resets = 0
    p.awaitingRespawn = false
    room.players.push(p)
    this.send(p, { t: 'welcome', code: room.code, id: p.id, slot })
    this.sendRoster(room)
    this.sendLeaderboard(room)
  }

  private leave(p: Player): void {
    const room = p.room
    if (!room) return
    p.room = null
    room.players = room.players.filter((x) => x !== p)
    if (room.players.length === 0) this.rooms.delete(room.code)
    else {
      this.sendRoster(room)
      this.sendLeaderboard(room)
    }
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

  private collide(room: Room, now: number): void {
    const ps = room.players
    const pos = new Map<Player, Vec3>()
    for (const p of ps) if (this.isLive(p, now)) pos.set(p, this.estimate(p, now))
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]
        const b = ps[j]
        if (!this.isLive(a, now) || !this.isLive(b, now)) continue
        if (now < a.graceUntil || now < b.graceUntil) continue
        // Two aircraft on the ground never collide (shared runway spawns).
        if (a.pose.onGround && b.pose.onGround) continue
        const r = collisionRadius(a.aircraftId) + collisionRadius(b.aircraftId)
        const a1 = pos.get(a)!
        const b1 = pos.get(b)!
        if (RoomServer.closestApproach(a.tickPos ?? a1, a1, b.tickPos ?? b1, b1) >= r) continue
        for (const x of [a, b]) {
          x.awaitingRespawn = true
          x.pose.crashed = true
          x.seconds = 0
          x.resets++
        }
        this.broadcast(room, { t: 'collision', a: a.id, b: b.id })
        this.sendLeaderboard(room)
      }
    }
    // Next tick sweeps from here; a player who wasn't live (stale, penalised, crashed) starts fresh.
    for (const p of ps) p.tickPos = this.isLive(p, now) ? (pos.get(p) ?? null) : null
  }

  private sendSnapshots(room: Room, now: number): void {
    for (const p of room.players) {
      const players = room.players
        .filter((x): x is Player & { pose: PoseData } => x !== p && x.pose !== null)
        .map((x) => ({ id: x.id, ...x.pose }))
      this.send(p, { t: 'snapshot', time: now, players })
    }
  }

  private sendRoster(room: Room): void {
    const players: RosterEntry[] = room.players.map(({ id, name, aircraftId, slot }) => ({ id, name, aircraftId, slot }))
    this.broadcast(room, { t: 'roster', players })
  }

  private sendLeaderboard(room: Room): void {
    const entries = room.players
      .map(({ id, seconds, resets }) => ({ id, seconds: Math.round(seconds * 10) / 10, resets }))
      .sort((a, b) => b.seconds - a.seconds)
    this.broadcast(room, { t: 'leaderboard', entries })
  }

  private uniqueCode(): string {
    for (;;) {
      const code = this.newCode()
      if (!this.rooms.has(code)) return code
    }
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

  private broadcast(room: Room, msg: ServerMessage): void {
    const data = encode(msg)
    for (const p of room.players) p.conn.send(data)
  }

  private send(p: Player, msg: ServerMessage): void {
    p.conn.send(encode(msg))
  }
}
