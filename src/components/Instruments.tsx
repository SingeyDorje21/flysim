import type { ReactNode } from 'react'
import { getAircraft, type AircraftSpeeds } from '../config/aircraftCatalog'
import { useGameStore, type Units } from '../state/gameStore'
import { useTelemetry } from '../state/telemetry'
import {
  altitudeUnit,
  altitudeValue,
  speedUnit,
  speedValue,
  verticalSpeedUnit,
  verticalSpeedValue,
} from './format'
import './Instruments.css'

const C = 100 // gauge centre; viewBox is 200x200

/** Point on a circle; angle 0 = top, clockwise, degrees. */
function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.sin(a), C - r * Math.cos(a)]
}

function arcPath(r: number, from: number, to: number): string {
  const [x1, y1] = polar(r, from)
  const [x2, y2] = polar(r, to)
  const large = Math.abs(to - from) > 180 ? 1 : 0
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const fin = (v: number): number => (Number.isFinite(v) ? v : 0)

interface GaugeProps {
  label: string
  value: string
  children: ReactNode
  /** Full-scale value, exposed for tests and assistive tech. */
  scaleMax?: number
}

function Gauge({ label, value, children, scaleMax }: GaugeProps) {
  return (
    <svg
      className="gauge"
      viewBox="0 0 200 200"
      role="img"
      aria-label={`${label} ${value}`}
      data-testid={`gauge-${label.toLowerCase().replace(/\s+/g, '-')}`}
      data-scale-max={scaleMax}
    >
      <circle cx={C} cy={C} r={97} className="gauge-bezel" />
      <circle cx={C} cy={C} r={90} className="gauge-face" />
      {children}
    </svg>
  )
}

interface TickSpec {
  min: number
  max: number
  startDeg: number
  endDeg: number
  major: number
  minor: number
  labelFormat?: (v: number) => string
}

function Ticks({ min, max, startDeg, endDeg, major, minor, labelFormat }: TickSpec) {
  const els: ReactNode[] = []
  const span = endDeg - startDeg
  const angle = (v: number) => startDeg + ((v - min) / (max - min)) * span
  for (let v = min; v <= max + 1e-6; v += minor) {
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6
    const a = angle(v)
    const [x1, y1] = polar(88, a)
    const [x2, y2] = polar(isMajor ? 76 : 82, a)
    els.push(<line key={`t${v}`} x1={x1} y1={y1} x2={x2} y2={y2} className={isMajor ? 'tick major' : 'tick'} />)
    if (isMajor) {
      const [tx, ty] = polar(63, a)
      els.push(
        <text key={`l${v}`} x={tx} y={ty} className="gauge-num" textAnchor="middle" dominantBaseline="central">
          {labelFormat ? labelFormat(v) : v}
        </text>,
      )
    }
  }
  return <>{els}</>
}

function Needle({ deg, length = 74, className = 'needle' }: { deg: number; length?: number; className?: string }) {
  const [x, y] = polar(length, deg)
  const [bx, by] = polar(-14, deg)
  return <line x1={bx} y1={by} x2={x} y2={y} className={className} />
}

/** Full-scale airspeed (display units) for an aircraft: fighters get a round 800 kt style scale. */
function airspeedScaleMax(speeds: AircraftSpeeds, units: Units): number {
  const maxOp = speedValue(speeds.maxOperating, units)
  if (maxOp > 400) return Math.ceil(maxOp / 100) * 100
  const step = units === 'imperial' ? 20 : 40
  return Math.ceil((maxOp * 1.15) / step) * step
}

function Airspeed({ ms, units, speeds }: { ms: number; units: Units; speeds: AircraftSpeeds }) {
  const imperial = units === 'imperial'
  const max = airspeedScaleMax(speeds, units)
  const major = imperial ? (max <= 200 ? 20 : max <= 450 ? 50 : 100) : max <= 400 ? 40 : max <= 1000 ? 100 : 200
  const a = (v: number) => -140 + (clamp(speedValue(v, units), 0, max) / max) * 280
  const shown = speedValue(ms, units)
  const [rx1, ry1] = polar(90, a(speeds.maxOperating))
  const [rx2, ry2] = polar(70, a(speeds.maxOperating))
  const caution = speeds.stallClean + (speeds.maxOperating - speeds.stallClean) * 0.82
  return (
    <Gauge label="Airspeed" value={`${Math.round(shown)} ${speedUnit(units)}`} scaleMax={max}>
      <path d={arcPath(84, a(speeds.stallClean * 0.85), a(speeds.approach * 1.2))} className="arc arc-white" />
      <path d={arcPath(79, a(speeds.stallClean), a(caution))} className="arc arc-green" />
      <path d={arcPath(79, a(caution), a(speeds.maxOperating))} className="arc arc-yellow" />
      <line x1={rx1} y1={ry1} x2={rx2} y2={ry2} className="redline" />
      <Ticks
        min={0}
        max={max}
        startDeg={-140}
        endDeg={140}
        major={major}
        minor={major / 2}
        labelFormat={(v) => (imperial || major !== 40 || v % 80 === 0 ? String(v) : '')}
      />
      <text x={C} y={140} className="gauge-title" textAnchor="middle">
        {speedUnit(units).toUpperCase()}
      </text>
      <Needle deg={-140 + (clamp(shown, 0, max) / max) * 280} />
      <circle cx={C} cy={C} r={5} className="hub" />
    </Gauge>
  )
}

function Attitude({ pitch, bank }: { pitch: number; bank: number }) {
  const ppd = 2.2 // px per degree
  const p = clamp(fin(pitch), -90, 90)
  const b = fin(bank)
  const ladder: ReactNode[] = []
  for (let d = -30; d <= 30; d += 5) {
    if (d === 0) continue
    const w = d % 10 === 0 ? 30 : 16
    const y = C - d * ppd
    ladder.push(<line key={d} x1={C - w} x2={C + w} y1={y} y2={y} className="ladder" />)
    if (d % 10 === 0)
      ladder.push(
        <text key={`n${d}`} x={C + w + 4} y={y} className="gauge-num small" dominantBaseline="central">
          {Math.abs(d)}
        </text>,
      )
  }
  return (
    <Gauge label="Attitude" value={`pitch ${Math.round(pitch)} bank ${Math.round(bank)}`}>
      <defs>
        <clipPath id="att-clip">
          <circle cx={C} cy={C} r={89} />
        </clipPath>
      </defs>
      <g clipPath="url(#att-clip)">
        <g transform={`rotate(${-b} ${C} ${C})`}>
          <g transform={`translate(0 ${p * ppd})`}>
            <rect x={-200} y={-400} width={600} height={400 + C} className="sky" />
            <rect x={-200} y={C} width={600} height={600} className="ground" />
            <line x1={-200} x2={400} y1={C} y2={C} className="horizon" />
            {ladder}
          </g>
        </g>
      </g>
      <g transform={`rotate(${-b} ${C} ${C})`}>
        {[-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((d) => {
          const [x1, y1] = polar(89, d)
          const [x2, y2] = polar(d % 30 === 0 ? 79 : 83, d)
          return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} className="tick major" />
        })}
      </g>
      <polygon points={`${C},14 ${C - 6},26 ${C + 6},26`} className="pointer" />
      <path d={`M${C - 40} ${C} h22 l6 8 M${C + 40} ${C} h-22 l-6 8`} className="aircraft-ref" />
      <circle cx={C} cy={C} r={3} className="aircraft-dot" />
    </Gauge>
  )
}

function Altimeter({ m, units }: { m: number; units: Units }) {
  const v = altitudeValue(m, units)
  const wrap = (x: number, mod: number) => ((x % mod) + mod) % mod
  return (
    <Gauge label="Altitude" value={`${Math.round(v)} ${altitudeUnit(units)}`}>
      <Ticks min={0} max={9.5} startDeg={0} endDeg={342} major={1} minor={0.5} labelFormat={(n) => String(n % 10)} />
      <text x={C} y={140} className="gauge-title" textAnchor="middle">
        {units === 'imperial' ? 'ALT FT' : 'ALT M'}
      </text>
      <Needle deg={(wrap(v, 10000) / 10000) * 360} length={48} className="needle thick" />
      <Needle deg={(wrap(v, 1000) / 1000) * 360} />
      <circle cx={C} cy={C} r={5} className="hub" />
    </Gauge>
  )
}

function Heading({ deg }: { deg: number }) {
  const h = fin(deg)
  const cards = [
    [0, 'N'],
    [90, 'E'],
    [180, 'S'],
    [270, 'W'],
  ] as const
  const els: ReactNode[] = []
  for (let d = 0; d < 360; d += 10) {
    const [x1, y1] = polar(88, d)
    const [x2, y2] = polar(d % 30 === 0 ? 76 : 82, d)
    els.push(<line key={d} x1={x1} y1={y1} x2={x2} y2={y2} className={d % 30 === 0 ? 'tick major' : 'tick'} />)
    if (d % 30 === 0 && d % 90 !== 0) {
      const [tx, ty] = polar(66, d)
      els.push(
        <text key={`n${d}`} x={tx} y={ty} className="gauge-num small" textAnchor="middle" dominantBaseline="central">
          {d / 10}
        </text>,
      )
    }
  }
  for (const [d, label] of cards) {
    const [tx, ty] = polar(66, d)
    els.push(
      <text key={label} x={tx} y={ty} className="gauge-num cardinal" textAnchor="middle" dominantBaseline="central">
        {label}
      </text>,
    )
  }
  return (
    <Gauge label="Heading" value={`${Math.round(((h % 360) + 360) % 360)} degrees`}>
      <g transform={`rotate(${-h} ${C} ${C})`}>{els}</g>
      <path d={`M${C} 38 L${C - 9} 66 L${C} 58 L${C + 9} 66 Z`} className="plane" />
      <line x1={C} y1={58} x2={C} y2={142} className="plane-line" />
      <line x1={C - 22} y1={96} x2={C + 22} y2={96} className="plane-line" />
      <line x1={C - 9} y1={130} x2={C + 9} y2={130} className="plane-line" />
      <polygon points={`${C},8 ${C - 5},18 ${C + 5},18`} className="pointer" />
    </Gauge>
  )
}

function Vsi({ ms, units }: { ms: number; units: Units }) {
  const imperial = units === 'imperial'
  const max = imperial ? 2000 : 10
  const v = clamp(verticalSpeedValue(ms, units), -max, max)
  // Zero sits at 9 o-clock (-90 deg); full scale is 150 deg either way.
  const ang = (x: number) => -90 + (x / max) * 150
  const step = imperial ? 500 : 2
  const ticks: ReactNode[] = []
  for (let x = -max; x <= max + 1e-6; x += step / 2) {
    const major = Math.abs(x % step) < 1e-6
    const a = ang(x)
    const [x1, y1] = polar(88, a)
    const [x2, y2] = polar(major ? 76 : 82, a)
    ticks.push(<line key={x} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'tick major' : 'tick'} />)
    if (major) {
      const [tx, ty] = polar(63, a)
      ticks.push(
        <text key={`l${x}`} x={tx} y={ty} className="gauge-num small" textAnchor="middle" dominantBaseline="central">
          {Math.abs(imperial ? x / 100 : x)}
        </text>,
      )
    }
  }
  return (
    <Gauge label="Vertical speed" value={`${Math.round(verticalSpeedValue(ms, units))} ${verticalSpeedUnit(units)}`}>
      {ticks}
      <text x={C} y={140} className="gauge-title" textAnchor="middle">
        {imperial ? 'VSI x100' : 'VSI M/S'}
      </text>
      <Needle deg={ang(v)} />
      <circle cx={C} cy={C} r={5} className="hub" />
    </Gauge>
  )
}

