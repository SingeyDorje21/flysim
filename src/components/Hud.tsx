import { getAircraft } from '../config/aircraftCatalog'
import { CAMERA_MODES, type CameraMode } from '../game/types'
import { useGameStore } from '../state/gameStore'
import { useTelemetry } from '../state/telemetry'
import { HUD_COMMANDS } from './controlsData'
import { ApproachIndicator } from './Approach'
import { CoachPanel } from './Coach'
import { formatAltitude, formatDistance, formatSpeed, formatTime, formatVerticalSpeed } from './format'
import { Minimap } from './Minimap'
import './Hud.css'

const CAMERA_LABEL: Record<CameraMode, string> = { chase: 'Chase', cockpit: 'Cockpit', free: 'Free' }

const norm360 = (d: number): number => (((Number.isFinite(d) ? d : 0) % 360) + 360) % 360
const FLAP_DETENTS = ['UP', '1', '2', 'FULL']

function flapDetent(lever: number): string {
  const idx = Math.min(FLAP_DETENTS.length - 1, Math.max(0, Math.round(lever * (FLAP_DETENTS.length - 1))))
  return FLAP_DETENTS[idx]
}

type GearState = { label: 'UP' | 'DOWN' | 'TRANSIT'; level: '' | 'caution' | 'warn' }

function gearState(position: number, lowDescending: boolean): GearState {
  if (position >= 0.99) return { label: 'DOWN', level: '' }
  if (position <= 0.01) return { label: 'UP', level: lowDescending ? 'warn' : '' }
  return { label: 'TRANSIT', level: 'caution' }
}

const CARDINALS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }

function HeadingTape({ heading }: { heading: number }) {
  const h = norm360(heading)
  const span = 90 // degrees visible each side is span / 2
  const marks = []
  const start = Math.floor((h - span / 2) / 10) * 10
  for (let d = start; d <= h + span / 2; d += 10) {
    const pct = 50 + ((d - h) / span) * 100
    const wrapped = norm360(d)
    const label = CARDINALS[wrapped] ?? (wrapped % 30 === 0 ? String(wrapped / 10).padStart(2, '0') : '')
    marks.push(
      <div key={d} className={wrapped % 30 === 0 ? 'tape-mark major' : 'tape-mark'} style={{ left: `${pct}%` }}>
        <span className="tape-tick" />
        <span className="tape-label">{label}</span>
      </div>,
    )
  }
  return (
    <div className="hud-tape" aria-hidden="true">
      <div className="tape-window">{marks}</div>
      <div className="tape-pointer" />
      <div className="tape-readout">{String(Math.round(h) % 360).padStart(3, '0')}&deg;</div>
    </div>
  )
}

