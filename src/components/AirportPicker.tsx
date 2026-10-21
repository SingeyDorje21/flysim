import { AIRPORTS, AIRPORT_CLASS_LABEL, getAirport } from '../config/airports'
import { runwayEnds } from '../game/airportGeometry'
import { useGameStore } from '../state/gameStore'
import { formatDistance } from './format'

/** Choose an airport and a runway end (shared selection in the game store). */
export function AirportPicker() {
  const airportId = useGameStore((s) => s.airportId)
  const runwayEnd = useGameStore((s) => s.runwayEnd)
  const units = useGameStore((s) => s.settings.units)
  const selectAirport = useGameStore((s) => s.selectAirport)
  const openOverlay = useGameStore((s) => s.openOverlay)
  const current = getAirport(airportId)
  const ends = runwayEnds(current)

  return (
    <section className="panel airport-picker" aria-label="Airport selection">
      <div className="picker-head">
        <h3>Airport</h3>
        <button type="button" className="btn" onClick={() => openOverlay('map')}>
          World map
        </button>
      </div>
      <div className="airport-list" role="radiogroup" aria-label="Airport">
        {AIRPORTS.map((a) => {
          const [a1, a2] = runwayEnds(a)
          const active = a.id === airportId
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${a.code} ${a.name}`}
              className={active ? 'airport-opt active' : 'airport-opt'}
              onClick={() => selectAirport(a.id)}
            >
              <span className="airport-code">{a.code}</span>
              <span className="airport-name">{a.name}</span>
              <span className="airport-meta">
                {AIRPORT_CLASS_LABEL[a.class]} · RWY {a1.designator}/{a2.designator} · {formatDistance(a.runway.length, units)}
              </span>
            </button>
          )
        })}
      </div>
      <div className="field">
        <span className="field-label">Runway end</span>
        <div className="seg" role="radiogroup" aria-label="Runway end">
          {ends.map((e) => (
            <button
              key={e.designator}
              type="button"
              role="radio"
              aria-checked={e.designator === runwayEnd}
              aria-label={`Runway ${e.designator}`}
              className={e.designator === runwayEnd ? 'seg-btn active' : 'seg-btn'}
              onClick={() => selectAirport(airportId, e.designator)}
            >
              {e.designator}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

/** One-line summary of the selection, e.g. "FSCF Central Field · RWY 36". */
export function SelectionSummary({ label }: { label: string }) {
  const airportId = useGameStore((s) => s.airportId)
  const runwayEnd = useGameStore((s) => s.runwayEnd)
  const a = getAirport(airportId)
  return (
    <p className="selection-line" data-testid="selection-line">
      {label}: {a.code} {a.name} · RWY {runwayEnd}
    </p>
  )
}
