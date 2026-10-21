import { BufferAttribute, BufferGeometry, Color } from 'three'
import { getTerrainGrid } from './terrainGrid'

const C_SEABED = new Color(0x6f8f86)
const C_SAND = new Color(0xd6c58f)
const C_GRASS = new Color(0x6a9a43)
const C_GRASS_DRY = new Color(0x8a9c4c)
const C_FOREST = new Color(0x3f6b33)
const C_ROCK = new Color(0x7b766f)
const C_SNOW = new Color(0xf1f4f8)

function smoothstep(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a)
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return t * t * (3 - 2 * t)
}

/**
 * Builds the terrain mesh with vertex colours by height and slope. Heights
 * come from the shared grid that the terrain samplers also triangulate
 * (terrainGrid.ts), so the drawn ground and the physics ground agree exactly.
 */
export function buildTerrainGeometry(segments: number): BufferGeometry {
  const { n, step, origin, heights } = getTerrainGrid(segments)
  const positions = new Float32Array(n * n * 3)
  const colors = new Float32Array(n * n * 3)

  for (let iz = 0; iz < n; iz++) {
    const z = origin + iz * step
    for (let ix = 0; ix < n; ix++) {
      const k = iz * n + ix
      positions[k * 3] = origin + ix * step
      positions[k * 3 + 1] = heights[k]
      positions[k * 3 + 2] = z
    }
  }

  // Normals by central differences on the height grid.
  const normals = new Float32Array(n * n * 3)
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const xl = heights[iz * n + Math.max(ix - 1, 0)]
      const xr = heights[iz * n + Math.min(ix + 1, n - 1)]
      const zu = heights[Math.max(iz - 1, 0) * n + ix]
      const zd = heights[Math.min(iz + 1, n - 1) * n + ix]
      const sx = (Math.min(ix + 1, n - 1) - Math.max(ix - 1, 0)) * step
      const sz = (Math.min(iz + 1, n - 1) - Math.max(iz - 1, 0)) * step
      const nx = -(xr - xl) / sx
      const nz = -(zd - zu) / sz
      const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz)
      const k = (iz * n + ix) * 3
      normals[k] = nx * inv
      normals[k + 1] = inv
      normals[k + 2] = nz * inv
    }
  }

  const c = new Color()
  const tmp = new Color()
  for (let k = 0; k < n * n; k++) {
    const h = heights[k]
    const slope = 1 - normals[k * 3 + 1] // 0 flat .. ~1 vertical
    const x = positions[k * 3]
    const z = positions[k * 3 + 2]
    // Cheap deterministic patchiness.
    const patch = 0.5 + 0.5 * Math.sin(x * 0.0043 + Math.sin(z * 0.0031) * 2.0) * Math.sin(z * 0.0051 - x * 0.0017)

    if (h < 0) {
      c.copy(C_SEABED)
      tmp.copy(C_SAND)
      c.lerp(tmp, smoothstep(-25, 0, h))
    } else {
      c.copy(C_SAND)
      c.lerp(C_GRASS, smoothstep(1.5, 6, h))
      tmp.copy(C_GRASS_DRY)
      c.lerp(tmp, patch * 0.45 * smoothstep(4, 12, h))
      tmp.copy(C_FOREST)
      c.lerp(tmp, smoothstep(40, 220, h) * 0.85)
      tmp.copy(C_ROCK)
      c.lerp(tmp, Math.max(smoothstep(260, 420, h), smoothstep(0.1, 0.28, slope)))
      tmp.copy(C_SNOW)
      c.lerp(tmp, smoothstep(520, 600, h) * (1 - smoothstep(0.18, 0.4, slope)))
    }
    colors[k * 3] = c.r
    colors[k * 3 + 1] = c.g
    colors[k * 3 + 2] = c.b
  }

  const indices = new Uint32Array(segments * segments * 6)
  let p = 0
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * n + ix
      const b = a + 1
      const d = a + n
      const e = d + 1
      // Counter-clockwise seen from above (+Y).
      indices[p++] = a
      indices[p++] = d
      indices[p++] = b
      indices[p++] = b
      indices[p++] = d
      indices[p++] = e
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('normal', new BufferAttribute(normals, 3))
  geo.setAttribute('color', new BufferAttribute(colors, 3))
  geo.setIndex(new BufferAttribute(indices, 1))
  geo.computeBoundingSphere()
  geo.computeBoundingBox()
  return geo
}

