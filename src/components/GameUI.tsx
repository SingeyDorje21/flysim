import { useId, useState, type ReactNode } from 'react'
import { QUALITY_LEVELS } from '../config/quality'
import { GAME_MODES } from '../game/modes'
import { CAMERA_MODES } from '../game/types'
import { useGameStore, type Units } from '../state/gameStore'
import { TIMES_OF_DAY } from '../world/types'
import { AirportPicker, SelectionSummary } from './AirportPicker'
import { AFTERBURNER_NOTE, ALL_BINDINGS } from './controlsData'
import { formatStat, formatTime } from './format'
import { Hangar } from './Hangar'
import { HowItWorks } from './HowItWorks'
import { Hud } from './Hud'
import { InstrumentPanel } from './Instruments'
import { WorldMap } from './WorldMap'
import './GameUI.css'

const AIRPORT_MODES: ReadonlySet<string> = new Set(['freeFlight', 'takeoff', 'landing'])

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

function MainMenu() {
  const goToModeSelect = useGameStore((s) => s.goToModeSelect)
  const startFlight = useGameStore((s) => s.startFlight)
  const openOverlay = useGameStore((s) => s.openOverlay)
  return (
    <div className="screen screen-center">
      <div className="panel menu-panel">
        <h1 className="title">FlySim</h1>
        <p className="subtitle">Island flight simulator</p>
        <div className="menu-buttons">
          <button type="button" className="btn primary" onClick={goToModeSelect}>
            Fly
          </button>
          <button type="button" className="btn" onClick={() => startFlight('freeFlight')}>
            Quick Flight
          </button>
          <button type="button" className="btn" onClick={() => openOverlay('howItWorks')}>
            How It Works
          </button>
          <button type="button" className="btn" onClick={() => openOverlay('settings')}>
            Settings
          </button>
          <button type="button" className="btn" onClick={() => openOverlay('controls')}>
            Controls
          </button>
        </div>
      </div>
    </div>
  )
}

function ModeSelect() {
  const startFlight = useGameStore((s) => s.startFlight)
  const goToMainMenu = useGameStore((s) => s.goToMainMenu)
  const bestScores = useGameStore((s) => s.bestScores)
  return (
    <div className="screen screen-scroll">
      <div className="mode-header">
        <h2>Choose a mode</h2>
        <button type="button" className="btn" onClick={goToMainMenu}>
          Back
        </button>
      </div>
      <Hangar />
      <AirportPicker />
      <div className="mode-grid">
        {GAME_MODES.map((m) => {
          const best = bestScores[m.id]
          return (
            <article key={m.id} className="panel mode-card" aria-label={m.name}>
              <h3>{m.name}</h3>
              <p className="tagline">{m.tagline}</p>
              <p className="desc">{m.description}</p>
              <ul className="objectives">
                {m.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
              {AIRPORT_MODES.has(m.id) && (
                <SelectionSummary label={m.id === 'landing' ? 'Destination' : 'Airport'} />
              )}
              <dl className="mode-meta">
                <div>
                  <dt>Time limit</dt>
                  <dd>{m.timeLimit === null ? 'None' : formatTime(m.timeLimit)}</dd>
                </div>
                <div>
                  <dt>Best score</dt>
                  <dd>{best === undefined ? '—' : Math.round(best)}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="btn primary"
                aria-label={`Start ${m.name}`}
                onClick={() => startFlight(m.id)}
              >
                Start
              </button>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function PauseMenu() {
  const resume = useGameStore((s) => s.resume)
  const restartFlight = useGameStore((s) => s.restartFlight)
  const openOverlay = useGameStore((s) => s.openOverlay)
  const quitToMenu = useGameStore((s) => s.quitToMenu)
  return (
    <div className="screen screen-center scrim" role="dialog" aria-modal="true" aria-label="Paused">
      <div className="panel menu-panel">
        <h2>Paused</h2>
        <div className="menu-buttons">
          <button type="button" className="btn primary" autoFocus onClick={resume}>
            Resume
          </button>
          <button type="button" className="btn" onClick={restartFlight}>
            Restart
          </button>
          <button type="button" className="btn" onClick={() => openOverlay('settings')}>
            Settings
          </button>
          <button type="button" className="btn" onClick={() => openOverlay('controls')}>
            Controls
          </button>
          <button type="button" className="btn" onClick={() => openOverlay('howItWorks')}>
            How It Works
          </button>
          <button type="button" className="btn danger" onClick={quitToMenu}>
            Main Menu
          </button>
        </div>
      </div>
    </div>
  )
}

function Results() {
  const result = useGameStore((s) => s.result)
  const newBest = useGameStore((s) => s.newBest)
  const bestScores = useGameStore((s) => s.bestScores)
  const units = useGameStore((s) => s.settings.units)
  const restartFlight = useGameStore((s) => s.restartFlight)
  const goToModeSelect = useGameStore((s) => s.goToModeSelect)
  const quitToMenu = useGameStore((s) => s.quitToMenu)
  if (!result) return null
  const best = bestScores[result.mode]
  return (
    <div className="screen screen-center scrim">
      <div className={`panel results-panel outcome-${result.outcome}`}>
        <div className="outcome-tag">{result.outcome === 'success' ? 'Success' : 'Failed'}</div>
        <h2>{result.headline}</h2>
        {result.reason && <p className="reason">{result.reason}</p>}
        <div className="score-row">
          <div className="score">
            <span className="score-label">Score</span>
            <span className="score-value" data-testid="result-score">
              {Math.round(result.score)}
            </span>
          </div>
          {newBest && <span className="badge">New best!</span>}
          {best !== undefined && (
            <div className="score">
              <span className="score-label">Best</span>
              <span className="score-value small" data-testid="result-best">
                {Math.round(best)}
              </span>
            </div>
          )}
        </div>
        <dl className="stats">
          <div>
            <dt>Time</dt>
            <dd>{formatTime(result.timeSec)}</dd>
          </div>
          {result.stats.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{formatStat(s, units)}</dd>
            </div>
          ))}
        </dl>
        <div className="menu-buttons row">
          <button type="button" className="btn primary" autoFocus onClick={restartFlight}>
            Retry
          </button>
          <button type="button" className="btn" onClick={goToModeSelect}>
            Choose Mode
          </button>
          <button type="button" className="btn" onClick={quitToMenu}>
            Main Menu
          </button>
        </div>
      </div>
    </div>
  )
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: readonly T[]
  onChange(value: T): void
}

function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          className={o === value ? 'seg-btn active' : 'seg-btn'}
          onClick={() => onChange(o)}
        >
          {cap(o)}
        </button>
      ))}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
    </div>
  )
}

