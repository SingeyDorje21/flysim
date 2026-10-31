import { describe, expect, it } from 'vitest'
import { AIRCRAFT_IDS, getAircraft } from '../../config/aircraftCatalog'
import {
  collisionRadius,
  encode,
  MAX_MESSAGE_BYTES,
  MAX_PLAYERS,
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
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

describe('geometry helpers', () => {
  it('collision radius tracks aircraft size', () => {
    for (const id of AIRCRAFT_IDS) {
      const g = getAircraft(id).geometry
      expect(collisionRadius(id)).toBeCloseTo(0.4 * Math.max(g.length, g.wingspan))
    }
    expect(collisionRadius('a350')).toBeGreaterThan(collisionRadius('trainer'))
  })

})

describe('parseClientMessage', () => {
  const valid: ClientMessage[] = [
    { t: 'hello', v: PROTOCOL_VERSION, name: 'Ace', aircraftId: 'f22' },
    { t: 'pose', seq: 7, ...pose },
    { t: 'respawn' },
  ]

  it.each(valid)('round-trips $t', (msg) => {
    expect(parseClientMessage(encode(msg))).toEqual(msg)
  })

  it.each([
    ['not json', '{'],
    ['array', '[]'],
    ['unknown type', '{"t":"nuke"}'],
    ['unknown aircraft', JSON.stringify({ t: 'hello', v: 1, name: 'a', aircraftId: 'b747' })],
    ['empty name', JSON.stringify({ t: 'hello', v: 1, name: '   ', aircraftId: 'f22' })],
    ['long name', JSON.stringify({ t: 'hello', v: 1, name: 'x'.repeat(17), aircraftId: 'f22' })],
    ['markup in name', JSON.stringify({ t: 'hello', v: 1, name: '<b>hi</b>', aircraftId: 'f22' })],
    ['room join (protocol 1)', JSON.stringify({ t: 'join', v: 1, code: 'ABC234', name: 'a', aircraftId: 'f22' })],
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
    { t: 'welcome', id: 'p1' },
    { t: 'roster', players: [{ id: 'p1', name: 'Ace', aircraftId: 'f22' }] },
    { t: 'snapshot', time: 1234, players: [{ id: 'p1', ...pose }] },
    { t: 'collision', a: 'p1', b: 'p2' },
    { t: 'leaderboard', entries: [{ id: 'p1', score: 18.8, seconds: 12.5, multiplier: 1.5, resets: 1 }] },
    { t: 'grade', kind: 'landing', label: 'Good landing', delta: 0.3, multiplier: 1.55 },
    { t: 'error', code: 'SERVER_FULL', message: 'The sky is full' },
  ]

  it.each(valid)('round-trips $t', (msg) => {
    expect(parseServerMessage(encode(msg))).toEqual(msg)
  })

  it.each([
    ['welcome without id', JSON.stringify({ t: 'welcome' })],
    ['bad id', JSON.stringify({ t: 'collision', a: 'p 1', b: 'p2' })],
    ['too many players', JSON.stringify({ t: 'roster', players: Array(MAX_PLAYERS + 1).fill({ id: 'p1', name: 'a', aircraftId: 'f22' }) })],
    ['negative seconds', JSON.stringify({ t: 'leaderboard', entries: [{ id: 'p1', score: 0, seconds: -1, multiplier: 1, resets: 0 }] })],
    ['missing score', JSON.stringify({ t: 'leaderboard', entries: [{ id: 'p1', seconds: 1, resets: 0 }] })],
    ['unknown grade kind', JSON.stringify({ t: 'grade', kind: 'loop', label: 'x', delta: 1, multiplier: 2 })],
    ['unknown error code', JSON.stringify({ t: 'error', code: 'LOL', message: '' })],
  ])('rejects %s', (_label, raw) => {
    expect(parseServerMessage(raw)).toBeNull()
  })

  it('accepts a full sky snapshot, larger than any client frame', () => {
    // Realistic in-flight values (the client rounds positions to cm and quaternions to 1e-4).
    const flying = {
      p: { x: -31512.37, y: 1234.56, z: 11008.91 },
      q: { x: 0.0123, y: -0.7071, z: 0.0456, w: 0.7055 },
      v: { x: -123.45, y: -3.21, z: 98.76 },
      onGround: false,
      crashed: false,
    }
    const players = Array.from({ length: MAX_PLAYERS }, (_, i) => ({ id: `p${String(i).padStart(10, '0')}`, ...flying }))
    const raw = encode({ t: 'snapshot', time: 1, players })
    expect(raw.length).toBeGreaterThan(MAX_MESSAGE_BYTES)
    expect(parseServerMessage(raw)).toMatchObject({ t: 'snapshot' })
  })
})
