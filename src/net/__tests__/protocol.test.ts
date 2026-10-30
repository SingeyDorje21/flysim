import { describe, expect, it } from 'vitest'
import { AIRCRAFT_IDS, getAircraft } from '../../config/aircraftCatalog'
import {
  collisionRadius,
  encode,
  generateRoomCode,
  isValidRoomCode,
  MAX_MESSAGE_BYTES,
  MAX_PLAYERS,
  normalizeRoomCode,
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  spawnSlotOffset,
  type ClientMessage,
  type ServerMessage,
} from '../protocol'

const pose = {
  p: { x: 10, y: 300, z: -40 },
  q: { x: 0, y: 0, z: 0, w: 1 },
  v: { x: 0, y: 0, z: -60 },
  onGround: false,
  crashed: false,
}

describe('room codes', () => {
  it('generates 6 symbols from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode()
      expect(code).toHaveLength(6)
      expect(isValidRoomCode(code)).toBe(true)
    }
  })

  it('rejects biased bytes instead of folding them (rejection sampling)', () => {
    // 248..255 are above the largest multiple of 31 and must be skipped.
    const bytes = [255, 250, 248, 0, 1, 2, 3, 4, 5]
    const code = generateRoomCode((b) => {
      b.fill(0)
      b.set(bytes)
      return b
    })
    expect(code).toBe(ROOM_CODE_ALPHABET.slice(0, 6))
  })

  it('normalizes case, spaces and dashes', () => {
    expect(normalizeRoomCode(' abc-234 ')).toBe('ABC234')
    expect(isValidRoomCode(normalizeRoomCode('abc 234'))).toBe(true)
  })

  it('refuses look-alike characters', () => {
    expect(isValidRoomCode('ABC0O1')).toBe(false)
    expect(isValidRoomCode('ABCDE')).toBe(false)
  })
})

describe('geometry helpers', () => {
  it('collision radius tracks aircraft size', () => {
    for (const id of AIRCRAFT_IDS) {
      const g = getAircraft(id).geometry
      expect(collisionRadius(id)).toBeCloseTo(0.4 * Math.max(g.length, g.wingspan))
    }
    expect(collisionRadius('a350')).toBeGreaterThan(collisionRadius('trainer'))
  })

  it('gives every slot a distinct spawn position', () => {
    const seen = new Set<string>()
    for (let s = 0; s < MAX_PLAYERS; s++) {
      const o = spawnSlotOffset(s)
      seen.add(`${o.alongM},${o.rightM}`)
    }
    expect(seen.size).toBe(MAX_PLAYERS)
  })
})

describe('parseClientMessage', () => {
  const valid: ClientMessage[] = [
    { t: 'create', v: PROTOCOL_VERSION, name: 'Ace', aircraftId: 'f22' },
    { t: 'join', v: PROTOCOL_VERSION, code: 'ABC234', name: 'Maverick', aircraftId: 'trainer' },
    { t: 'pose', seq: 7, ...pose },
    { t: 'respawn' },
  ]

  it.each(valid)('round-trips $t', (msg) => {
    expect(parseClientMessage(encode(msg))).toEqual(msg)
  })

  it('normalizes the join code', () => {
    const m = parseClientMessage(JSON.stringify({ t: 'join', v: 1, code: 'abc-234', name: 'x', aircraftId: 'a220' }))
    expect(m).toMatchObject({ code: 'ABC234' })
  })

  it.each([
    ['not json', '{'],
    ['array', '[]'],
    ['unknown type', '{"t":"nuke"}'],
    ['unknown aircraft', JSON.stringify({ t: 'create', v: 1, name: 'a', aircraftId: 'b747' })],
    ['empty name', JSON.stringify({ t: 'create', v: 1, name: '   ', aircraftId: 'f22' })],
    ['long name', JSON.stringify({ t: 'create', v: 1, name: 'x'.repeat(17), aircraftId: 'f22' })],
    ['markup in name', JSON.stringify({ t: 'create', v: 1, name: '<b>hi</b>', aircraftId: 'f22' })],
    ['bad code', JSON.stringify({ t: 'join', v: 1, code: 'ZZ', name: 'a', aircraftId: 'f22' })],
    ['NaN position', JSON.stringify({ t: 'pose', seq: 1, ...pose, p: { x: 'NaN', y: 0, z: 0 } })],
    ['far position', JSON.stringify({ t: 'pose', seq: 1, ...pose, p: { x: 1e9, y: 0, z: 0 } })],
    ['zero quaternion', JSON.stringify({ t: 'pose', seq: 1, ...pose, q: { x: 0, y: 0, z: 0, w: 0 } })],
    ['missing flag', JSON.stringify({ t: 'pose', seq: 1, p: pose.p, q: pose.q, v: pose.v, onGround: false })],
    ['fractional seq', JSON.stringify({ t: 'pose', seq: 1.5, ...pose })],
  ])('rejects %s', (_label, raw) => {
    expect(parseClientMessage(raw)).toBeNull()
  })

  it('rejects oversized frames before parsing', () => {
    const raw = JSON.stringify({ t: 'respawn', pad: 'x'.repeat(MAX_MESSAGE_BYTES) })
    expect(parseClientMessage(raw)).toBeNull()
  })

  it('drops unknown extra fields', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'respawn', admin: true }))).toEqual({ t: 'respawn' })
  })
})

describe('parseServerMessage', () => {
  const valid: ServerMessage[] = [
    { t: 'welcome', code: 'ABC234', id: 'p1', slot: 0 },
    { t: 'roster', players: [{ id: 'p1', name: 'Ace', aircraftId: 'f22', slot: 0 }] },
    { t: 'snapshot', time: 1234, players: [{ id: 'p1', ...pose }] },
    { t: 'collision', a: 'p1', b: 'p2' },
    { t: 'leaderboard', entries: [{ id: 'p1', seconds: 12.5, resets: 1 }] },
    { t: 'error', code: 'ROOM_FULL', message: 'Room is full' },
  ]

  it.each(valid)('round-trips $t', (msg) => {
    expect(parseServerMessage(encode(msg))).toEqual(msg)
  })

  it.each([
    ['slot out of range', JSON.stringify({ t: 'welcome', code: 'ABC234', id: 'p1', slot: 8 })],
    ['bad id', JSON.stringify({ t: 'collision', a: 'p 1', b: 'p2' })],
    ['too many players', JSON.stringify({ t: 'roster', players: Array(9).fill({ id: 'p1', name: 'a', aircraftId: 'f22', slot: 0 }) })],
    ['negative seconds', JSON.stringify({ t: 'leaderboard', entries: [{ id: 'p1', seconds: -1, resets: 0 }] })],
    ['unknown error code', JSON.stringify({ t: 'error', code: 'LOL', message: '' })],
  ])('rejects %s', (_label, raw) => {
    expect(parseServerMessage(raw)).toBeNull()
  })
})
