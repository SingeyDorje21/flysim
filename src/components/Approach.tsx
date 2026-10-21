import type { Units } from '../state/gameStore'
import type { NavInfo } from '../state/telemetry'
import { formatDistance } from './format'

export const FULL_SCALE_LATERAL = 150
export const FULL_SCALE_VERTICAL = 60

const clamp = (v: number, lim: number): number => Math.max(-lim, Math.min(lim, Number.isFinite(v) ? v : 0))
const TICKS = [-1, -0.5, 0, 0.5, 1]

/**
 * ILS-style localizer (horizontal) and glide-slope (vertical) deviation scales.
 * Diamonds show where the course is relative to the aircraft: aircraft right of
 * the centreline puts the diamond left (fly left); aircraft above the slope puts it below.
 */
export function ApproachIndicator({ approach, units }: { approach: NonNullable<NavInfo['approach']>; units: Units }) {
  const lateral = clamp(approach.lateral, FULL_SCALE_LATERAL)
  const vertical = clamp(approach.vertical, FULL_SCALE_VERTICAL)
  const lat = lateral / FULL_SCALE_LATERAL
  const vert = vertical / FULL_SCALE_VERTICAL
  return (
    <div className="hud-approach" data-testid="hud-approach">
      <div className="approach-title">
        RWY {approach.runway} {approach.code} ·{' '}
        <span data-testid="approach-distance">{formatDistance(approach.distance, units)}</span>
      </div>
      <div className="approach-body">
        <div
          className="gs-scale"
          role="meter"
          aria-label="Glide slope deviation"
          aria-valuemin={-FULL_SCALE_VERTICAL}
          aria-valuemax={FULL_SCALE_VERTICAL}
          aria-valuenow={Math.round(vertical)}
        >
          {TICKS.map((m) => (
            <span key={m} className={m === 0 ? 'dot centre' : 'dot'} style={{ top: `${50 + m * 50}%` }} />
          ))}
          <span className="diamond" data-testid="gs-diamond" style={{ top: `${50 + vert * 50}%` }} />
        </div>
        <div
          className="loc-scale"
          role="meter"
          aria-label="Localizer deviation"
          aria-valuemin={-FULL_SCALE_LATERAL}
          aria-valuemax={FULL_SCALE_LATERAL}
          aria-valuenow={Math.round(lateral)}
        >
          {TICKS.map((m) => (
            <span key={m} className={m === 0 ? 'dot centre' : 'dot'} style={{ left: `${50 + m * 50}%` }} />
          ))}
          <span className="diamond" data-testid="loc-diamond" style={{ left: `${50 - lat * 50}%` }} />
        </div>
      </div>
    </div>
  )
}
