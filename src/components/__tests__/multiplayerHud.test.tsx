// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleBoardKey, useHotkeys } from '../../input/hotkeys'
import { FakeSocket } from '../../net/__tests__/fakeSocket'
import type { LeaderboardEntry } from '../../net/protocol'
import { DEFAULT_SETTINGS, useGameStore } from '../../state/gameStore'
import { setMultiplayerTransport, useMultiplayerStore } from '../../state/multiplayerStore'
import { resetTelemetry } from '../../state/telemetry'
import { GameUI } from '../GameUI'

const mp = () => useMultiplayerStore.getState()
const row = (id: string, seconds: number, multiplier = 1, resets = 0): LeaderboardEntry => ({
  id,
  score: Math.round(seconds * multiplier * 10) / 10,
  seconds,
  multiplier,
  resets,
})

/** Joins the sky as p1 "Ace" with "Bee" (p2) and "Cat" (p3) online; the flight starts. */
function joinSky() {
  mp().setPlayerName('Ace')
  mp().joinSky('trainer')
  const s = FakeSocket.last
  act(() => {
    s.open()
    s.receive({ t: 'welcome', id: 'p1' })
    s.receive({
      t: 'roster',
      players: [
        { id: 'p1', name: 'Ace', aircraftId: 'trainer' },
        { id: 'p2', name: 'Bee', aircraftId: 'f22' },
        { id: 'p3', name: 'Cat', aircraftId: 'a220' },
      ],
    })
    s.receive({ t: 'leaderboard', entries: [row('p2', 75, 2), row('p1', 130, 1), row('p3', 5)] })
  })
  return s
}

/** The app with its global key listeners, as App mounts them. */
function WithHotkeys() {
  useHotkeys()
  return <GameUI />
}

const holdTab = () => act(() => void handleBoardKey('Tab', true))
const releaseTab = () => act(() => void handleBoardKey('Tab', false))
const rows = () => within(screen.getByTestId('mp-scoreboard')).getAllByRole('row').slice(1)

beforeEach(() => {
  FakeSocket.reset()
  resetTelemetry()
  setMultiplayerTransport(FakeSocket.factory, 'ws://test')
  useGameStore.setState({ screen: 'mainMenu', overlay: 'none', paused: false, flightId: 0, settings: { ...DEFAULT_SETTINGS } })
})
afterEach(() => {
  cleanup()
  mp().leaveSky()
  setMultiplayerTransport(undefined)
})

describe('score chip', () => {
  it('renders nothing multiplayer in a single-player flight', () => {
    useGameStore.getState().startFlight('freeFlight')
    render(<GameUI />)
    expect(screen.queryByTestId('mp-score')).toBeNull()
    expect(screen.queryByTestId('mp-scoreboard')).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Crashed' })).toBeNull()
  })

  it('shows my score, multiplier and flying time, and how to see the scoreboard', () => {
    render(<GameUI />)
    joinSky()
    const chip = screen.getByTestId('mp-score')
    expect(chip.textContent).toContain('130')
    expect(chip.textContent).toContain('x1.0')
    expect(chip.textContent).toContain('2:10 in the air')
    expect(chip.textContent).toContain('Hold Tab')
  })

  it('shows a take-off or landing grade', () => {
    render(<GameUI />)
    const s = joinSky()
    act(() => s.receive({ t: 'grade', kind: 'landing', label: 'Good landing', delta: 0.3, multiplier: 1.3 }))
    expect(screen.getByTestId('mp-score').textContent).toContain('Good landing +0.30 → x1.3')
  })
})

