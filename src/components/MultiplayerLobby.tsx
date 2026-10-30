import { useId, useState, type FormEvent } from 'react'
import { AIRCRAFT_IDS, getAircraft, type AircraftId } from '../config/aircraftCatalog'
import { isValidRoomCode, normalizeRoomCode } from '../net/protocol'
import { useGameStore } from '../state/gameStore'
import { enterMultiplayerFlight, useMultiplayerStore } from '../state/multiplayerStore'
import './Multiplayer.css'

/** Copy the room code; shows whether it worked. */
export function CopyCode({ code }: { code: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = () => {
    const done = navigator.clipboard?.writeText(code)
    if (!done) return setState('failed')
    done.then(
      () => setState('copied'),
      () => setState('failed'),
    )
  }
  return (
    <button type="button" className="btn mp-copy" onClick={copy} aria-label={`Copy room code ${code}`}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
  )
}

/** Room created: share the code, then take off. */
function RoomReady() {
  const code = useMultiplayerStore((s) => s.code)
  const roster = useMultiplayerStore((s) => s.roster)
  const myId = useMultiplayerStore((s) => s.myId)
  const leaveRoom = useMultiplayerStore((s) => s.leaveRoom)
  if (!code) return null
  return (
    <div className="mp-ready">
      <div className="field-label">Room code - share it with the other pilots</div>
      <div className="mp-code-row">
        <output className="mp-code" data-testid="room-code">
          {code}
        </output>
        <CopyCode code={code} />
      </div>
      <ul className="mp-roster" aria-label="Pilots in the room">
        {roster.map((p) => (
          <li key={p.id}>
            {p.name}
            {p.id === myId && <span className="mp-you"> (you)</span>}
            <span className="mp-roster-aircraft">{getAircraft(p.aircraftId).name}</span>
          </li>
        ))}
      </ul>
      <div className="menu-buttons">
        <button type="button" className="btn primary" autoFocus onClick={enterMultiplayerFlight}>
          Take off
        </button>
        <button type="button" className="btn" onClick={leaveRoom}>
          Leave room
        </button>
      </div>
    </div>
  )
}

/** Multiplayer screen: pilot name, aircraft, then create a room or join one by code. */
export function MultiplayerLobby() {
  const status = useMultiplayerStore((s) => s.status)
  const errorMessage = useMultiplayerStore((s) => s.errorMessage)
  const playerName = useMultiplayerStore((s) => s.playerName)
  const setPlayerName = useMultiplayerStore((s) => s.setPlayerName)
  const createRoom = useMultiplayerStore((s) => s.createRoom)
  const joinRoom = useMultiplayerStore((s) => s.joinRoom)
  const clearError = useMultiplayerStore((s) => s.clearError)
  const aircraftId = useGameStore((s) => s.aircraftId)
  const selectAircraft = useGameStore((s) => s.selectAircraft)
  const goToMainMenu = useGameStore((s) => s.goToMainMenu)
  const [code, setCode] = useState('')
  const [codeTouched, setCodeTouched] = useState(false)
  const uid = useId()

  const busy = status === 'connecting'
  const inRoom = status === 'inRoom' || status === 'reconnecting'
  const codeOk = isValidRoomCode(normalizeRoomCode(code))

  const onJoin = (e: FormEvent) => {
    e.preventDefault()
    setCodeTouched(true)
    if (codeOk) joinRoom(code, aircraftId)
  }

  return (
    <div className="screen screen-center">
      <div className="panel menu-panel mp-lobby" role="region" aria-label="Multiplayer">
        <h2>Multiplayer</h2>
        <p className="mp-intro">
          Fly the island together. Touch another aircraft and you both crash, and both your flying times reset to zero.
        </p>

        {inRoom ? (
          <RoomReady />
        ) : (
          <>
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

            <div className="mp-actions">
              <button type="button" className="btn primary" disabled={busy} onClick={() => createRoom(aircraftId)}>
                Create room
              </button>
              <form className="mp-join" onSubmit={onJoin} noValidate>
                <label className="field" htmlFor={`${uid}-code`}>
                  <span className="field-label">Room code</span>
                  <input
                    id={`${uid}-code`}
                    className="mp-input mp-code-input"
                    value={code}
                    maxLength={9}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="ABC234"
                    disabled={busy}
                    aria-invalid={codeTouched && !codeOk}
                    aria-describedby={`${uid}-code-hint`}
                    onChange={(e) => {
                      setCode(e.target.value)
                      clearError()
                    }}
                    onBlur={() => setCodeTouched(code.length > 0)}
                  />
                </label>
                <span id={`${uid}-code-hint`} className="mp-hint">
                  {codeTouched && !codeOk ? 'Codes are 6 letters and digits, like ABC234.' : ''}
                </span>
                <button type="submit" className="btn" disabled={busy}>
                  Join
                </button>
              </form>
            </div>
          </>
        )}

        <p className="mp-status" role="status">
          {busy ? 'Connecting...' : status === 'reconnecting' ? 'Reconnecting...' : ''}
        </p>
        {errorMessage && (
          <p className="mp-error" role="alert">
            {errorMessage}
          </p>
        )}

        <button type="button" className="btn ghost" onClick={goToMainMenu}>
          Back
        </button>
      </div>
    </div>
  )
}
