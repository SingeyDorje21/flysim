/**
 * Procedural low-poly transports: A220-300 (underwing GTF), A350-900
 * (wide-body with black cockpit mask) and Global 8000 (rear engines, T-tail).
 * Generic liveries only: vertex colours, no textures, no real insignia.
 */

import { Vector3 } from 'three'
import { getAircraft, type AircraftId } from '../../config/aircraftCatalog'
import {
  GeoBuilder,
  Hull,
  addPanel,
  mirrorSecs,
  rgb,
  secAt,
  sec,
  smoothstep,
  wingContains,
  mix,
  type RGB,
  type Sec,
  type Station,
  type V3,
} from './geomKit'
import { JetAssembly, type EngineSpec } from './jetKit'
import type { AircraftRig } from './rigTypes'

interface Range {
  t0: number
  t1: number
}

interface MainGear {
  hingeY: number
  stow: V3
  axles: number[]
  wheelDx: number
  halfWidth: number
  strutR: number
  doorX: number
  doorLenZ: number
}

interface NoseGear {
  hingeY: number
  stow: V3
  wheelDx: number
  halfWidth: number
  strutR: number
}

interface TransportCfg {
  id: AircraftId
  hull: Station[]
  hullSegs: number
  hullSpacing: number
  colors: { body: RGB; belly: RGB; wing: RGB; accent: RGB; engine: RGB; cheat: RGB }
  mask: boolean
  windows: { zStart: number; zEnd: number; pitch: number; phi: number; w: number; h: number }
  wing: Sec[]
  winglet?: Sec[]
  spar: number
  flap: Range & { travel: number }
  aileron: Range
  spoiler: { hinge: [number, number]; plates: [number, number][]; u0: number }
  hstab: Sec[]
  elevator: Range & { u0: number }
  fin: Sec[]
  rudder: Range & { u0: number }
  engines: { spec: EngineSpec; pylon: 'wing' | 'rear' }[]
  nav: { left: V3; right: V3; tail: V3; r: number }
  mainGear: MainGear
  noseGear: NoseGear
}

const WHITE_WING: RGB = [0.8, 0.82, 0.85]

export function hullBottomY(hull: Hull, x: number, z: number): number {
  const s = hull.at(z)
  const f = Math.min(0.999, Math.abs(x) / Math.max(s.w, 0.01))
  return s.y0 - s.bot * Math.pow(1 - Math.pow(f, s.n), 1 / s.n) - 0.01
}

function wingTAtX(secs: Sec[], x: number): number {
  const ax = Math.abs(x)
  for (let i = 0; i < secs.length - 1; i++) {
    const a = Math.abs(secs[i].le[0])
    const b = Math.abs(secs[i + 1].le[0])
    if (ax >= a && ax <= b) return i + (ax - a) / (b - a || 1)
  }
  return secs.length - 1
}

export function fill(b: GeoBuilder, secs: Sec[], u0: number, ranges: Range[], total: number, colour: RGB): void {
  // Static trailing-edge pieces everywhere a movable surface is not.
  const cuts = [...ranges].sort((a, c) => a.t0 - c.t0)
  let cur = 0
  for (const r of cuts) {
    if (r.t0 - cur > 1e-6) addPanel(b, secs, cur, r.t0, u0, 1, colour)
    cur = r.t1
  }
  if (total - cur > 1e-6) addPanel(b, secs, cur, total, u0, 1, colour)
}

