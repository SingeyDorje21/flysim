/**
 * Procedural low-poly geometry kit for the aircraft models. Pure three.js
 * (no React, no DOM) so it runs in node tests.
 *
 * Everything is accumulated into GeoBuilder instances with per-vertex colour
 * (liveries are vertex colours only, never textures), then turned into ONE
 * BufferGeometry per builder. Closed solids get their winding fixed from the
 * signed volume so callers never have to think about face orientation.
 */

import { BufferAttribute, BufferGeometry, Color, Matrix4, Vector3 } from 'three'

export type V3 = readonly [number, number, number]
export type RGB = readonly [number, number, number]
export type ColorSpec = RGB | ((x: number, y: number, z: number) => RGB)

export function rgb(hex: number): RGB {
  const c = new Color(hex)
  return [c.r, c.g, c.b]
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function smoothstep(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a)
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return t * t * (3 - 2 * t)
}

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x)

interface AddOpts {
  /** Closed manifold: winding is fixed from the signed volume. */
  closed?: boolean
  /** Open sheet: each triangle is flipped to face this way. */
  outward?: (x: number, y: number, z: number) => V3
  /** Flat shading (faceted). */
  flat?: boolean
  /** Per original vertex colours (overrides the colour spec). */
  vcols?: RGB[]
}

export class GeoBuilder {
  pos: number[] = []
  col: number[] = []
  nrm: number[] = []
  idx: number[] = []

  get triangles(): number {
    return this.idx.length / 3
  }

