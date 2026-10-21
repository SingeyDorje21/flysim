/**
 * Procedural low-poly 5th-generation fighter: blended diamond fuselage,
 * trapezoidal wings and all-moving stabilators, twin canted fins, caret
 * intakes, gold canopy, 2D thrust-vectoring nozzles with afterburner flames.
 * Grey camouflage in vertex colours; no insignia.
 */

import { Group, Mesh, Vector3 } from 'three'
import { getAircraft } from '../../config/aircraftCatalog'
import { GeoBuilder, Hull, addPanel, clamp, mirrorSecs, rgb, sec, smoothstep, wingContains, type RGB, type Station } from './geomKit'
import { JetAssembly, flameMaterial } from './jetKit'
import { fill, hullBottomY } from './transport'
import type { AircraftRig } from './rigTypes'

const HULL: Station[] = [
  { z: -9.9, w: 0, top: 0, bot: 0, y0: -0.5, n: 2 },
  { z: -9.3, w: 0.3, top: 0.22, bot: 0.2, y0: -0.45, n: 2 },
  { z: -8.0, w: 0.65, top: 0.42, bot: 0.38, y0: -0.38, n: 1.9 },
  { z: -6.5, w: 0.95, top: 0.62, bot: 0.5, y0: -0.28, n: 1.7 },
  { z: -5.0, w: 1.15, top: 0.72, bot: 0.58, y0: -0.2, n: 1.6 },
  { z: -3.0, w: 1.3, top: 0.75, bot: 0.62, y0: -0.15, n: 1.55 },
  { z: 0, w: 1.4, top: 0.78, bot: 0.68, y0: -0.12, n: 1.55 },
  { z: 3.0, w: 1.4, top: 0.75, bot: 0.68, y0: -0.1, n: 1.55 },
  { z: 6.0, w: 1.3, top: 0.65, bot: 0.58, y0: -0.06, n: 1.6 },
  { z: 7.6, w: 1.25, top: 0.52, bot: 0.55, y0: -0.05, n: 1.7 },
]

const CAMO_LIGHT: RGB = rgb(0x6a6e74)
const CAMO_DARK: RGB = rgb(0x4b4f55)
const SURF: RGB = rgb(0x575b61)
const NOZZLE_Y = -0.05
const NOZZLE_Z = 7.6
const NOZZLE_LEN = 1.42

