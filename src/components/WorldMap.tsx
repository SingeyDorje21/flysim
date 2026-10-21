import { useMemo } from 'react'
import { AIRPORTS } from '../config/airports'
import { WORLD } from '../config/world'
import { headingVector } from '../game/airportGeometry'
import { useGameStore } from '../state/gameStore'
import { useTelemetry } from '../state/telemetry'
import { formatDistance } from './format'
import { sampleLandRuns } from './mapData'

const SCALE_M = 10000

/** Full-island map. Click an airport to select it when not in flight. */
export function WorldMap() {
  const t = useTelemetry()
  const screen = useGameStore((s) => s.screen)
  const airportId = useGameStore((s) => s.airportId)
  const units = useGameStore((s) => s.settings.units)
  const selectAirport = useGameStore((s) => s.selectAirport)
  const closeOverlay = useGameStore((s) => s.closeOverlay)
  const size = WORLD.terrainSize
  const half = size / 2
  const land = useMemo(() => sampleLandRuns(size), [size])
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
        <svg
          className="world-map"
          viewBox={`${-half} ${-half} ${size} ${size}`}
          role="img"
          aria-label="Island map"
          data-testid="world-map"
        >
          <rect x={-half} y={-half} width={size} height={size} className="map-sea" />
          <g className="map-land" data-testid="map-land">
            {land.map((r, i) => (
              <rect key={i} x={r.x} y={r.z} width={r.w + 1} height={r.h + 1} />
            ))}
          </g>
          {AIRPORTS.map((a) => {
            const d = headingVector(a.runway.headingDeg)
            const hl = a.runway.length / 2
            const active = a.id === airportId
            return (
              <g
                key={a.id}
                data-testid={`map-airport-${a.code}`}
                className={active ? 'map-airport active' : 'map-airport'}
                style={{ cursor: canSelect ? 'pointer' : 'default' }}
                onClick={canSelect ? () => selectAirport(a.id) : undefined}
              >
                <circle cx={a.center.x} cy={a.center.z} r={1500} className="map-hit" />
                <line
                  x1={a.center.x - d.x * hl}
                  y1={a.center.z - d.z * hl}
                  x2={a.center.x + d.x * hl}
                  y2={a.center.z + d.z * hl}
                  className="map-runway"
                  strokeWidth={380}
                />
                <text x={a.center.x} y={a.center.z - 1400} className="map-label" fontSize={1300} textAnchor="middle">
                  {a.code}
                </text>
              </g>
            )
          })}
          <g data-testid="map-aircraft" transform={`translate(${t.position.x} ${t.position.z}) rotate(${t.headingDeg})`}>
            <polygon points="0,-1700 -1000,1200 0,600 1000,1200" className="map-aircraft" />
          </g>
          <g className="map-scale" data-testid="map-scale" transform={`translate(${-half + 3000} ${half - 3500})`}>
            <rect x={0} y={0} width={SCALE_M} height={400} />
            <text x={0} y={-500} fontSize={1300}>
              {formatDistance(SCALE_M, units)}
            </text>
          </g>
          <g className="map-north" data-testid="map-north" transform={`translate(${half - 4000} ${-half + 6000})`}>
            <polygon points="0,-3000 1000,1000 0,300 -1000,1000" />
            <text x={0} y={3200} fontSize={1800} textAnchor="middle">
              N
            </text>
          </g>
        </svg>
        <p className="note">{canSelect ? 'Click an airport to select it.' : 'Press M or Close to return to the flight.'}</p>
      </div>
    </div>
  )
}
