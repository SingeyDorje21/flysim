import { AIRPORTS } from '../config/airports'
import { airportRunways, headingVector, longestRunway } from '../game/airportGeometry'
import { useTelemetry } from '../state/telemetry'

export const MINIMAP_RANGE = 20000
const R = 70 // px radius in a 140 viewBox

/** Heading-up circular minimap, ~20 km radius, centred on the aircraft. */
export function Minimap() {
  const t = useTelemetry()
  const h = (t.headingDeg * Math.PI) / 180
  const fx = Math.sin(h)
  const fz = -Math.cos(h)
  const rx = Math.cos(h)
  const rz = Math.sin(h)
  const k = R / MINIMAP_RANGE
  const toScreen = (x: number, z: number) => {
    const dx = x - t.position.x
    const dz = z - t.position.z
    return { x: (dx * rx + dz * rz) * k, y: -(dx * fx + dz * fz) * k }
  }
  const near = AIRPORTS.filter((a) => {
    const dx = a.center.x - t.position.x
    const dz = a.center.z - t.position.z
    return Math.hypot(dx, dz) < MINIMAP_RANGE + longestRunway(a)
  })
  const north = toScreen(t.position.x, t.position.z - MINIMAP_RANGE * 0.88)
  return (
    <svg
      className="hud-minimap"
      viewBox={`${-R - 2} ${-R - 2} ${2 * R + 4} ${2 * R + 4}`}
      data-testid="minimap"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="minimap-clip">
          <circle r={R} />
        </clipPath>
      </defs>
      <circle r={R} className="mm-bg" />
      <g clipPath="url(#minimap-clip)">
        <circle r={R / 2} className="mm-ring" />
        {near.map((a) => {
          const c = toScreen(a.center.x, a.center.z)
          return (
            <g key={a.id} data-testid={`minimap-airport-${a.code}`}>
              {airportRunways(a).map(({ rect: r, index }) => {
                const d = headingVector(r.headingDeg)
                const hl = r.length / 2
                const p1 = toScreen(r.cx - d.x * hl, r.cz - d.z * hl)
                const p2 = toScreen(r.cx + d.x * hl, r.cz + d.z * hl)
                return <line key={index} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="mm-runway" />
              })}
              <text x={c.x} y={c.y - 5} className="mm-label" textAnchor="middle">
                {a.code}
              </text>
            </g>
          )
        })}
      </g>
      <text x={north.x} y={north.y} className="mm-n" textAnchor="middle" dominantBaseline="middle">
        N
      </text>
      <polygon points="0,-7 5,6 0,3 -5,6" className="mm-aircraft" />
    </svg>
  )
}
