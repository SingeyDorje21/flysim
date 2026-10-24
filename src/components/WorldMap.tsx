import { useState } from 'react'
import { AIRPORTS, AIRPORT_CLASS_LABEL, type AirportDef } from '../config/airports'
import { WORLD } from '../config/world'
import { airportRunways, headingVector, longestRunway, runwayEnds } from '../game/airportGeometry'
import { useGameStore } from '../state/gameStore'
import { useTelemetry } from '../state/telemetry'
import { LAKES } from '../world/terrain/heightField'
import { formatDistance, formatRunwayLength } from './format'
import { reliefImageUrl } from './mapData'

const SCALE_M = 10000
/** Graticule spacing (m). */
const GRID_M = 10000
/** How far beyond a threshold the clickable runway-end label sits (m). */
const END_LABEL_M = 3400
/** Length of the dashed final-approach line drawn before the chosen threshold (m). */
const APPROACH_LINE_M = 9000

interface MapViewProps {
  /** Prefix for test ids; the inline preview uses "preview" so it never collides with the overlay. */
  idPrefix?: string
  inline?: boolean
  canSelect: boolean
  /** Airports whose runway is too short for the chosen aircraft are dimmed. */
  minRunway?: number
  showAircraft?: boolean
}

/** Name, class and longest runway of the airport under the pointer. */
function AirportTooltip({ a, below }: { a: AirportDef; below: boolean }) {
  const units = useGameStore((s) => s.settings.units)
  const title = `${a.code} ${a.name}`
  const sub = `${AIRPORT_CLASS_LABEL[a.class]} · ${formatRunwayLength(longestRunway(a), units)}`
  const w = Math.max(title.length, sub.length) * 640 + 1600
  const y = below ? a.center.z + 2600 : a.center.z - 2600 - 3400
  return (
    <g className="map-tooltip" pointerEvents="none" data-testid="map-tooltip">
      <rect x={a.center.x - w / 2} y={y} width={w} height={3400} rx={500} />
      <text x={a.center.x} y={y + 1450} fontSize={1150} textAnchor="middle" className="map-tooltip-title">
        {title}
      </text>
      <text x={a.center.x} y={y + 2800} fontSize={950} textAnchor="middle">
        {sub}
      </text>
    </g>
  )
}

