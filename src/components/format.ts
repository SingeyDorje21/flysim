import type { ResultStat } from '../game/types'
import type { Units } from '../state/gameStore'

const MS_TO_KT = 1.943844
const MS_TO_KMH = 3.6
const M_TO_FT = 3.280840
const MS_TO_FPM = 196.850394
const NM = 1852

const int = (n: number): string => Math.round(n).toLocaleString('en-US')
const safe = (n: number): number => (Number.isFinite(n) ? n : 0)

export function speedValue(ms: number, units: Units): number {
  return safe(ms) * (units === 'imperial' ? MS_TO_KT : MS_TO_KMH)
}
export function speedUnit(units: Units): string {
  return units === 'imperial' ? 'kt' : 'km/h'
}
export function altitudeValue(m: number, units: Units): number {
  return safe(m) * (units === 'imperial' ? M_TO_FT : 1)
}
export function altitudeUnit(units: Units): string {
  return units === 'imperial' ? 'ft' : 'm'
}
export function verticalSpeedValue(ms: number, units: Units): number {
  return safe(ms) * (units === 'imperial' ? MS_TO_FPM : 1)
}
export function verticalSpeedUnit(units: Units): string {
  return units === 'imperial' ? 'ft/min' : 'm/s'
}

/** Metres per second to "97 kt" or "180 km/h". */
export function formatSpeed(ms: number, units: Units): string {
  return `${int(speedValue(ms, units))} ${speedUnit(units)}`
}

/** Metres to "1,234 ft" or "376 m". */
export function formatAltitude(m: number, units: Units): string {
  return `${int(altitudeValue(m, units))} ${altitudeUnit(units)}`
}

/** Signed vertical speed: "+500 ft/min" or "-2.5 m/s". */
export function formatVerticalSpeed(ms: number, units: Units): string {
  const v = verticalSpeedValue(ms, units)
  if (units === 'imperial') {
    const r = Math.round(v / 10) * 10
    return `${r > 0 ? '+' : ''}${int(r)} ft/min`
  }
  const r = Math.round(v * 10) / 10
  return `${r > 0 ? '+' : ''}${r.toFixed(1)} m/s`
}

/** Distances: ft / nm (imperial) or m / km (metric). */
export function formatDistance(m: number, units: Units): string {
  const d = safe(m)
  if (units === 'imperial') {
    return d < NM * 0.5 ? `${int(d * M_TO_FT)} ft` : `${(d / NM).toFixed(1)} nm`
  }
  return d < 1000 ? `${int(d)} m` : `${(d / 1000).toFixed(1)} km`
}

/** Seconds to "m:ss" (or "h:mm:ss"). */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(safe(seconds)))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function formatStat(stat: ResultStat, units: Units): string {
  const v = stat.value
  switch (stat.kind) {
    case 'speed':
      return formatSpeed(v, units)
    case 'altitude':
      return formatAltitude(v, units)
    case 'distance':
      return formatDistance(v, units)
    case 'verticalSpeed':
      return formatVerticalSpeed(v, units)
    case 'time':
      return formatTime(v)
    case 'g':
      return `${safe(v).toFixed(1)} G`
    case 'degrees':
      return `${safe(v).toFixed(1)}\u00b0`
    case 'count':
    case 'score':
      return int(v)
  }
}

/** Runway-scale distances with thousands separators: "1,600 m" or "5,249 ft". */
export function formatRunwayLength(m: number, units: Units): string {
  const d = safe(m)
  return units === 'imperial'
    ? `${Math.round(d * M_TO_FT).toLocaleString('en-US')} ft`
    : `${Math.round(d).toLocaleString('en-US')} m`
}

/** Short aircraft name for badges: "A350-900" -> "A350", "F-22 Raptor" -> "F-22". */
export function shortAircraftName(name: string): string {
  return name.split(' ')[0].replace(/-\d{3}$/, '')
}

/** Lesson cue value: speed in kt / km/h, altitude in ft / m, degrees as deg, percent as %. */
export function formatCueValue(kind: 'speed' | 'altitude' | 'degrees' | 'percent', v: number, units: Units): string {
  switch (kind) {
    case 'speed':
      return formatSpeed(v, units)
    case 'altitude':
      return formatAltitude(v, units)
    case 'degrees':
      return `${Math.round(safe(v))}\u00b0`
    case 'percent':
      return `${Math.round(safe(v))}%`
  }
}

/** Flap lever 0..1 as UP / 1 / 2 / FULL. */
export function flapLabel(lever: number): string {
  const d = ['UP', '1', '2', 'FULL']
  return d[Math.min(d.length - 1, Math.max(0, Math.round(safe(lever) * (d.length - 1))))]
}