  /** Add a triangle mesh. `p` is a flat xyz array, `tri` triangle indices. */
  add(p: number[], tri: number[], color: ColorSpec, o: AddOpts = {}): void {
    const t = tri.slice()
    const n = p.length / 3
    if (o.closed) {
      let vol = 0
      for (let i = 0; i < t.length; i += 3) {
        const a = t[i] * 3
        const b = t[i + 1] * 3
        const c = t[i + 2] * 3
        vol +=
          p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
          p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
          p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])
      }
      if (vol < 0) for (let i = 0; i < t.length; i += 3) [t[i + 1], t[i + 2]] = [t[i + 2], t[i + 1]]
    } else if (o.outward) {
      for (let i = 0; i < t.length; i += 3) {
        const a = t[i] * 3
        const b = t[i + 1] * 3
        const c = t[i + 2] * 3
        const ux = p[b] - p[a]
        const uy = p[b + 1] - p[a + 1]
        const uz = p[b + 2] - p[a + 2]
        const vx = p[c] - p[a]
        const vy = p[c + 1] - p[a + 1]
        const vz = p[c + 2] - p[a + 2]
        const nx = uy * vz - uz * vy
        const ny = uz * vx - ux * vz
        const nz = ux * vy - uy * vx
        const cx = (p[a] + p[b] + p[c]) / 3
        const cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3
        const cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3
        const w = o.outward(cx, cy, cz)
        if (nx * w[0] + ny * w[1] + nz * w[2] < 0) [t[i + 1], t[i + 2]] = [t[i + 2], t[i + 1]]
      }
    }
    const colorOf = (vi: number): RGB => {
      if (o.vcols) return o.vcols[vi]
      if (typeof color === 'function') return color(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2])
      return color
    }
    const base = this.pos.length / 3
    if (o.flat) {
      for (let i = 0; i < t.length; i += 3) {
        const ia = t[i]
        const ib = t[i + 1]
        const ic = t[i + 2]
        const a = ia * 3
        const b = ib * 3
        const c = ic * 3
        const ux = p[b] - p[a]
        const uy = p[b + 1] - p[a + 1]
        const uz = p[b + 2] - p[a + 2]
        const vx = p[c] - p[a]
        const vy = p[c + 1] - p[a + 1]
        const vz = p[c + 2] - p[a + 2]
        let nx = uy * vz - uz * vy
        let ny = uz * vx - ux * vz
        let nz = ux * vy - uy * vx
        const l = Math.hypot(nx, ny, nz) || 1
        nx /= l
        ny /= l
        nz /= l
        const k = this.pos.length / 3
        for (const vi of [ia, ib, ic]) {
          this.pos.push(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2])
          this.nrm.push(nx, ny, nz)
          const cc = colorOf(vi)
          this.col.push(cc[0], cc[1], cc[2])
        }
        this.idx.push(k, k + 1, k + 2)
      }
      return
    }
    const nr = new Array<number>(n * 3).fill(0)
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3
      const b = t[i + 1] * 3
      const c = t[i + 2] * 3
      const ux = p[b] - p[a]
      const uy = p[b + 1] - p[a + 1]
      const uz = p[b + 2] - p[a + 2]
      const vx = p[c] - p[a]
      const vy = p[c + 1] - p[a + 1]
      const vz = p[c + 2] - p[a + 2]
      const nx = uy * vz - uz * vy
      const ny = uz * vx - ux * vz
      const nz = ux * vy - uy * vx
      for (const k of [a, b, c]) {
        nr[k] += nx
        nr[k + 1] += ny
        nr[k + 2] += nz
      }
    }
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2])
      const cc = colorOf(i)
      this.pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
      this.nrm.push(l > 1e-12 ? nr[i * 3] / l : 0, l > 1e-12 ? nr[i * 3 + 1] / l : 1, l > 1e-12 ? nr[i * 3 + 2] / l : 0)
      this.col.push(cc[0], cc[1], cc[2])
    }
    for (let i = 0; i < t.length; i++) this.idx.push(base + t[i])
  }

  /**
   * Loft a closed solid through rings (each an array of equal length). Caps
   * are separate vertices so they shade flat while the sides stay smooth.
   */
  loft(rings: Vector3[][], color: ColorSpec, o: { capStart?: boolean; capEnd?: boolean; flat?: boolean; vcols?: RGB[][] } = {}): void {
    const m = rings[0].length
    const p: number[] = []
    const tri: number[] = []
    const vc: RGB[] = []
    for (let i = 0; i < rings.length; i++) {
      for (let j = 0; j < m; j++) {
        const v = rings[i][j]
        p.push(v.x, v.y, v.z)
        if (o.vcols) vc.push(o.vcols[i][j])
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < m; j++) {
        const j2 = (j + 1) % m
        const a = i * m + j
        const b = i * m + j2
        const c = (i + 1) * m + j2
        const d = (i + 1) * m + j
        tri.push(a, b, c, a, c, d)
      }
    }
    const cap = (ri: number) => {
      const c = new Vector3()
      for (const v of rings[ri]) c.add(v)
      c.multiplyScalar(1 / m)
      const ci = p.length / 3
      p.push(c.x, c.y, c.z)
      if (o.vcols) vc.push(o.vcols[ri][0])
      const first = p.length / 3
      for (let j = 0; j < m; j++) {
        p.push(rings[ri][j].x, rings[ri][j].y, rings[ri][j].z)
        if (o.vcols) vc.push(o.vcols[ri][j])
      }
      for (let j = 0; j < m; j++) tri.push(ci, first + j, first + ((j + 1) % m))
    }
    if (o.capStart) cap(0)
    if (o.capEnd) cap(rings.length - 1)
    this.add(p, tri, color, { closed: true, flat: o.flat, vcols: o.vcols ? vc : undefined })
  }

  /** Grid sheet (rows x cols points), facing `outward`. */
  sheet(grid: Vector3[][], color: ColorSpec, outward: (x: number, y: number, z: number) => V3): void {
    const rows = grid.length
    const cols = grid[0].length
    const p: number[] = []
    const tri: number[] = []
    for (const r of grid) for (const v of r) p.push(v.x, v.y, v.z)
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j
        const b = a + 1
        const c = a + cols + 1
        const d = a + cols
        tri.push(a, b, c, a, c, d)
      }
    }
    this.add(p, tri, color, { outward })
  }

  /** Box from 8 corners: 0..3 one face (in order), 4..7 the opposite face. */
  hexa(c: Vector3[], color: ColorSpec): void {
    this.loft([c.slice(0, 4), c.slice(4, 8)], color, { capStart: true, capEnd: true, flat: true })
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: ColorSpec): void {
    const h = (a: number, b: number, c: number) => new Vector3(cx + a * sx * 0.5, cy + b * sy * 0.5, cz + c * sz * 0.5)
    this.hexa([h(-1, -1, -1), h(1, -1, -1), h(1, 1, -1), h(-1, 1, -1), h(-1, -1, 1), h(1, -1, 1), h(1, 1, 1), h(-1, 1, 1)], color)
  }

  /** Tube / cone / cylinder between two points. */
  tube(a: Vector3, b: Vector3, r0: number, r1: number, seg: number, color: ColorSpec, caps = true, flat = false): void {
    const axis = b.clone().sub(a)
    const len = axis.length()
    axis.multiplyScalar(1 / (len || 1))
    const ref = Math.abs(axis.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
    const u = new Vector3().crossVectors(axis, ref).normalize()
    const v = new Vector3().crossVectors(axis, u)
    const ring = (c: Vector3, r: number) => {
      const out: Vector3[] = []
      for (let j = 0; j < seg; j++) {
        const t = (j / seg) * Math.PI * 2
        out.push(c.clone().addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r))
      }
      return out
    }
    this.loft([ring(a, r0), ring(b, r1)], color, { capStart: caps && r0 > 0, capEnd: caps && r1 > 0, flat })
  }

  /** Ellipsoid; `domeUp` flattens the lower half (canopy dome). Rings run along z. */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seg: number, rings: number, color: ColorSpec, domeUp = false): void {
    const rs: Vector3[][] = []
    for (let i = 0; i <= rings; i++) {
      const th = (i / rings) * Math.PI
      const z = cz - Math.cos(th) * rz
      const s = Math.sin(th)
      const ring: Vector3[] = []
      for (let j = 0; j < seg; j++) {
        const t = (j / seg) * Math.PI * 2
        let y = Math.sin(t) * s * ry
        if (domeUp && y < 0) y = 0
        ring.push(new Vector3(cx + Math.cos(t) * s * rx, cy + y, z))
      }
      rs.push(ring)
    }
    this.loft(rs, color)
  }

  /** Solid of revolution about the +z axis. Profile runs axis to axis. */
  lathe(profile: { r: number; z: number; c: RGB }[], seg: number, origin: Vector3, scaleY = 1): void {
    const rs: Vector3[][] = []
    const vc: RGB[][] = []
    for (const pt of profile) {
      const ring: Vector3[] = []
      for (let j = 0; j < seg; j++) {
        const t = (j / seg) * Math.PI * 2
        ring.push(new Vector3(origin.x + Math.cos(t) * pt.r, origin.y + Math.sin(t) * pt.r * scaleY, origin.z + pt.z))
      }
      rs.push(ring)
      vc.push(ring.map(() => pt.c))
    }
    this.loft(rs, [0, 0, 0], { vcols: vc })
  }

  toGeometry(bake?: Matrix4): BufferGeometry {
    const g = new BufferGeometry()
    const pos = new Float32Array(this.pos)
    const nrm = new Float32Array(this.nrm)
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('normal', new BufferAttribute(nrm, 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3))
    g.setIndex(new BufferAttribute(new Uint32Array(this.idx), 1))
    if (bake) {
      g.applyMatrix4(bake)
    }
    g.computeBoundingBox()
    g.computeBoundingSphere()
    return g
  }
}