export function createF22(shadows: boolean): AircraftRig {
  const info = getAircraft('f22')
  const geom = info.geometry
  const hull = new Hull(HULL, 2.2)
  const asm = new JetAssembly('f22', shadows, 0x9a7418, 0.5)
  const st = asm.statics

  // ------------------------------------------------------------- fuselage
  hull.build(st, 24, (z, phi) => {
    const a = Math.abs(phi)
    const v = Math.sin(z * 0.7 + 2.0 * Math.cos(2 * phi)) + 0.6 * Math.sin(z * 1.9 - phi * 3)
    let col: RGB = v > 0.5 ? CAMO_DARK : CAMO_LIGHT
    if (a > 2.2) col = [col[0] * 1.12, col[1] * 1.12, col[2] * 1.12]
    if (z < -8.6) col = [0.3, 0.31, 0.33]
    return col
  })

  // Canopy (hidden in the cockpit view) and a dark coaming strip.
  asm.glass.ellipsoid(0, 0.3, -5.4, 0.5, 0.8, 2.0, 16, 10, [1, 1, 1], true)

  // ---------------------------------------------------------------- intakes
  const dark: RGB = [0.04, 0.04, 0.05]
  for (const s of [1, -1] as const) {
    const xi = 0.95 * s
    const xo = 1.75 * s
    const P = (x: number, y: number, z: number) => new Vector3(x, y, z)
    st.hexa(
      [P(xi, -0.5, -4.7), P(xo, -0.5, -4.7), P(xo, -0.5, -0.8), P(xi, -0.5, -0.8), P(xi, 0.45, -4.3), P(xo, 0.45, -4.3), P(xo, 0.45, -0.8), P(xi, 0.45, -0.8)],
      CAMO_DARK,
    )
    const grid: Vector3[][] = []
    for (let i = 0; i <= 1; i++) {
      const y = -0.5 + 0.95 * i
      const z = -4.7 + 0.4 * i - 0.015
      grid.push([P(xi + 0.08 * s, y + (i ? -0.08 : 0.08), z), P(xo - 0.08 * s, y + (i ? -0.08 : 0.08), z)])
    }
    st.sheet(grid, dark, () => [0, -0.3, -1])
  }

  // ---------------------------------------------------------------- wings
  const wing = [sec(0.9, -0.4, -2.99, 8.9, 0.045), sec(6.78, -0.4, 2.3, 1.8, 0.07)]
  const spar = 0.7
  const flaperon = { t0: 0.153, t1: 0.493 }
  const aileron = { t0: 0.544, t1: 0.935 }
  for (const side of [1, -1] as const) {
    const secs = side > 0 ? wing : mirrorSecs(wing)
    addPanel(st, secs, 0, 1, 0, spar, SURF)
    fill(st, secs, spar, [flaperon, aileron], 1, SURF)
    asm.flap(secs, flaperon.t0, flaperon.t1, spar, SURF, 0.5)
    asm.aileron(secs, side, aileron.t0, aileron.t1, spar, SURF)
    asm.addEnvelope((x, y, z) => wingContains(secs, x, y, z))
  }

  // ---------------------------------------------------- stabilators and fins
  const stab = [sec(1.2, -0.1, 4.6, 3.6, 0.05), sec(4.45, -0.1, 7.33, 1.2, 0.06)]
  const cant = (27 * Math.PI) / 180
  for (const side of [1, -1] as const) {
    asm.stabilator(side > 0 ? stab : mirrorSecs(stab), 0.45, SURF)
  }
  const fin = [
    sec(1.0, 0.45, 3.6, 4.6, 0.06, [Math.cos(cant), -Math.sin(cant), 0]),
    sec(1.0 + 3.06 * Math.sin(cant), 3.18, 5.03, 1.6, 0.05, [Math.cos(cant), -Math.sin(cant), 0]),
  ]
  const rud = { t0: 0.25, t1: 0.985, u0: 0.62 }
  for (const side of [1, -1] as const) {
    const secs = side > 0 ? fin : mirrorSecs(fin)
    addPanel(st, secs, 0, 1, 0, rud.u0, CAMO_DARK)
    fill(st, secs, rud.u0, [rud], 1, CAMO_DARK)
    asm.rudder(secs, rud.t0, rud.t1, rud.u0, CAMO_DARK)
  }

  // Dorsal speed brake between the fins.
  {
    const b = new GeoBuilder()
    b.box(0, -0.02, 0.9, 1.0, 0.05, 1.8, CAMO_DARK)
    const g = new Group()
    g.position.set(0, 0.6, 3.2)
    asm.mesh(b, g)
    asm.root.add(g)
    asm.spoilers.push({ g, max: 0.9 })
  }

  // ------------------------------------------------------ nozzles and flames
  const nozzleMat = rgb(0x2b2a2a)
  const outerMat = asm.mat(flameMaterial(0xff7a1a))
  const innerMat = asm.mat(flameMaterial(0xcfe6ff))
  const cone = new GeoBuilder()
  cone.tube(new Vector3(0, 0, 0), new Vector3(0, 0, 1), 1, 0, 12, [1, 1, 1], false)
  const coneGeo = asm.geo(cone)
  const nozzles: { g: Group; outer: Mesh; inner: Mesh }[] = []
  for (const s of [1, -1] as const) {
    const g = new Group()
    g.position.set(0.92 * s, NOZZLE_Y, NOZZLE_Z)
    const b = new GeoBuilder()
    const P = (x: number, y: number, z: number) => new Vector3(x, y, z)
    b.hexa(
      [P(-0.6, -0.45, 0), P(0.6, -0.45, 0), P(0.6, 0.45, 0), P(-0.6, 0.45, 0), P(-0.55, -0.3, NOZZLE_LEN), P(0.55, -0.3, NOZZLE_LEN), P(0.55, 0.3, NOZZLE_LEN), P(-0.55, 0.3, NOZZLE_LEN)],
      nozzleMat,
    )
    asm.mesh(b, g)
    const mk = (m: typeof outerMat, rx: number, ry: number) => {
      const mesh = new Mesh(coneGeo, m)
      mesh.position.z = NOZZLE_LEN
      mesh.scale.set(rx, ry, 0.001)
      mesh.userData.noBounds = true
      mesh.frustumCulled = false
      mesh.renderOrder = 2
      g.add(mesh)
      return mesh
    }
    const outer = mk(outerMat, 0.5, 0.32)
    const inner = mk(innerMat, 0.3, 0.19)
    asm.root.add(g)
    nozzles.push({ g, outer, inner })
  }
  asm.extra.push((rs, _cockpit, _dt, time) => {
    const tv = clamp(rs.thrustVector, -0.6, 0.6)
    const glow = smoothstep(0.75, 1.0, rs.n1)
    const flick = 1 + 0.06 * Math.sin(time * 61) + 0.04 * Math.sin(time * 37 + 1)
    for (const n of nozzles) {
      n.g.rotation.x = -tv
      const lo = rs.afterburner ? (5.0 + 1.5 * clamp(rs.n1 - 0.8, 0, 0.3) * 5) * flick : 1.2 * glow
      const li = rs.afterburner ? lo * 0.55 : 0
      n.outer.visible = lo > 0.05
      n.inner.visible = li > 0.05
      n.outer.scale.z = Math.max(lo, 0.001)
      n.inner.scale.z = Math.max(li, 0.001)
      outerMat.opacity = rs.afterburner ? 0.55 : 0.3 * glow
      innerMat.opacity = rs.afterburner ? 0.9 : 0
    }
  })

  // ----------------------------------------------------------------- gear
  const gg = geom.gear
  asm.leg({
    name: 'nose',
    contact: [gg.nose.x, gg.nose.y, gg.nose.z],
    hinge: [0, -0.6, gg.nose.z],
    stow: [0, -0.15, -5.2],
    fold: 'x',
    axles: [0],
    wheelDx: 0.15,
    radius: gg.wheelRadius * 0.8,
    halfWidth: 0.08,
    strutR: 0.07,
    landingLight: true,
  })
  for (const s of [1, -1] as const) {
    asm.door({ x: 0.35, z: gg.nose.z, lenX: 0.35, lenZ: 0.9, hullBottomY: hullBottomY(hull, 0.35, gg.nose.z), stayOpen: true }, s)
  }
  for (const [name, p] of [
    ['mainLeft', gg.mainLeft],
    ['mainRight', gg.mainRight],
  ] as const) {
    const s = p.x < 0 ? -1 : 1
    asm.leg({
      name,
      contact: [p.x, p.y, p.z],
      hinge: [p.x, -0.45, p.z],
      stow: [0.7 * s, -0.35, p.z],
      fold: 'z',
      axles: [0],
      wheelDx: 0,
      radius: gg.wheelRadius,
      halfWidth: 0.15,
      strutR: 0.1,
    })
    asm.door({ x: 1.2, z: p.z, lenX: 1.2, lenZ: 0.9, hullBottomY: hullBottomY(hull, 1.2, p.z), stayOpen: false }, s)
  }

  asm.navLights([-6.8, -0.4, 3.2], [6.8, -0.4, 3.2], [0, 0.35, 7.5], 0.1)
  asm.fanRate = 0
  return asm.finish((x, y, z) => hull.contains(x, y, z, 0))
}
