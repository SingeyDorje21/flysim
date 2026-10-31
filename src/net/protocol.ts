/**
 * Multiplayer wire protocol, shared by the browser client and the sky
 * server (server/ imports this file directly). See docs/adr/0002.
 *
 * JSON text frames, one message per frame, discriminated by `t`. Every
 * inbound frame goes through parseClientMessage / parseServerMessage, which
 * return null for anything malformed - callers drop null and never throw.
 */

import { AIRCRAFT_IDS, getAircraft, type AircraftId } from '../config/aircraftCatalog'
import type { Quat, Vec3 } from '../simulation/types'

export const PROTOCOL_VERSION = 2

/** Pilots in the one shared sky. */
export const MAX_PLAYERS = 24
/** Largest client -> server frame. */
export const MAX_MESSAGE_BYTES = 4096
/** Largest server -> client frame (a full sky's snapshot is bigger than a client frame). */
export const MAX_SERVER_MESSAGE_BYTES = 64 * 1024
/** Client pose upload rate. */
export const POSE_SEND_HZ = 15
/** Server collision/snapshot tick rate. */
export const SERVER_TICK_HZ = 20
/** Leaderboard broadcast rate. */
export const LEADERBOARD_HZ = 1
/** Seconds after joining or respawning during which a player cannot collide. */
export const SPAWN_GRACE_S = 3

// ---------------------------------------------------------------------------
// Gameplay geometry

/** Collision sphere radius around the CG (m): 0.4 x the larger of length and wingspan. */
export function collisionRadius(aircraftId: AircraftId): number {
  const g = getAircraft(aircraftId).geometry
  return 0.4 * Math.max(g.length, g.wingspan)
}

// ---------------------------------------------------------------------------
// Messages

export type PlayerId = string

export interface PoseData {
  p: Vec3
  q: Quat
  v: Vec3
  onGround: boolean
  crashed: boolean
}

export interface RosterEntry {
  id: PlayerId
  name: string
  aircraftId: AircraftId
}

export interface LeaderboardEntry {
  id: PlayerId
  /** Airborne seconds x multiplier. */
  score: number
  /** Airborne seconds since the last reset. */
  seconds: number
  /** Earned by take-offs and landings; 1 after a reset. */
  multiplier: number
  /** Times this player's score was reset by a crash or a collision. */
  resets: number
}

export type GradeKind = 'takeoff' | 'landing'

export type ClientMessage =
  | { t: 'hello'; v: number; name: string; aircraftId: AircraftId }
  | ({ t: 'pose'; seq: number } & PoseData)
  | { t: 'respawn' }

export type ErrorCode = 'SERVER_FULL' | 'RATE_LIMITED' | 'BAD_MESSAGE' | 'VERSION_MISMATCH' | 'NOT_JOINED'

export const ERROR_CODES: readonly ErrorCode[] = [
  'SERVER_FULL',
  'RATE_LIMITED',
  'BAD_MESSAGE',
  'VERSION_MISMATCH',
  'NOT_JOINED',
]

export type ServerMessage =
  | { t: 'welcome'; id: PlayerId }
  | { t: 'roster'; players: RosterEntry[] }
  | { t: 'snapshot'; time: number; players: ({ id: PlayerId } & PoseData)[] }
  | { t: 'collision'; a: PlayerId; b: PlayerId }
  | { t: 'leaderboard'; entries: LeaderboardEntry[] }
  /** To one pilot: a take-off or landing changed their multiplier by `delta`. */
  | { t: 'grade'; kind: GradeKind; label: string; delta: number; multiplier: number }
  | { t: 'error'; code: ErrorCode; message: string }

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg)
}

// ---------------------------------------------------------------------------
// Validation

type Obj = Record<string, unknown>

