/**
 * Shared assembly + animation for the jet models (F-22, A220, A350, Global 8000).
 *
 * Static parts are merged into ONE vertex-coloured mesh; every animated part
 * (control surfaces, gear legs and doors, fans, nozzles) is its own mesh under
 * a pivot group. Sign conventions follow src/simulation/types.ts:
 *   elevator +  = trailing edge up          -> deflect.rotation.x = -elevator
 *   aileron  +  = right TE up, left TE down -> right.x = -aileron, left.x = +aileron
 *   rudder   +  = trailing edge to +X       -> deflect.rotation.y = +rudder
 *   flaps    +  = trailing edge down        -> deflect.rotation.x = +flaps (and slides aft)
 *   thrustVector + = nozzle trailing edge up -> rotation.x = -thrustVector
 */

import {
  AdditiveBlending,
  BufferGeometry,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three'
import type { AircraftId } from '../../config/aircraftCatalog'
import type { CameraMode } from '../../game/types'
import type { AircraftRenderState } from '../../simulation/types'
import {
  GeoBuilder,
  addPanel,
  addSpoilerPlate,
  clamp,
  hingeFrameX,
  hingeFrameY,
  rgb,
  secPoint,
  secSurfacePoint,
  smoothstep,
  type RGB,
  type Sec,
  type V3,
} from './geomKit'
import type { AircraftRig, LegName, RigWheel } from './rigTypes'

export const C = {
  steel: rgb(0x8c9096),
  darkSteel: rgb(0x3a3d42),
  tyre: rgb(0x0f0f11),
  hub: rgb(0x9a9ea4),
  dark: rgb(0x0b0c0e),
  glass: rgb(0x16222e),
}

const v3 = (p: V3) => new Vector3(p[0], p[1], p[2])
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

interface Pivoted {
  pivot: Group
  deflect: Group
}

interface LegAnim {
  group: Group
  hinge: Vector3
  u: Vector3
  theta: number
  axis: 'x' | 'z'
  light?: Mesh
}

interface DoorAnim {
  group: Group
  open: number
  stayOpen: boolean
}

export interface LegSpec {
  name: LegName
  contact: V3
  hinge: V3
  stow: V3
  fold: 'x' | 'z'
  /** Axle offsets along z relative to the contact point. */
  axles: number[]
  /** Half distance between the two wheels of an axle (0 = single wheel). */
  wheelDx: number
  radius: number
  halfWidth: number
  strutR: number
  landingLight?: boolean
}

export interface DoorSpec {
  /** Hinge position (x of the hinge edge, z centre). */
  x: number
  z: number
  /** Plate size: inward length (x), z length. */
  lenX: number
  lenZ: number
  hullBottomY: number
  stayOpen: boolean
}

export interface EngineSpec {
  /** Nacelle centre-line start (front of the lip). */
  x: number
  y: number
  zFront: number
  len: number
  R: number
  body: RGB
  blades?: number
}

export type FrameUpdate = (rs: AircraftRenderState, cockpit: boolean, dt: number, time: number) => void

export class JetAssembly {
  readonly root = new Group()
  readonly geos: BufferGeometry[] = []
  readonly mats: Material[] = []
  readonly statics = new GeoBuilder()
  readonly glass = new GeoBuilder()
  readonly lamps = new GeoBuilder()
  readonly bodyMat: MeshStandardMaterial
  readonly glassMat: MeshStandardMaterial
  readonly lampMat: MeshBasicMaterial
  readonly wheels: RigWheel[] = []

  elevators: Group[] = []
  rudders: Group[] = []
  ailerons: { g: Group; side: 1 | -1 }[] = []
  flaps: { g: Group; travel: number }[] = []
  spoilers: { g: Group; max: number }[] = []
  legs: LegAnim[] = []
  doors: DoorAnim[] = []
  fans: Group[] = []
  fanRate = 10
  hideInCockpit: Group[] = []
  strobes: Mesh[] = []
  extra: FrameUpdate[] = []
  glassHideInCockpit: Mesh | null = null
  private time = 0
  private envelopeTests: ((x: number, y: number, z: number) => boolean)[] = []

  constructor(
    readonly id: AircraftId,
    readonly shadows: boolean,
    glassColor: number,
    glassOpacity: number,
  ) {
    this.bodyMat = this.mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 }))
    this.glassMat = this.mat(
      new MeshStandardMaterial({ color: glassColor, roughness: 0.08, metalness: 0.6, transparent: true, opacity: glassOpacity }),
    )
    this.lampMat = this.mat(new MeshBasicMaterial({ vertexColors: true, toneMapped: false }))
  }

  mat<T extends Material>(m: T): T {
    this.mats.push(m)
    return m
  }

  geo(b: GeoBuilder, bake?: Matrix4): BufferGeometry {
    const g = b.toGeometry(bake)
    this.geos.push(g)
    return g
  }

  /** Mesh from a builder, using the body material. */
  mesh(b: GeoBuilder, parent: Group, bake?: Matrix4, cast = true): Mesh {
    const m = new Mesh(this.geo(b, bake), this.bodyMat)
    m.castShadow = cast && this.shadows
    parent.add(m)
    return m
  }

  addEnvelope(fn: (x: number, y: number, z: number) => boolean): void {
    this.envelopeTests.push(fn)
  }

  // ------------------------------------------------------ control surfaces

  /** Hinged trailing-edge panel on a lifting surface. */
  control(kind: 'x' | 'y', secs: Sec[], t0: number, t1: number, u0: number, u1: number, color: RGB): Pivoted {
    const p0 = secPoint(secs, t0, u0)
    const p1 = secPoint(secs, t1, u0)
    const f = kind === 'x' ? hingeFrameX(p0, p1) : hingeFrameY(p0, p1)
    const b = new GeoBuilder()
    addPanel(b, secs, t0, t1, u0, u1, color)
    return this.pivoted(b, f.m, f.origin)
  }

  private pivoted(b: GeoBuilder, m: Matrix4, origin: Vector3): Pivoted {
    const pivot = new Group()
    pivot.position.copy(origin)
    pivot.quaternion.setFromRotationMatrix(m)
    const deflect = new Group()
    pivot.add(deflect)
    this.mesh(b, deflect, m.clone().invert())
    this.root.add(pivot)
    return { pivot, deflect }
  }

  elevator(secs: Sec[], t0: number, t1: number, u0: number, color: RGB): void {
    this.elevators.push(this.control('x', secs, t0, t1, u0, 1, color).deflect)
  }

  /** All-moving stabilator: the entire surface turns about chord fraction `pivotU`. */
  stabilator(secs: Sec[], pivotU: number, color: RGB): void {
    const t1 = secs.length - 1
    const p0 = secPoint(secs, 0, pivotU)
    const p1 = secPoint(secs, t1, pivotU)
    const f = hingeFrameX(p0, p1)
    const b = new GeoBuilder()
    addPanel(b, secs, 0, t1, 0, 1, color)
    this.elevators.push(this.pivoted(b, f.m, f.origin).deflect)
  }

  aileron(secs: Sec[], side: 1 | -1, t0: number, t1: number, u0: number, color: RGB): void {
    this.ailerons.push({ g: this.control('x', secs, t0, t1, u0, 1, color).deflect, side })
  }

  flap(secs: Sec[], t0: number, t1: number, u0: number, color: RGB, travel: number): void {
    this.flaps.push({ g: this.control('x', secs, t0, t1, u0, 1, color).deflect, travel })
  }

  rudder(secs: Sec[], t0: number, t1: number, u0: number, color: RGB): void {
    this.rudders.push(this.control('y', secs, t0, t1, u0, 1, color).deflect)
  }

  /** Spoiler plates on the upper surface sharing one hinge line, hinged at chord fraction u0. */
  spoiler(secs: Sec[], hinge: [number, number], plates: [number, number][], u0: number, u1: number, color: RGB, max = 1.0): void {
    const p0 = secSurfacePoint(secs, hinge[0], u0, 1)
    const p1 = secSurfacePoint(secs, hinge[1], u0, 1)
    const f = hingeFrameX(p0, p1)
    const b = new GeoBuilder()
    for (const [a, c] of plates) addSpoilerPlate(b, secs, a, c, u0, u1, 0.03, 0.05, color)
    const pv = this.pivoted(b, f.m, f.origin)
    this.spoilers.push({ g: pv.deflect, max })
  }

  // ---------------------------------------------------------------- engines

  /** Nacelle (static) plus a spinning fan group. */
  engine(e: EngineSpec, side: 1 | -1): void {
    const { R, len } = e
    const dark = C.dark
    const lip = [Math.min(1, e.body[0] * 1.1), Math.min(1, e.body[1] * 1.1), Math.min(1, e.body[2] * 1.1)] as RGB
    const prof: [number, number, RGB][] = [
      [0.0, 0.14, dark],
      [0.8, 0.14, dark],
      [0.84, 0.1, C.darkSteel],
      [0.87, 0.025, C.darkSteel],
      [0.93, 0.0, lip],
      [0.98, 0.05, e.body],
      [1.0, 0.25, e.body],
      [0.96, 0.6, e.body],
      [0.83, 0.9, e.body],
      [0.74, 0.96, e.body],
      [0.64, 0.96, C.darkSteel],
      [0.56, 0.93, C.darkSteel],
      [0.5, 1.0, C.steel],
      [0.3, 1.08, C.steel],
      [0.0, 1.12, C.steel],
    ]
    const profile = prof.map(([r, z, c]) => ({ r: r * R, z: z * len, c }))
    this.statics.lathe(profile, 20, new Vector3(e.x * side, e.y, e.zFront))
    // Fan: spinner cone plus blades on a rotating group at the fan face.
    const fan = new Group()
    fan.position.set(e.x * side, e.y, e.zFront + 0.14 * len)
    const b = new GeoBuilder()
    b.tube(new Vector3(0, 0, 0.02), new Vector3(0, 0, -0.55 * R), 0.22 * R, 0, 12, rgb(0xd8dade), true)
    const n = e.blades ?? 14
    const hw = 0.11 * R
    const blade = rgb(0x6c7076)
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2
      const ex = Math.cos(a)
      const ey = Math.sin(a)
      const nx = -ey
      const ny = ex
      const c = (r: number, s: number, z: number) => new Vector3(ex * r + nx * s, ey * r + ny * s, z)
      const r0 = 0.2 * R
      const r1 = 0.8 * R
      b.hexa(
        [c(r0, -hw, -0.04), c(r1, -hw, -0.04), c(r1, hw, -0.04), c(r0, hw, -0.04), c(r0, -hw, 0.0), c(r1, -hw, 0.0), c(r1, hw, 0.0), c(r0, hw, 0.0)],
        blade,
      )
    }
    this.mesh(b, fan, undefined, false)
    this.root.add(fan)
    this.fans.push(fan)
  }

  // ------------------------------------------------------------------- gear

  leg(spec: LegSpec): LegAnim {
    const hinge = v3(spec.hinge)
    const b = new GeoBuilder()
    const [cx, cy, cz] = spec.contact
    const axleY = cy + spec.radius
    const wheelX = spec.wheelDx > 0 ? [-spec.wheelDx, spec.wheelDx] : [0]
    const wheelRecs: RigWheel[] = []
    // Strut: upper oleo and lower piston.
    const top = hinge.clone()
    const bottom = new Vector3(cx, axleY, cz)
    const mid = top.clone().lerp(bottom, 0.55)
    b.tube(top, mid, spec.strutR * 1.4, spec.strutR * 1.4, 10, C.steel)
    b.tube(mid, bottom, spec.strutR, spec.strutR, 10, C.hub)
    for (const az of spec.axles) {
      const z = cz + az
      b.tube(new Vector3(cx - spec.wheelDx, axleY, z), new Vector3(cx + spec.wheelDx, axleY, z), spec.strutR * 0.7, spec.strutR * 0.7, 8, C.darkSteel)
      for (const dx of wheelX) {
        const wc = new Vector3(cx + dx, axleY, z)
        const hw = spec.halfWidth
        b.tube(new Vector3(wc.x - hw, wc.y, wc.z), new Vector3(wc.x + hw, wc.y, wc.z), spec.radius, spec.radius, 16, C.tyre, true, false)
        b.tube(new Vector3(wc.x - hw * 1.08, wc.y, wc.z), new Vector3(wc.x + hw * 1.08, wc.y, wc.z), spec.radius * 0.58, spec.radius * 0.58, 12, C.hub)
        wheelRecs.push({ leg: spec.name, group: this.root, centre: wc.clone().sub(hinge), radius: spec.radius, halfWidth: hw })
      }
    }
    if (spec.axles.length > 1) {
      const zs = spec.axles.map((a) => cz + a)
      b.box(cx, axleY + 0.05, (Math.min(...zs) + Math.max(...zs)) / 2, 0.22, 0.2, Math.max(...zs) - Math.min(...zs), C.darkSteel)
    }
    const group = new Group()
    group.position.copy(hinge)
    this.mesh(b, group, new Matrix4().makeTranslation(-hinge.x, -hinge.y, -hinge.z))
    let light: Mesh | undefined
    if (spec.landingLight) {
      const lb = new GeoBuilder()
      const lp = new Vector3(0, -(hinge.y - axleY) * 0.45, -spec.radius * 0.5)
      lb.ellipsoid(lp.x, lp.y, lp.z, 0.14, 0.14, 0.1, 8, 4, [1, 1, 0.85])
      light = new Mesh(this.geo(lb), this.lampMat)
      light.userData.noBounds = true
      group.add(light)
    }
    // Retraction: rotate the leg about its hinge until the reference wheel point
    // lies along the stow direction, then slide it to the stow point.
    const ref = new Vector3(cx, axleY, cz)
    const d = ref.clone().sub(hinge)
    let theta: number
    const rotated = new Vector3()
    if (spec.fold === 'z') {
      const phi = Math.atan2(d.y, d.x)
      theta = wrapPi((cx < 0 ? 0 : Math.PI) - phi)
      rotated.set(d.x * Math.cos(theta) - d.y * Math.sin(theta), d.x * Math.sin(theta) + d.y * Math.cos(theta), d.z)
    } else {
      const phi = Math.atan2(d.z, d.y)
      theta = wrapPi(Math.PI / 2 - phi)
      rotated.set(d.x, d.y * Math.cos(theta) - d.z * Math.sin(theta), d.y * Math.sin(theta) + d.z * Math.cos(theta))
    }
    const u = v3(spec.stow).sub(hinge).sub(rotated)
    const anim: LegAnim = { group, hinge, u, theta, axis: spec.fold, light }
    this.legs.push(anim)
    for (const w of wheelRecs) {
      w.group = group
      this.wheels.push(w)
    }
    this.root.add(group)
    if (spec.name === 'nose') this.hideInCockpit.push(group)
    return anim
  }

  /** Gear door hinged along its outer edge, hanging open when the gear is in transit. */
  door(spec: DoorSpec, side: 1 | -1): void {
    const g = new Group()
    const thick = 0.05
    const b = new GeoBuilder()
    // Hinge along z at x = side * spec.x; the plate extends towards the centre line.
    const dir = -side
    b.box((dir * spec.lenX) / 2, -thick / 2, 0, spec.lenX, thick, spec.lenZ, rgb(0xb8bbc0))
    g.position.set(side * spec.x, spec.hullBottomY, spec.z)
    this.doors.push({ group: g, open: side * 1.3, stayOpen: spec.stayOpen })
    this.mesh(b, g)
    this.root.add(g)
  }

  // ----------------------------------------------------------------- lights

  navLights(left: V3, right: V3, tail: V3, r: number): void {
    const s = (p: V3, c: RGB) => this.lamps.ellipsoid(p[0], p[1], p[2], r, r, r, 8, 4, c)
    s(left, [1, 0.08, 0.05])
    s(right, [0.1, 1, 0.25])
    s(tail, [1, 1, 0.95])
    const sb = new GeoBuilder()
    for (const p of [left, right, tail]) sb.ellipsoid(p[0], p[1] + r * 1.6, p[2], r * 1.3, r * 1.3, r * 1.3, 8, 4, [1, 1, 1])
    const m = new Mesh(this.geo(sb), this.lampMat)
    m.userData.noBounds = true
    this.root.add(m)
    this.strobes.push(m)
  }

  // ------------------------------------------------------------------ finish

  finish(hullContains: (x: number, y: number, z: number) => boolean): AircraftRig {
    const sm = new Mesh(this.geo(this.statics), this.bodyMat)
    sm.castShadow = this.shadows
    sm.receiveShadow = false
    this.root.add(sm)
    if (this.glass.idx.length) {
      const gm = new Mesh(this.geo(this.glass), this.glassMat)
      this.root.add(gm)
      this.glassHideInCockpit = gm
    }
    if (this.lamps.idx.length) {
      const lm = new Mesh(this.geo(this.lamps), this.lampMat)
      lm.userData.noBounds = true
      this.root.add(lm)
    }
    this.envelopeTests.push(hullContains)
    this.root.updateMatrixWorld(true)
    return {
      id: this.id,
      root: this.root,
      wheels: this.wheels,
      insideEnvelope: (p) => this.envelopeTests.some((f) => f(p.x, p.y, p.z)),
      dispose: () => {
        this.geos.forEach((g) => g.dispose())
        this.mats.forEach((m) => m.dispose())
      },
      update: (rs, mode, dt) => this.update(rs, mode, dt),
    }
  }

  update(rs: AircraftRenderState, mode: CameraMode, dtRaw: number): void {
    const dt = Math.min(dtRaw, 0.1)
    this.root.position.set(rs.position.x, rs.position.y, rs.position.z)
    this.root.quaternion.set(rs.orientation.x, rs.orientation.y, rs.orientation.z, rs.orientation.w)
    const cockpit = mode === 'cockpit'
    if (!rs.frozen) this.time += dt

    const s = rs.surfaces
    for (const e of this.elevators) e.rotation.x = -s.elevator
    for (const a of this.ailerons) a.g.rotation.x = a.side > 0 ? -s.aileron : s.aileron
    for (const r of this.rudders) r.rotation.y = s.rudder
    const fl = clamp(s.flaps / 0.7, 0, 1)
    for (const f of this.flaps) {
      f.g.rotation.x = s.flaps
      f.g.position.z = f.travel * fl
    }
    for (const sp of this.spoilers) sp.g.rotation.x = -clamp(rs.speedbrakePosition, 0, 1) * sp.max

    // Gear: t = 0 down, 1 stowed.
    const g = clamp(rs.gearPosition, 0, 1)
    const t = 1 - g
    for (const l of this.legs) {
      l.group.position.copy(l.hinge).addScaledVector(l.u, t)
      if (l.axis === 'z') l.group.rotation.z = l.theta * t
      else l.group.rotation.x = l.theta * t
      l.group.visible = t < 0.999
      if (l.light) l.light.visible = g > 0.98
    }
    for (const d of this.doors) {
      const amount = d.stayOpen ? smoothstep(0, 0.12, g) : smoothstep(0, 0.12, g) * (1 - smoothstep(0.86, 0.97, g))
      d.group.rotation.z = d.open * amount
      d.group.visible = amount > 0.01
    }
    // Nose gear is hidden in the cockpit view (it would sit under the eye).
    for (const h of this.hideInCockpit) if (cockpit) h.visible = false

    if (!rs.frozen) for (const f of this.fans) f.rotation.z += this.fanRate * clamp(rs.n1, 0, 1.1) * dt
    for (const st of this.strobes) st.visible = this.time % 1.3 < 0.09 || (this.time % 1.3 > 0.2 && this.time % 1.3 < 0.28)
    if (this.glassHideInCockpit) this.glassHideInCockpit.visible = !cockpit
    for (const fn of this.extra) fn(rs, cockpit, dt, this.time)
  }
}

export function flameMaterial(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  })
}
