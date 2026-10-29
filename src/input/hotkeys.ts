/**
 * Global (non-flight-control) hotkeys: pause, camera, HUD toggles. The only
 * place that listens for these keys, so UI components must not add their own.
 */

import { useEffect } from 'react'
import { useAutopilotStore } from '../state/autopilotStore'
import { useGameStore } from '../state/gameStore'
import type { CameraMode } from '../game/types'

const CAMERA_KEYS: Record<string, CameraMode> = { Digit1: 'chase', Digit2: 'cockpit', Digit3: 'free' }

function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
  )
}

/** Returns true when the key was handled. Exported for tests. */
export function handleHotkey(code: string): boolean {
  const s = useGameStore.getState()
  if (code === 'KeyM' && s.overlay === 'map') {
    s.closeOverlay()
    return true
  }
  if (code === 'Escape' || code === 'KeyP') {
    if (s.overlay !== 'none') s.closeOverlay()
    else if (s.screen === 'flight') s.togglePause()
    else if ((s.screen === 'modeSelect' || s.screen === 'flightSchool') && code === 'Escape') s.goToMainMenu()
    else return false
    return true
  }
  const inFlight = s.screen === 'flight' || s.screen === 'results'
  if (!inFlight || s.overlay !== 'none') return false
  if (code === 'KeyC') s.cycleCamera()
  else if (CAMERA_KEYS[code]) s.setCameraMode(CAMERA_KEYS[code])
  else if (code === 'KeyH') s.toggleHud()
  else if (code === 'KeyI') s.toggleInstruments()
  else if (code === 'KeyM') s.openOverlay('map')
  else if (code === 'Digit0' || code === 'Numpad0') useAutopilotStore.getState().requestAssist()
  else return false
  return true
}

export function useHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTextInput(e.target) && e.code !== 'Escape') return
      if (handleHotkey(e.code)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
