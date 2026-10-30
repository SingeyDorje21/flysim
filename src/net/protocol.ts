/**
 * Multiplayer wire protocol, shared by the browser client and the room
 * server (server/ imports this file directly). See docs/adr/0001.
 *
 * JSON text frames, one message per frame, discriminated by `t`. Every
 * inbound frame goes through parseClientMessage / parseServerMessage, which
 * return null for anything malformed - callers drop null and never throw.
 */

import { AIRCRAFT_IDS, getAircraft, type AircraftId } from '../config/aircraftCatalog'
import type { Quat, Vec3 } from '../simulation/types'

export const PROTOCOL_VERSION = 1

export const MAX_PLAYERS = 8
export const MAX_MESSAGE_BYTES = 4096
/** Client pose upload rate. */
export const POSE_SEND_HZ = 15
/** Server collision/snapshot tick rate. */
export const SERVER_TICK_HZ = 20
/** Leaderboard broadcast rate. */
export const LEADERBOARD_HZ = 1
/** Seconds after joining or respawning during which a player cannot collide. */
export const SPAWN_GRACE_S = 3

// ---------------------------------------------------------------------------
// Room codes

/** No 0/O, 1/I/L look-alikes. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6
const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`)

/** Uniform random code from a CSPRNG (rejection sampling avoids modulo bias). */
export function generateRoomCode(
  fillRandom: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => globalThis.crypto.getRandomValues(b),
): string {
  const n = ROOM_CODE_ALPHABET.length
  const limit = 256 - (256 % n)
  let code = ''
  while (code.length < ROOM_CODE_LENGTH) {
    for (const byte of fillRandom(new Uint8Array(16))) {
      if (byte < limit) code += ROOM_CODE_ALPHABET[byte % n]
      if (code.length === ROOM_CODE_LENGTH) break
    }
  }
  return code
}

/** Upper-case and strip spaces/dashes so "abc-234" and "ABC 234" both work. */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '')
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_RE.test(code)
}

// ---------------------------------------------------------------------------
// Gameplay geometry

/** Collision sphere radius around the CG (m): 0.4 x the larger of length and wingspan. */
export function collisionRadius(aircraftId: AircraftId): number {
  const g = getAircraft(aircraftId).geometry
  return 0.4 * Math.max(g.length, g.wingspan)
}

/** Lateral spacing either side of the centreline, and spacing down the runway per pair (m). */
const SLOT_LATERAL = 12
const SLOT_ALONG = 80

/**
 * Where slot `slot` lines up relative to the normal Free Flight spawn:
 * `alongM` metres further down the runway, `rightM` metres right of the
 * centreline (relative to the runway heading). Pairs side by side.
 */
export function spawnSlotOffset(slot: number): { alongM: number; rightM: number } {
  const pair = Math.floor(slot / 2)
  return { alongM: pair * SLOT_ALONG, rightM: slot % 2 === 0 ? -SLOT_LATERAL : SLOT_LATERAL }
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
  slot: number
}

export interface LeaderboardEntry {
  id: PlayerId
  /** Airborne seconds since the last reset. */
  seconds: number
  /** Times this player's score was reset by a collision. */
  resets: number
}

export type ClientMessage =
  | { t: 'create'; v: number; name: string; aircraftId: AircraftId }
  | { t: 'join'; v: number; code: string; name: string; aircraftId: AircraftId }
  | ({ t: 'pose'; seq: number } & PoseData)
  | { t: 'respawn' }

export type ErrorCode =
  | 'BAD_CODE'
  | 'ROOM_FULL'
  | 'SERVER_FULL'
  | 'RATE_LIMITED'
  | 'BAD_MESSAGE'
  | 'VERSION_MISMATCH'
  | 'NOT_IN_ROOM'

export const ERROR_CODES: readonly ErrorCode[] = [
  'BAD_CODE',
  'ROOM_FULL',
  'SERVER_FULL',
  'RATE_LIMITED',
  'BAD_MESSAGE',
  'VERSION_MISMATCH',
  'NOT_IN_ROOM',
]

export type ServerMessage =
  | { t: 'welcome'; code: string; id: PlayerId; slot: number }
  | { t: 'roster'; players: RosterEntry[] }
  | { t: 'snapshot'; time: number; players: ({ id: PlayerId } & PoseData)[] }
  | { t: 'collision'; a: PlayerId; b: PlayerId }
  | { t: 'leaderboard'; entries: LeaderboardEntry[] }
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

function parseJson(raw: string): Obj | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null
  try {
    const x: unknown = JSON.parse(raw)
    return isObj(x) ? x : null
  } catch {
    return null
  }
}

/** Validate a frame from a client. Returns null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  const x = parseJson(raw)
  if (!x) return null
  switch (x.t) {
    case 'create': {
      const name = cleanName(x.name)
      if (!int(x.v, 0, 1e6) || !name || !aircraft(x.aircraftId)) return null
      return { t: 'create', v: x.v, name, aircraftId: x.aircraftId }
    }
    case 'join': {
      const name = cleanName(x.name)
      if (!int(x.v, 0, 1e6) || !name || !aircraft(x.aircraftId) || typeof x.code !== 'string') return null
      const code = normalizeRoomCode(x.code)
      if (!isValidRoomCode(code)) return null
      return { t: 'join', v: x.v, code, name, aircraftId: x.aircraftId }
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
  const x = parseJson(raw)
  if (!x) return null
  switch (x.t) {
    case 'welcome':
      if (typeof x.code !== 'string' || !isValidRoomCode(x.code) || !playerId(x.id) || !int(x.slot, 0, MAX_PLAYERS - 1))
        return null
      return { t: 'welcome', code: x.code, id: x.id, slot: x.slot }
    case 'roster': {
      const players = list(x.players, MAX_PLAYERS, (e) => {
        if (!isObj(e) || !playerId(e.id) || !aircraft(e.aircraftId) || !int(e.slot, 0, MAX_PLAYERS - 1)) return null
        const name = cleanName(e.name)
        return name ? { id: e.id, name, aircraftId: e.aircraftId, slot: e.slot } : null
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
        isObj(e) && playerId(e.id) && num(e.seconds, 0, 1e9) && int(e.resets, 0, 1e9)
          ? { id: e.id, seconds: e.seconds, resets: e.resets }
          : null,
      )
      return entries ? { t: 'leaderboard', entries } : null
    }
    case 'error':
      if (!(ERROR_CODES as readonly unknown[]).includes(x.code) || typeof x.message !== 'string') return null
      return { t: 'error', code: x.code as ErrorCode, message: x.message.slice(0, 200) }
    default:
      return null
  }
}