describe('Tab scoreboard', () => {
  it('is hidden until Tab is held, and hides again on release', () => {
    render(<GameUI />)
    joinSky()
    expect(screen.queryByTestId('mp-scoreboard')).toBeNull()
    holdTab()
    expect(screen.getByTestId('mp-scoreboard')).toBeTruthy()
    releaseTab()
    expect(screen.queryByTestId('mp-scoreboard')).toBeNull()
  })

  it('lists everyone online by score with aircraft, multiplier and time, highlighting me', () => {
    render(<GameUI />)
    joinSky()
    holdTab()
    expect(screen.getByTestId('mp-scoreboard').textContent).toContain('Online · 3 pilots')
    const cells = rows().map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))
    expect(cells).toEqual([
      ['1', 'Bee', expect.any(String), '150', 'x2.0', '1:15'],
      ['2', 'Ace (you)', expect.any(String), '130', 'x1.0', '2:10'],
      ['3', 'Cat', expect.any(String), '5', 'x1.0', '0:05'],
    ])
    expect(rows()[1].getAttribute('aria-current')).toBe('true')
  })

  it('flashes rows whose score was reset', () => {
    render(<GameUI />)
    const s = joinSky()
    holdTab()
    act(() => s.receive({ t: 'leaderboard', entries: [row('p3', 6), row('p1', 0, 1, 1), row('p2', 0, 1, 1)] }))
    expect(rows().map((x) => x.className.includes('reset'))).toEqual([false, true, true])
  })

  it('Tab does nothing offline', () => {
    expect(handleBoardKey('Tab', true)).toBe(false)
    expect(mp().boardVisible).toBe(false)
  })

  it('a real Tab key press is kept from moving the focus', () => {
    render(<WithHotkeys />)
    joinSky()
    const ev = new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', cancelable: true, repeat: true })
    act(() => void window.dispatchEvent(ev))
    expect(ev.defaultPrevented).toBe(true)
    expect(mp().boardVisible).toBe(true)
    act(() => void window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Tab', key: 'Tab' })))
    expect(mp().boardVisible).toBe(false)
  })

  it('in the crash dialog or the pause menu, Tab moves the focus as usual', () => {
    render(<WithHotkeys />)
    joinSky()
    act(() => mp().reportCrash('Terrain collision'))
    const crashed = new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', cancelable: true })
    act(() => void window.dispatchEvent(crashed))
    expect(crashed.defaultPrevented).toBe(false)
    expect(mp().boardVisible).toBe(false)
    act(() => mp().respawn())
    act(() => useGameStore.getState().togglePause())
    const paused = new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', cancelable: true })
    act(() => void window.dispatchEvent(paused))
    expect(paused.defaultPrevented).toBe(false)
  })

  it('losing window focus hides it', () => {
    render(<WithHotkeys />)
    joinSky()
    holdTab()
    act(() => void window.dispatchEvent(new Event('blur')))
    expect(screen.queryByTestId('mp-scoreboard')).toBeNull()
  })
})

describe('crash panel', () => {
  it('a collision crash offers respawn; respawning restarts the flight and keeps the connection', () => {
    render(<GameUI />)
    const s = joinSky()
    act(() => mp().reportCrash('Mid-air collision with Bee'))
    const dialog = screen.getByRole('dialog', { name: 'Crashed' })
    expect(dialog.textContent).toContain('Mid-air collision with Bee')
    expect(dialog.textContent).toContain('both scores were reset')
    const flightId = useGameStore.getState().flightId
    fireEvent.click(within(dialog).getByRole('button', { name: 'Respawn' }))
    expect(useGameStore.getState()).toMatchObject({ screen: 'flight', flightId: flightId + 1 })
    expect(screen.queryByRole('dialog', { name: 'Crashed' })).toBeNull()
    expect(s.closed).toBe(false)
  })

  it('a terrain crash says the score was reset', () => {
    render(<GameUI />)
    joinSky()
    act(() => mp().reportCrash('Terrain collision'))
    expect(screen.getByRole('dialog', { name: 'Crashed' }).textContent).toContain('Your score was reset')
  })

  it('leave quits to the menu and closes the connection', () => {
    render(<GameUI />)
    const s = joinSky()
    act(() => mp().reportCrash('Terrain collision'))
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(useGameStore.getState().screen).toBe('mainMenu')
    expect(s.closed).toBe(true)
    expect(mp().status).toBe('idle')
  })
})