export function buildTransport(cfg: TransportCfg, shadows: boolean): AircraftRig {
  const info = getAircraft(cfg.id)
  const geom = info.geometry
  const hull = new Hull(cfg.hull, cfg.hullSpacing)
  const asm = new JetAssembly(cfg.id, shadows, 0x14202c, 0.7)
  const st = asm.statics
  const c = cfg.colors
  const eyeZ = geom.eyePoint.z
  const zNose = hull.z0

  // ------------------------------------------------------------- fuselage
  hull.build(st, cfg.hullSegs, (z, phi) => {
    const a = Math.abs(phi)
    let col = mix(c.body, c.belly, smoothstep(1.9, 2.5, a))
    if (z < zNose + 1.1) col = mix([0.5, 0.52, 0.55], col, smoothstep(zNose + 0.2, zNose + 1.1, z))
    return col
  })
  const R = Math.max(hull.at(0).w, 1)
  const off = R * (1 - Math.cos(Math.PI / cfg.hullSegs)) + 0.02
  const winCol: RGB = [0.07, 0.11, 0.17]
  // Cockpit: optional black mask, then the windscreen panes.
  if (cfg.mask) {
    const edge = (z: number) => 1.95 - 0.6 * smoothstep(eyeZ - 3.0, eyeZ + 1.8, z)
    hull.decal(st, eyeZ - 3.0, eyeZ + 1.8, (z) => -edge(z), (z) => edge(z), [0.02, 0.025, 0.03], off + 0.03, 6, 16)
  }
  for (const s of [1, -1]) {
    hull.decal(st, eyeZ - 1.9, eyeZ - 0.7, () => (s > 0 ? 0.35 : -1.15), () => (s > 0 ? 1.15 : -0.35), winCol, off + 0.06, 1, 3)
    hull.decal(st, eyeZ - 0.6, eyeZ + 0.5, () => (s > 0 ? 1.2 : -1.55), () => (s > 0 ? 1.55 : -1.2), winCol, off + 0.06, 1, 1)
  }
  // Passenger windows.
  const w = cfg.windows
  for (let z = w.zStart; z < w.zEnd; z += w.pitch) {
    const rr = hull.at(z).w
    const dphi = w.h / (2 * Math.max(rr, 0.5))
    for (const s of [1, -1]) {
      hull.decal(st, z, z + w.w, () => s * (w.phi - dphi), () => s * (w.phi + dphi), winCol, off + 0.03)
    }
  }
  // Generic cheat line.
  const zc0 = zNose + 5
  const zc1 = hull.z1 - 2
  for (const s of [1, -1]) {
    hull.decal(st, zc0, zc1, () => s * 1.95, () => s * 2.1, c.cheat, off + 0.015, Math.ceil((zc1 - zc0) / 3))
  }

  // ---------------------------------------------------------------- wings
  const T = cfg.wing.length - 1
  const fl = cfg.flap
  const ai = cfg.aileron
  for (const side of [1, -1] as const) {
    const secs = side > 0 ? cfg.wing : mirrorSecs(cfg.wing)
    addPanel(st, secs, 0, T, 0, cfg.spar, c.wing)
    fill(st, secs, cfg.spar, [fl, ai], T, c.wing)
    asm.flap(secs, fl.t0, fl.t1, cfg.spar, c.wing, fl.travel)
    asm.aileron(secs, side, ai.t0, ai.t1, cfg.spar, c.wing)
    asm.spoiler(secs, cfg.spoiler.hinge, cfg.spoiler.plates, cfg.spoiler.u0, cfg.spar, c.wing, 1.0)
    if (cfg.winglet) {
      const wl = side > 0 ? cfg.winglet : mirrorSecs(cfg.winglet)
      addPanel(st, wl, 0, wl.length - 1, 0, 1, c.accent)
    }
    asm.addEnvelope((x, y, z) => wingContains(secs, x, y, z))
  }

  // ----------------------------------------------------------------- tail
  const hs = cfg.hstab
  const el = cfg.elevator
  const HT = hs.length - 1
  for (const side of [1, -1] as const) {
    const secs = side > 0 ? hs : mirrorSecs(hs)
    addPanel(st, secs, 0, HT, 0, el.u0, c.wing)
    fill(st, secs, el.u0, [el], HT, c.wing)
    asm.elevator(secs, el.t0, el.t1, el.u0, c.wing)
  }
  const FT = cfg.fin.length - 1
  addPanel(st, cfg.fin, 0, FT, 0, cfg.rudder.u0, c.accent)
  fill(st, cfg.fin, cfg.rudder.u0, [cfg.rudder], FT, c.accent)
  asm.rudder(cfg.fin, cfg.rudder.t0, cfg.rudder.t1, cfg.rudder.u0, c.accent)

  // -------------------------------------------------------------- engines
  for (const e of cfg.engines) {
    asm.engine(e.spec, 1)
    asm.engine(e.spec, -1)
    for (const side of [1, -1] as const) {
      const sp = e.spec
      const ex = sp.x * side
      if (e.pylon === 'wing') {
        const t = wingTAtX(cfg.wing, sp.x)
        const ws = secAt(cfg.wing, t)
        const under = ws.le[1] - 0.5 * ws.tc * ws.chord * 0.9
        const yb = sp.y + sp.R * 0.7
        const yt = under + 0.12
        if (yt - yb > 0.08) {
          const zb0 = sp.zFront + 0.3 * sp.len
          const zb1 = sp.zFront + 0.75 * sp.len
          const zt0 = ws.le[2] + 0.15
          const zt1 = zt0 + 0.55 * sp.len
          const hw = 0.16
          st.hexa(
            [
              new Vector3(ex - hw, yb, zb0),
              new Vector3(ex + hw, yb, zb0),
              new Vector3(ex + hw, yb, zb1),
              new Vector3(ex - hw, yb, zb1),
              new Vector3(ex - hw, yt, zt0),
              new Vector3(ex + hw, yt, zt0),
              new Vector3(ex + hw, yt, zt1),
              new Vector3(ex - hw, yt, zt1),
            ],
            c.engine,
          )
        }
      } else {
        // Rear-mounted: a stub from the fuselage side to the nacelle.
        const xi = 0.85 * side
        const xo = (sp.x - sp.R * 0.75) * side
        const z0 = sp.zFront + 0.7
        const z1 = sp.zFront + sp.len * 0.8
        const h = sp.R * 0.45
        st.hexa(
          [
            new Vector3(xi, sp.y - h, z0),
            new Vector3(xo, sp.y - h, z0 + 0.3),
            new Vector3(xo, sp.y - h, z1),
            new Vector3(xi, sp.y - h, z1 + 0.3),
            new Vector3(xi, sp.y + h, z0),
            new Vector3(xo, sp.y + h, z0 + 0.3),
            new Vector3(xo, sp.y + h, z1),
            new Vector3(xi, sp.y + h, z1 + 0.3),
          ],
          c.engine,
        )
      }
    }
  }

  // ----------------------------------------------------------------- gear
  const gg = geom.gear
  const ng = cfg.noseGear
  asm.leg({
    name: 'nose',
    contact: [gg.nose.x, gg.nose.y, gg.nose.z],
    hinge: [0, ng.hingeY, gg.nose.z],
    stow: ng.stow,
    fold: 'x',
    axles: [0],
    wheelDx: ng.wheelDx,
    radius: gg.wheelRadius * 0.8,
    halfWidth: ng.halfWidth,
    strutR: ng.strutR,
    landingLight: true,
  })
  const ndy = hullBottomY(hull, 0.5, gg.nose.z)
  for (const s of [1, -1] as const) asm.door({ x: 0.5, z: gg.nose.z, lenX: 0.5, lenZ: 1.5, hullBottomY: ndy, stayOpen: true }, s)
  const mg = cfg.mainGear
  for (const [name, p] of [
    ['mainLeft', gg.mainLeft],
    ['mainRight', gg.mainRight],
  ] as const) {
    const s = p.x < 0 ? -1 : 1
    asm.leg({
      name,
      contact: [p.x, p.y, p.z],
      hinge: [p.x, mg.hingeY, p.z],
      stow: [mg.stow[0] * s, mg.stow[1], mg.stow[2]],
      fold: 'z',
      axles: mg.axles,
      wheelDx: mg.wheelDx,
      radius: gg.wheelRadius,
      halfWidth: mg.halfWidth,
      strutR: mg.strutR,
    })
    asm.door({ x: mg.doorX, z: p.z, lenX: mg.doorX, lenZ: mg.doorLenZ, hullBottomY: hullBottomY(hull, mg.doorX, p.z), stayOpen: false }, s)
  }

  asm.navLights(cfg.nav.left, cfg.nav.right, cfg.nav.tail, cfg.nav.r)
  return asm.finish((x, y, z) => hull.contains(x, y, z, 0))
}