/** The island map drawing, shared by the overlay and the inline preview. */
export function MapView({ idPrefix = 'map', inline = false, canSelect, minRunway = 0, showAircraft = true }: MapViewProps) {
  const t = useTelemetry()
  const airportId = useGameStore((s) => s.airportId)
  const runwayEnd = useGameStore((s) => s.runwayEnd)
  const units = useGameStore((s) => s.settings.units)
  const selectAirport = useGameStore((s) => s.selectAirport)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const size = WORLD.terrainSize
  const half = size / 2
  const current = AIRPORTS.find((a) => a.id === airportId)
  const ends = current ? runwayEnds(current) : []
  const chosen = ends.find((e) => e.designator === runwayEnd)
  const approachDir = chosen ? headingVector(chosen.headingDeg) : null
  const hovered = AIRPORTS.find((a) => a.id === hoverId)
  const gridLines: number[] = []
  for (let v = -half + GRID_M; v < half; v += GRID_M) gridLines.push(v)

  return (
    <svg
      className={inline ? 'world-map inline' : 'world-map'}
      viewBox={`${-half} ${-half} ${size} ${size}`}
      role="img"
      aria-label={inline ? 'Island map preview' : 'Island map'}
      data-testid={inline ? `${idPrefix}` : 'world-map'}
    >
      <rect x={-half} y={-half} width={size} height={size} className="map-sea" />
      <g className="map-land" data-testid={`${idPrefix}-land`}>
        <image href={reliefImageUrl()} x={-half} y={-half} width={size} height={size} preserveAspectRatio="none" />
        {LAKES.map((l) => (
          <circle key={`${l.x},${l.z}`} cx={l.x} cy={l.z} r={l.radius} className="map-lake" />
        ))}
      </g>
      <g className="map-grid">
        {gridLines.map((v) => (
          <g key={v}>
            <line x1={v} y1={-half} x2={v} y2={half} />
            <line x1={-half} y1={v} x2={half} y2={v} />
          </g>
        ))}
      </g>
      {chosen && approachDir && (
        <line
          className="map-approach-line"
          x1={chosen.threshold.x - approachDir.x * APPROACH_LINE_M}
          y1={chosen.threshold.z - approachDir.z * APPROACH_LINE_M}
          x2={chosen.threshold.x}
          y2={chosen.threshold.z}
        />
      )}
      {AIRPORTS.map((a) => {
        const active = a.id === airportId
        const short = longestRunway(a) < minRunway
        const cls = ['map-airport', active ? 'active' : '', short ? 'short' : '', a.id === hoverId ? 'hover' : '']
        return (
          <g
            key={a.id}
            data-testid={`${idPrefix}-airport-${a.code}`}
            data-active={active ? 'true' : 'false'}
            data-short={short ? 'true' : 'false'}
            className={cls.filter(Boolean).join(' ')}
            style={{ cursor: canSelect ? 'pointer' : 'default' }}
            onClick={canSelect ? () => selectAirport(a.id) : undefined}
            onPointerEnter={() => setHoverId(a.id)}
            onPointerLeave={() => setHoverId((h) => (h === a.id ? null : h))}
          >
            <circle cx={a.center.x} cy={a.center.z} r={2200} className="map-hit" />
            <circle cx={a.center.x} cy={a.center.z} r={active ? 2100 : 1500} className="map-ring" />
            {airportRunways(a).map(({ rect: r, index }) => {
              const d = headingVector(r.headingDeg)
              const hl = r.length / 2
              return (
                <line
                  key={index}
                  x1={r.cx - d.x * hl}
                  y1={r.cz - d.z * hl}
                  x2={r.cx + d.x * hl}
                  y2={r.cz + d.z * hl}
                  className="map-runway"
                  strokeWidth={index === 0 ? 420 : 300}
                />
              )
            })}
            {chosen && active && (
              <g
                data-testid={`${idPrefix}-approach-arrow`}
                transform={`translate(${chosen.threshold.x} ${chosen.threshold.z}) rotate(${chosen.headingDeg})`}
              >
                <polygon points="0,-1400 -900,900 0,350 900,900" className="map-approach" />
              </g>
            )}
            <text x={a.center.x} y={a.center.z - 2800} className="map-label" fontSize={1800} textAnchor="middle">
              {a.code}
            </text>
          </g>
        )
      })}
      {canSelect &&
        current &&
        ends.map((e) => {
          const d = headingVector(e.headingDeg)
          const x = e.threshold.x - d.x * END_LABEL_M
          const z = e.threshold.z - d.z * END_LABEL_M
          const on = e.designator === runwayEnd
          return (
            <g
              key={e.designator}
              className={on ? 'map-end active' : 'map-end'}
              data-testid={`${idPrefix}-end-${e.designator}`}
              onClick={() => selectAirport(current.id, e.designator)}
            >
              <title>{`Use runway ${e.designator}`}</title>
              <circle cx={x} cy={z} r={1350} />
              <text x={x} y={z + 480} fontSize={1300} textAnchor="middle">
                {e.designator}
              </text>
            </g>
          )
        })}
      {hovered && <AirportTooltip a={hovered} below={hovered.center.z < -half + 9000} />}
      {showAircraft && (
        <g data-testid="map-aircraft" transform={`translate(${t.position.x} ${t.position.z}) rotate(${t.headingDeg})`}>
          <polygon points="0,-1700 -1000,1200 0,600 1000,1200" className="map-aircraft" />
        </g>
      )}
      <g className="map-scale" data-testid={`${idPrefix}-scale`} transform={`translate(${-half + 3000} ${half - 3500})`}>
        <rect x={0} y={0} width={SCALE_M} height={400} />
        <text x={0} y={-500} fontSize={1300}>
          {formatDistance(SCALE_M, units)}
        </text>
      </g>
      <g className="map-north" data-testid={`${idPrefix}-north`} transform={`translate(${half - 4000} ${-half + 6000})`}>
        <polygon points="0,-3000 1000,1000 0,300 -1000,1000" />
        <text x={0} y={3200} fontSize={1800} textAnchor="middle">
          N
        </text>
      </g>
    </svg>
  )
}

/** Inline (non-overlay) map for the airport picker. Clicking an airport selects it. */
export function MapPreview({ minRunway }: { minRunway: number }) {
  return (
    <div className="map-preview">
      <MapView inline idPrefix="preview" canSelect minRunway={minRunway} showAircraft={false} />
    </div>
  )
}

/** Full-island map overlay. Click an airport to select it when not in flight. */
export function WorldMap() {
  const screen = useGameStore((s) => s.screen)
  const closeOverlay = useGameStore((s) => s.closeOverlay)
  const canSelect = screen !== 'flight'

  return (
    <div className="screen screen-center scrim overlay" role="dialog" aria-modal="true" aria-label="World map">
      <div className="panel map-panel">
        <div className="picker-head">
          <h2>Map</h2>
          <button type="button" className="btn primary" autoFocus onClick={closeOverlay}>
            Close
          </button>
        </div>
        <MapView canSelect={canSelect} />
        <p className="note">
          {canSelect
            ? 'Click an airport to select it, then a runway number to choose the end.'
            : 'Press M or Close to return to the flight.'}
        </p>
      </div>
    </div>
  )
}
