// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeSocket } from '../../net/__tests__/fakeSocket'
import { DEFAULT_SETTINGS, useGameStore } from '../../state/gameStore'
import { setMultiplayerTransport, useMultiplayerStore } from '../../state/multiplayerStore'
import { GameUI } from '../GameUI'

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  FakeSocket.reset()
  setMultiplayerTransport(FakeSocket.factory, 'ws://test')
  useMultiplayerStore.getState().leaveSky()
  useMultiplayerStore.getState().setPlayerName('')
  useGameStore.setState({
    screen: 'mainMenu',
    overlay: 'none',
    paused: false,
    flightId: 0,
    aircraftId: 'trainer',
    airportId: 'central',
    runwayEnd: '36',
    settings: { ...DEFAULT_SETTINGS },
  })
})
afterEach(() => {
  cleanup()
  useMultiplayerStore.getState().leaveSky()
  setMultiplayerTransport(undefined)
})

describe('Multiplayer lobby', () => {
  it('is reachable from the main menu, beside the single-player options', () => {
    render(<GameUI />)
    expect(screen.getByRole('button', { name: 'Quick Flight' })).toBeTruthy()
    click('Multiplayer')
    expect(useGameStore.getState().screen).toBe('multiplayer')
    expect(screen.getByRole('region', { name: 'Multiplayer' })).toBeTruthy()
  })

  it('has no room codes: one button joins the shared sky', () => {
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    expect(screen.queryByLabelText(/room code/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /create room/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Join the sky' })).toBeTruthy()
  })

  it('pick an airport, join, and spawn there', () => {
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    type(/pilot name/i, 'Ace')
    fireEvent.click(screen.getByRole('radio', { name: 'FSHI Harbor International' }))
    expect(useGameStore.getState().airportId).toBe('harbor')
    expect(screen.getByText(/middle of runway .* at Harbor International/)).toBeTruthy()
    click('Join the sky')
    expect(screen.getByText(/connecting/i)).toBeTruthy()
    const s = FakeSocket.last
    act(() => {
      s.open()
      s.receive({ t: 'welcome', id: 'p1' })
    })
    expect(s.sent[0]).toMatchObject({ t: 'hello', name: 'Ace', aircraftId: 'trainer' })
    expect(useGameStore.getState()).toMatchObject({ screen: 'flight', mode: 'freeFlight', airportId: 'harbor' })
  })

  it('an airliner that needs more than half the runway starts further back, without a warning', () => {
    useGameStore.setState({ aircraftId: 'a350' })
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    fireEvent.click(screen.getByRole('radio', { name: 'FSHI Harbor International' }))
    // Harbor's 3,400 m runway leaves 1,700 m from the middle; the A350 needs 2,600 m.
    expect(screen.queryByTestId('runway-warning-FSHI')).toBeNull()
    expect(screen.getByText(/at Harbor International, 8,530 ft from its end \(the A350 needs more than half\)/)).toBeTruthy()
  })

  it('Enter in the name field joins too', () => {
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    type(/pilot name/i, 'Ace')
    fireEvent.submit(screen.getByRole('region', { name: 'Multiplayer' }))
    expect(FakeSocket.all).toHaveLength(1)
  })

  it('shows a full sky from the server', () => {
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    type(/pilot name/i, 'Bee')
    click('Join the sky')
    const s = FakeSocket.last
    act(() => {
      s.open()
      s.receive({ t: 'error', code: 'SERVER_FULL', message: 'x' })
    })
    expect(screen.getByRole('alert').textContent).toMatch(/sky is full/i)
    expect(useGameStore.getState().screen).toBe('multiplayer')
  })

  it('an unreachable server is reported', () => {
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    type(/pilot name/i, 'Bee')
    click('Join the sky')
    act(() => FakeSocket.last.drop())
    expect(screen.getByRole('alert').textContent).toMatch(/can't reach/i)
  })

  it('a missing pilot name is reported without connecting', () => {
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    click('Join the sky')
    expect(screen.getByRole('alert').textContent).toMatch(/pilot name/i)
    expect(FakeSocket.all).toHaveLength(0)
  })
})