// ======================================================================= A350

const A350_HULL: Station[] = [
  { z: -33.4, w: 0, top: 0, bot: 0, y0: -0.9 },
  { z: -33.0, w: 0.6, top: 0.5, bot: 0.55, y0: -0.9 },
  { z: -32.0, w: 1.2, top: 1.0, bot: 1.1, y0: -0.75 },
  { z: -30.5, w: 1.9, top: 1.7, bot: 1.75, y0: -0.5 },
  { z: -28.5, w: 2.5, top: 2.4, bot: 2.45, y0: -0.2 },
  { z: -26, w: 2.85, top: 2.85, bot: 2.9, y0: -0.05 },
  { z: -22, w: 2.98, top: 2.98, bot: 3.0, y0: 0 },
  { z: 10, w: 2.98, top: 2.98, bot: 3.0, y0: 0 },
  { z: 14, w: 2.85, top: 2.8, bot: 2.6, y0: 0 },
  { z: 18, w: 2.5, top: 2.5, bot: 2.15, y0: 0.25 },
  { z: 22, w: 2.1, top: 2.15, bot: 1.7, y0: 0.7 },
  { z: 26, w: 1.6, top: 1.7, bot: 1.35, y0: 1.15 },
  { z: 30, w: 0.95, top: 1.1, bot: 0.85, y0: 1.65 },
  { z: 33.4, w: 0.2, top: 0.25, bot: 0.2, y0: 2.0 },
]

