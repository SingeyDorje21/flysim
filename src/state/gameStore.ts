/**
 * Low-frequency application state: screens, overlays, pause, camera mode,
 * settings and best scores. High-frequency flight data lives in telemetry.ts.
 * Owned by the orchestrator; UI components call these actions directly.
 */

import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { QUALITY_LEVELS, type Quality } from '../config/quality'
import { GAME_MODES } from '../game/modes'
import { CAMERA_MODES, type CameraMode, type FlightResult, type GameMode } from '../game/types'

export type Screen = 'mainMenu' | 'modeSelect' | 'flight' | 'results'
/** Modal panels that can sit on top of any screen. */
export type Overlay = 'none' | 'settings' | 'controls'
/** imperial = knots, feet, ft/min. metric = km/h, metres, m/s. */
export type Units = 'imperial' | 'metric'

export interface Settings {
  quality: Quality
  units: Units
  /** When true, Up/W pulls the nose up instead of pushing it down. */
  invertPitch: boolean
  showHud: boolean
  /** Cockpit instrument panel overlay. */
  showInstruments: boolean
  /** Camera used when a flight starts. */
  defaultCamera: CameraMode
  /** Free-look mouse sensitivity multiplier, 0.2..3. */
  mouseSensitivity: number
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'medium',
  units: 'imperial',
  invertPitch: false,
  showHud: true,
  showInstruments: true,
  defaultCamera: 'chase',
  mouseSensitivity: 1,
}

export interface GameState {
  screen: Screen
  overlay: Overlay
  mode: GameMode
  /** Only meaningful while screen === 'flight'. */
  paused: boolean
  cameraMode: CameraMode
  /** Increments on every start and restart; the flight session resets when it changes. */
  flightId: number
  result: FlightResult | null
  /** True when `result` set a new best score for its mode. */
  newBest: boolean
  bestScores: Partial<Record<GameMode, number>>
  settings: Settings

  goToMainMenu(): void
  goToModeSelect(): void
  openOverlay(overlay: Exclude<Overlay, 'none'>): void
  closeOverlay(): void
  startFlight(mode: GameMode): void
  restartFlight(): void
  pause(): void
  resume(): void
  togglePause(): void
  quitToMenu(): void
  /** Called by the session when a flight ends. Ignored unless a flight is running. */
  finishFlight(result: FlightResult): void
  setCameraMode(mode: CameraMode): void
  cycleCamera(): void
  updateSettings(patch: Partial<Settings>): void
  resetSettings(): void
  toggleHud(): void
  toggleInstruments(): void
  clearBestScores(): void
}

const memoryStorage = new Map<string, string>()

/** localStorage when available, in-memory otherwise (tests, private mode). */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      const value = globalThis.localStorage?.getItem(name)
      if (value != null) return value
    } catch {
      // storage blocked
    }
    return memoryStorage.get(name) ?? null
  },
  setItem: (name, value) => {
    memoryStorage.set(name, value)
    try {
      globalThis.localStorage?.setItem(name, value)
    } catch {
      // storage blocked or full
    }
  },
  removeItem: (name) => {
    memoryStorage.delete(name)
    try {
      globalThis.localStorage?.removeItem(name)
    } catch {
      // storage blocked
    }
  },
}

type PersistedSlice = Pick<GameState, 'settings' | 'bestScores'>

const UNITS: readonly Units[] = ['imperial', 'metric']

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Stored data may be stale or hand-edited: keep only valid fields, default the rest. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const sens = r.mouseSensitivity
  return {
    quality: oneOf(r.quality, QUALITY_LEVELS, d.quality),
    units: oneOf(r.units, UNITS, d.units),
    invertPitch: bool(r.invertPitch, d.invertPitch),
    showHud: bool(r.showHud, d.showHud),
    showInstruments: bool(r.showInstruments, d.showInstruments),
    defaultCamera: oneOf(r.defaultCamera, CAMERA_MODES, d.defaultCamera),
    mouseSensitivity:
      typeof sens === 'number' && Number.isFinite(sens) ? Math.min(3, Math.max(0.2, sens)) : d.mouseSensitivity,
  }
}

export function sanitizeBestScores(raw: unknown): Partial<Record<GameMode, number>> {
  const out: Partial<Record<GameMode, number>> = {}
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  for (const { id } of GAME_MODES) {
    const v = r[id]
    if (typeof v === 'number' && Number.isFinite(v)) out[id] = v
  }
  return out
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      screen: 'mainMenu',
      overlay: 'none',
      mode: 'freeFlight',
      paused: false,
      cameraMode: DEFAULT_SETTINGS.defaultCamera,
      flightId: 0,
      result: null,
      newBest: false,
      bestScores: {},
      settings: DEFAULT_SETTINGS,

      goToMainMenu: () => set({ screen: 'mainMenu', overlay: 'none', paused: false, result: null, newBest: false }),
      goToModeSelect: () =>
        set({ screen: 'modeSelect', overlay: 'none', paused: false, result: null, newBest: false }),
      openOverlay: (overlay) => set({ overlay }),
      closeOverlay: () => set({ overlay: 'none' }),

      startFlight: (mode) =>
        set((s) => ({
          screen: 'flight',
          overlay: 'none',
          mode,
          paused: false,
          result: null,
          newBest: false,
          cameraMode: s.settings.defaultCamera,
          flightId: s.flightId + 1,
        })),

      /** Only from a running flight or its results; elsewhere there is nothing to restart. */
      restartFlight: () => {
        const s = get()
        if (s.screen !== 'flight' && s.screen !== 'results') return
        set({ screen: 'flight', overlay: 'none', paused: false, result: null, newBest: false, flightId: s.flightId + 1 })
      },

      pause: () => {
        if (get().screen === 'flight') set({ paused: true })
      },
      resume: () => set({ paused: false, overlay: 'none' }),
      togglePause: () => {
        const s = get()
        if (s.screen !== 'flight') return
        set(s.paused ? { paused: false, overlay: 'none' } : { paused: true })
      },

      quitToMenu: () => set({ screen: 'mainMenu', overlay: 'none', paused: false, result: null, newBest: false }),

      finishFlight: (result) => {
        const s = get()
        if (s.screen !== 'flight') return
        const best = s.bestScores[result.mode]
        const newBest = result.outcome === 'success' && (best === undefined || result.score > best)
        set({
          screen: 'results',
          overlay: 'none',
          paused: false,
          result,
          newBest,
          bestScores: newBest ? { ...s.bestScores, [result.mode]: result.score } : s.bestScores,
        })
      },

      setCameraMode: (cameraMode) => set({ cameraMode }),
      cycleCamera: () =>
        set((s) => ({
          cameraMode: CAMERA_MODES[(CAMERA_MODES.indexOf(s.cameraMode) + 1) % CAMERA_MODES.length],
        })),

      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
      toggleHud: () => set((s) => ({ settings: { ...s.settings, showHud: !s.settings.showHud } })),
      toggleInstruments: () =>
        set((s) => ({ settings: { ...s.settings, showInstruments: !s.settings.showInstruments } })),
      clearBestScores: () => set({ bestScores: {} }),
    }),
    {
      name: 'flysim-v1',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s): PersistedSlice => ({ settings: s.settings, bestScores: s.bestScores }),
      // Validate field by field: settings added later get their defaults and
      // corrupt values never reach the renderer.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Record<keyof PersistedSlice, unknown>>
        const settings = sanitizeSettings(p.settings)
        return {
          ...current,
          bestScores: sanitizeBestScores(p.bestScores),
          settings,
          cameraMode: settings.defaultCamera,
        }
      },
    },
  ),
)