/** Heads-up display. Re-renders with telemetry; the root ignores the pointer. */
export function Hud() {
  const t = useTelemetry()
  const units = useGameStore((s) => s.settings.units)
  const cameraMode = useGameStore((s) => s.cameraMode)
  const setCameraMode = useGameStore((s) => s.setCameraMode)
  const showInstruments = useGameStore((s) => s.settings.showInstruments)
  const lesson = t.lesson
  const c = lesson ? null : t.challenge
  const nav = t.nav
  const lowAgl = t.heightAboveGround < 300 && !t.onGround
  const isJet = getAircraft(t.aircraftId).engineKind !== 'piston'
  const gear = gearState(t.gearPosition, t.heightAboveGround < 300 && !t.onGround && t.verticalSpeed < 0)
  const flapsLabel = `${flapDetent(t.flaps)} (${Math.round(t.flapsDeg)}°)`

  return (
    <div className={`hud${showInstruments ? ' with-instruments' : ''}`} data-testid="hud">
      <div className="hud-top">
        <div className="hud-camera" role="group" aria-label="Camera mode">
          {CAMERA_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={m === cameraMode ? 'cam-btn active' : 'cam-btn'}
              aria-pressed={m === cameraMode}
              aria-label={`${CAMERA_LABEL[m]} camera`}
              onClick={() => setCameraMode(m)}
            >
              {CAMERA_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {/*
        Right-hand column: one flowing stack, so nothing can overlap. On short
        screens it wraps into a second column to the left instead.
      */}
      <div className="hud-rightcol">
          {lesson && <CoachPanel lesson={lesson} units={units} />}
          {c && (
            <div className={`hud-challenge status-${c.status}`} data-testid="challenge">
              <div className="challenge-objective">{c.objective}</div>
              {c.detail && <div className="challenge-detail">{c.detail}</div>}
              {c.fraction !== null && (
                <div
                  className="challenge-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(Math.min(1, Math.max(0, c.fraction)) * 100)}
                  aria-label="Challenge progress"
                >
                  <div style={{ width: `${Math.min(1, Math.max(0, c.fraction)) * 100}%` }} />
                </div>
              )}
              <div className="challenge-time">
                {formatTime(c.elapsed)}
                {c.timeLimit !== null ? ` / ${formatTime(c.timeLimit)}` : ''}
              </div>
            </div>
          )}
        <div className="hud-box hud-right">
          <div className="hud-label">ALTITUDE</div>
          <div className="hud-big" data-testid="hud-altitude">
            {formatAltitude(t.altitude, units)}
          </div>
          {lowAgl && (
            <div className="hud-row agl">
              <span>AGL</span>
              <span data-testid="hud-agl">{formatAltitude(t.heightAboveGround, units)}</span>
            </div>
          )}
          <div className="hud-row">
            <span>V/S</span>
            <span data-testid="hud-vs">{formatVerticalSpeed(t.verticalSpeed, units)}</span>
          </div>
          <div className="hud-row">
            <span>PITCH</span>
            <span>{Math.round(t.pitchDeg)}&deg;</span>
          </div>
          <div className="hud-row">
            <span>BANK</span>
            <span>{Math.round(t.bankDeg)}&deg;</span>
          </div>
        </div>

        <div className="hud-box hud-engine">
          <div className="hud-row">
            <span>THR</span>
            <span data-testid="hud-throttle">{Math.round(t.throttle * 100)}%</span>
          </div>
          <div className="hud-meter" aria-hidden="true">
            <div style={{ width: `${Math.min(1, Math.max(0, t.throttle)) * 100}%` }} />
          </div>
          {isJet ? (
            <div className="hud-row">
              <span>N1</span>
              <span data-testid="hud-n1">{Math.round(t.n1 * 100)}%</span>
            </div>
          ) : (
            <div className="hud-row">
              <span>RPM</span>
              <span>{Math.round(t.rpm)}</span>
            </div>
          )}
          {t.mach > 0.3 && (
            <div className="hud-row">
              <span>MACH</span>
              <span data-testid="hud-mach">{t.mach.toFixed(2)}</span>
            </div>
          )}
          <div className="hud-row">
            <span>GEAR</span>
            <span className={`gear ${gear.level}`} data-testid="hud-gear">
              {gear.label}
            </span>
          </div>
          <div className="hud-row">
            <span>FLAPS</span>
            <span data-testid="hud-flaps">{flapsLabel}</span>
          </div>
          <div className="hud-row">
            <span>BRAKES</span>
            <span className={t.brakes > 0.05 ? 'on' : ''}>{t.brakes > 0.05 ? `${Math.round(t.brakes * 100)}%` : 'OFF'}</span>
          </div>
          {(t.speedbrake > 0.05 || t.reverse > 0 || t.afterburner) && (
            <div className="hud-flags" data-testid="hud-flags">
              {t.speedbrake > 0.05 && <span className="flag">SPD BRK</span>}
              {t.reverse > 0 && <span className="flag warn">REV</span>}
              {t.afterburner && <span className="flag ab">AB</span>}
            </div>
          )}
          <div className="hud-row">
            <span>TRIM</span>
            <span>{t.trim > 0 ? '+' : ''}{(t.trim * 100).toFixed(0)}%</span>
          </div>
        </div>

        <div className="hud-navgroup">
          <Minimap />
          {nav.nearest && (
            <div className="hud-nav" data-testid="hud-nav">
              {nav.nearest.code} {nav.nearest.name} · {formatDistance(nav.nearest.distance, units)} ·{' '}
              {String(Math.round(norm360(nav.nearest.bearingDeg)) % 360).padStart(3, '0')}&deg;
            </div>
          )}
        </div>
      </div>

      <div className="hud-alerts" aria-live="polite">
        {t.crashed && (
          <div className="alert alert-crash">
            CRASHED{t.crashReason ? <span className="alert-sub">{t.crashReason}</span> : null}
          </div>
        )}
        {!t.crashed && t.stalled && <div className="alert alert-stall flash">STALL</div>}
        {!t.crashed && !t.stalled && t.stallWarning && <div className="alert alert-warn flash">STALL WARNING</div>}
        {!t.crashed && t.onGround && <div className="alert alert-ground">ON GROUND</div>}
        {/* Centre-screen too, so it shows even where the engine box is hidden (narrow screens). */}
        {!t.crashed && gear.level === 'warn' && <div className="alert alert-stall flash">GEAR UP</div>}
      </div>

      <HeadingTape heading={t.headingDeg} />

      {nav.approach && <ApproachIndicator approach={nav.approach} units={units} />}

      <div className="hud-box hud-left">
        <div className="hud-label">AIRSPEED</div>
        <div className="hud-big" data-testid="hud-airspeed">
          {formatSpeed(t.airspeed, units)}
        </div>
        <div className="hud-row">
          <span>GS</span>
          <span>{formatSpeed(t.groundSpeed, units)}</span>
        </div>
        <div className="hud-row">
          <span>AoA</span>
          <span>{t.angleOfAttackDeg.toFixed(1)}&deg;</span>
        </div>
        <div className="hud-row">
          <span>G</span>
          <span>{t.gForce.toFixed(1)}</span>
        </div>
      </div>

      <dl className="hud-commands" aria-label="Key commands">
        {HUD_COMMANDS.map(([keys, action]) => (
          <div className="hud-command" key={action}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