function Tach({ rpm }: { rpm: number }) {
  const max = 3000
  const r = clamp(fin(rpm), 0, max)
  const a = (v: number) => -135 + (v / max) * 270
  return (
    <Gauge label="Tachometer" value={`${Math.round(fin(rpm))} rpm`}>
      <path d={arcPath(79, a(1500), a(2500))} className="arc arc-green" />
      <path d={arcPath(79, a(2500), a(2700))} className="arc arc-yellow" />
      <path d={arcPath(79, a(2700), a(3000))} className="arc arc-red" />
      <Ticks
        min={0}
        max={3000}
        startDeg={-135}
        endDeg={135}
        major={500}
        minor={250}
        labelFormat={(v) => String(v / 100)}
      />
      <text x={C} y={140} className="gauge-title" textAnchor="middle">
        RPM x100
      </text>
      <Needle deg={a(r)} />
      <circle cx={C} cy={C} r={5} className="hub" />
    </Gauge>
  )
}

function N1Gauge({ n1 }: { n1: number }) {
  const max = 110
  const pct = clamp(fin(n1) * 100, 0, max)
  const a = (v: number) => -135 + (v / max) * 270
  return (
    <Gauge label="N1" value={`${Math.round(fin(n1) * 100)} percent`} scaleMax={max}>
      <path d={arcPath(79, a(20), a(100))} className="arc arc-green" />
      <path d={arcPath(79, a(100), a(105))} className="arc arc-yellow" />
      <path d={arcPath(79, a(105), a(110))} className="arc arc-red" />
      <Ticks min={0} max={max} startDeg={-135} endDeg={(max / max) * 135} major={20} minor={10} />
      <text x={C} y={140} className="gauge-title" textAnchor="middle">
        N1 %
      </text>
      <Needle deg={a(pct)} />
      <circle cx={C} cy={C} r={5} className="hub" />
    </Gauge>
  )
}

/** Six-pack instrument panel. Reads live telemetry; never intercepts the pointer. */
export function InstrumentPanel() {
  const t = useTelemetry()
  const units = useGameStore((s) => s.settings.units)
  const aircraft = getAircraft(t.aircraftId)
  return (
    <div className="instrument-panel" data-testid="instrument-panel">
      <Airspeed ms={t.airspeed} units={units} speeds={aircraft.speeds} />
      <Attitude pitch={t.pitchDeg} bank={t.bankDeg} />
      <Altimeter m={t.altitude} units={units} />
      {aircraft.engineKind === 'piston' ? <Tach rpm={t.rpm} /> : <N1Gauge n1={t.n1} />}
      <Heading deg={t.headingDeg} />
      <Vsi ms={t.verticalSpeed} units={units} />
    </div>
  )
}
