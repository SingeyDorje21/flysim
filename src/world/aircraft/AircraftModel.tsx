import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'
import { AIRCRAFT_GEOMETRY as G } from '../../config/aircraftGeometry'
import type { CameraMode } from '../../game/types'
import type { AircraftRenderState } from '../../simulation/types'

const DEG = Math.PI / 180
const UP = new Vector3(0, 1, 0)

function smoothstep(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a)
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return t * t * (3 - 2 * t)
}

interface AircraftParts {
  root: Group
  elevator: Group
  rudder: Group
  aileronL: Group
  aileronR: Group
  flapL: Group
  flapR: Group
  prop: Group
  propVisual: Group
  noseGear: Group
  bladeMat: MeshBasicMaterial
  discMat: MeshBasicMaterial
  geos: BufferGeometry[]
  mats: Material[]
}

function buildAircraft(shadows: boolean): AircraftParts {
  const geos: BufferGeometry[] = []
  const mats: Material[] = []
  const geo = <T extends BufferGeometry>(g: T): T => (geos.push(g), g)
  const mat = <T extends Material>(m: T): T => (mats.push(m), m)
  const root = new Group()

  const add = (parent: Group, g: BufferGeometry, m: Material, x = 0, y = 0, z = 0, cast = true): Mesh => {
    const mesh = new Mesh(g, m)
    mesh.position.set(x, y, z)
    mesh.castShadow = cast && shadows
    parent.add(mesh)
    return mesh
  }

  const white = mat(new MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.5, metalness: 0.1 }))
  const blue = mat(new MeshStandardMaterial({ color: 0x1f4f9a, roughness: 0.5, metalness: 0.1 }))
  const red = mat(new MeshStandardMaterial({ color: 0xc8261e, roughness: 0.5, metalness: 0.1 }))
  const dark = mat(new MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.8 }))
  const steel = mat(new MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.4, metalness: 0.6 }))
  const glass = mat(
    new MeshStandardMaterial({ color: 0x1c2e40, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.6 }),
  )

  // ------------------------------------------------------------- fuselage
  // Lathe profile (radius, z) along the body; back-face culled so the
  // cockpit camera sees straight through it.
  const f = G.fuselage
  const profile: [number, number][] = [
    [0, f.noseZ],
    [0.28, f.noseZ + 0.01],
    [0.5, f.noseZ + 0.25],
    [0.6, -2.5],
    [0.61, -2.3],
    [0.62, -2.2],
    [0.65, -1.8],
    [0.65, -0.6],
    [0.62, 0.8],
    [0.55, 1.8],
    [0.4, 3.0],
    [0.22, 4.2],
    [0.09, f.tailZ],
    [0, f.tailZ],
  ]
  const body = geo(new LatheGeometry(profile.map(([r, z]) => new Vector2(r, z)), 28))
  body.rotateX(Math.PI / 2) // lathe axis (Y) -> body Z
  body.scale(f.halfWidth / f.halfHeight, 1, 1)
  body.translate(0, f.centreY, 0)
  {
    const pos = body.getAttribute('position')
    const col = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i)
      const c = z < -2.25 ? [0.78, 0.15, 0.12] : z > 2.6 ? [0.12, 0.31, 0.6] : [0.945, 0.945, 0.93]
      col[i * 3] = c[0]
      col[i * 3 + 1] = c[1]
      col[i * 3 + 2] = c[2]
    }
    body.setAttribute('color', new BufferAttribute(col, 3))
  }
  const bodyMat = mat(new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.12 }))
  add(root, body, bodyMat)

  // Canopy (upper half ellipsoid)
  const canopy = geo(new SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2))
  const canopyMesh = add(root, canopy, glass, 0, 0.5, 0.35, false)
  canopyMesh.scale.set(0.5, 0.36, 1.25)

  // ---------------------------------------------------------------- wings
  const w = G.wing
  const hf = G.surfaces
  const wingGeometry = (sign: 1 | -1): BufferGeometry => {
    const s = new Shape()
    const lead = w.leadingEdgeZ
    const trail = lead + w.chord
    const half = w.span / 2
    const pts: [number, number][] = [
      [0, lead],
      [half, lead + 0.1],
      [half, trail],
      [hf.aileron.outerX, trail],
      [hf.aileron.outerX, hf.aileron.hingeZ],
      [hf.flap.innerX, hf.flap.hingeZ],
      [hf.flap.innerX, trail],
      [0, trail],
    ]
    pts.forEach(([x, z], i) => (i === 0 ? s.moveTo(sign * x, z) : s.lineTo(sign * x, z)))
    s.closePath()
    const g = new ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false })
    // shape (x, y) -> world (x, z); extrusion -> world -y
    g.rotateX(Math.PI / 2)
    g.translate(0, 0.06, 0)
    return g
  }

  const makeWing = (sign: 1 | -1) => {
    const wing = new Group()
    wing.position.set(0, w.rootY, 0)
    wing.rotation.z = sign * G.wing.dihedralDeg * DEG
    add(wing, geo(wingGeometry(sign)), white)

    // Wingtip cap in blue
    const tip = add(wing, geo(new BoxGeometry(0.06, 0.13, w.chord)), blue, sign * (w.span / 2), 0, w.leadingEdgeZ + w.chord / 2 + 0.04)
    tip.castShadow = false

    // Flap and aileron pivots at the hinge lines (+z is the trailing edge).
    const mkSurface = (inner: number, outer: number, hingeZ: number, chord: number, m: Material) => {
      const pivot = new Group()
      pivot.position.set(sign * ((inner + outer) / 2), 0, hingeZ)
      add(pivot, geo(new BoxGeometry(outer - inner, 0.07, chord)), m, 0, 0, chord / 2)
      wing.add(pivot)
      return pivot
    }
    const flap = mkSurface(hf.flap.innerX, hf.flap.outerX, hf.flap.hingeZ, hf.flap.chord, white)
    const aileron = mkSurface(hf.aileron.innerX, hf.aileron.outerX, hf.aileron.hingeZ, hf.aileron.chord, white)

    // Navigation light: red on the left wingtip, green on the right.
    const lightMat = mat(new MeshBasicMaterial({ color: sign === 1 ? 0x22ff55 : 0xff2020, toneMapped: false }))
    const lamp = add(wing, geo(new SphereGeometry(0.1, 10, 8)), lightMat, sign * (w.span / 2 + 0.03), 0.02, w.leadingEdgeZ + 0.4, false)
    lamp.name = sign === 1 ? 'nav-green' : 'nav-red'

    root.add(wing)
    return { flap, aileron }
  }
  const right = makeWing(1)
  const left = makeWing(-1)

  // ----------------------------------------------------------------- tail
  const ht = G.horizontalTail
  const el = hf.elevator
  const stabChord = el.hingeZ - ht.leadingEdgeZ
  add(root, geo(new BoxGeometry(ht.span, 0.05, stabChord)), white, 0, ht.y, ht.leadingEdgeZ + stabChord / 2)
  const elevator = new Group()
  elevator.position.set(0, el.y, el.hingeZ)
  add(elevator, geo(new BoxGeometry(el.halfSpan * 2, 0.04, el.chord)), white, 0, 0, el.chord / 2)
  root.add(elevator)

  const vt = G.verticalTail
  const rd = hf.rudder
  {
    const s = new Shape()
    s.moveTo(vt.leadingEdgeZ, vt.baseY)
    s.lineTo(rd.hingeZ, vt.baseY)
    s.lineTo(rd.hingeZ, vt.baseY + vt.height)
    s.lineTo(vt.leadingEdgeZ + 0.35, vt.baseY + vt.height)
    s.closePath()
    const fin = geo(new ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: false }))
    // shape (z, y) with extrusion along x: map shape-x -> world z, extrusion -> world x
    fin.rotateY(-Math.PI / 2)
    fin.translate(0.035, 0, 0)
    add(root, fin, blue)
  }
  const rudder = new Group()
  rudder.position.set(0, rd.baseY + rd.height / 2, rd.hingeZ)
  add(rudder, geo(new BoxGeometry(0.05, rd.height, rd.chord)), blue, 0, 0, rd.chord / 2)
  root.add(rudder)

  // --------------------------------------------------------------- gear
  const gr = G.gear
  const wheelGeo = geo(new CylinderGeometry(gr.wheelRadius, gr.wheelRadius, 0.16, 18))
  wheelGeo.rotateZ(Math.PI / 2)
  const strut = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r = 0.035, parent: Group = root) => {
    const a = new Vector3(ax, ay, az)
    const b = new Vector3(bx, by, bz)
    const len = a.distanceTo(b)
    const m = new Mesh(geo(new CylinderGeometry(r, r, len, 8)), steel)
    m.position.copy(a).add(b).multiplyScalar(0.5)
    m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize())
    m.castShadow = shadows
    parent.add(m)
  }
  const wheelY = (p: { y: number }) => p.y + gr.wheelRadius // wheel centre; bottom sits exactly at the contact point
  for (const p of [gr.mainLeft, gr.mainRight]) {
    add(root, wheelGeo, dark, p.x, wheelY(p), p.z)
    strut(p.x * 0.35, -0.5, p.z, p.x, wheelY(p), p.z, 0.04)
  }
  const noseGear = new Group()
  root.add(noseGear)
  add(noseGear, wheelGeo, dark, gr.nose.x, wheelY(gr.nose), gr.nose.z)
  strut(0, -0.3, gr.nose.z - 0.1, gr.nose.x, wheelY(gr.nose), gr.nose.z, 0.035, noseGear)

  // ---------------------------------------------------------- propeller
  const hub = G.propeller.hub
  const spinnerGeo = geo(new ConeGeometry(0.2, 0.5, 16))
  spinnerGeo.rotateX(-Math.PI / 2) // tip towards -Z
  const propVisual = new Group()
  propVisual.position.set(hub.x, hub.y, hub.z)
  add(propVisual, spinnerGeo, red, 0, 0, -0.05, false)
  const prop = new Group()
  propVisual.add(prop)
  const bladeMat = mat(new MeshBasicMaterial({ color: 0x15161a, transparent: true, opacity: 1, depthWrite: false }))
  const R = G.propeller.diameter / 2
  const blade = add(prop, geo(new BoxGeometry(R * 2, 0.13, 0.03)), bladeMat, 0, 0, 0, false)
  blade.renderOrder = 1
  const discMat = mat(new MeshBasicMaterial({ color: 0x2a2d33, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }))
  const disc = add(propVisual, geo(new CircleGeometry(R, 32)), discMat, 0, 0, 0.02, false)
  disc.renderOrder = 1


  return {
    root,
    elevator,
    rudder,
    aileronL: left.aileron,
    aileronR: right.aileron,
    flapL: left.flap,
    flapR: right.flap,
    prop,
    propVisual,
    noseGear,
    bladeMat,
    discMat,
    geos,
    mats,
  }
}

