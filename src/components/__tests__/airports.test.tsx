// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AIRPORTS } from '../../config/airports'
import { useGameStore } from '../../state/gameStore'
import { INITIAL_TELEMETRY, publishTelemetry, resetTelemetry, type TelemetrySnapshot } from '../../state/telemetry'
import { GameUI } from '../GameUI'

const state = () => useGameStore.getState()

function withNav(nav: TelemetrySnapshot['nav'], extra: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return { ...INITIAL_TELEMETRY, nav, ...extra }
}

beforeEach(() => {
  useGameStore.setState(useGameStore.getInitialState(), true)
  resetTelemetry()
})
afterEach(cleanup)

describe('airport picker', () => {
  it('selects an airport and a runway end, and Start launches with it', () => {
    useGameStore.setState({ screen: 'modeSelect' })
    render(<GameUI />)
    fireEvent.click(screen.getByRole('radio', { name: 'FSHI Harbor International' }))
    expect(state().airportId).toBe('harbor')
    expect(screen.getByRole('radio', { name: 'FSHI Harbor International' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Runway 27' }))
    expect(state().runwayEnd).toBe('27')
    const landing = screen.getByRole('article', { name: 'Landing Challenge' })
    expect(within(landing).getByTestId('selection-line').textContent).toContain('FSHI')
    expect(within(landing).getByTestId('selection-line').textContent).toContain('RWY 27')
    fireEvent.click(screen.getByRole('button', { name: 'Start Landing Challenge' }))
    expect(state().screen).toBe('flight')
    expect(state().mode).toBe('landing')
    expect(state().airportId).toBe('harbor')
    expect(state().runwayEnd).toBe('27')
  })

  it('does not show the selection on the fixed ring course', () => {
    useGameStore.setState({ screen: 'modeSelect' })
    render(<GameUI />)
    const rings = screen.getByRole('article', { name: /Ring/ })
    expect(within(rings).queryByTestId('selection-line')).toBeNull()
  })
})

describe('world map', () => {
  it('renders every airport and closes', () => {
    useGameStore.setState({ screen: 'modeSelect' })
    useGameStore.getState().openOverlay('map')
    render(<GameUI />)
    for (const a of AIRPORTS) expect(screen.getByTestId(`map-airport-${a.code}`)).toBeTruthy()
    expect(screen.getByTestId('map-aircraft')).toBeTruthy()
    expect(screen.getByTestId('map-scale')).toBeTruthy()
    expect(screen.getByTestId('map-north')).toBeTruthy()
    expect(screen.getByTestId('map-land').childElementCount).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(state().overlay).toBe('none')
    expect(screen.queryByTestId('world-map')).toBeNull()
  })

  it('clicking an airport selects it only when not in flight', () => {
    useGameStore.setState({ screen: 'modeSelect' })
    useGameStore.getState().openOverlay('map')
    render(<GameUI />)
    fireEvent.click(screen.getByTestId('map-airport-FSWP'))
    expect(state().airportId).toBe('westport')
    act(() => useGameStore.setState({ screen: 'flight' }))
    fireEvent.click(screen.getByTestId('map-airport-FSHI'))
    expect(state().airportId).toBe('westport')
  })
})

describe('HUD navigation', () => {
  beforeEach(() => useGameStore.getState().startFlight('freeFlight'))

  it('shows the nav readout and minimap, and hides the readout without data', () => {
    render(<GameUI />)
    expect(screen.getByTestId('minimap')).toBeTruthy()
    expect(screen.queryByTestId('hud-nav')).toBeNull()
    act(() =>
      publishTelemetry(
        withNav({ nearest: { code: 'FSHI', name: 'Harbor International', distance: 22980, bearingDeg: 245 }, approach: null }),
      ),
    )
    const nav = screen.getByTestId('hud-nav').textContent ?? ''
    expect(nav).toContain('FSHI Harbor International')
    expect(nav).toContain('12.4 nm')
    expect(nav).toContain('245')
  })

  it('minimap draws nearby airports', () => {
    render(<GameUI />)
    expect(screen.getByTestId('minimap-airport-FSCF')).toBeTruthy()
    expect(screen.queryByTestId('minimap-airport-FSHI')).toBeNull()
  })

  it('shows the approach indicator with clamped deviations and hides when null', () => {
    render(<GameUI />)
    expect(screen.queryByTestId('hud-approach')).toBeNull()
    act(() =>
      publishTelemetry(
        withNav({
          nearest: null,
          approach: { code: 'FSHI', runway: '27', distance: 5000, lateral: 500, vertical: -30 },
        }),
      ),
    )
    const box = screen.getByTestId('hud-approach')
    expect(box.textContent).toContain('RWY 27 FSHI')
    expect(screen.getByTestId('approach-distance').textContent).toBe('2.7 nm')
    // aircraft far right -> diamond clamped to the left end; below slope -> diamond above centre
    expect(screen.getByTestId('loc-diamond').style.left).toBe('0%')
    expect(screen.getByTestId('gs-diamond').style.top).toBe('25%')
    act(() => publishTelemetry(withNav({ nearest: null, approach: null })))
    expect(screen.queryByTestId('hud-approach')).toBeNull()
  })

  it('hides the minimap with the HUD', () => {
    useGameStore.getState().updateSettings({ showHud: false })
    render(<GameUI />)
    expect(screen.queryByTestId('minimap')).toBeNull()
  })
})

describe('controls', () => {
  it('lists the M key', () => {
    useGameStore.getState().openOverlay('controls')
    render(<GameUI />)
    expect(screen.getByText('World map')).toBeTruthy()
  })
})
