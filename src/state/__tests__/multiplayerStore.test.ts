import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSocket } from '../../net/__tests__/fakeSocket'
import { HOME_PLACE } from '../../game/spawns'
import { useGameStore } from '../gameStore'
import {
  enterMultiplayerFlight,
  inMultiplayerRoom,
  remotePoses,
  sendLocalPose,
  setMultiplayerTransport,
  useMultiplayerStore,
} from '../multiplayerStore'

const mp = () => useMultiplayerStore.getState()
const local = {
  position: { x: 0, y: 300, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
  velocity: { x: 0, y: 0, z: -60 },
  onGround: false,
  crashed: false,
}

function enterRoom() {
  mp().setPlayerName('Ace')
  mp().createRoom('f22')
  const s = FakeSocket.last
  s.open()
  s.receive({ t: 'welcome', code: 'ABC234', id: 'p1', slot: 0 })
  s.receive({
    t: 'roster',
    players: [
      { id: 'p1', name: 'Ace', aircraftId: 'f22', slot: 0 },
      { id: 'p2', name: 'Bee', aircraftId: 'trainer', slot: 1 },
    ],
  })
  return s
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.reset()
  setMultiplayerTransport(FakeSocket.factory, 'ws://test')
  useGameStore.setState({ screen: 'mainMenu', airportId: 'harbor', runwayEnd: '09R' })
})
afterEach(() => {
  mp().leaveRoom()
  useMultiplayerStore.setState({ connectionLost: false, error: null, errorMessage: null, status: 'idle' })
  setMultiplayerTransport(undefined)
  vi.useRealTimers()
})