export function AircraftModel({
  renderState,
  cameraMode,
  shadows,
}: {
  renderState: AircraftRenderState
  cameraMode: CameraMode
  shadows: boolean
}) {
  const parts = useMemo(() => buildAircraft(shadows), [shadows])

  useEffect(
    () => () => {
      parts.geos.forEach((g) => g.dispose())
      parts.mats.forEach((m) => m.dispose())
    },
    [parts],
  )

  useFrame((_, dt) => {
    const rs = renderState
    const p = parts
    p.root.position.set(rs.position.x, rs.position.y, rs.position.z)
    p.root.quaternion.set(rs.orientation.x, rs.orientation.y, rs.orientation.z, rs.orientation.w)

    const s = rs.surfaces
    // Sign mapping (see simulation/types.ts):
    //   elevator +  = trailing edge up        -> rotation.x = -elevator
    //   aileron  +  = right TE up, left TE down -> right.x = -aileron, left.x = +aileron
    //   rudder   +  = trailing edge to +X     -> rotation.y = +rudder
    //   flaps    +  = trailing edge down      -> rotation.x = +flaps
    p.elevator.rotation.x = -s.elevator
    p.aileronR.rotation.x = -s.aileron
    p.aileronL.rotation.x = s.aileron
    p.rudder.rotation.y = s.rudder
    p.flapL.rotation.x = s.flaps
    p.flapR.rotation.x = s.flaps

    // Propeller: saturate the visual spin rate to avoid strobing, fade blades
    // into a translucent disc at high rpm.
    const omega = (rs.engineRpm * 2 * Math.PI) / 60
    const visOmega = 60 * Math.tanh(omega / 60)
    p.prop.rotation.z += visOmega * Math.min(dt, 0.1)
    const blur = smoothstep(500, 1500, rs.engineRpm)
    p.bladeMat.opacity = 1 - 0.7 * blur
    p.discMat.opacity = 0.3 * blur

    const cockpit = cameraMode === 'cockpit'
    p.propVisual.visible = !cockpit
    p.noseGear.visible = !cockpit
  })

  return <primitive object={parts.root} />
}