// ------------------------------------------------------------ interpolation

/** Monotone cubic (PCHIP) interpolant through (xs, ys). */
export function pchip(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length
  const h: number[] = []
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i])
    d.push((ys[i + 1] - ys[i]) / h[i])
  }
  const m = new Array<number>(n).fill(0)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0
    else {
      const w1 = 2 * h[i] + h[i - 1]
      const w2 = h[i] + 2 * h[i - 1]
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (x > xs[i + 1]) i++
    const t = (x - xs[i]) / h[i]
    const t2 = t * t
    const t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1]
  }
}

// -------------------------------------------------------------------- hull

export interface Station {
  z: number
  /** Half width, half height above and below the section centre, centre height. */
  w: number
  top: number
  bot: number
  y0: number
  /** Superellipse exponent (2 = ellipse, ~1 = diamond). */
  n?: number
}

export interface HullSection {
  w: number
  top: number
  bot: number
  y0: number
  n: number
}

export class Hull {
  readonly z0: number
  readonly z1: number
  private fw: (z: number) => number
  private ft: (z: number) => number
  private fb: (z: number) => number
  private fy: (z: number) => number
  private fn: (z: number) => number
  readonly zs: number[]

  constructor(ctrl: Station[], spacing: number) {
    const cz = ctrl.map((s) => s.z)
    this.fw = pchip(cz, ctrl.map((s) => s.w))
    this.ft = pchip(cz, ctrl.map((s) => s.top))
    this.fb = pchip(cz, ctrl.map((s) => s.bot))
    this.fy = pchip(cz, ctrl.map((s) => s.y0))
    this.fn = pchip(cz, ctrl.map((s) => s.n ?? 2))
    this.z0 = cz[0]
    this.z1 = cz[cz.length - 1]
    const zs: number[] = [cz[0]]
    for (let i = 0; i < cz.length - 1; i++) {
      const k = Math.max(1, Math.round((cz[i + 1] - cz[i]) / spacing))
      for (let j = 1; j <= k; j++) zs.push(cz[i] + ((cz[i + 1] - cz[i]) * j) / k)
    }
    this.zs = zs
  }

