import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  SRGBColorSpace,
  SphereGeometry,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three'
import { RUNWAY } from '../../config/world'
import { APRON_RECT, HANGARS, RUNWAY_RECT, TAXIWAY_RECTS, TOWER_POS, WINDSOCK_POS, type PavedRect } from '../airportLayout'

const Y0 = RUNWAY.elevation
// Layering offsets above the (exactly flat) terrain: apron < taxiway < runway < markings.
const Y_APRON = 0.015
const Y_TAXI = 0.022
const Y_RUNWAY = 0.03
const Y_MARK = 0.05
const Y_NUM = 0.056

function makeNumberTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#f4f4f0'
    ctx.font = 'bold 150px Arial, Helvetica, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 6)
  }
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function hangarGeometry(w: number, depth: number): ExtrudeGeometry {
  const wallH = 7
  const ridge = 3.4
  const s = new Shape()
  s.moveTo(-w / 2, 0)
  s.lineTo(w / 2, 0)
  s.lineTo(w / 2, wallH)
  s.lineTo(0, wallH + ridge)
  s.lineTo(-w / 2, wallH)
  s.closePath()
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: false })
  g.translate(0, 0, -depth / 2)
  g.rotateY(-Math.PI / 2) // gable faces +/-X, shape-x becomes world Z
  return g
}

interface Strip {
  x: number
  z: number
  w: number
  l: number
}

