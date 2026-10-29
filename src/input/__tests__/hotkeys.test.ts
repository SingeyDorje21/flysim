import { beforeEach, describe, expect, it } from 'vitest'
import { useAutopilotStore } from '../../state/autopilotStore'
import { useGameStore } from '../../state/gameStore'
import { handleHotkey } from '../hotkeys'

const initial = useGameStore.getInitialState()
const s = () => useGameStore.getState()

beforeEach(() => {
  useGameStore.setState(initial, true)
  useAutopilotStore.setState({ assistRequests: 0 })
})

describe('Escape on the menu screens', () => {
  it('goes back to the main menu from the mode select', () => {
    s().goToModeSelect()
    expect(handleHotkey('Escape')).toBe(true)
    expect(s().screen).toBe('mainMenu')
  })

  it('goes back to the main menu from Flight School', () => {
    s().goToFlightSchool()
    expect(handleHotkey('Escape')).toBe(true)
    expect(s().screen).toBe('mainMenu')
  })

  it('is not handled on the main menu', () => {
    expect(handleHotkey('Escape')).toBe(false)
    expect(s().screen).toBe('mainMenu')
  })

  it('closes an open overlay first', () => {
    s().goToFlightSchool()
    s().openOverlay('settings')
    handleHotkey('Escape')
    expect(s().overlay).toBe('none')
    expect(s().screen).toBe('flightSchool')
  })
})

describe('in flight', () => {
  beforeEach(() => s().startFlight('freeFlight'))

  it('Escape and P toggle the pause', () => {
    handleHotkey('Escape')
    expect(s().paused).toBe(true)
    handleHotkey('KeyP')
    expect(s().paused).toBe(false)
  })

  it('M opens and closes the map', () => {
    handleHotkey('KeyM')
    expect(s().overlay).toBe('map')
    handleHotkey('KeyM')
    expect(s().overlay).toBe('none')
  })

  it('camera keys pick the camera', () => {
    handleHotkey('Digit2')
    expect(s().cameraMode).toBe('cockpit')
  })

  it('0 asks for the landing assist', () => {
    handleHotkey('Digit0')
    expect(useAutopilotStore.getState().assistRequests).toBe(1)
  })
})

it('flight keys do nothing on the main menu', () => {
  expect(handleHotkey('KeyC')).toBe(false)
  expect(handleHotkey('Digit0')).toBe(false)
  expect(useAutopilotStore.getState().assistRequests).toBe(0)
})
