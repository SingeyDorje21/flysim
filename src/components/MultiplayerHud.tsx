import { useEffect, useState } from 'react'
import { getAircraft } from '../config/aircraftCatalog'
import { useGameStore } from '../state/gameStore'
import { useMultiplayerStore } from '../state/multiplayerStore'
import { formatTime } from './format'
import './Multiplayer.css'

const formatScore = (score: number) => Math.floor(score).toLocaleString('en-US')
const formatMultiplier = (m: number) => `x${m.toFixed(2).replace(/0$/, '')}`

/** Your own score, always on the HUD while online, plus the latest take-off or landing grade. */
export function ScoreChip() {
  const myId = useMultiplayerStore((s) => s.myId)
  const mine = useMultiplayerStore((s) => s.leaderboard.find((e) => e.id === s.myId))
  const status = useMultiplayerStore((s) => s.status)
  const grade = useMultiplayerStore((s) => s.lastGrade)
  // Re-render when the grade expires.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!grade) return
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, grade.until - performance.now()))
    return () => clearTimeout(t)
  }, [grade])
  if (!myId) return null
  const showGrade = grade && performance.now() < grade.until

  return (
    <section className="panel mp-panel mp-chip" aria-label="Your score" data-testid="mp-score">
      <div className="mp-chip-row">
        <span className="mp-chip-score">{formatScore(mine?.score ?? 0)}</span>
        <span className="mp-chip-mult">{formatMultiplier(mine?.multiplier ?? 1)}</span>
      </div>
      <div className="mp-chip-time">{formatTime(mine?.seconds ?? 0)} in the air</div>
      {showGrade && (
        <p className={`mp-grade ${grade.delta >= 0 ? 'good' : 'bad'}`} role="status">
          {grade.label} {grade.delta >= 0 ? '+' : ''}
          {grade.delta.toFixed(2)} → {formatMultiplier(grade.multiplier)}
        </p>
      )}
      {status === 'reconnecting' ? (
        <p className="mp-panel-warn" role="status">
          Reconnecting...
        </p>
      ) : (
        <p className="mp-panel-note">Hold Tab: scoreboard</p>
      )}
    </section>
  )
}

/** Everyone online, by score. Shown while Tab is held. */
export function Scoreboard() {
  const visible = useMultiplayerStore((s) => s.boardVisible)
  const roster = useMultiplayerStore((s) => s.roster)
  const entries = useMultiplayerStore((s) => s.leaderboard)
  const flashUntil = useMultiplayerStore((s) => s.resetFlashUntil)
  const myId = useMultiplayerStore((s) => s.myId)
  if (!visible || !myId) return null

  const now = performance.now()
  const rows = [...entries]
    .sort((a, b) => b.score - a.score)
    .map((e) => {
      const pilot = roster.find((p) => p.id === e.id)
      return {
        ...e,
        name: pilot?.name ?? '?',
        aircraft: pilot ? getAircraft(pilot.aircraftId).name : '',
        flashing: now < (flashUntil[e.id] ?? 0),
      }
    })

  return (
    <div className="mp-scoreboard-wrap">
      <section className="panel mp-scoreboard" aria-label="Scoreboard" data-testid="mp-scoreboard">
        <h2>
          Online · {rows.length} {rows.length === 1 ? 'pilot' : 'pilots'}
        </h2>
        <table className="mp-board">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Pilot</th>
              <th scope="col">Aircraft</th>
              <th scope="col" className="num">
                Score
              </th>
              <th scope="col" className="num">
                Multiplier
              </th>
              <th scope="col" className="num">
                Flying time
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                // A new key on every reset restarts the flash animation.
                key={`${r.id}:${r.resets}`}
                className={[r.id === myId ? 'me' : '', r.flashing ? 'reset' : ''].join(' ').trim() || undefined}
                aria-current={r.id === myId ? 'true' : undefined}
              >
                <td className="rank">{i + 1}</td>
                <td className="mp-name">
                  {r.name}
                  {r.id === myId && <span className="mp-you"> (you)</span>}
                </td>
                <td className="mp-aircraft">{r.aircraft}</td>
                <td className="num">{formatScore(r.score)}</td>
                <td className="num">{formatMultiplier(r.multiplier)}</td>
                <td className="num">{formatTime(r.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mp-panel-note">
          Score = flying time × multiplier. Clean take-offs and soft landings raise the multiplier; a crash or a
          mid-air collision resets it all.
        </p>
      </section>
    </div>
  )
}

/** After a crash online: respawn on your runway instead of the results screen. */
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
          {midAir ? 'Both pilots crashed and both scores were reset.' : 'Your score was reset.'}
        </p>
        <div className="menu-buttons">
          <button type="button" className="btn primary" autoFocus onClick={respawn}>
            Respawn
          </button>
          <button type="button" className="btn danger" onClick={quitToMenu}>
            Leave
          </button>
        </div>
      </div>
    </div>
  )
}

/** The connection died mid-flight: carry on alone or go back to the menu. */
export function ConnectionLostPanel() {
  const message = useMultiplayerStore((s) => s.errorMessage)
  const continueSolo = useMultiplayerStore((s) => s.continueSolo)
  const quitToMenu = useGameStore((s) => s.quitToMenu)
  return (
    <div className="screen screen-center scrim" role="dialog" aria-modal="true" aria-label="Connection lost">
      <div className="panel menu-panel mp-crash">
        <h2>Connection lost</h2>
        <p>{message ?? 'Lost the connection to the multiplayer server.'}</p>
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
 * The multiplayer overlays on the flight: the Tab scoreboard and the crash or
 * connection-lost dialogs. (Your own score chip lives in the HUD, see Hud.tsx.)
 */
export function MultiplayerHud() {
  const connectionLost = useMultiplayerStore((s) => s.connectionLost)
  if (connectionLost) return <ConnectionLostPanel />
  return (
    <>
      <Scoreboard />
      <CrashPanel />
    </>
  )
}