const A350: TransportCfg = {
  id: 'a350',
  hull: A350_HULL,
  hullSegs: 32,
  hullSpacing: 3.5,
  colors: { body: rgb(0xeceff2), belly: rgb(0x9da2a8), wing: WHITE_WING, accent: rgb(0x14285a), engine: rgb(0xe4e7ea), cheat: rgb(0x2a4a8a) },
  mask: true,
  windows: { zStart: -24.5, zEnd: 17, pitch: 0.5, phi: 1.2, w: 0.26, h: 0.34 },
  wing: [
    sec(2.2, -1.4, -12.25, 11.0, 0.11),
    sec(29.8, 0.55, 5.67, 2.6, 0.075),
    sec(31.6, 1.1, 7.18, 2.2, 0.06),
    sec(32.375, 1.5, 8.1, 1.8, 0.05),
  ],
  spar: 0.75,
  flap: { t0: 0.138, t1: 0.79, travel: 0.9 },
  aileron: { t0: 0.844, t1: 0.989 },
  spoiler: { hinge: [0.21, 0.72], plates: [[0.21, 0.45], [0.5, 0.72]], u0: 0.62 },
  hstab: [sec(1.4, 1.3, 22.6, 6.3, 0.1), sec(9.5, 1.75, 28.5, 2.0, 0.08)],
  elevator: { t0: 0.148, t1: 0.94, u0: 0.68 },
  fin: [sec(0, 2.2, 17.0, 11.5, 0.1, [1, 0, 0]), sec(0, 12.05, 25.3, 3.8, 0.08, [1, 0, 0])],
  rudder: { t0: 0.18, t1: 0.985, u0: 0.66 },
  engines: [{ spec: { x: 10.5, y: -2.55, zFront: -8.5, len: 6.9, R: 1.55, body: rgb(0xe4e7ea), blades: 18 }, pylon: 'wing' }],
  nav: { left: [-32.4, 1.45, 9.0], right: [32.4, 1.45, 9.0], tail: [0, 11.9, 29.2], r: 0.18 },
  mainGear: { hingeY: -1.7, stow: [1.2, -1.1, 2.2], axles: [-1.5, 0, 1.5], wheelDx: 0.55, halfWidth: 0.2, strutR: 0.17, doorX: 2.15, doorLenZ: 4.4 },
  noseGear: { hingeY: -2.0, stow: [0, -1.0, -23.8], wheelDx: 0.27, halfWidth: 0.14, strutR: 0.12 },
}

