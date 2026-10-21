import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, useGameStore } from '../gameStore'
import type { FlightResult } from '../../game/types'

const initial = useGameStore.getInitialState()
const s = () => useGameStore.getState()

function result(over: Partial<FlightResult> = {}): FlightResult {
  return {
    mode: 'landing',
    outcome: 'success',
    headline: 'ok',
    reason: null,
    score: 500,
    timeSec: 30,
    stats: [],
    ...over,
  }
}

beforeEach(() => {
  useGameStore.setState(initial, true)
})

describe('navigation', () => {
  it('starts on the main menu with defaults', () => {
    expect(s().screen).toBe('mainMenu')
    expect(s().settings).toEqual(DEFAULT_SETTINGS)
    expect(s().flightId).toBe(0)
  })

  it('goToModeSelect and goToMainMenu clear pause/overlay/result', () => {
    s().startFlight('takeoff')
    s().pause()
    s().openOverlay('settings')
    s().goToModeSelect()
    expect(s()).toMatchObject({ screen: 'modeSelect', overlay: 'none', paused: false, result: null })
    s().openOverlay('controls')
    s().goToMainMenu()
    expect(s()).toMatchObject({ screen: 'mainMenu', overlay: 'none', paused: false, result: null })
  })

  it('open/close overlay', () => {
    s().openOverlay('controls')
    expect(s().overlay).toBe('controls')
    s().closeOverlay()
    expect(s().overlay).toBe('none')
  })

  it('quitToMenu clears flight state including newBest', () => {
    s().startFlight('landing')
    s().finishFlight(result())
    expect(s().newBest).toBe(true)
    s().quitToMenu()
    expect(s()).toMatchObject({ screen: 'mainMenu', result: null, newBest: false, paused: false })
  })
})

describe('startFlight / restartFlight', () => {
  it('startFlight sets mode, screen, camera from settings and bumps flightId', () => {
    s().updateSettings({ defaultCamera: 'cockpit' })
    s().openOverlay('settings')
    s().startFlight('rings')
    expect(s()).toMatchObject({
      screen: 'flight',
      mode: 'rings',
      overlay: 'none',
      paused: false,
      result: null,
      newBest: false,
      cameraMode: 'cockpit',
      flightId: 1,
    })
  })

  it('restartFlight bumps flightId and clears result, paused, overlay, newBest', () => {
    s().startFlight('landing')
    s().finishFlight(result())
    s().restartFlight()
    expect(s()).toMatchObject({
      screen: 'flight',
      mode: 'landing',
      flightId: 2,
      result: null,
      paused: false,
      overlay: 'none',
      newBest: false,
    })
    s().pause()
    s().openOverlay('settings')
    s().restartFlight()
    expect(s()).toMatchObject({ flightId: 3, paused: false, overlay: 'none' })
  })

  it('restartFlight keeps the current camera mode', () => {
    s().startFlight('freeFlight')
    s().setCameraMode('free')
    s().restartFlight()
    expect(s().cameraMode).toBe('free')
  })
})

describe('pause', () => {
  it('pause/togglePause only work during flight', () => {
    s().pause()
    expect(s().paused).toBe(false)
    s().togglePause()
    expect(s().paused).toBe(false)
    s().goToModeSelect()
    s().togglePause()
    expect(s().paused).toBe(false)
  })

  it('pause, resume, togglePause during flight', () => {
    s().startFlight('freeFlight')
    s().pause()
    expect(s().paused).toBe(true)
    s().resume()
    expect(s().paused).toBe(false)
    s().togglePause()
    expect(s().paused).toBe(true)
    s().openOverlay('settings')
    s().togglePause()
    expect(s()).toMatchObject({ paused: false, overlay: 'none' })
  })

  it('does not leave paused set after results', () => {
    s().startFlight('takeoff')
    s().pause()
    s().finishFlight(result({ mode: 'takeoff' }))
    expect(s().paused).toBe(false)
    expect(s().screen).toBe('results')
  })
})

