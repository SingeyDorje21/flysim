import { getAircraft } from '../config/aircraftCatalog'
import { getAirport } from '../config/airports'
import { techniqueFor } from '../game/technique'
import { useGameStore } from '../state/gameStore'
import { flapLabel, formatAltitude, formatSpeed, formatRunwayLength } from './format'
import { Hangar } from './Hangar'

/** Flight School: pick an aircraft, read how to fly it, start a guided lesson. */
export function FlightSchool() {
  const aircraftId = useGameStore((s) => s.aircraftId)
  const units = useGameStore((s) => s.settings.units)
  const startFlight = useGameStore((s) => s.startFlight)
  const goToMainMenu = useGameStore((s) => s.goToMainMenu)
  const tech = techniqueFor(aircraftId)
  const ac = getAircraft(aircraftId)
  const airport = getAirport(tech.lessonPlace.airportId)
  return (
    <div className="screen screen-scroll" data-testid="flight-school">
      <div className="mode-header">
        <h2>Flight School</h2>
        <button type="button" className="btn" onClick={goToMainMenu}>
          Back
        </button>
      </div>
      <Hangar />
      <section className="panel school-card" aria-label="How to fly it">
        <h3>How to fly the {ac.name}</h3>
        <ol className="school-steps">
          <li>
            <strong>Take-off:</strong> flaps <b>{flapLabel(tech.takeoffFlaps)}</b>, full power. Rotate at{' '}
            <b data-testid="tech-rotate">{formatSpeed(tech.rotateSpeed, units)}</b> and raise the nose to{' '}
            <b>{Math.round(tech.rotatePitchDeg)}°</b>.
          </li>
          <li>
            <strong>On the ground</strong> never pitch above{' '}
            <b data-testid="tech-maxpitch">{Math.round(tech.maxGroundPitchDeg)}°</b>: the tail strikes at{' '}
            {Math.round(tech.tailStrikePitchDeg)}°.
          </li>
          <li>
            <strong>Climb</strong> at <b>{Math.round(tech.climbPitchDeg)}°</b>
            {tech.retractableGear ? ', then gear up (G)' : ''}.
          </li>
          <li>
            <strong>Approach</strong> at <b data-testid="tech-approach">{formatSpeed(tech.approachSpeed, units)}</b> with
            flaps <b>{flapLabel(tech.landingFlaps)}</b>
            {tech.retractableGear ? ' and gear down (G)' : ''}.
          </li>
          <li>
            <strong>Flare</strong> at <b>{formatAltitude(tech.flareHeight, units)}</b>: ease the nose up to{' '}
            <b>{Math.round(tech.flarePitchDeg)}°</b> and close the throttle.
          </li>
          {tech.reverse && (
            <li>
              <strong>Reverse thrust</strong> (hold Y) after touchdown, with the brakes.
            </li>
          )}
        </ol>
        {tech.notes.length > 0 && (
          <ul className="school-notes">
            {tech.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <p className="selection-line" data-testid="lesson-place">
          Lesson airport: {airport.code} {airport.name}, runway {tech.lessonPlace.runwayEnd} (
          {formatRunwayLength(airport.runway.length, units)})
        </p>
        <div className="school-actions">
          <button type="button" className="btn primary big" onClick={() => startFlight('lessonTakeoff')}>
            Start Take-off Lesson
          </button>
          <button type="button" className="btn primary big" onClick={() => startFlight('lessonLanding')}>
            Start Landing Lesson
          </button>
        </div>
      </section>
    </div>
  )
}