  at(z: number): HullSection {
    return { w: Math.max(0, this.fw(z)), top: Math.max(0, this.ft(z)), bot: Math.max(0, this.fb(z)), y0: this.fy(z), n: Math.max(1, this.fn(z)) }
  }

  /** Point on the skin. phi = 0 at the top, +pi/2 towards +X, pi at the belly. */
  surface(z: number, phi: number): Vector3 {
    const s = this.at(z)
    const sn = Math.sin(phi)
    const cs = Math.cos(phi)
    const e = 2 / s.n
    return new Vector3(s.w * Math.sign(sn) * Math.pow(Math.abs(sn), e), s.y0 + (cs >= 0 ? s.top : s.bot) * Math.sign(cs) * Math.pow(Math.abs(cs), e), z)
  }

  /** Is the body-frame point inside the skin (shrunk by `margin` metres)? */
  contains(x: number, y: number, z: number, margin = 0): boolean {
    if (z < this.z0 || z > this.z1) return false
    const s = this.at(z)
    const dy = y - s.y0
    const hh = dy >= 0 ? s.top : s.bot
    const w = s.w - margin
    const h = hh - margin
    if (w <= 0 || h <= 0) return false
    return Math.pow(Math.abs(x) / w, s.n) + Math.pow(Math.abs(dy) / h, s.n) <= 1
  }

  /** Skin mesh with a paint function (z, phi, x, y) -> colour. */
  build(b: GeoBuilder, segs: number, paint: (z: number, phi: number, p: Vector3) => RGB, capTail = true): void {
    const rings: Vector3[][] = []
    const vc: RGB[][] = []
    for (const z of this.zs) {
      const r: Vector3[] = []
      const c: RGB[] = []
      for (let j = 0; j < segs; j++) {
        const phi = (j / segs) * Math.PI * 2
        const p = this.surface(z, phi)
        r.push(p)
        c.push(paint(z, phi > Math.PI ? phi - Math.PI * 2 : phi, p))
      }
      rings.push(r)
      vc.push(c)
    }
    b.loft(rings, [0, 0, 0], { vcols: vc, capEnd: capTail && this.at(this.z1).w > 1e-3, capStart: this.at(this.z0).w > 1e-3 })
  }