describe('finishFlight and best scores', () => {
  it('is ignored outside a flight', () => {
    s().finishFlight(result())
    expect(s().screen).toBe('mainMenu')
    expect(s().result).toBeNull()
    expect(s().bestScores).toEqual({})
  })

  it('second finish after results is ignored', () => {
    s().startFlight('landing')
    s().finishFlight(result({ score: 400 }))
    s().finishFlight(result({ score: 900 }))
    expect(s().result?.score).toBe(400)
    expect(s().bestScores.landing).toBe(400)
  })

  it('first success sets a best and newBest', () => {
    s().startFlight('landing')
    s().finishFlight(result({ score: 500 }))
    expect(s()).toMatchObject({ screen: 'results', newBest: true, bestScores: { landing: 500 } })
  })

  it('higher score replaces best; lower or equal does not', () => {
    s().startFlight('landing')
    s().finishFlight(result({ score: 500 }))
    s().restartFlight()
    s().finishFlight(result({ score: 700 }))
    expect(s().newBest).toBe(true)
    expect(s().bestScores.landing).toBe(700)
    s().restartFlight()
    s().finishFlight(result({ score: 700 }))
    expect(s().newBest).toBe(false)
    s().restartFlight()
    s().finishFlight(result({ score: 100 }))
    expect(s().newBest).toBe(false)
    expect(s().bestScores.landing).toBe(700)
  })

  it('failure never sets a best, even with no previous best', () => {
    s().startFlight('rings')
    s().finishFlight(result({ mode: 'rings', outcome: 'failure', score: 999 }))
    expect(s().newBest).toBe(false)
    expect(s().bestScores.rings).toBeUndefined()
    expect(s().result?.outcome).toBe('failure')
  })

  it('bests are tracked per mode', () => {
    s().startFlight('landing')
    s().finishFlight(result({ score: 300 }))
    s().startFlight('rings')
    s().finishFlight(result({ mode: 'rings', score: 200 }))
    expect(s().bestScores).toEqual({ landing: 300, rings: 200 })
  })

  it('clearBestScores empties bests', () => {
    s().startFlight('landing')
    s().finishFlight(result())
    s().clearBestScores()
    expect(s().bestScores).toEqual({})
  })
})

describe('camera', () => {
  it('cycleCamera goes chase -> cockpit -> free -> chase', () => {
    s().setCameraMode('chase')
    s().cycleCamera()
    expect(s().cameraMode).toBe('cockpit')
    s().cycleCamera()
    expect(s().cameraMode).toBe('free')
    s().cycleCamera()
    expect(s().cameraMode).toBe('chase')
  })
})

describe('settings', () => {
  it('updateSettings merges a patch', () => {
    s().updateSettings({ quality: 'high', units: 'metric' })
    expect(s().settings).toEqual({ ...DEFAULT_SETTINGS, quality: 'high', units: 'metric' })
  })

  it('resetSettings restores defaults without touching bests', () => {
    s().updateSettings({ quality: 'low', invertPitch: true })
    s().startFlight('landing')
    s().finishFlight(result())
    s().resetSettings()
    expect(s().settings).toEqual(DEFAULT_SETTINGS)
    expect(s().bestScores.landing).toBe(500)
  })

  it('toggleHud / toggleInstruments flip only their flag', () => {
    s().toggleHud()
    expect(s().settings.showHud).toBe(false)
    expect(s().settings.showInstruments).toBe(true)
    s().toggleInstruments()
    expect(s().settings.showInstruments).toBe(false)
    s().toggleHud()
    expect(s().settings.showHud).toBe(true)
  })

  it('does not mutate DEFAULT_SETTINGS', () => {
    s().updateSettings({ quality: 'high' })
    s().toggleHud()
    expect(DEFAULT_SETTINGS.quality).toBe('medium')
    expect(DEFAULT_SETTINGS.showHud).toBe(true)
  })
})

describe('persistence', () => {
  type State = ReturnType<typeof s>
  const merge = (persisted: unknown): State => {
    const m = useGameStore.persist.getOptions().merge
    if (!m) throw new Error('merge missing')
    return m(persisted, initial) as State
  }

  it('partializes only settings and bestScores', () => {
    const partialize = useGameStore.persist.getOptions().partialize
    expect(Object.keys(partialize?.(s()) ?? {}).sort()).toEqual(['bestScores', 'settings'])
  })

  it('keeps defaults for settings fields missing from storage', () => {
    const merged = merge({ settings: { quality: 'high' }, bestScores: { rings: 300 } })
    expect(merged.settings).toEqual({ ...DEFAULT_SETTINGS, quality: 'high' })
    expect(merged.bestScores).toEqual({ rings: 300 })
  })

  it('handles empty / missing persisted data', () => {
    for (const p of [undefined, null, {}]) {
      const merged = merge(p)
      expect(merged.settings).toEqual(DEFAULT_SETTINGS)
      expect(merged.bestScores).toEqual({})
    }
  })

  it('keeps actions from the current state', () => {
    expect(typeof merge({ settings: {} }).startFlight).toBe('function')
  })

  // Known gaps (reported as contract issues): merge does not validate values.
  it('rejects an invalid quality value from storage', () => {
    const merged = merge({ settings: { quality: 'ultra' } })
    expect(['low', 'medium', 'high']).toContain(merged.settings.quality)
  })

  it('ignores a non-object settings value from storage', () => {
    const merged = merge({ settings: 'garbage' })
    expect(merged.settings).toEqual(DEFAULT_SETTINGS)
  })
})
