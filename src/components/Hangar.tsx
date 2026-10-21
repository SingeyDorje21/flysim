import { useState } from 'react'
import { AIRCRAFT, type AircraftId, type AircraftInfo } from '../config/aircraftCatalog'
import { useGameStore } from '../state/gameStore'

/** Simple top-view silhouettes (viewBox 100x60, nose to the right). No logos. */
const SILHOUETTES: Record<AircraftId, string> = {
  // Light single: straight high wing, small tail, prop disc.
  trainer: 'M8 30 L30 27 L38 6 L46 6 L46 27 L78 29 L92 30 L78 31 L46 33 L46 54 L38 54 L30 33 Z M8 22 L10 22 L10 38 L8 38 Z',
  // Delta-ish twin-tail fighter.
  f22: 'M96 30 L72 26 L50 8 L34 8 L42 26 L20 24 L8 18 L6 24 L14 30 L6 36 L8 42 L20 36 L42 34 L34 52 L50 52 L72 34 Z',
  // Narrow-body twin with swept wing.
  a220: 'M96 30 C90 27 80 27 70 27 L44 8 L36 8 L46 27 L14 27 L6 20 L4 20 L8 30 L4 40 L6 40 L14 33 L46 33 L36 52 L44 52 L70 33 C80 33 90 33 96 30 Z',
  // Wide-body twin, longer, bigger sweep.
  a350: 'M98 30 C92 27 82 27 70 27 L40 4 L30 4 L42 27 L12 27 L4 19 L2 19 L7 30 L2 41 L4 41 L12 33 L42 33 L30 56 L40 56 L70 33 C82 33 92 33 98 30 Z',
  // Business jet: aft engines, swept wing, T-tail.
  global8000: 'M96 30 C90 28 80 28 68 28 L46 10 L38 10 L48 28 L18 28 L10 20 L6 20 L8 28 L14 28 L14 32 L8 32 L6 40 L10 40 L18 32 L48 32 L38 50 L46 50 L68 32 C80 32 90 32 96 30 Z',
}

export function AircraftIcon({ id }: { id: AircraftId }) {
  return (
    <svg className="aircraft-icon" viewBox="0 0 100 60" role="img" aria-label="" aria-hidden="true">
      <path d={SILHOUETTES[id]} />
    </svg>
  )
}

function AircraftCard({ a, selected, onSelect }: { a: AircraftInfo; selected: boolean; onSelect: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <article
      className={selected ? 'aircraft-card selected' : 'aircraft-card'}
      aria-label={a.name}
      data-testid={`aircraft-card-${a.id}`}
      data-selected={selected ? 'true' : 'false'}
    >
      <div className="aircraft-head">
        <AircraftIcon id={a.id} />
        <div>
          <h4>{a.name}</h4>
          <div className="aircraft-sub">
            {a.manufacturer} · {a.role}
          </div>
        </div>
      </div>
      <p className="aircraft-blurb">{a.blurb}</p>
      <button
        type="button"
        className="link-btn"
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} specs for ${a.name}`}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide specs' : 'Specs'}
      </button>
      {open && (
        <>
          <dl className="aircraft-specs">
            {a.specs.map((s) => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd>{s.value}</dd>
              </div>
            ))}
          </dl>
          <p className="aircraft-sources">Sources: {a.sources.join('; ')}</p>
        </>
      )}
      <button
        type="button"
        className={selected ? 'btn primary' : 'btn'}
        aria-pressed={selected}
        aria-label={`Select ${a.name}`}
        onClick={onSelect}
      >
        {selected ? 'Selected' : 'Select'}
      </button>
    </article>
  )
}

/** Aircraft picker ("hangar"): one card per type; the choice persists in the game store. */
export function Hangar() {
  const aircraftId = useGameStore((s) => s.aircraftId)
  const selectAircraft = useGameStore((s) => s.selectAircraft)
  return (
    <section className="panel hangar" aria-label="Hangar">
      <div className="picker-head">
        <h3>Hangar</h3>
      </div>
      <div className="aircraft-grid">
        {AIRCRAFT.map((a) => (
          <AircraftCard key={a.id} a={a} selected={a.id === aircraftId} onSelect={() => selectAircraft(a.id)} />
        ))}
      </div>
    </section>
  )
}