  /** Decal strip on the skin between z0..z1 and phi range (functions of z), offset outward. */
  decal(b: GeoBuilder, za: number, zb: number, phiLo: (z: number) => number, phiHi: (z: number) => number, color: RGB, off: number, nz = 1, nphi = 1): void {
    const grid: Vector3[][] = []
    for (let i = 0; i <= nz; i++) {
      const z = za + ((zb - za) * i) / nz
      const lo = phiLo(z)
      const hi = phiHi(z)
      const row: Vector3[] = []
      for (let j = 0; j <= nphi; j++) {
        const phi = lo + ((hi - lo) * j) / nphi
        const p = this.surface(z, phi)
        const s = this.at(z)
        const dir = new Vector3(p.x, p.y - s.y0, 0)
        if (dir.lengthSq() > 0) dir.normalize()
        row.push(p.addScaledVector(dir, off))
      }
      grid.push(row)
    }
    b.sheet(grid, color, (x, y, z) => {
      const s = this.at(z)
      const l = Math.hypot(x, y - s.y0) || 1
      return [x / l, (y - s.y0) / l, 0]
    })
  }
}

// ------------------------------------------------------- lifting surfaces

export interface Sec {
  /** Leading edge point at mid-thickness. */
  le: V3
  chord: number
  /** Thickness / chord. */
  tc: number
  /** Unit thickness direction. */
  up: V3
}

export function sec(x: number, y: number, z: number, chord: number, tc: number, up: V3 = [0, 1, 0]): Sec {
  return { le: [x, y, z], chord, tc, up }
}

export function mirrorSecs(secs: Sec[]): Sec[] {
  return secs.map((s) => ({ le: [-s.le[0], s.le[1], s.le[2]] as V3, chord: s.chord, tc: s.tc, up: [-s.up[0], s.up[1], s.up[2]] as V3 }))
}

const U_SAMPLES = [0.015, 0.05, 0.12, 0.22, 0.34, 0.48, 0.62, 0.76, 0.88]

export function halfThick(u: number, tc: number, chord: number): number {
  const s = Math.sqrt(Math.max(u, 0))
  return 5 * tc * chord * (0.2969 * s - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4)
}

export function secAt(secs: Sec[], t: number): Sec {
  const i = Math.min(secs.length - 2, Math.max(0, Math.floor(t)))
  const f = t - i
  const a = secs[i]
  const b = secs[i + 1]
  const l = (p: number, q: number) => p + (q - p) * f
  const up = new Vector3(l(a.up[0], b.up[0]), l(a.up[1], b.up[1]), l(a.up[2], b.up[2])).normalize()
  return { le: [l(a.le[0], b.le[0]), l(a.le[1], b.le[1]), l(a.le[2], b.le[2])], chord: l(a.chord, b.chord), tc: l(a.tc, b.tc), up: [up.x, up.y, up.z] }
}

/** Mid-thickness point at chord fraction u of the interpolated section at t. */
export function secPoint(secs: Sec[], t: number, u: number): Vector3 {
  const s = secAt(secs, t)
  return new Vector3(s.le[0], s.le[1], s.le[2] + u * s.chord)
}

function ringAt(s: Sec, u0: number, u1: number): Vector3[] {
  const us = [u0, ...U_SAMPLES.filter((u) => u > u0 + 1e-6 && u < u1 - 1e-6), u1]
  const pt = (u: number, sgn: number) => {
    const h = halfThick(u, s.tc, s.chord) * sgn
    return new Vector3(s.le[0] + s.up[0] * h, s.le[1] + s.up[1] * h, s.le[2] + s.up[2] * h + u * s.chord)
  }
  const top = us.map((u) => pt(u, 1))
  const bot = us.map((u) => pt(u, -1)).reverse()
  if (halfThick(u1, s.tc, s.chord) < 1e-5) bot.shift()
  if (halfThick(u0, s.tc, s.chord) < 1e-5) bot.pop()
  return [...top, ...bot]
}

/** Rings of a panel spanning section parameter t0..t1 and chord u0..u1 (integer t are real sections). */
export function panelRings(secs: Sec[], t0: number, t1: number, u0: number, u1: number): Vector3[][] {
  const ts = [t0]
  for (let k = Math.floor(t0) + 1; k < t1 - 1e-9; k++) if (k > t0 + 1e-9) ts.push(k)
  ts.push(t1)
  return ts.map((t) => ringAt(secAt(secs, t), u0, u1))
}

export function addPanel(b: GeoBuilder, secs: Sec[], t0: number, t1: number, u0: number, u1: number, color: ColorSpec): void {
  b.loft(panelRings(secs, t0, t1, u0, u1), color, { capStart: true, capEnd: true })
}

