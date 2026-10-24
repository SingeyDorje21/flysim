import { useRef, type CSSProperties, type PointerEvent } from 'react'
import { AIRCRAFT_IDS, getAircraft } from '../config/aircraftCatalog'
import { getAirport } from '../config/airports'
import { GAME_MODES } from '../game/modes'
import { useGameStore } from '../state/gameStore'
import { TIMES_OF_DAY } from '../world/types'
import { AircraftIcon } from './Hangar'
import './MainMenu.css'

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

interface Action {
  label: string
  hint?: string
  run(): void
}

/** Animated sky behind the menu: pure CSS/SVG, tinted by the chosen time of day. */
function Backdrop() {
  const aircraftId = useGameStore((s) => s.aircraftId)
  return (
    <div className="menu-sky" aria-hidden="true">
      <div className="menu-sun" />
      <div className="menu-clouds far" />
      <div className="menu-clouds near" />
      <svg className="menu-island" viewBox="0 0 1200 200" preserveAspectRatio="none">
        <path d="M0 200 L0 150 C120 140 200 90 320 100 C420 108 470 60 560 70 C660 80 700 130 820 120 C930 110 1010 140 1200 135 L1200 200 Z" />
      </svg>
      <div className="menu-sea" />
      <div className="menu-flyby">
        <AircraftIcon id={aircraftId} />
      </div>
    </div>
  )
}

/** The aircraft, airport and time of day that Quick Flight (and every mode) will use. */
function ReadyCard() {
  const aircraftId = useGameStore((s) => s.aircraftId)
  const airportId = useGameStore((s) => s.airportId)
  const runwayEnd = useGameStore((s) => s.runwayEnd)
  const timeOfDay = useGameStore((s) => s.settings.timeOfDay)
  const selectAircraft = useGameStore((s) => s.selectAircraft)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const aircraft = getAircraft(aircraftId)
  const airport = getAirport(airportId)

  const step = (delta: number) => {
    const i = AIRCRAFT_IDS.indexOf(aircraftId)
    selectAircraft(AIRCRAFT_IDS[(i + delta + AIRCRAFT_IDS.length) % AIRCRAFT_IDS.length])
  }

  return (
    <section className="panel ready-card" aria-label="Ready to fly">
      <div className="ready-label">Ready to fly</div>
      <div className="ready-aircraft">
        <button type="button" className="ready-arrow" aria-label="Previous aircraft" onClick={() => step(-1)}>
          ‹
        </button>
        <div className="ready-plane" key={aircraftId}>
          <AircraftIcon id={aircraftId} />
          <div className="ready-name" data-testid="ready-aircraft">
            {aircraft.name}
          </div>
          <div className="ready-sub">
            {aircraft.manufacturer} · {aircraft.role}
          </div>
        </div>
        <button type="button" className="ready-arrow" aria-label="Next aircraft" onClick={() => step(1)}>
          ›
        </button>
      </div>
      <div className="ready-dots" aria-hidden="true">
        {AIRCRAFT_IDS.map((id) => (
          <span key={id} className={id === aircraftId ? 'dot on' : 'dot'} />
        ))}
      </div>
      <dl className="ready-facts">
        <div>
          <dt>Airport</dt>
          <dd data-testid="ready-airport">
            {airport.code} · {airport.name}
          </dd>
        </div>
        <div>
          <dt>Runway</dt>
          <dd>{runwayEnd}</dd>
        </div>
      </dl>
      <div className="ready-time" role="radiogroup" aria-label="Time of day">
        {TIMES_OF_DAY.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={t === timeOfDay}
            className={t === timeOfDay ? 'time-chip active' : 'time-chip'}
            onClick={() => updateSettings({ timeOfDay: t })}
          >
            {cap(t)}
          </button>
        ))}
      </div>
    </section>
  )
}

function PilotLog() {
  const bestScores = useGameStore((s) => s.bestScores)
  const entries = GAME_MODES.filter((m) => bestScores[m.id] !== undefined)
  return (
    <section className="panel pilot-log" aria-label="Pilot log">
      <div className="ready-label">Pilot log</div>
      {entries.length === 0 ? (
        <p className="log-empty">No scores yet. Finish a challenge or lesson to set your first best.</p>
      ) : (
        <ul className="log-list">
          {entries.map((m) => (
            <li key={m.id}>
              <span>{m.name}</span>
              <span className="log-score">{Math.round(bestScores[m.id] ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Title screen: animated backdrop, main actions, the current flight setup and best scores. */
export function MainMenu() {
  const goToModeSelect = useGameStore((s) => s.goToModeSelect)
  const goToFlightSchool = useGameStore((s) => s.goToFlightSchool)
  const startFlight = useGameStore((s) => s.startFlight)
  const openOverlay = useGameStore((s) => s.openOverlay)
  const timeOfDay = useGameStore((s) => s.settings.timeOfDay)
  const rootRef = useRef<HTMLDivElement>(null)

  const primary: Action[] = [
    { label: 'Fly', hint: 'Pick an aircraft, airport and challenge', run: goToModeSelect },
    { label: 'Flight School', hint: 'Guided lessons: take-off, landing, circuit', run: goToFlightSchool },
    { label: 'Quick Flight', hint: 'Straight onto the runway in your current aircraft', run: () => startFlight('freeFlight') },
  ]
  const secondary: Action[] = [
    { label: 'How It Works', run: () => openOverlay('howItWorks') },
    { label: 'Settings', run: () => openOverlay('settings') },
    { label: 'Controls', run: () => openOverlay('controls') },
  ]

  // Parallax: backdrop layers lean toward the pointer through CSS variables, without re-rendering.
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = rootRef.current
    if (!el || e.pointerType === 'touch') return
    el.style.setProperty('--mx', ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3))
    el.style.setProperty('--my', ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3))
  }

  return (
    <div
      ref={rootRef}
      className={`screen main-menu tod-${timeOfDay}`}
      style={{ '--mx': 0, '--my': 0 } as CSSProperties}
      onPointerMove={onPointerMove}
    >
      <Backdrop />
      <div className="menu-layout">
        <div className="panel menu-hero">
          <h1 className="title">FlySim</h1>
          <p className="subtitle">Island flight simulator</p>
          <div className="menu-actions">
            {primary.map((a, i) => (
              <div key={a.label} className="menu-action">
                <button
                  type="button"
                  className={i === 0 ? 'btn primary menu-btn' : 'btn menu-btn'}
                  autoFocus={i === 0}
                  aria-describedby={`menu-hint-${i}`}
                  onClick={a.run}
                >
                  {a.label}
                </button>
                <span id={`menu-hint-${i}`} className="menu-hint">
                  {a.hint}
                </span>
              </div>
            ))}
          </div>
          <div className="menu-secondary">
            {secondary.map((a) => (
              <button key={a.label} type="button" className="btn ghost" onClick={a.run}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div className="menu-side">
          <ReadyCard />
          <PilotLog />
        </div>
      </div>
    </div>
  )
}
