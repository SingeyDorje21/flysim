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
  useMultiplayerStore.getState().leaveRoom()
  useMultiplayerStore.getState().setPlayerName('')
  useGameStore.setState({
    screen: 'mainMenu',
    overlay: 'none',
    paused: false,
    flightId: 0,
    aircraftId: 'trainer',
    settings: { ...DEFAULT_SETTINGS },
  })
})
afterEach(() => {
  cleanup()
  useMultiplayerStore.getState().leaveRoom()
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

  it('create room shows the code with a copy button, then takes off', () => {
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    type(/pilot name/i, 'Ace')
    click('Create room')
    expect(screen.getByRole('status').textContent).toMatch(/connecting/i)
    const s = FakeSocket.last
    act(() => {
      s.open()
      s.receive({ t: 'welcome', code: 'ABC234', id: 'p1', slot: 0 })
      s.receive({ t: 'roster', players: [{ id: 'p1', name: 'Ace', aircraftId: 'trainer', slot: 0 }] })
    })
    expect(s.sent[0]).toMatchObject({ t: 'create', name: 'Ace', aircraftId: 'trainer' })
    expect(screen.getByTestId('room-code').textContent).toBe('ABC234')
    expect(screen.getByRole('button', { name: /copy room code abc234/i })).toBeTruthy()
    click('Take off')
    expect(useGameStore.getState()).toMatchObject({ screen: 'flight', mode: 'freeFlight' })
  })

  it('join with a valid code goes straight to the flight', () => {
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    type(/pilot name/i, 'Bee')
    type(/room code/i, 'abc 234')
    click('Join')
    const s = FakeSocket.last
    act(() => {
      s.open()
      s.receive({ t: 'welcome', code: 'ABC234', id: 'p2', slot: 1 })
    })
    expect(s.sent[0]).toMatchObject({ t: 'join', code: 'ABC234', name: 'Bee' })
    expect(useGameStore.getState().screen).toBe('flight')
  })

  it('an invalid code is flagged and never sent', () => {
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    type(/pilot name/i, 'Bee')
    type(/room code/i, 'AB0')
    click('Join')
    expect(screen.getByLabelText(/room code/i).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(/6 letters and digits/i)).toBeTruthy()
    expect(FakeSocket.all).toHaveLength(0)
  })

  it.each([
    ['ROOM_FULL', /room is full/i],
    ['BAD_CODE', /no room with that code/i],
  ] as const)('shows the %s error from the server', (code, text) => {
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    type(/pilot name/i, 'Bee')
    type(/room code/i, 'ABC234')
    click('Join')
    const s = FakeSocket.last
    act(() => {
      s.open()
      s.receive({ t: 'error', code, message: 'x' })
    })
    expect(screen.getByRole('alert').textContent).toMatch(text)
    expect(useGameStore.getState().screen).toBe('multiplayer')
  })

  it('an unreachable server is reported', () => {
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    type(/pilot name/i, 'Bee')
    click('Create room')
    act(() => FakeSocket.last.drop())
    expect(screen.getByRole('alert').textContent).toMatch(/can't reach/i)
  })

  it('a missing pilot name is reported without connecting', () => {
    useGameStore.getState().goToMultiplayer()
    render(<GameUI />)
    click('Create room')
    expect(screen.getByRole('alert').textContent).toMatch(/pilot name/i)
    expect(FakeSocket.all).toHaveLength(0)
  })
})
