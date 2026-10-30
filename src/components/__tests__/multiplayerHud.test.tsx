// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleHotkey } from '../../input/hotkeys'
import { FakeSocket } from '../../net/__tests__/fakeSocket'
import { DEFAULT_SETTINGS, useGameStore } from '../../state/gameStore'
import { setMultiplayerTransport, useMultiplayerStore } from '../../state/multiplayerStore'
import { resetTelemetry } from '../../state/telemetry'
import { GameUI } from '../GameUI'

const mp = () => useMultiplayerStore.getState()

/** Joins room ABC234 as p1 "Ace" with "Bee" (p2) and "Cat" (p3), and starts the flight. */
function joinRoom() {
  mp().setPlayerName('Ace')
  mp().joinRoom('ABC234', 'trainer')
  const s = FakeSocket.last
  act(() => {
    s.open()
    s.receive({ t: 'welcome', code: 'ABC234', id: 'p1', slot: 0 })
    s.receive({
      t: 'roster',
      players: [
        { id: 'p1', name: 'Ace', aircraftId: 'trainer', slot: 0 },
        { id: 'p2', name: 'Bee', aircraftId: 'f22', slot: 1 },
        { id: 'p3', name: 'Cat', aircraftId: 'a220', slot: 2 },
      ],
    })
    s.receive({
      t: 'leaderboard',
      entries: [
        { id: 'p2', seconds: 75, resets: 0 },
        { id: 'p1', seconds: 130, resets: 0 },
        { id: 'p3', seconds: 5, resets: 0 },
      ],
    })
  })
  return s
}

const rows = () => within(screen.getByTestId('mp-leaderboard')).getAllByRole('listitem')

beforeEach(() => {
  FakeSocket.reset()
  resetTelemetry()
  setMultiplayerTransport(FakeSocket.factory, 'ws://test')
  useGameStore.setState({ screen: 'mainMenu', overlay: 'none', paused: false, flightId: 0, settings: { ...DEFAULT_SETTINGS } })
  useMultiplayerStore.setState({ boardVisible: true })
})
afterEach(() => {
  cleanup()
  mp().leaveRoom()
  setMultiplayerTransport(undefined)
})

describe('leaderboard HUD', () => {
  it('renders nothing multiplayer in a single-player flight', () => {
    useGameStore.getState().startFlight('freeFlight')
    render(<GameUI />)
    expect(screen.queryByTestId('mp-leaderboard')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Crashed' })).toBeNull()
  })

  it('ranks pilots by airborne time and highlights me', () => {
    render(<GameUI />)
    joinRoom()
    expect(rows().map((r) => r.textContent)).toEqual(['Ace (you)2:10', 'Bee1:15', 'Cat0:05'])
    expect(rows()[0].getAttribute('aria-current')).toBe('true')
    expect(rows()[0].className).toContain('me')
    expect(screen.getByTestId('mp-leaderboard').textContent).toContain('ABC234')
  })

  it('flashes rows whose score was reset by a collision', () => {
    render(<GameUI />)
    const s = joinRoom()
    act(() =>
      s.receive({
        t: 'leaderboard',
        entries: [
          { id: 'p3', seconds: 6, resets: 0 },
          { id: 'p1', seconds: 0, resets: 1 },
          { id: 'p2', seconds: 0, resets: 1 },
        ],
      }),
    )
    const r = rows()
    expect(r.map((x) => x.className.includes('reset'))).toEqual([false, true, true])
    expect(r[1].textContent).toContain('0:00')
  })

  it('L toggles the leaderboard, only in a room', () => {
    expect(handleHotkey('KeyL')).toBe(false)
    render(<GameUI />)
    joinRoom()
    act(() => void handleHotkey('KeyL'))
    expect(screen.queryByTestId('mp-leaderboard')).toBeNull()
    act(() => void handleHotkey('KeyL'))
    expect(screen.getByTestId('mp-leaderboard')).toBeTruthy()
  })
})

describe('crash panel', () => {
  it('a collision crash offers respawn; respawning restarts the flight and tells the server', () => {
    render(<GameUI />)
    const s = joinRoom()
    act(() => mp().reportCrash('Mid-air collision with Bee'))
    const dialog = screen.getByRole('dialog', { name: 'Crashed' })
    expect(dialog.textContent).toContain('Mid-air collision with Bee')
    expect(dialog.textContent).toContain('flying times were reset')
    const flightId = useGameStore.getState().flightId
    fireEvent.click(within(dialog).getByRole('button', { name: 'Respawn' }))
    expect(useGameStore.getState()).toMatchObject({ screen: 'flight', flightId: flightId + 1 })
    expect(screen.queryByRole('dialog', { name: 'Crashed' })).toBeNull()
    expect(s.closed).toBe(false)
  })

  it('a terrain crash says the time is kept', () => {
    render(<GameUI />)
    joinRoom()
    act(() => mp().reportCrash('Terrain collision'))
    expect(screen.getByRole('dialog', { name: 'Crashed' }).textContent).toContain('time is kept')
  })

  it('leave room quits to the menu and closes the connection', () => {
    render(<GameUI />)
    const s = joinRoom()
    act(() => mp().reportCrash('Terrain collision'))
    fireEvent.click(screen.getByRole('button', { name: 'Leave room' }))
    expect(useGameStore.getState().screen).toBe('mainMenu')
    expect(s.closed).toBe(true)
    expect(mp().status).toBe('idle')
  })
})
