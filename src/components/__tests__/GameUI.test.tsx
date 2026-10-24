// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AIRCRAFT_IDS, getAircraft } from '../../config/aircraftCatalog'
import type { FlightResult } from '../../game/types'
import { DEFAULT_SETTINGS, useGameStore } from '../../state/gameStore'
import { INITIAL_TELEMETRY, publishTelemetry, resetTelemetry } from '../../state/telemetry'
import { GameUI } from '../GameUI'

const result: FlightResult = {
  mode: 'landing',
  outcome: 'success',
  headline: 'Smooth landing!',
  reason: 'Touched down gently',
  score: 870,
  timeSec: 125,
  stats: [
    { label: 'Touchdown speed', value: 30, kind: 'speed' },
    { label: 'Sink rate', value: -1.5, kind: 'verticalSpeed' },
  ],
}

function reset(patch: Partial<ReturnType<typeof useGameStore.getState>> = {}) {
  useGameStore.setState({
    screen: 'mainMenu',
    overlay: 'none',
    mode: 'freeFlight',
    paused: false,
    cameraMode: 'chase',
    flightId: 0,
    result: null,
    newBest: false,
    bestScores: {},
    settings: { ...DEFAULT_SETTINGS },
    ...patch,
  })
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
const state = () => useGameStore.getState()

beforeEach(() => {
  reset()
  resetTelemetry()
})
afterEach(cleanup)

describe('main menu', () => {
  it('shows the title and buttons that trigger store actions', () => {
    render(<GameUI />)
    expect(screen.getByText('FlySim')).toBeTruthy()
    click('Settings')
    expect(state().overlay).toBe('settings')
    cleanup()
    reset()
    render(<GameUI />)
    click('Controls')
    expect(state().overlay).toBe('controls')
  })

  it('Fly opens mode select', () => {
    render(<GameUI />)
    click('Fly')
    expect(state().screen).toBe('modeSelect')
  })

  it('aircraft arrows cycle the selected aircraft, wrapping at both ends', () => {
    reset({ aircraftId: 'trainer' })
    render(<GameUI />)
    click('Next aircraft')
    expect(state().aircraftId).toBe('f22')
    expect(screen.getByTestId('ready-aircraft').textContent).toBe(getAircraft('f22').name)
    click('Previous aircraft')
    click('Previous aircraft')
    expect(state().aircraftId).toBe(AIRCRAFT_IDS[AIRCRAFT_IDS.length - 1])
  })

  it('time-of-day chips update the setting', () => {
    render(<GameUI />)
    const group = screen.getByRole('radiogroup', { name: 'Time of day' })
    fireEvent.click(within(group).getByRole('radio', { name: 'Evening' }))
    expect(state().settings.timeOfDay).toBe('evening')
    expect(within(group).getByRole('radio', { name: 'Evening' }).getAttribute('aria-checked')).toBe('true')
  })

  it('pilot log lists best scores, or an empty note', () => {
    render(<GameUI />)
    expect(screen.getByText(/No scores yet/)).toBeTruthy()
    cleanup()
    reset({ bestScores: { landing: 812.4 } })
    render(<GameUI />)
    const log = screen.getByRole('region', { name: 'Pilot log' })
    expect(within(log).getByText('Landing Challenge')).toBeTruthy()
    expect(within(log).getByText('812')).toBeTruthy()
  })

  it('Quick Flight starts free flight', () => {
    render(<GameUI />)
    click('Quick Flight')
    expect(state().screen).toBe('flight')
    expect(state().mode).toBe('freeFlight')
  })
})

describe('mode select', () => {
  it('starts the chosen mode and shows best score', () => {
    reset({ screen: 'modeSelect', bestScores: { landing: 640 } })
    render(<GameUI />)
    expect(screen.getByText('Landing Challenge')).toBeTruthy()
    expect(screen.getByText('Best 640')).toBeTruthy()
    expect(screen.getAllByText(/^Best /)).toHaveLength(1)
    fireEvent.click(within(screen.getByRole('article', { name: 'Landing Challenge' })).getByRole('button', { name: /Start/ }))
    expect(state().screen).toBe('flight')
    expect(state().mode).toBe('landing')
  })

  it('Back returns to main menu', () => {
    reset({ screen: 'modeSelect' })
    render(<GameUI />)
    click('Back')
    expect(state().screen).toBe('mainMenu')
  })
})

describe('flight screen', () => {
  it('HUD shows formatted airspeed and altitude', () => {
    reset({ screen: 'flight' })
    render(<GameUI />)
    act(() => {
      publishTelemetry({ ...INITIAL_TELEMETRY, airspeed: 50, altitude: 1000, onGround: false, heightAboveGround: 100 })
    })
    expect(screen.getByTestId('hud-airspeed').textContent).toBe('97 kt')
    expect(screen.getByTestId('hud-altitude').textContent).toBe('3,281 ft')
    expect(screen.getByTestId('hud-agl').textContent).toBe('328 ft')
  })

  it('uses metric units', () => {
    reset({ screen: 'flight', settings: { ...DEFAULT_SETTINGS, units: 'metric' } })
    render(<GameUI />)
    act(() => {
      publishTelemetry({ ...INITIAL_TELEMETRY, airspeed: 50, altitude: 1000 })
    })
    expect(screen.getByTestId('hud-airspeed').textContent).toBe('180 km/h')
    expect(screen.getByTestId('hud-altitude').textContent).toBe('1,000 m')
  })

  it('shows warnings and challenge progress', () => {
    reset({ screen: 'flight' })
    render(<GameUI />)
    act(() => {
      publishTelemetry({
        ...INITIAL_TELEMETRY,
        stalled: true,
        crashed: true,
        crashReason: 'Wingtip strike',
        challenge: {
          mode: 'rings',
          objective: 'Fly through ring',
          detail: 'Ring 3 of 9',
          fraction: 0.33,
          elapsed: 65,
          timeLimit: 360,
          status: 'active',
        },
      })
    })
    expect(screen.getByText('Wingtip strike')).toBeTruthy()
    expect(screen.getByText('Fly through ring')).toBeTruthy()
    expect(screen.getByText('Ring 3 of 9')).toBeTruthy()
    expect(screen.getByText('1:05 / 6:00')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('33')
  })

  it('camera buttons set the camera mode', () => {
    reset({ screen: 'flight' })
    render(<GameUI />)
    click('Cockpit camera')
    expect(state().cameraMode).toBe('cockpit')
    click('Free camera')
    expect(state().cameraMode).toBe('free')
  })

  it('hides HUD and instruments per settings', () => {
    reset({ screen: 'flight', settings: { ...DEFAULT_SETTINGS, showHud: false, showInstruments: false } })
    render(<GameUI />)
    expect(screen.queryByTestId('hud')).toBeNull()
    expect(screen.queryByTestId('instrument-panel')).toBeNull()
  })

  it('renders six instruments reading telemetry', () => {
    reset({ screen: 'flight' })
    render(<GameUI />)
    act(() => {
      publishTelemetry({ ...INITIAL_TELEMETRY, airspeed: 50, bankDeg: 20, pitchDeg: 5, rpm: 2300 })
    })
    expect(screen.getByRole('img', { name: 'Airspeed 97 kt' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Tachometer 2300 rpm' })).toBeTruthy()
    expect(screen.getAllByRole('img').length).toBe(6)
  })
})

describe('pause menu', () => {
  beforeEach(() => reset({ screen: 'flight', paused: true, flightId: 3 }))

  it('Resume', () => {
    render(<GameUI />)
    click('Resume')
    expect(state().paused).toBe(false)
  })
  it('Restart', () => {
    render(<GameUI />)
    click('Restart')
    expect(state().flightId).toBe(4)
    expect(state().paused).toBe(false)
  })
  it('Settings and Controls overlays sit above the pause menu', () => {
    render(<GameUI />)
    click('Settings')
    expect(state().overlay).toBe('settings')
    expect(screen.getByRole('dialog', { name: 'Paused' })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
  })
  it('Main Menu', () => {
    render(<GameUI />)
    click('Main Menu')
    expect(state().screen).toBe('mainMenu')
  })
})

describe('results screen', () => {
  it('shows result details and new best badge', () => {
    reset({ screen: 'results', result, newBest: true, bestScores: { landing: 870 } })
    render(<GameUI />)
    expect(screen.getByText('Smooth landing!')).toBeTruthy()
    expect(screen.getByText('Touched down gently')).toBeTruthy()
    expect(screen.getByTestId('result-score').textContent).toBe('870')
    expect(screen.getByText('New best!')).toBeTruthy()
    expect(screen.getByTestId('result-best').textContent).toBe('870')
    expect(screen.getByText('2:05')).toBeTruthy()
    expect(screen.getByText('58 kt')).toBeTruthy()
    expect(screen.getByText('-300 ft/min')).toBeTruthy()
  })

  it('no badge when not a new best', () => {
    reset({ screen: 'results', result, newBest: false })
    render(<GameUI />)
    expect(screen.queryByText('New best!')).toBeNull()
  })

  it('Retry, Choose Mode, Main Menu', () => {
    reset({ screen: 'results', result, flightId: 1 })
    render(<GameUI />)
    click('Retry')
    expect(state().screen).toBe('flight')
    expect(state().flightId).toBe(2)
    reset({ screen: 'results', result })
    cleanup()
    render(<GameUI />)
    click('Choose Mode')
    expect(state().screen).toBe('modeSelect')
    reset({ screen: 'results', result })
    cleanup()
    render(<GameUI />)
    click('Main Menu')
    expect(state().screen).toBe('mainMenu')
  })
})

describe('settings overlay', () => {
  beforeEach(() => reset({ overlay: 'settings' }))

  it('updates quality, units and camera', () => {
    render(<GameUI />)
    fireEvent.click(screen.getByRole('radio', { name: 'High' }))
    expect(state().settings.quality).toBe('high')
    fireEvent.click(screen.getByRole('radio', { name: 'Metric' }))
    expect(state().settings.units).toBe('metric')
    fireEvent.click(screen.getByRole('radio', { name: 'Cockpit' }))
    expect(state().settings.defaultCamera).toBe('cockpit')
  })

  it('updates toggles and sensitivity', () => {
    render(<GameUI />)
    fireEvent.click(screen.getByLabelText('Invert pitch'))
    expect(state().settings.invertPitch).toBe(true)
    fireEvent.click(screen.getByLabelText('Show HUD'))
    expect(state().settings.showHud).toBe(false)
    fireEvent.click(screen.getByLabelText('Show instruments'))
    expect(state().settings.showInstruments).toBe(false)
    fireEvent.change(screen.getByLabelText(/Mouse sensitivity/), { target: { value: '2.5' } })
    expect(state().settings.mouseSensitivity).toBe(2.5)
  })

  it('reset to defaults', () => {
    render(<GameUI />)
    fireEvent.click(screen.getByRole('radio', { name: 'Low' }))
    click('Reset to defaults')
    expect(state().settings).toEqual(DEFAULT_SETTINGS)
  })

  it('clear best scores needs confirmation', () => {
    reset({ overlay: 'settings', bestScores: { rings: 500 } })
    render(<GameUI />)
    click('Clear best scores')
    expect(state().bestScores).toEqual({ rings: 500 })
    click('Cancel')
    expect(state().bestScores).toEqual({ rings: 500 })
    click('Clear best scores')
    click('Yes, clear')
    expect(state().bestScores).toEqual({})
  })

  it('Close', () => {
    render(<GameUI />)
    click('Close')
    expect(state().overlay).toBe('none')
  })
})

describe('controls overlay', () => {
  it('lists key bindings and closes', () => {
    reset({ overlay: 'controls' })
    render(<GameUI />)
    expect(screen.getByText('Esc or P')).toBeTruthy()
    expect(screen.getByText('B or Space')).toBeTruthy()
    click('Close')
    expect(state().overlay).toBe('none')
  })
})