const UNITS: readonly Units[] = ['imperial', 'metric']

function SettingsPanel() {
  const settings = useGameStore((s) => s.settings)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const resetSettings = useGameStore((s) => s.resetSettings)
  const clearBestScores = useGameStore((s) => s.clearBestScores)
  const closeOverlay = useGameStore((s) => s.closeOverlay)
  const [confirming, setConfirming] = useState(false)
  const uid = useId()
  return (
    <div className="screen screen-center scrim overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="panel dialog-panel">
        <h2>Settings</h2>
        <Field label="Graphics quality">
          <Segmented
            label="Graphics quality"
            value={settings.quality}
            options={QUALITY_LEVELS}
            onChange={(quality) => updateSettings({ quality })}
          />
        </Field>
        <Field label="Units">
          <Segmented
            label="Units"
            value={settings.units}
            options={UNITS}
            onChange={(units) => updateSettings({ units })}
          />
        </Field>
        <Field label="Time of day">
          <Segmented
            label="Time of day"
            value={settings.timeOfDay}
            options={TIMES_OF_DAY}
            onChange={(timeOfDay) => updateSettings({ timeOfDay })}
          />
        </Field>
        <Field label="Default camera">
          <Segmented
            label="Default camera"
            value={settings.defaultCamera}
            options={CAMERA_MODES}
            onChange={(defaultCamera) => updateSettings({ defaultCamera })}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.invertPitch}
            onChange={(e) => updateSettings({ invertPitch: e.target.checked })}
          />
          Invert pitch
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.showHud}
            onChange={(e) => updateSettings({ showHud: e.target.checked })}
          />
          Show HUD
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.showInstruments}
            onChange={(e) => updateSettings({ showInstruments: e.target.checked })}
          />
          Show instruments
        </label>
        <div className="field">
          <label className="field-label" htmlFor={`${uid}-sens`}>
            Mouse sensitivity: {settings.mouseSensitivity.toFixed(1)}x
          </label>
          <input
            id={`${uid}-sens`}
            type="range"
            min={0.2}
            max={3}
            step={0.1}
            value={settings.mouseSensitivity}
            onChange={(e) => updateSettings({ mouseSensitivity: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${uid}-vol`}>
            Sound volume: {settings.masterVolume === 0 ? 'muted' : `${Math.round(settings.masterVolume * 100)}%`}
          </label>
          <input
            id={`${uid}-vol`}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.masterVolume}
            onChange={(e) => updateSettings({ masterVolume: Number(e.target.value) })}
          />
        </div>
        <div className="menu-buttons row">
          <button type="button" className="btn" onClick={resetSettings}>
            Reset to defaults
          </button>
          {confirming ? (
            <span className="confirm" role="group" aria-label="Confirm clearing best scores">
              <span>Clear all best scores?</span>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  clearBestScores()
                  setConfirming(false)
                }}
              >
                Yes, clear
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirming(true)}>
              Clear best scores
            </button>
          )}
        </div>
        <div className="menu-buttons row">
          <button type="button" className="btn primary" onClick={closeOverlay}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function ControlsPanel() {
  const closeOverlay = useGameStore((s) => s.closeOverlay)
  return (
    <div className="screen screen-center scrim overlay" role="dialog" aria-modal="true" aria-label="Controls">
      <div className="panel dialog-panel">
        <h2>Controls</h2>
        <table className="controls-table">
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Keys</th>
            </tr>
          </thead>
          <tbody>
            {ALL_BINDINGS.map(({ action, keys }) => (
              <tr key={action}>
                <th scope="row">{action}</th>
                <td>{keys}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">Hold the mouse button and drag to look around in free camera mode.</p>
        <p className="note">{AFTERBURNER_NOTE}</p>
        <div className="menu-buttons row">
          <button type="button" className="btn primary" autoFocus onClick={closeOverlay}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/** All DOM UI. Renders from store state; HUD and instruments subscribe to telemetry themselves. */
export function GameUI() {
  const screen = useGameStore((s) => s.screen)
  const overlay = useGameStore((s) => s.overlay)
  const paused = useGameStore((s) => s.paused)
  const showHud = useGameStore((s) => s.settings.showHud)
  const showInstruments = useGameStore((s) => s.settings.showInstruments)

  return (
    <div className="game-ui">
      {screen === 'mainMenu' && <MainMenu />}
      {screen === 'modeSelect' && <ModeSelect />}
      {screen === 'flight' && (
        <>
          {showHud && <Hud />}
          {showInstruments && <InstrumentPanel />}
          {paused && <PauseMenu />}
        </>
      )}
      {screen === 'results' && <Results />}
      {overlay === 'settings' && <SettingsPanel />}
      {overlay === 'controls' && <ControlsPanel />}
      {overlay === 'howItWorks' && <HowItWorks />}
      {overlay === 'map' && <WorldMap />}
    </div>
  )
}