// ======================================================================= A220

const A220: TransportCfg = {
  id: 'a220',
  hull: [
    { z: -19.0, w: 0, top: 0, bot: 0, y0: -0.55 },
    { z: -18.6, w: 0.45, top: 0.4, bot: 0.42, y0: -0.55 },
    { z: -17.5, w: 1.0, top: 0.95, bot: 0.98, y0: -0.45 },
    { z: -16.2, w: 1.42, top: 1.4, bot: 1.4, y0: -0.3 },
    { z: -14.5, w: 1.65, top: 1.65, bot: 1.68, y0: -0.18 },
    { z: -11, w: 1.73, top: 1.78, bot: 1.82, y0: -0.08 },
    { z: 7, w: 1.73, top: 1.78, bot: 1.82, y0: -0.08 },
    { z: 11, w: 1.65, top: 1.7, bot: 1.6, y0: 0 },
    { z: 13, w: 1.45, top: 1.55, bot: 1.35, y0: 0.15 },
    { z: 16, w: 0.95, top: 1.1, bot: 0.85, y0: 0.5 },
    { z: 19.7, w: 0.2, top: 0.25, bot: 0.2, y0: 0.75 },
  ],
  hullSegs: 28,
  hullSpacing: 3.0,
  colors: { body: rgb(0xeef0f2), belly: rgb(0xa5aab0), wing: WHITE_WING, accent: rgb(0x0f4c5c), engine: rgb(0xdfe3e6), cheat: rgb(0xe8772e) },
  mask: false,
  windows: { zStart: -13.2, zEnd: 10.5, pitch: 0.53, phi: 1.2, w: 0.27, h: 0.32 },
  wing: [sec(1.3, -1.0, -5.2, 6.3, 0.11), sec(17.55, 0.7, 3.8, 1.4, 0.06)],
  spar: 0.72,
  flap: { t0: 0.105, t1: 0.6, travel: 0.6 },
  aileron: { t0: 0.69, t1: 0.935 },
  spoiler: { hinge: [0.15, 0.58], plates: [[0.15, 0.35], [0.38, 0.58]], u0: 0.58 },
  hstab: [sec(1.0, 0.9, 13.0, 3.4, 0.1), sec(6.6, 1.2, 16.6, 1.3, 0.08)],
  elevator: { t0: 0.14, t1: 0.93, u0: 0.65 },
  fin: [sec(0, 1.0, 8.8, 6.0, 0.1, [1, 0, 0]), sec(0, 8.2, 14.4, 2.4, 0.08, [1, 0, 0])],
  rudder: { t0: 0.21, t1: 0.97, u0: 0.64 },
  engines: [{ spec: { x: 5.5, y: -1.6, zFront: -3.6, len: 4.2, R: 1.1, body: rgb(0xdfe3e6), blades: 16 }, pylon: 'wing' }],
  nav: { left: [-17.5, 0.65, 4.4], right: [17.5, 0.65, 4.4], tail: [0, 8.1, 16.7], r: 0.12 },
  mainGear: { hingeY: -0.85, stow: [0.75, -0.55, 1.5], axles: [0], wheelDx: 0.3, halfWidth: 0.15, strutR: 0.12, doorX: 1.55, doorLenZ: 2.0 },
  noseGear: { hingeY: -1.2, stow: [0, -0.4, -12.6], wheelDx: 0.22, halfWidth: 0.1, strutR: 0.09 },
}

// ================================================================= Global 8000

