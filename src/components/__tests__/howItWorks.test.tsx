// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useGameStore } from '../../state/gameStore'
import { GameUI } from '../GameUI'

beforeEach(() => {
  useGameStore.setState(useGameStore.getInitialState(), true)
})
afterEach(cleanup)

describe('How It Works page', () => {
  it('opens from the main menu and closes with "Got it"', () => {
    render(<GameUI />)
    fireEvent.click(screen.getByRole('button', { name: 'How It Works' }))
    const dialog = screen.getByRole('dialog', { name: 'How it works' })
    expect(within(dialog).getByText('Your first flight')).toBeTruthy()
    expect(within(dialog).getByText('Throttle up / down')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Got it' }))
    expect(useGameStore.getState().overlay).toBe('none')
  })

  it('opens from the pause menu during a flight', () => {
    useGameStore.getState().startFlight('freeFlight')
    useGameStore.getState().pause()
    render(<GameUI />)
    fireEvent.click(screen.getByRole('button', { name: 'How It Works' }))
    expect(useGameStore.getState().overlay).toBe('howItWorks')
    expect(useGameStore.getState().paused).toBe(true)
  })
})

describe('HUD command list', () => {
  it('lists the key commands at the bottom left of the HUD', () => {
    useGameStore.getState().startFlight('freeFlight')
    render(<GameUI />)
    const list = screen.getByLabelText('Key commands')
    for (const action of ['Pitch', 'Roll', 'Throttle', 'Flaps', 'Brakes', 'Camera', 'Pause']) {
      expect(within(list).getByText(action)).toBeTruthy()
    }
  })
})

describe('sound volume setting', () => {
  it('updates the stored volume from the settings slider', () => {
    render(<GameUI />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.change(screen.getByLabelText(/Sound volume/), { target: { value: '0' } })
    expect(useGameStore.getState().settings.masterVolume).toBe(0)
    expect(screen.getByText('Sound volume: muted')).toBeTruthy()
  })
})
