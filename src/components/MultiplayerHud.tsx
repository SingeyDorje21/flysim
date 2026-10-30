import { useGameStore } from '../state/gameStore'
import { useMultiplayerStore } from '../state/multiplayerStore'
import { formatTime } from './format'
import { CopyCode } from './MultiplayerLobby'
import './Multiplayer.css'

/** Room code and the airborne-time leaderboard. Toggled with L. */
export function Leaderboard() {
  const code = useMultiplayerStore((s) => s.code)
  const roster = useMultiplayerStore((s) => s.roster)
  const entries = useMultiplayerStore((s) => s.leaderboard)
  const flashUntil = useMultiplayerStore((s) => s.resetFlashUntil)
  const myId = useMultiplayerStore((s) => s.myId)
  const status = useMultiplayerStore((s) => s.status)
  const visible = useMultiplayerStore((s) => s.boardVisible)
  if (!visible || !code) return null

  const now = performance.now()
  const rows = [...entries]
    .sort((a, b) => b.seconds - a.seconds)
    .map((e) => ({
      ...e,
      name: roster.find((p) => p.id === e.id)?.name ?? '?',
      flashing: now < (flashUntil[e.id] ?? 0),
    }))

  return (
    <section className="panel mp-panel" aria-label="Leaderboard" data-testid="mp-leaderboard">
      <div className="mp-panel-head">
        <span>
          Room <span className="mp-panel-code">{code}</span>
        </span>
        <CopyCode code={code} />
      </div>
      <ol className="mp-board">
        {rows.map((r) => (
          <li
            // A new key on every reset restarts the flash animation.
            key={`${r.id}:${r.resets}`}
            className={[r.id === myId ? 'me' : '', r.flashing ? 'reset' : ''].join(' ').trim() || undefined}
            aria-current={r.id === myId ? 'true' : undefined}
          >
            <span className="mp-name">
              {r.name}
              {r.id === myId && <span className="mp-you"> (you)</span>}
            </span>
            <span className="mp-time">{formatTime(r.seconds)}</span>
          </li>
        ))}
      </ol>
      {status === 'reconnecting' ? (
        <p className="mp-panel-warn" role="status">
          Reconnecting...
        </p>
      ) : (
        <p className="mp-panel-note">Time in the air. A mid-air collision resets both pilots to 0:00. L hides this.</p>
      )}
    </section>
  )
}

/** After a crash in a room: respawn at your slot instead of the results screen. */
export function CrashPanel() {
  const reason = useMultiplayerStore((s) => s.crashReason)
  const respawn = useMultiplayerStore((s) => s.respawn)
  const quitToMenu = useGameStore((s) => s.quitToMenu)
  if (!reason) return null
  const midAir = reason.startsWith('Mid-air collision')
  return (
    <div className="screen screen-center scrim" role="dialog" aria-modal="true" aria-label="Crashed">
      <div className="panel menu-panel mp-crash">
        <h2>Crashed</h2>
        <p>{reason}</p>
        <p className="mp-intro">
          {midAir ? 'Both pilots crashed and both flying times were reset.' : 'Your flying time is kept.'}
        </p>
        <div className="menu-buttons">
          <button type="button" className="btn primary" autoFocus onClick={respawn}>
            Respawn
          </button>
          <button type="button" className="btn danger" onClick={quitToMenu}>
            Leave room
          </button>
        </div>
      </div>
    </div>
  )
}

/** The room connection died mid-flight: carry on alone or go back to the menu. */
export function ConnectionLostPanel() {
  const message = useMultiplayerStore((s) => s.errorMessage)
  const continueSolo = useMultiplayerStore((s) => s.continueSolo)
  const quitToMenu = useGameStore((s) => s.quitToMenu)
  return (
    <div className="screen screen-center scrim" role="dialog" aria-modal="true" aria-label="Connection lost">
      <div className="panel menu-panel mp-crash">
        <h2>Connection lost</h2>
        <p>{message ?? 'Lost the connection to the room.'}</p>
        <div className="menu-buttons">
          <button type="button" className="btn primary" autoFocus onClick={continueSolo}>
            Fly solo
          </button>
          <button type="button" className="btn" onClick={quitToMenu}>
            Main Menu
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The multiplayer dialogs over the flight. Mounted while in a room, or after losing it
 * mid-flight. (The leaderboard lives in the HUD's right column, see Hud.tsx.)
 */
export function MultiplayerHud() {
  const connectionLost = useMultiplayerStore((s) => s.connectionLost)
  return connectionLost ? <ConnectionLostPanel /> : <CrashPanel />
}