const GLOBAL: TransportCfg = {
  id: 'global8000',
  hull: [
    { z: -17.5, w: 0, top: 0, bot: 0, y0: -0.45 },
    { z: -17.2, w: 0.3, top: 0.25, bot: 0.28, y0: -0.45 },
    { z: -16.2, w: 0.75, top: 0.72, bot: 0.72, y0: -0.35 },
    { z: -15.0, w: 1.05, top: 1.15, bot: 1.05, y0: -0.15 },
    { z: -13.0, w: 1.22, top: 1.25, bot: 1.28, y0: -0.12 },
    { z: -8, w: 1.25, top: 1.3, bot: 1.3, y0: -0.1 },
    { z: 6, w: 1.25, top: 1.3, bot: 1.3, y0: -0.1 },
    { z: 9, w: 1.15, top: 1.2, bot: 1.15, y0: 0 },
    { z: 12, w: 0.95, top: 1.0, bot: 0.75, y0: 0.15 },
    { z: 14.5, w: 0.55, top: 0.6, bot: 0.45, y0: 0.35 },
    { z: 16.3, w: 0.15, top: 0.2, bot: 0.15, y0: 0.5 },
  ],
  hullSegs: 26,
  hullSpacing: 3.0,
  colors: { body: rgb(0xf2f2ef), belly: rgb(0xb4b7bb), wing: [0.85, 0.86, 0.87], accent: rgb(0x3a3f47), engine: rgb(0xd5d8dc), cheat: rgb(0x8a6a3a) },
  mask: false,
  windows: { zStart: -11.5, zEnd: 7.5, pitch: 0.58, phi: 1.2, w: 0.3, h: 0.36 },
  wing: [sec(0.9, -0.45, -7.46, 6.4, 0.11), sec(15.7, 0.4, 2.9, 1.2, 0.07)],
  winglet: [sec(15.7, 0.4, 2.9, 1.2, 0.07, [1, -0.21, 0]), sec(16.05, 2.05, 4.0, 0.55, 0.06, [1, -0.21, 0])],
  spar: 0.72,
  flap: { t0: 0.074, t1: 0.48, travel: 0.5 },
  aileron: { t0: 0.58, t1: 0.885 },
  spoiler: { hinge: [0.1, 0.45], plates: [[0.1, 0.27], [0.29, 0.45]], u0: 0.58 },
  hstab: [sec(0.1, 5.75, 13.0, 3.0, 0.09), sec(4.5, 5.9, 15.05, 1.1, 0.07)],
  elevator: { t0: 0.15, t1: 0.93, u0: 0.62 },
  fin: [sec(0, 0.9, 8.6, 5.8, 0.1, [1, 0, 0]), sec(0, 5.9, 13.1, 2.9, 0.08, [1, 0, 0])],
  rudder: { t0: 0.1, t1: 0.97, u0: 0.62 },
  engines: [{ spec: { x: 2.05, y: 0.45, zFront: 8.5, len: 4.4, R: 0.62, body: rgb(0xd5d8dc), blades: 12 }, pylon: 'rear' }],
  nav: { left: [-16.0, 1.95, 4.0], right: [16.0, 1.95, 4.0], tail: [0, 5.85, 16.1], r: 0.1 },
  mainGear: { hingeY: -0.8, stow: [0.5, -0.45, 1.6], axles: [0], wheelDx: 0.22, halfWidth: 0.12, strutR: 0.1, doorX: 1.1, doorLenZ: 1.6 },
  noseGear: { hingeY: -0.7, stow: [0, -0.2, -12.2], wheelDx: 0.18, halfWidth: 0.09, strutR: 0.07 },
}

export const createA350 = (shadows: boolean): AircraftRig => buildTransport(A350, shadows)
export const createA220 = (shadows: boolean): AircraftRig => buildTransport(A220, shadows)
export const createGlobal8000 = (shadows: boolean): AircraftRig => buildTransport(GLOBAL, shadows)
