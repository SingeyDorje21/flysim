import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSocket } from '../../net/__tests__/fakeSocket'
import { PROTOCOL_VERSION } from '../../net/protocol'
import { useGameStore } from '../gameStore'
import {
  enterMultiplayerFlight,
  inMultiplayer,
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
const row = (id: string, seconds: number, resets = 0, multiplier = 1) => ({
  id,
  score: seconds * multiplier,
  seconds,
  multiplier,
  resets,
})

function joinSky() {
  mp().setPlayerName('Ace')
  mp().joinSky('f22')
  const s = FakeSocket.last
  s.open()
  s.receive({ t: 'welcome', id: 'p1' })
  s.receive({
    t: 'roster',
    players: [
      { id: 'p1', name: 'Ace', aircraftId: 'f22' },
      { id: 'p2', name: 'Bee', aircraftId: 'trainer' },
    ],
  })
  return s
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.reset()
  setMultiplayerTransport(FakeSocket.factory, 'ws://test')
  useGameStore.setState({ screen: 'multiplayer', airportId: 'harbor', runwayEnd: '09R' })
})
afterEach(() => {
  mp().leaveSky()
  useMultiplayerStore.setState({ connectionLost: false, error: null, errorMessage: null, status: 'idle' })
  setMultiplayerTransport(undefined)
  vi.useRealTimers()
})

