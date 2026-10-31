import { useEffect, useId, useState, type FormEvent } from 'react'
import { AIRCRAFT_IDS, getAircraft, type AircraftId } from '../config/aircraftCatalog'
import { getAirport } from '../config/airports'
import { getRunwayEnd } from '../game/airportGeometry'
import { multiplayerRunwayAhead } from '../game/spawns'
import { useGameStore } from '../state/gameStore'
import { useMultiplayerStore } from '../state/multiplayerStore'
import { AirportPicker } from './AirportPicker'
import { formatRunwayLength, shortAircraftName } from './format'
import './Multiplayer.css'

/** After this long still connecting, explain that the server may be waking up. */
const WAKE_HINT_MS = 4000

/** Multiplayer screen: pilot name, aircraft and airport, then join the one shared sky. */
export function MultiplayerLobby() {
  const status = useMultiplayerStore((s) => s.status)
  const errorMessage = useMultiplayerStore((s) => s.errorMessage)
  const playerName = useMultiplayerStore((s) => s.playerName)
  const setPlayerName = useMultiplayerStore((s) => s.setPlayerName)
  const joinSky = useMultiplayerStore((s) => s.joinSky)
  const clearError = useMultiplayerStore((s) => s.clearError)
  const aircraftId = useGameStore((s) => s.aircraftId)
  const selectAircraft = useGameStore((s) => s.selectAircraft)
  const airportId = useGameStore((s) => s.airportId)
  const runwayEnd = useGameStore((s) => s.runwayEnd)
  const goToMainMenu = useGameStore((s) => s.goToMainMenu)
  const units = useGameStore((s) => s.settings.units)
  const uid = useId()

  const length = getRunwayEnd(airportId, runwayEnd).runway.def.length
  const ahead = multiplayerRunwayAhead(length, aircraftId)
  const where = `runway ${runwayEnd} at ${getAirport(airportId).name}`
  const spawn =
    ahead === length / 2
      ? `Spawn: middle of ${where}`
      : `Spawn: ${where}, ${formatRunwayLength(ahead, units)} from its end (the ${shortAircraftName(getAircraft(aircraftId).name)} needs more than half)`

  const busy = status === 'connecting'
  // A free-tier server sleeps when idle and takes a while to wake: say so instead of looking stuck.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => setSlow(true), WAKE_HINT_MS)
    return () => {
      clearTimeout(t)
      setSlow(false)
    }
  }, [busy])

  const onJoin = (e: FormEvent) => {
    e.preventDefault()
    joinSky(aircraftId)
  }

  return (
    <div className="screen screen-scroll">
      <div className="mode-header">
        <h2>Multiplayer</h2>
        <button type="button" className="btn" onClick={goToMainMenu}>
          Back
        </button>
      </div>

      <form className="panel mp-lobby" role="region" aria-label="Multiplayer" onSubmit={onJoin} noValidate>
        <p className="mp-intro">
          One sky for everyone online. Your score is flying time times your multiplier: clean take-offs and soft
          landings raise it. Crash or touch another aircraft and it resets to zero. Hold Tab in flight to see
          everyone&apos;s score.
        </p>
        <div className="mp-fields">
          <label className="field" htmlFor={`${uid}-name`}>
            <span className="field-label">Pilot name</span>
            <input
              id={`${uid}-name`}
              className="mp-input"
              value={playerName}
              maxLength={16}
              autoComplete="nickname"
              placeholder="Your call sign"
              disabled={busy}
              onChange={(e) => {
                setPlayerName(e.target.value)
                clearError()
              }}
            />
          </label>
          <label className="field" htmlFor={`${uid}-aircraft`}>
            <span className="field-label">Aircraft</span>
            <select
              id={`${uid}-aircraft`}
              className="mp-input"
              value={aircraftId}
              disabled={busy}
              onChange={(e) => selectAircraft(e.target.value as AircraftId)}
            >
              {AIRCRAFT_IDS.map((id) => (
                <option key={id} value={id}>
                  {getAircraft(id).name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </form>

      <AirportPicker />

      <div className="panel mp-join-bar">
        <span className="mp-join-where">{spawn}</span>
        <button type="button" className="btn primary" disabled={busy} onClick={() => joinSky(aircraftId)}>
          Join the sky
        </button>
        <p className="mp-status" role="status">
          {busy ? (slow ? 'Waking up the multiplayer server... this can take up to a minute.' : 'Connecting...') : ''}
        </p>
        {errorMessage && (
          <p className="mp-error" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  )
}