const POS_LIMIT_XZ = 200_000
const POS_MIN_Y = -1_000
const POS_MAX_Y = 30_000
const VEL_LIMIT = 1_500
const NAME_MAX = 16
const NAME_RE = /^[\p{L}\p{N} _.'-]+$/u
const ID_RE = /^[A-Za-z0-9_-]{1,16}$/

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const num = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi
const bool = (x: unknown): x is boolean => typeof x === 'boolean'
const int = (x: unknown, lo: number, hi: number): x is number => num(x, lo, hi) && Number.isInteger(x)

function vec3(x: unknown, lo: Vec3, hi: Vec3): Vec3 | null {
  if (!isObj(x) || !num(x.x, lo.x, hi.x) || !num(x.y, lo.y, hi.y) || !num(x.z, lo.z, hi.z)) return null
  return { x: x.x, y: x.y, z: x.z }
}

function quat(x: unknown): Quat | null {
  if (!isObj(x) || !num(x.x, -1.01, 1.01) || !num(x.y, -1.01, 1.01) || !num(x.z, -1.01, 1.01) || !num(x.w, -1.01, 1.01))
    return null
  const len = Math.hypot(x.x, x.y, x.z, x.w)
  if (len < 0.9 || len > 1.1) return null
  return { x: x.x, y: x.y, z: x.z, w: x.w }
}

function pose(x: Obj): PoseData | null {
  const p = vec3(x.p, { x: -POS_LIMIT_XZ, y: POS_MIN_Y, z: -POS_LIMIT_XZ }, { x: POS_LIMIT_XZ, y: POS_MAX_Y, z: POS_LIMIT_XZ })
  const q = quat(x.q)
  const v = vec3(x.v, { x: -VEL_LIMIT, y: -VEL_LIMIT, z: -VEL_LIMIT }, { x: VEL_LIMIT, y: VEL_LIMIT, z: VEL_LIMIT })
  if (!p || !q || !v || !bool(x.onGround) || !bool(x.crashed)) return null
  return { p, q, v, onGround: x.onGround, crashed: x.crashed }
}

/** Trimmed display name, or null if empty, too long or using odd characters. */
export function cleanName(x: unknown): string | null {
  if (typeof x !== 'string') return null
  const name = x.trim().replace(/\s+/g, ' ')
  if (name.length < 1 || name.length > NAME_MAX || !NAME_RE.test(name)) return null
  return name
}

const aircraft = (x: unknown): x is AircraftId => typeof x === 'string' && (AIRCRAFT_IDS as readonly string[]).includes(x)
const playerId = (x: unknown): x is PlayerId => typeof x === 'string' && ID_RE.test(x)

function parseJson(raw: string, maxBytes: number): Obj | null {
  if (raw.length > maxBytes) return null
  try {
    const x: unknown = JSON.parse(raw)
    return isObj(x) ? x : null
  } catch {
    return null
  }
}

/** Validate a frame from a client. Returns null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  const x = parseJson(raw, MAX_MESSAGE_BYTES)
  if (!x) return null
  switch (x.t) {
    case 'hello': {
      const name = cleanName(x.name)
      if (!int(x.v, 0, 1e6) || !name || !aircraft(x.aircraftId)) return null
      return { t: 'hello', v: x.v, name, aircraftId: x.aircraftId }
    }
    case 'pose': {
      const p = pose(x)
      if (!p || !int(x.seq, 0, Number.MAX_SAFE_INTEGER)) return null
      return { t: 'pose', seq: x.seq, ...p }
    }
    case 'respawn':
      return { t: 'respawn' }
    default:
      return null
  }
}

function list<T>(x: unknown, max: number, item: (e: unknown) => T | null): T[] | null {
  if (!Array.isArray(x) || x.length > max) return null
  const out: T[] = []
  for (const e of x) {
    const v = item(e)
    if (v === null) return null
    out.push(v)
  }
  return out
}

/** Validate a frame from the server. Returns null for anything malformed. */
export function parseServerMessage(raw: string): ServerMessage | null {
  const x = parseJson(raw, MAX_SERVER_MESSAGE_BYTES)
  if (!x) return null
  switch (x.t) {
    case 'welcome':
      return playerId(x.id) ? { t: 'welcome', id: x.id } : null
    case 'roster': {
      const players = list(x.players, MAX_PLAYERS, (e) => {
        if (!isObj(e) || !playerId(e.id) || !aircraft(e.aircraftId)) return null
        const name = cleanName(e.name)
        return name ? { id: e.id, name, aircraftId: e.aircraftId } : null
      })
      return players ? { t: 'roster', players } : null
    }
    case 'snapshot': {
      if (!num(x.time, 0, Number.MAX_SAFE_INTEGER)) return null
      const players = list(x.players, MAX_PLAYERS, (e) => {
        if (!isObj(e) || !playerId(e.id)) return null
        const p = pose(e)
        return p ? { id: e.id, ...p } : null
      })
      return players ? { t: 'snapshot', time: x.time, players } : null
    }
    case 'collision':
      if (!playerId(x.a) || !playerId(x.b)) return null
      return { t: 'collision', a: x.a, b: x.b }
    case 'leaderboard': {
      const entries = list(x.entries, MAX_PLAYERS, (e) =>
        isObj(e) &&
        playerId(e.id) &&
        num(e.score, 0, 1e12) &&
        num(e.seconds, 0, 1e9) &&
        num(e.multiplier, 0, 100) &&
        int(e.resets, 0, 1e9)
          ? { id: e.id, score: e.score, seconds: e.seconds, multiplier: e.multiplier, resets: e.resets }
          : null,
      )
      return entries ? { t: 'leaderboard', entries } : null
    }
    case 'grade':
      if (
        (x.kind !== 'takeoff' && x.kind !== 'landing') ||
        typeof x.label !== 'string' ||
        !num(x.delta, -100, 100) ||
        !num(x.multiplier, 0, 100)
      )
        return null
      return { t: 'grade', kind: x.kind, label: x.label.slice(0, 60), delta: x.delta, multiplier: x.multiplier }
    case 'error':
      if (!(ERROR_CODES as readonly unknown[]).includes(x.code) || typeof x.message !== 'string') return null
      return { t: 'error', code: x.code as ErrorCode, message: x.message.slice(0, 200) }
    default:
      return null
  }
}
