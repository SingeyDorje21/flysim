import { BufferAttribute, BufferGeometry } from 'three'
import type { Rgb } from './plan'

type V3 = readonly [number, number, number]

/** Tiny vertex-coloured, flat-shaded geometry accumulator (merges many shapes into one draw call). */
export class MeshBuilder {
  private pos: number[] = []
  private nor: number[] = []
  private col: number[] = []

  /** Planar polygon (convex, CCW seen from the normal side). */
  face(pts: V3[], color: Rgb, normal?: V3): void {
    const [a, b, c] = pts
    let n = normal
    if (!n) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const l = Math.hypot(nx, ny, nz) || 1
      n = [nx / l, ny / l, nz / l]
    }
    for (let i = 1; i < pts.length - 1; i++) {
      for (const p of [pts[0], pts[i], pts[i + 1]]) {
        this.pos.push(p[0], p[1], p[2])
        this.nor.push(n[0], n[1], n[2])
        this.col.push(color[0], color[1], color[2])
      }
    }
  }

  /** Horizontal rectangle rotated about Y by `rotY` (rad) around its centre. */
  quad(cx: number, y: number, cz: number, w: number, l: number, rotY: number, color: Rgb): void {
    const c = Math.cos(rotY), s = Math.sin(rotY)
    const p = (x: number, z: number): V3 => [cx + x * c + z * s, y, cz - x * s + z * c]
    this.face([p(-w / 2, -l / 2), p(-w / 2, l / 2), p(w / 2, l / 2), p(w / 2, -l / 2)], color, [0, 1, 0])
  }

  /** Axis-aligned box on the ground plane: footprint w (x) by d (z), from y0 to y0+h. */
  box(cx: number, cz: number, w: number, d: number, y0: number, h: number, color: Rgb): void {
    this.gable(cx, cz, w, d, y0, h, 0, color)
  }

  /** Box with an optional gable roof whose ridge runs along z. */
  gable(cx: number, cz: number, w: number, d: number, y0: number, h: number, ridge: number, color: Rgb): void {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2
    const y1 = y0 + h
    const dark: Rgb = [color[0] * 0.8, color[1] * 0.8, color[2] * 0.8]
    const roof: Rgb = [color[0] * 0.6, color[1] * 0.6, color[2] * 0.64]
    // side walls
    this.face([[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], color, [-1, 0, 0])
    this.face([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], color, [1, 0, 0])
    // end walls
    const endWall = (z: number, nz: number) => {
      const pts: V3[] = [[x0, y0, z], [x1, y0, z], [x1, y1, z]]
      if (ridge > 0) pts.push([cx, y1 + ridge, z])
      pts.push([x0, y1, z])
      this.face(nz > 0 ? pts : pts.slice().reverse(), dark, [0, 0, nz])
    }
    endWall(z1, 1)
    endWall(z0, -1)
    if (ridge > 0) {
      const sl = Math.hypot(w / 2, ridge)
      const nx = ridge / sl, ny = (w / 2) / sl
      this.face([[x0, y1, z1], [x0, y1, z0], [cx, y1 + ridge, z0], [cx, y1 + ridge, z1]], roof, [-nx, ny, 0])
      this.face([[x1, y1, z0], [x1, y1, z1], [cx, y1 + ridge, z1], [cx, y1 + ridge, z0]], roof, [nx, ny, 0])
    } else {
      this.face([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], roof, [0, 1, 0])
    }
  }

  /** Thin vertical pole. */
  pole(cx: number, cz: number, h: number, r: number, color: Rgb): void {
    this.box(cx, cz, r * 2, r * 2, 0, h, color)
  }

  /** Banded cone (windsock) pointing along +x from (cx, cy, cz). */
  sock(cx: number, cy: number, cz: number, len: number, r0: number, r1: number, bands: Rgb[]): void {
    const seg = 6
    const nb = bands.length
    for (let b = 0; b < nb; b++) {
      const t0 = b / nb, t1 = (b + 1) / nb
      const ra = r0 + (r1 - r0) * t0, rb = r0 + (r1 - r0) * t1
      const xa = cx + len * t0, xb = cx + len * t1
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2
        const p = (x: number, r: number, an: number): V3 => [x, cy + Math.sin(an) * r, cz + Math.cos(an) * r]
        this.face([p(xa, ra, a0), p(xb, rb, a0), p(xb, rb, a1), p(xa, ra, a1)], bands[b])
      }
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3))
    g.computeBoundingSphere()
    return g
  }

  get isEmpty(): boolean {
    return this.pos.length === 0
  }
}
