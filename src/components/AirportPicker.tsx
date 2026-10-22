import { getAircraft } from '../config/aircraftCatalog'
import { AIRPORTS, AIRPORT_CLASS_LABEL, getAirport } from '../config/airports'
import { airportRunways, endsOf, longestRunway, runwayEnds } from '../game/airportGeometry'
import { useGameStore } from '../state/gameStore'
import { formatDistance, formatRunwayLength, shortAircraftName } from './format'
import { MapPreview } from './WorldMap'

/** Choose an airport and a runway end (shared selection in the game store). */
export function AirportPicker() {
  const airportId = useGameStore((s) => s.airportId)
  const runwayEnd = useGameStore((s) => s.runwayEnd)
  const units = useGameStore((s) => s.settings.units)
  const selectAirport = useGameStore((s) => s.selectAirport)
  const openOverlay = useGameStore((s) => s.openOverlay)
  const aircraftId = useGameStore((s) => s.aircraftId)
  const aircraft = getAircraft(aircraftId)
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
      <div className="picker-body">
      <MapPreview minRunway={aircraft.minRunway} />
      <div className="airport-list" role="radiogroup" aria-label="Airport">
        {AIRPORTS.map((a) => {
          const longest = longestRunway(a)
          const pairs = airportRunways(a)
            .map((rw) => endsOf(rw).map((e) => e.designator).join('/'))
            .join(', ')
          const active = a.id === airportId
          const short = longest < aircraft.minRunway
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${a.code} ${a.name}`}
              className={`airport-opt${active ? ' active' : ''}${short ? ' short' : ''}`}
              onClick={() => selectAirport(a.id)}
            >
              <span className="airport-code">{a.code}</span>
              <span className="airport-name">{a.name}</span>
              <span className="airport-meta">
                {AIRPORT_CLASS_LABEL[a.class]} · RWY {pairs} · {formatDistance(longest, units)}
              </span>
              {short && (
                <span className="runway-warning" data-testid={`runway-warning-${a.code}`}>
                  Runway {formatRunwayLength(longest, units)} — {shortAircraftName(aircraft.name)} needs{' '}
                  {formatRunwayLength(aircraft.minRunway, units)}
                </span>
              )}
            </button>
          )
        })}
      </div>
      </div>
      <div className="field">
        <span className="field-label">Runway end</span>
        <div className="seg" role="radiogroup" aria-label="Runway end">
          {ends.map((e) => {
            const length = e.runway.def.length
            const cls = ['seg-btn', e.designator === runwayEnd ? 'active' : '', length < aircraft.minRunway ? 'short' : '']
            return (
              <button
                key={e.designator}
                type="button"
                role="radio"
                aria-checked={e.designator === runwayEnd}
                aria-label={`Runway ${e.designator}`}
                title={formatRunwayLength(length, units)}
                className={cls.filter(Boolean).join(' ')}
                onClick={() => selectAirport(airportId, e.designator)}
              >
                {e.designator}
              </button>
            )
          })}
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