export function Airport({ shadows }: { shadows: boolean }) {
  const built = useMemo(() => {
    const geos: BufferGeometry[] = []
    const mats: Material[] = []
    const texs: Texture[] = []
    const geo = <T extends BufferGeometry>(g: T): T => (geos.push(g), g)
    const mat = <T extends Material>(m: T): T => (mats.push(m), m)

    const group = new Group()
    const dd = new Object3D()

    const addMesh = (parent: Object3D, g: BufferGeometry, m: Material, cast: boolean, receive: boolean): Mesh => {
      const mesh = new Mesh(g, m)
      mesh.castShadow = cast && shadows
      mesh.receiveShadow = receive && shadows
      parent.add(mesh)
      return mesh
    }

    /** One InstancedMesh of unit XZ planes scaled into rectangles. */
    const unitPlane = geo(new PlaneGeometry(1, 1))
    unitPlane.rotateX(-Math.PI / 2)
    const addStrips = (strips: Strip[], m: Material, y: number) => {
      const im = new InstancedMesh(unitPlane, m, strips.length)
      strips.forEach((s, i) => {
        dd.position.set(s.x, Y0 + y, s.z)
        dd.rotation.set(0, 0, 0)
        dd.scale.set(s.w, 1, s.l)
        dd.updateMatrix()
        im.setMatrixAt(i, dd.matrix)
      })
      im.instanceMatrix.needsUpdate = true
      im.frustumCulled = false
      im.receiveShadow = shadows
      group.add(im)
    }
    const rectStrip = (r: PavedRect): Strip => ({
      x: (r.minX + r.maxX) / 2,
      z: (r.minZ + r.maxZ) / 2,
      w: r.maxX - r.minX,
      l: r.maxZ - r.minZ,
    })

    // ---- pavement
    addStrips([rectStrip(APRON_RECT)], mat(new MeshStandardMaterial({ color: 0x77777a, roughness: 0.95 })), Y_APRON)
    addStrips(TAXIWAY_RECTS.map(rectStrip), mat(new MeshStandardMaterial({ color: 0x4a4b50, roughness: 0.92 })), Y_TAXI)
    addStrips([rectStrip(RUNWAY_RECT)], mat(new MeshStandardMaterial({ color: 0x3b3c40, roughness: 0.92 })), Y_RUNWAY)

    // ---- runway markings
    const halfL = RUNWAY.length / 2
    const marks: Strip[] = []
    for (let z = -halfL + 120; z <= halfL - 120; z += 50) marks.push({ x: 0, z, w: 0.9, l: 30 })
    for (const sgn of [1, -1]) {
      // threshold bars
      for (let i = -6; i <= 6; i++) {
        if (i === 0) continue
        marks.push({ x: i * 2.1, z: sgn * (halfL - 21), w: 1.2, l: 30 })
      }
      // touchdown-zone bars 300 m in
      for (const sx of [-1, 1]) {
        marks.push({ x: sx * 5, z: sgn * (halfL - 300), w: 2.2, l: 28 })
        marks.push({ x: sx * 8.5, z: sgn * (halfL - 300), w: 2.2, l: 28 })
      }
    }
    for (const sx of [-1, 1]) marks.push({ x: sx * (RUNWAY.width / 2 - 0.6), z: 0, w: 0.4, l: RUNWAY.length - 20 })
    addStrips(marks, mat(new MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8 })), Y_MARK)

    // taxiway centre lines
    addStrips(
      [
        { x: 62.5, z: 0, w: 0.3, l: 1540 },
        { x: 35, z: 0, w: 42, l: 0.3 },
        { x: 35, z: -772.5, w: 42, l: 0.3 },
        { x: 35, z: 772.5, w: 42, l: 0.3 },
      ],
      mat(new MeshStandardMaterial({ color: 0xe2b814, roughness: 0.8 })),
      Y_MARK,
    )

    // ---- runway numbers: "36" at the south end (read when approaching north), "18" at the north end
    for (const [label, sgn] of [['36', 1], ['18', -1]] as const) {
      const numTex = makeNumberTexture(label)
      texs.push(numTex)
      const m = mat(
        new MeshBasicMaterial({
          map: numTex,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      )
      const g = geo(new PlaneGeometry(12, 16))
      const mesh = new Mesh(g, m)
      mesh.rotation.order = 'YXZ'
      // After rotation.x = -PI/2 the plane's top points to -Z (north).
      mesh.rotation.set(-Math.PI / 2, sgn === 1 ? 0 : Math.PI, 0)
      mesh.position.set(0, Y0 + Y_NUM, sgn * (halfL - 66))
      group.add(mesh)
    }

    // ---- edge and threshold lights
    const lightGeo = geo(new SphereGeometry(0.22, 8, 6))
    const edgePos: [number, number][] = []
    for (let z = -halfL; z <= halfL; z += 50) {
      edgePos.push([-(RUNWAY.width / 2 + 1.2), z], [RUNWAY.width / 2 + 1.2, z])
    }
    const lightsMat = mat(new MeshBasicMaterial({ color: 0xfff1c2, toneMapped: false }))
    const edge = new InstancedMesh(lightGeo, lightsMat, edgePos.length)
    edgePos.forEach(([x, z], i) => {
      dd.position.set(x, Y0 + 0.2, z)
      dd.rotation.set(0, 0, 0)
      dd.scale.set(1, 0.8, 1)
      dd.updateMatrix()
      edge.setMatrixAt(i, dd.matrix)
    })
    edge.frustumCulled = false
    group.add(edge)
    for (const [sgn, color] of [[1, 0x3dff7a], [-1, 0xff3b30]] as const) {
      const im = new InstancedMesh(lightGeo, mat(new MeshBasicMaterial({ color, toneMapped: false })), 11)
      for (let i = 0; i < 11; i++) {
        dd.position.set((i - 5) * 3, Y0 + 0.2, sgn * (halfL + 1))
        dd.rotation.set(0, 0, 0)
        dd.scale.set(1, 0.8, 1)
        dd.updateMatrix()
        im.setMatrixAt(i, dd.matrix)
      }
      im.frustumCulled = false
      group.add(im)
    }

    // ---- hangars (doors facing west)
    const doorMat = mat(new MeshStandardMaterial({ color: 0x3a4048, roughness: 0.7 }))
    const doorGeo = geo(new BoxGeometry(0.4, 6, 20))
    for (const h of HANGARS) {
      const hg = new Group()
      addMesh(hg, geo(hangarGeometry(h.width, h.depth)), mat(new MeshStandardMaterial({ color: h.color, roughness: 0.85, metalness: 0.1 })), true, true)
      const door = addMesh(hg, doorGeo, doorMat, false, true)
      door.position.set(-h.depth / 2 - 0.1, 3, 0)
      hg.position.set(h.x, Y0, h.z)
      group.add(hg)
    }

    // ---- control tower
    const concrete = mat(new MeshStandardMaterial({ color: 0xd9d9d4, roughness: 0.85 }))
    const glass = mat(new MeshStandardMaterial({ color: 0x5f8fb0, roughness: 0.15, metalness: 0.3 }))
    const dark = mat(new MeshStandardMaterial({ color: 0x303338, roughness: 0.6 }))
    const tower = new Group()
    addMesh(tower, geo(new BoxGeometry(12, 5, 12)), concrete, true, true).position.y = 2.5
    addMesh(tower, geo(new CylinderGeometry(2.1, 2.5, 16, 14)), concrete, true, true).position.y = 13
    addMesh(tower, geo(new BoxGeometry(8, 3.4, 8)), glass, true, true).position.y = 22.7
    addMesh(tower, geo(new BoxGeometry(9.6, 0.5, 9.6)), dark, true, true).position.y = 24.65
    addMesh(tower, geo(new CylinderGeometry(0.08, 0.08, 6, 6)), dark, false, false).position.y = 27.9
    tower.position.set(TOWER_POS.x, Y0, TOWER_POS.z)
    group.add(tower)

    // ---- windsock
    const sock = new Group()
    addMesh(sock, geo(new CylinderGeometry(0.08, 0.1, 6, 6)), dark, true, false).position.y = 3
    const coneG = geo(new CylinderGeometry(0.25, 0.55, 2.6, 12, 1, true))
    coneG.rotateZ(-Math.PI / 2)
    coneG.translate(1.3, 0, 0)
    const pivot = new Group()
    pivot.position.set(0, 6, 0)
    addMesh(pivot, coneG, mat(new MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.8, side: DoubleSide })), false, false)
    sock.add(pivot)
    sock.position.set(WINDSOCK_POS.x, Y0, WINDSOCK_POS.z)
    group.add(sock)

    return { group, pivot, geos, mats, texs }
  }, [shadows])

  useEffect(
    () => () => {
      built.geos.forEach((g) => g.dispose())
      built.mats.forEach((m) => m.dispose())
      built.texs.forEach((t) => t.dispose())
      built.group.traverse((o) => {
        if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose()
      })
    },
    [built],
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    built.pivot.rotation.y = Math.sin(t * 0.7) * 0.12 + 0.3
    built.pivot.rotation.z = -0.25 + Math.sin(t * 1.9) * 0.05
  })

  return <primitive object={built.group} />
}
