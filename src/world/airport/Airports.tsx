import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  SRGBColorSpace,
  CanvasTexture,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three'
import { AIRPORTS } from '../../config/airports'
import { longestRunway } from '../../game/airportGeometry'
import { MeshBuilder } from './meshBuilder'
import { buildAirportPlan, papiColors, planToWorld, type AirportPlan, type LightColor, type Rgb } from './plan'

/** Beyond this distance (m, from the runway end) markings and buildings are hidden; lights stay. */
export const DETAIL_DISTANCE = 10000
/** PAPI colours are only refreshed within this range. */
const PAPI_RANGE = 30000
const DEG = Math.PI / 180

const LIGHT_RGB: Record<LightColor, Rgb> = {
  white: [1, 0.95, 0.8],
  green: [0.1, 1, 0.25],
  red: [1, 0.1, 0.08],
  blue: [0.15, 0.3, 1],
}
const PAPI_WHITE = new Color(1, 0.97, 0.85)
const PAPI_RED = new Color(1, 0.08, 0.05)

interface AirportNode {
  plan: AirportPlan
  group: Group
  detail: Group
  papiMesh: InstancedMesh
  /** World position of each PAPI bar centre, aligned with plan.papi. */
  papiWorld: { x: number; z: number }[]
  papiState: number[]
  cx: number
  cz: number
  detailRange: number
}

interface Built {
  root: Group
  nodes: AirportNode[]
  geos: BufferGeometry[]
  mats: Material[]
  texs: Texture[]
}

function designatorTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 192
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#f2f2ee'
    ctx.font = 'bold 190px Arial, Helvetica, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 8)
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/** Lights keep a minimum apparent size: grow with camera distance so they stay visible as points. */
function patchLightMaterial(m: MeshBasicMaterial): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 lightCenter = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      transformed *= clamp(distance(cameraPosition, lightCenter.xyz) / 500.0, 1.0, 60.0);`,
    )
  }
  m.customProgramCacheKey = () => 'airportLights'
}

function build(): Built {
  const geos: BufferGeometry[] = []
  const mats: Material[] = []
  const texs: Texture[] = []
  const groundMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: DoubleSide })
  const buildingMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: DoubleSide })
  const lightMat = new MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false })
  patchLightMaterial(lightMat)
  mats.push(groundMat, buildingMat, lightMat)
  const lightGeo = new OctahedronGeometry(0.5, 0)
  const plane = new PlaneGeometry(1, 1)
  plane.rotateX(-Math.PI / 2)
  geos.push(lightGeo, plane)
  const texCache = new Map<string, MeshStandardMaterial>()
  const markMat = groundMat

  const root = new Group()
  root.name = 'Airports'
  const nodes: AirportNode[] = []
  const tmp = new Object3D()
  const col = new Color()

  for (const a of AIRPORTS) {
    const plan = buildAirportPlan(a)
    const group = new Group()
    group.name = `airport-${a.id}`
    group.position.set(a.center.x, a.elevation, a.center.z)
    group.rotation.y = -a.runways[0].headingDeg * DEG
    root.add(group)

    // pavement (always visible)
    const pav = new MeshBuilder()
    for (const p of plan.pavement) pav.quad(p.x, p.y, p.z, p.width, p.length, -p.relHeadingDeg * DEG, p.color)
    const pavGeo = pav.build()
    geos.push(pavGeo)
    const pavMesh = new Mesh(pavGeo, groundMat)
    pavMesh.name = 'pavement'
    group.add(pavMesh)

    // detail group: markings, designators, buildings
    const detail = new Group()
    detail.name = 'detail'
    group.add(detail)
    const mk = new MeshBuilder()
    for (const m of plan.markings) mk.quad(m.x, m.y, m.z, m.width, m.length, 0, m.color)
    const mkGeo = mk.build()
    geos.push(mkGeo)
    const mkMesh = new Mesh(mkGeo, markMat)
    mkMesh.name = 'markings'
    detail.add(mkMesh)

    for (const d of plan.designators) {
      let mat = texCache.get(d.text)
      if (!mat) {
        const tex = designatorTexture(d.text)
        texs.push(tex)
        mat = new MeshStandardMaterial({ map: tex, alphaTest: 0.45, roughness: 0.9, side: DoubleSide })
        mats.push(mat)
        texCache.set(d.text, mat)
      }
      const m = new Mesh(plane, mat)
      m.position.set(d.x, 0.056, d.z)
      m.rotation.y = d.rotY
      m.scale.set(d.width, 1, d.height)
      m.name = `designator-${d.text}`
      detail.add(m)
    }

    const bl = new MeshBuilder()
    for (const b of plan.buildings) bl.gable(b.x, b.z, b.width, b.depth, b.base, b.height, b.shape === 'gable' ? b.ridge : 0, b.color)
    // windsock: pole, ring and banded sock pointing down the runway-perpendicular (fixed "wind")
    const w = plan.windsock
    bl.pole(w.x, w.z, 7, 0.12, [0.8, 0.8, 0.8])
    bl.sock(w.x, 7, w.z, 3.6, 0.7, 0.35, [[1, 0.4, 0.05], [0.95, 0.95, 0.95], [1, 0.4, 0.05], [0.95, 0.95, 0.95]])
    const blGeo = bl.build()
    geos.push(blGeo)
    const blMesh = new Mesh(blGeo, buildingMat)
    blMesh.name = 'buildings'
    detail.add(blMesh)

    // lights (always visible)
    const lm = new InstancedMesh(lightGeo, lightMat, plan.lights.length)
    lm.name = 'lights'
    plan.lights.forEach((l, i) => {
      tmp.position.set(l.x, l.y, l.z)
      tmp.scale.setScalar(1)
      tmp.updateMatrix()
      lm.setMatrixAt(i, tmp.matrix)
      const c = LIGHT_RGB[l.color]
      lm.setColorAt(i, col.setRGB(c[0], c[1], c[2]))
    })
    lm.instanceMatrix.needsUpdate = true
    if (lm.instanceColor) lm.instanceColor.needsUpdate = true
    lm.frustumCulled = false
    group.add(lm)

    const papiCount = plan.papi.length * 4
    const pm = new InstancedMesh(lightGeo, lightMat, papiCount)
    pm.name = 'papi'
    plan.papi.forEach((p, e) => {
      p.lights.forEach((l, k) => {
        const i = e * 4 + k
        tmp.position.set(l.x, 0.8, l.z)
        tmp.scale.setScalar(2.2)
        tmp.updateMatrix()
        pm.setMatrixAt(i, tmp.matrix)
        pm.setColorAt(i, PAPI_RED)
      })
    })
    pm.instanceMatrix.needsUpdate = true
    pm.frustumCulled = false
    group.add(pm)

    nodes.push({
      plan,
      group,
      detail,
      papiMesh: pm,
      papiWorld: plan.papi.map((p) => planToWorld(a, p.cx, p.cz)),
      papiState: plan.papi.map(() => -1),
      cx: a.center.x,
      cz: a.center.z,
      // Every runway reaches at most its own length from the primary's centre.
      detailRange: DETAIL_DISTANCE + longestRunway(a),
    })
  }
  return { root, nodes, geos, mats, texs }
}

export function Airports({ shadows }: { shadows: boolean }) {
  const built = useMemo(build, [])

  useEffect(() => {
    built.root.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh || (o as InstancedMesh).isInstancedMesh) return
      const isGround = o.name === 'pavement' || o.name === 'markings' || o.name.startsWith('designator')
      mesh.receiveShadow = shadows
      mesh.castShadow = shadows && !isGround
    })
    for (const m of built.mats) m.needsUpdate = true
  }, [built, shadows])

  useEffect(() => {
    return () => {
      built.geos.forEach((g) => g.dispose())
      built.mats.forEach((m) => m.dispose())
      built.texs.forEach((t) => t.dispose())
      built.root.traverse((o) => {
        if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose()
        if ((o as Mesh).isMesh) (o as Mesh).geometry?.dispose()
      })
    }
  }, [built])

  useFrame(({ camera }) => {
    const cp = camera.position
    for (const n of built.nodes) {
      const dist = Math.hypot(cp.x - n.cx, cp.z - n.cz)
      const show = dist < n.detailRange
      if (n.detail.visible !== show) n.detail.visible = show
      if (dist > PAPI_RANGE) continue
      let dirty = false
      n.plan.papi.forEach((_, e) => {
        const w = n.papiWorld[e]
        const horiz = Math.hypot(cp.x - w.x, cp.z - w.z)
        const angle = Math.atan2(cp.y - (n.plan.airport.elevation + 0.8), Math.max(horiz, 1e-3)) / DEG
        const whites = papiColors(angle)
        const code = whites.reduce((s, v, k) => s | (v ? 1 << k : 0), 0)
        if (n.papiState[e] === code) return
        n.papiState[e] = code
        whites.forEach((v, k) => n.papiMesh.setColorAt(e * 4 + k, v ? PAPI_WHITE : PAPI_RED))
        dirty = true
      })
      if (dirty && n.papiMesh.instanceColor) n.papiMesh.instanceColor.needsUpdate = true
    }
  })

  return <primitive object={built.root} />
}