describe('multiplayer store', () => {
  it('opens no socket until a room is created or joined', () => {
    expect(mp().status).toBe('idle')
    sendLocalPose(local)
    expect(FakeSocket.all).toHaveLength(0)
  })

  it('create -> welcome enters the room but stays in the lobby to share the code', () => {
    useGameStore.getState().goToMultiplayer()
    enterRoom()
    expect(mp()).toMatchObject({ status: 'inRoom', code: 'ABC234', myId: 'p1', slot: 0 })
    expect(mp().roster).toHaveLength(2)
    expect(useGameStore.getState().screen).toBe('multiplayer')
    expect(inMultiplayerRoom()).toBe(true)
    enterMultiplayerFlight()
    const g = useGameStore.getState()
    expect(g).toMatchObject({ screen: 'flight', mode: 'freeFlight', airportId: HOME_PLACE.airportId })
  })

  it('join -> welcome goes straight to Free Flight at the home runway', () => {
    mp().setPlayerName('Bee')
    mp().joinRoom('ABC234', 'trainer')
    FakeSocket.last.open()
    FakeSocket.last.receive({ t: 'welcome', code: 'ABC234', id: 'p2', slot: 1 })
    expect(useGameStore.getState()).toMatchObject({ screen: 'flight', airportId: HOME_PLACE.airportId })
  })

  it('backing out of the lobby leaves the room', () => {
    useGameStore.getState().goToMultiplayer()
    const s = enterRoom()
    useGameStore.getState().goToMainMenu()
    expect(mp().status).toBe('idle')
    expect(s.closed).toBe(true)
  })

  it('uploads poses only while in the room', () => {
    const s = enterRoom()
    sendLocalPose(local)
    expect(s.sent.filter((m) => m.t === 'pose')).toHaveLength(1)
    mp().leaveRoom()
    sendLocalPose(local)
    expect(s.closed).toBe(true)
  })

  it('rejects a malformed code without connecting', () => {
    mp().setPlayerName('Bee')
    mp().joinRoom('ab', 'trainer')
    expect(mp()).toMatchObject({ status: 'error', error: 'BAD_CODE' })
    expect(FakeSocket.all).toHaveLength(0)
  })

  it('requires a valid pilot name', () => {
    mp().setPlayerName('   ')
    mp().createRoom('trainer')
    expect(mp().error).toBe('BAD_NAME')
  })

  it.each(['BAD_CODE', 'ROOM_FULL'] as const)('server %s before welcome ends the attempt', (code) => {
    mp().setPlayerName('Bee')
    mp().joinRoom('abc-234', 'trainer')
    const s = FakeSocket.last
    s.open()
    expect(s.sent[0]).toMatchObject({ t: 'join', code: 'ABC234' })
    s.receive({ t: 'error', code, message: 'x' })
    expect(mp()).toMatchObject({ status: 'error', error: code })
    expect(s.closed).toBe(true)
    expect(useGameStore.getState().screen).toBe('mainMenu')
  })

  it('an unreachable server is reported', () => {
    mp().setPlayerName('Bee')
    mp().createRoom('trainer')
    FakeSocket.last.drop()
    expect(mp().error).toBe('UNREACHABLE')
  })

  it('no configured server is reported without a socket', () => {
    setMultiplayerTransport(FakeSocket.factory, null)
    mp().setPlayerName('Bee')
    mp().createRoom('trainer')
    expect(mp().error).toBe('NO_SERVER')
    expect(FakeSocket.all).toHaveLength(0)
  })

  it('a collision involving me queues a crash naming the other pilot', () => {
    const s = enterRoom()
    s.receive({ t: 'collision', a: 'p2', b: 'p1' })
    expect(mp().pendingCrash).toBe('Mid-air collision with Bee')
    mp().consumeCrash()
    expect(mp().pendingCrash).toBeNull()
  })

  it('a collision between other players is ignored', () => {
    const s = enterRoom()
    s.receive({ t: 'collision', a: 'p2', b: 'p3' })
    expect(mp().pendingCrash).toBeNull()
  })

  it('stores the leaderboard and feeds snapshots to the pose buffer', () => {
    const s = enterRoom()
    s.receive({ t: 'leaderboard', entries: [{ id: 'p2', seconds: 12, resets: 0 }] })
    expect(mp().leaderboard).toEqual([{ id: 'p2', seconds: 12, resets: 0 }])
    const { position: p, orientation: q, velocity: v } = local
    s.receive({ t: 'snapshot', time: 5, players: [{ id: 'p2', p, q, v, onGround: false, crashed: false }] })
    expect(remotePoses.has('p2')).toBe(true)
  })

  it('a refused rejoin after a dropped connection ends in DISCONNECTED, not endless reconnecting', () => {
    const s = enterRoom()
    s.drop()
    expect(mp().status).toBe('reconnecting')
    vi.advanceTimersByTime(500)
    const s2 = FakeSocket.last
    s2.open()
    expect(s2.sent[0]).toMatchObject({ t: 'join', code: 'ABC234' })
    s2.receive({ t: 'error', code: 'BAD_CODE', message: 'gone' })
    expect(mp()).toMatchObject({ status: 'error', error: 'DISCONNECTED' })
  })

  it('a joiner whose socket dropped before the welcome still goes to the runway', () => {
    mp().setPlayerName('Bee')
    mp().joinRoom('ABC234', 'trainer')
    FakeSocket.last.open()
    FakeSocket.last.drop()
    vi.advanceTimersByTime(500)
    FakeSocket.last.open()
    FakeSocket.last.receive({ t: 'welcome', code: 'ABC234', id: 'p2', slot: 1 })
    expect(useGameStore.getState().screen).toBe('flight')
  })

  it('a rejoin with a new id clears the old roster and leaderboard', () => {
    const s = enterRoom()
    s.receive({ t: 'leaderboard', entries: [{ id: 'p1', seconds: 3, resets: 0 }] })
    s.drop()
    vi.advanceTimersByTime(500)
    FakeSocket.last.open()
    FakeSocket.last.receive({ t: 'welcome', code: 'ABC234', id: 'p9', slot: 0 })
    expect(mp()).toMatchObject({ status: 'inRoom', myId: 'p9', roster: [], leaderboard: [] })
  })

  it('losing the connection mid-flight offers to fly solo', () => {
    enterRoom()
    enterMultiplayerFlight()
    mp().reportCrash('Terrain collision')
    // The connection drops and every retry fails.
    for (let i = 0; i < 6; i++) {
      FakeSocket.last.drop()
      vi.runOnlyPendingTimers()
    }
    expect(mp()).toMatchObject({ status: 'error', connectionLost: true, crashReason: 'Terrain collision' })
    const flightId = useGameStore.getState().flightId
    mp().continueSolo()
    expect(mp()).toMatchObject({ connectionLost: false, status: 'idle', crashReason: null })
    expect(useGameStore.getState().flightId).toBe(flightId + 1)
    expect(inMultiplayerRoom()).toBe(false)
  })

  it('leaving multiplayer gives back the player\'s own airport choice', () => {
    useGameStore.setState({ airportId: 'harbor', runwayEnd: '09R' })
    enterRoom()
    enterMultiplayerFlight()
    expect(useGameStore.getState().airportId).toBe(HOME_PLACE.airportId)
    useGameStore.getState().quitToMenu()
    expect(useGameStore.getState()).toMatchObject({ airportId: 'harbor', runwayEnd: '09R' })
  })

  it('flags leaderboard rows whose resets went up', () => {
    const s = enterRoom()
    s.receive({ t: 'leaderboard', entries: [{ id: 'p1', seconds: 9, resets: 0 }, { id: 'p2', seconds: 4, resets: 0 }] })
    expect(mp().resetFlashUntil).toEqual({})
    s.receive({ t: 'leaderboard', entries: [{ id: 'p1', seconds: 0, resets: 1 }, { id: 'p2', seconds: 5, resets: 0 }] })
    expect(Object.keys(mp().resetFlashUntil)).toEqual(['p1'])
  })

  it('quitting the flight leaves the room', () => {
    const s = enterRoom()
    enterMultiplayerFlight()
    useGameStore.getState().quitToMenu()
    expect(mp().status).toBe('idle')
    expect(s.closed).toBe(true)
  })
})
