// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AIRCRAFT } from '../../config/aircraftCatalog'
import { useGameStore } from '../../state/gameStore'
import { INITIAL_TELEMETRY, publishTelemetry, resetTelemetry, type TelemetrySnapshot } from '../../state/telemetry'
import { GameUI } from '../GameUI'

const state = () => useGameStore.getState()
const tel = (extra: Partial<TelemetrySnapshot>): TelemetrySnapshot => ({ ...INITIAL_TELEMETRY, ...extra })

beforeEach(() => {
  localStorage.clear()
  useGameStore.setState(useGameStore.getInitialState(), true)
  resetTelemetry()
})
afterEach(cleanup)

describe('hangar', () => {
  it('shows all 5 aircraft and selecting persists in the store', () => {
    useGameStore.setState({ screen: 'modeSelect' })
    render(<GameUI />)
    for (const a of AIRCRAFT) expect(screen.getByTestId(`aircraft-card-${a.id}`)).toBeTruthy()
    expect(AIRCRAFT).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'Select A350-900' }))
    expect(state().aircraftId).toBe('a350')
    expect(screen.getByTestId('aircraft-card-a350').getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId('aircraft-card-trainer').getAttribute('data-selected')).toBe('false')
    expect(JSON.stringify(Object.values(localStorage))).toContain('a350')
  })

  it('shows specs (collapsible) and sources', () => {
    useGameStore.setState({ screen: 'modeSelect' })
    render(<GameUI />)
    const card = screen.getByTestId('aircraft-card-f22')
    expect(within(card).queryByText(/Sources:/)).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: /Show specs/ }))
    expect(within(card).getByText(/Sources:/)).toBeTruthy()
  })
})

describe('map preview', () => {
  it('renders inline with the selected airport highlighted and an approach arrow', () => {
    useGameStore.setState({ screen: 'modeSelect' })
    state().selectAirport('harbor')
    render(<GameUI />)
    expect(screen.getByTestId('preview')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'World map' })).toBeNull()
    expect(screen.getByTestId('preview-airport-FSHI').getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId('preview-airport-FSCF').getAttribute('data-active')).toBe('false')
    expect(screen.getByTestId('preview-approach-arrow')).toBeTruthy()
  })

  it('clicking an airport on the preview selects it', () => {
    useGameStore.setState({ screen: 'modeSelect' })
    render(<GameUI />)
    fireEvent.click(screen.getByTestId('preview-airport-FSHI'))
    expect(state().airportId).toBe('harbor')
  })

  it('warns that Central Field is too short for the A350, and dims it on the map', () => {
    useGameStore.setState({ screen: 'modeSelect' })
    state().selectAircraft('a350')
    useGameStore.setState({ settings: { ...state().settings, units: 'metric' } })
    render(<GameUI />)
    const w = screen.getByTestId('runway-warning-FSCF')
    expect(w.textContent).toContain('Runway 1,600 m')
    expect(w.textContent).toContain('A350 needs 2,600 m')
    expect(screen.getByTestId('preview-airport-FSCF').getAttribute('data-short')).toBe('true')
    expect(screen.queryByTestId('runway-warning-FSHI')).toBeNull()
  })

  it('does not warn the trainer', () => {
    useGameStore.setState({ screen: 'modeSelect' })
    render(<GameUI />)
    expect(screen.queryByTestId('runway-warning-FSCF')).toBeNull()
  })
})

describe('HUD phase 3', () => {
  function showHud(extra: Partial<TelemetrySnapshot>) {
    useGameStore.setState({ screen: 'flight' })
    render(<GameUI />)
    act(() => publishTelemetry(tel(extra)))
  }

  it('shows gear, AB, speed brake, Mach and N1 for a jet', () => {
    showHud({
      aircraftId: 'f22',
      gearPosition: 0,
      afterburner: true,
      speedbrake: 0.6,
      mach: 1.35,
      n1: 1.02,
      onGround: false,
      heightAboveGround: 5000,
    })
    expect(screen.getByTestId('hud-gear').textContent).toBe('UP')
    expect(screen.getByTestId('hud-gear').className).not.toContain('warn')
    expect(screen.getByTestId('hud-flags').textContent).toContain('AB')
    expect(screen.getByTestId('hud-flags').textContent).toContain('SPD BRK')
    expect(screen.getByTestId('hud-mach').textContent).toBe('1.35')
    expect(screen.getByTestId('hud-n1').textContent).toBe('102%')
  })

  it('flags gear up low and descending in red, transit in amber, and hides Mach when slow', () => {
    showHud({ aircraftId: 'a220', gearPosition: 0, onGround: false, heightAboveGround: 100, verticalSpeed: -3, mach: 0.2 })
    expect(screen.getByTestId('hud-gear').className).toContain('warn')
    expect(screen.queryByTestId('hud-mach')).toBeNull()
    act(() => publishTelemetry(tel({ aircraftId: 'a220', gearPosition: 0.5, reverse: 0.5 })))
    expect(screen.getByTestId('hud-gear').textContent).toBe('TRANSIT')
    expect(screen.getByTestId('hud-gear').className).toContain('caution')
    expect(screen.getByTestId('hud-flags').textContent).toContain('REV')
  })

  it('shows RPM, not N1, for the piston trainer', () => {
    showHud({ aircraftId: 'trainer', rpm: 2300 })
    expect(screen.queryByTestId('hud-n1')).toBeNull()
    expect(screen.getByText('RPM')).toBeTruthy()
  })
})

describe('instruments phase 3', () => {
  it('scales the airspeed dial per aircraft and swaps the tach for N1 on jets', () => {
    useGameStore.setState({ screen: 'flight' })
    useGameStore.setState({ settings: { ...state().settings, showInstruments: true } })
    render(<GameUI />)
    const max = () => Number(screen.getByTestId('gauge-airspeed').getAttribute('data-scale-max'))
    act(() => publishTelemetry(tel({ aircraftId: 'trainer' })))
    const trainerMax = max()
    expect(screen.getByTestId('gauge-tachometer')).toBeTruthy()
    act(() => publishTelemetry(tel({ aircraftId: 'f22' })))
    expect(max()).toBeGreaterThan(trainerMax)
    expect(max()).toBe(800)
    expect(screen.queryByTestId('gauge-tachometer')).toBeNull()
    expect(screen.getByTestId('gauge-n1').getAttribute('data-scale-max')).toBe('110')
  })
})
