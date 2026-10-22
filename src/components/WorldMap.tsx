import { useMemo } from 'react'
import { AIRPORTS } from '../config/airports'
import { WORLD } from '../config/world'
import { airportRunways, headingVector, longestRunway, runwayEnds } from '../game/airportGeometry'
import { useGameStore } from '../state/gameStore'
import { useTelemetry } from '../state/telemetry'
import { formatDistance } from './format'
import { sampleLandRuns } from './mapData'

const SCALE_M = 10000

interface MapViewProps {
  /** Prefix for test ids; the inline preview uses "preview" so it never collides with the overlay. */
  idPrefix?: string
  inline?: boolean
  canSelect: boolean
  /** Airports whose runway is too short for the chosen aircraft are dimmed. */
  minRunway?: number
  showAircraft?: boolean
}

/** The island map drawing, shared by the overlay and the inline preview. */
export function MapView({ idPrefix = 'map', inline = false, canSelect, minRunway = 0, showAircraft = true }: MapViewProps) {
  const t = useTelemetry()
  const airportId = useGameStore((s) => s.airportId)
  const runwayEnd = useGameStore((s) => s.runwayEnd)
  const units = useGameStore((s) => s.settings.units)
  const selectAirport = useGameStore((s) => s.selectAirport)
  const size = WORLD.terrainSize
  const half = size / 2
  const land = useMemo(() => sampleLandRuns(size), [size])
  const chosenEnd = (a: (typeof AIRPORTS)[number]) => runwayEnds(a).find((e) => e.designator === runwayEnd)

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
        {land.map((r, i) => (
          <rect key={i} x={r.x} y={r.z} width={r.w + 1} height={r.h + 1} />
        ))}
      </g>
      {AIRPORTS.map((a) => {
        const active = a.id === airportId
        const short = longestRunway(a) < minRunway
        const end = active ? chosenEnd(a) : undefined
        const cls = ['map-airport', active ? 'active' : '', short ? 'short' : ''].filter(Boolean).join(' ')
        return (
          <g
            key={a.id}
            data-testid={`${idPrefix}-airport-${a.code}`}
            data-active={active ? 'true' : 'false'}
            data-short={short ? 'true' : 'false'}
            className={cls}
            style={{ cursor: canSelect ? 'pointer' : 'default' }}
            onClick={canSelect ? () => selectAirport(a.id) : undefined}
          >
            <circle cx={a.center.x} cy={a.center.z} r={1500} className="map-hit" />
            {active && <circle cx={a.center.x} cy={a.center.z} r={1900} className="map-ring" />}
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
                  strokeWidth={index === 0 ? 380 : 260}
                />
              )
            })}
            {end && (
              <g
                data-testid={`${idPrefix}-approach-arrow`}
                transform={`translate(${end.threshold.x} ${end.threshold.z}) rotate(${end.headingDeg})`}
              >
                <polygon points="0,-1400 -900,900 0,350 900,900" className="map-approach" />
              </g>
            )}
            <text x={a.center.x} y={a.center.z - 1400} className="map-label" fontSize={1300} textAnchor="middle">
              {a.code}
            </text>
          </g>
        )
      })}
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
        <p className="note">{canSelect ? 'Click an airport to select it.' : 'Press M or Close to return to the flight.'}</p>
      </div>
    </div>
  )
}