/** Thin plate lying on the upper surface (spoiler). */
export function addSpoilerPlate(b: GeoBuilder, secs: Sec[], t0: number, t1: number, u0: number, u1: number, lift: number, thick: number, color: ColorSpec): void {
  const mk = (t: number) => {
    const s = secAt(secs, t)
    const pt = (u: number, dy: number) => {
      const h = halfThick(u, s.tc, s.chord) + dy
      return new Vector3(s.le[0] + s.up[0] * h, s.le[1] + s.up[1] * h, s.le[2] + s.up[2] * h + u * s.chord)
    }
    return [pt(u0, lift - thick), pt(u1, lift - thick), pt(u1, lift), pt(u0, lift)]
  }
  b.loft([mk(t0), mk(t1)], color, { capStart: true, capEnd: true, flat: true })
}

/** Frame whose x runs along the hinge line, z aft, y roughly up (wing-like surfaces). */
export function hingeFrameX(p0: Vector3, p1: Vector3): { m: Matrix4; origin: Vector3 } {
  let a = p0
  let b = p1
  if (b.x < a.x) [a, b] = [b, a]
  const x = b.clone().sub(a).normalize()
  const aft = new Vector3(0, 0, 1)
  const z = aft.sub(x.clone().multiplyScalar(aft.dot(x))).normalize()
  const y = new Vector3().crossVectors(z, x)
  const m = new Matrix4().makeBasis(x, y, z)
  m.setPosition(a)
  return { m, origin: a.clone() }
}

/** Frame whose y runs up along the hinge, z aft, x = y cross z (rudders). */
export function hingeFrameY(p0: Vector3, p1: Vector3): { m: Matrix4; origin: Vector3 } {
  let a = p0
  let b = p1
  if (b.y < a.y) [a, b] = [b, a]
  const y = b.clone().sub(a).normalize()
  const aft = new Vector3(0, 0, 1)
  const z = aft.sub(y.clone().multiplyScalar(aft.dot(y))).normalize()
  const x = new Vector3().crossVectors(y, z)
  const m = new Matrix4().makeBasis(x, y, z)
  m.setPosition(a)
  return { m, origin: a.clone() }
}

/** Surface-top height of a section list at spanwise body x (for pylons). Returns mid-thickness y. */
export function wingYAt(secs: Sec[], x: number): number {
  for (let i = 0; i < secs.length - 1; i++) {
    const a = Math.abs(secs[i].le[0])
    const b = Math.abs(secs[i + 1].le[0])
    const ax = Math.abs(x)
    if (ax >= a && ax <= b) {
      const f = (ax - a) / (b - a || 1)
      return secs[i].le[1] + (secs[i + 1].le[1] - secs[i].le[1]) * f
    }
  }
  return secs[secs.length - 1].le[1]
}

/** Point on the upper (sgn = 1) or lower surface at chord fraction u of the section at t. */
export function secSurfacePoint(secs: Sec[], t: number, u: number, sgn = 1): Vector3 {
  const s = secAt(secs, t)
  const h = halfThick(u, s.tc, s.chord) * sgn
  return new Vector3(s.le[0] + s.up[0] * h, s.le[1] + s.up[1] * h, s.le[2] + s.up[2] * h + u * s.chord)
}

/** Is the point inside the (right or mirrored) wing volume described by `secs`? */
export function wingContains(secs: Sec[], x: number, y: number, z: number): boolean {
  const ax = Math.abs(x)
  for (let i = 0; i < secs.length - 1; i++) {
    const a = Math.abs(secs[i].le[0])
    const b = Math.abs(secs[i + 1].le[0])
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    if (ax < lo || ax > hi) continue
    // Only the sign-matching wing.
    if (secs[i].le[0] * x < 0) return false
    const s = secAt(secs, i + (ax - a) / (b - a || 1))
    if (z < s.le[2] || z > s.le[2] + s.chord) return false
    const u = (z - s.le[2]) / s.chord
    const h = halfThick(u, s.tc, s.chord)
    return Math.abs(y - s.le[1]) <= h
  }
  return false
}