describe('multiplayer store', () => {
  it('opens no socket until the player joins the sky', () => {
    expect(mp().status).toBe('idle')
    sendLocalPose(local)
    expect(FakeSocket.all).toHaveLength(0)
  })

  it('join -> hello -> welcome goes straight to Free Flight at the chosen airport', () => {
    const s = joinSky()
    expect(s.sent[0]).toEqual({ t: 'hello', v: PROTOCOL_VERSION, name: 'Ace', aircraftId: 'f22' })
    expect(mp()).toMatchObject({ status: 'inSky', myId: 'p1' })
    expect(mp().roster).toHaveLength(2)
    expect(inMultiplayer()).toBe(true)
    // The player's own pick, not a shared home field.
    expect(useGameStore.getState()).toMatchObject({
      screen: 'flight',
      mode: 'freeFlight',
      airportId: 'harbor',
      runwayEnd: '09R',
    })
  })

  it('backing out of the lobby while connecting leaves the sky', () => {
    mp().setPlayerName('Ace')
    mp().joinSky('f22')
    const s = FakeSocket.last
    useGameStore.getState().goToMainMenu()
    expect(mp().status).toBe('idle')
    expect(s.closed).toBe(true)
  })

  it('uploads poses only while in the sky', () => {
    const s = joinSky()
    sendLocalPose(local)
    expect(s.sent.filter((m) => m.t === 'pose')).toHaveLength(1)
    mp().leaveSky()
    sendLocalPose(local)
    expect(s.closed).toBe(true)
  })

  it('requires a valid pilot name', () => {
    mp().setPlayerName('   ')
    mp().joinSky('trainer')
    expect(mp().error).toBe('BAD_NAME')
    expect(FakeSocket.all).toHaveLength(0)
  })

  it.each(['SERVER_FULL', 'VERSION_MISMATCH'] as const)('server %s before welcome ends the attempt', (code) => {
    mp().setPlayerName('Bee')
    mp().joinSky('trainer')
    const s = FakeSocket.last
    s.open()
    s.receive({ t: 'error', code, message: 'x' })
    expect(mp()).toMatchObject({ status: 'error', error: code })
    expect(s.closed).toBe(true)
    expect(useGameStore.getState().screen).toBe('multiplayer')
  })

  it('an unreachable server is reported', () => {
    mp().setPlayerName('Bee')
    mp().joinSky('trainer')
    FakeSocket.last.drop()
    expect(mp().error).toBe('UNREACHABLE')
  })

  it('no configured server is reported without a socket', () => {
    setMultiplayerTransport(FakeSocket.factory, null)
    mp().setPlayerName('Bee')
    mp().joinSky('trainer')
    expect(mp().error).toBe('NO_SERVER')
    expect(FakeSocket.all).toHaveLength(0)
  })

  it('a collision involving me queues a crash naming the other pilot', () => {
    const s = joinSky()
    s.receive({ t: 'collision', a: 'p2', b: 'p1' })
    expect(mp().pendingCrash).toBe('Mid-air collision with Bee')
    mp().consumeCrash()
    expect(mp().pendingCrash).toBeNull()
  })

  it('a collision between other players is ignored', () => {
    const s = joinSky()
    s.receive({ t: 'collision', a: 'p2', b: 'p3' })
    expect(mp().pendingCrash).toBeNull()
  })

  it('stores the leaderboard and feeds snapshots to the pose buffer', () => {
    const s = joinSky()
    s.receive({ t: 'leaderboard', entries: [row('p2', 12, 0, 1.5)] })
    expect(mp().leaderboard).toEqual([{ id: 'p2', score: 18, seconds: 12, multiplier: 1.5, resets: 0 }])
    const { position: p, orientation: q, velocity: v } = local
    s.receive({ t: 'snapshot', time: 5, players: [{ id: 'p2', p, q, v, onGround: false, crashed: false }] })
    expect(remotePoses.has('p2')).toBe(true)
  })

  it('keeps my latest take-off or landing grade for a few seconds', () => {
    const s = joinSky()
    s.receive({ t: 'grade', kind: 'landing', label: 'Good landing', delta: 0.3, multiplier: 1.55 })
    expect(mp().lastGrade).toMatchObject({ kind: 'landing', label: 'Good landing', delta: 0.3, multiplier: 1.55 })
    expect(mp().lastGrade!.until).toBeGreaterThan(performance.now())
  })

  it('the scoreboard starts hidden and follows setBoardVisible', () => {
    joinSky()
    expect(mp().boardVisible).toBe(false)
    mp().setBoardVisible(true)
    expect(mp().boardVisible).toBe(true)
    mp().setBoardVisible(false)
    expect(mp().boardVisible).toBe(false)
  })

  it('a refused rejoin after a dropped connection ends in DISCONNECTED, not endless reconnecting', () => {
    const s = joinSky()
    s.drop()
    expect(mp().status).toBe('reconnecting')
    vi.advanceTimersByTime(500)
    const s2 = FakeSocket.last
    s2.open()
    expect(s2.sent[0]).toMatchObject({ t: 'hello', name: 'Ace' })
    s2.receive({ t: 'error', code: 'SERVER_FULL', message: 'full' })
    expect(mp()).toMatchObject({ status: 'error', error: 'DISCONNECTED' })
  })

  it('a socket that dropped before the welcome still goes to the runway', () => {
    mp().setPlayerName('Bee')
    mp().joinSky('trainer')
    FakeSocket.last.open()
    FakeSocket.last.drop()
    vi.advanceTimersByTime(500)
    FakeSocket.last.open()
    FakeSocket.last.receive({ t: 'welcome', id: 'p2' })
    expect(useGameStore.getState().screen).toBe('flight')
  })

  it('a rejoin with a new id clears the old roster and leaderboard', () => {
    const s = joinSky()
    s.receive({ t: 'leaderboard', entries: [row('p1', 3)] })
    s.drop()
    vi.advanceTimersByTime(500)
    FakeSocket.last.open()
    FakeSocket.last.receive({ t: 'welcome', id: 'p9' })
    expect(mp()).toMatchObject({ status: 'inSky', myId: 'p9', roster: [], leaderboard: [] })
  })

  it('losing the connection mid-flight offers to fly solo', () => {
    joinSky()
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
    expect(inMultiplayer()).toBe(false)
  })

  it('respawn restarts the flight at the same chosen airport', () => {
    joinSky()
    mp().reportCrash('Terrain collision')
    const flightId = useGameStore.getState().flightId
    mp().respawn()
    expect(mp().crashReason).toBeNull()
    expect(useGameStore.getState()).toMatchObject({ flightId: flightId + 1, airportId: 'harbor', runwayEnd: '09R' })
  })

  it('flags leaderboard rows whose resets went up', () => {
    const s = joinSky()
    s.receive({ t: 'leaderboard', entries: [row('p1', 9), row('p2', 4)] })
    expect(mp().resetFlashUntil).toEqual({})
    s.receive({ t: 'leaderboard', entries: [row('p1', 0, 1), row('p2', 5)] })
    expect(Object.keys(mp().resetFlashUntil)).toEqual(['p1'])
  })

  it('quitting the flight leaves the sky', () => {
    const s = joinSky()
    enterMultiplayerFlight()
    useGameStore.getState().quitToMenu()
    expect(mp().status).toBe('idle')
    expect(s.closed).toBe(true)
  })
})
