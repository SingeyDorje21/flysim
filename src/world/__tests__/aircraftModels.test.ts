import { Box3, Mesh, Vector3, type Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { AIRCRAFT, type AircraftId, type AircraftInfo } from '../../config/aircraftCatalog'
import type { AircraftRenderState } from '../../simulation/types'
import { createAircraftRig } from '../aircraft'
import { forEachStructureVertex, modelStats, structureBounds } from '../aircraft/modelMetrics'
import type { AircraftRig } from '../aircraft/rigTypes'

function state(id: AircraftId, over: Partial<AircraftRenderState> = {}): AircraftRenderState {
  return {
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    surfaces: { elevator: 0, aileron: 0, rudder: 0, flaps: 0 },
    engineRpm: 0,
    aircraftId: id,
    n1: 0,
    afterburner: false,
    gearPosition: 1,
    speedbrakePosition: 0,
    thrustVector: 0,
    airspeed: 0,
    onGround: true,
    crashed: false,
    frozen: false,
    teleportId: 0,
    ...over,
  } as AircraftRenderState
}

function pose(rig: AircraftRig, id: AircraftId, over: Partial<AircraftRenderState> = {}): void {
  rig.update(state(id, over), 'chase', 0.016)
  rig.root.updateMatrixWorld(true)
}

function wheelBox(rig: AircraftRig, w: AircraftRig['wheels'][number]): Box3 {
  w.group.updateMatrixWorld(true)
  const box = new Box3()
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box.expandByPoint(new Vector3(sx * w.halfWidth, sy * w.radius, sz * w.radius).add(w.centre).applyMatrix4(w.group.matrixWorld))
      }
    }
  }
  void rig
  return box
}

const info = (id: AircraftId): AircraftInfo => AIRCRAFT.find((a) => a.id === id)!
const IDS: AircraftId[] = ['trainer', 'f22', 'a220', 'a350', 'global8000']
const JETS: AircraftId[] = ['f22', 'a220', 'a350', 'global8000']

describe.each(IDS)('aircraft model %s', (id) => {
  const a = info(id)
  const g = a.geometry
  const rig = createAircraftRig(id, false)
  pose(rig, id, { gearPosition: 1 })

  it('matches the contracted length and wingspan within 3%', () => {
    const b = structureBounds(rig.root)
    expect(Math.abs(b.max.z - b.min.z - g.length) / g.length).toBeLessThan(0.03)
    expect(Math.abs(b.max.x - b.min.x - g.wingspan) / g.wingspan).toBeLessThan(0.03)
    if (id !== 'trainer') expect(Math.abs(b.max.y - Math.min(g.gear.nose.y, g.gear.mainLeft.y) - g.height) / g.height).toBeLessThan(0.08)
  })

  it('puts the wheel bottoms on the gear contact points with the gear down', () => {
    const contact = { nose: g.gear.nose, mainLeft: g.gear.mainLeft, mainRight: g.gear.mainRight }
    for (const leg of ['nose', 'mainLeft', 'mainRight'] as const) {
      const ws = rig.wheels.filter((w) => w.leg === leg)
      expect(ws.length).toBeGreaterThan(0)
      const c = contact[leg]
      const centre = new Vector3()
      for (const w of ws) {
        const box = wheelBox(rig, w)
        expect(Math.abs(box.min.y - c.y)).toBeLessThan(0.05)
        centre.add(box.getCenter(new Vector3()))
      }
      centre.multiplyScalar(1 / ws.length)
      expect(Math.abs(centre.x - c.x)).toBeLessThan(0.05)
      expect(Math.abs(centre.z - c.z)).toBeLessThan(0.05)
    }
  })

  it('has nothing below the ground plane defined by the wheels', () => {
    const floor = Math.min(g.gear.nose.y, g.gear.mainLeft.y, g.gear.mainRight.y)
    let minY = Infinity
    forEachStructureVertex(rig.root, (v) => (minY = Math.min(minY, v.y)))
    expect(minY).toBeGreaterThan(floor - 0.06)
  })

  it('uses no textures (no logos or text)', () => {
    rig.root.traverse((o: Object3D) => {
      const m = o as Mesh
      if (!m.isMesh) return
      if (id !== 'trainer') expect(m.geometry.getAttribute('uv')).toBeUndefined()
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      for (const mat of mats) {
        const x = mat as unknown as Record<string, unknown>
        for (const k of ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap', 'envMap', 'aoMap']) {
          expect(x[k] ?? null).toBeNull()
        }
      }
    })
  })

  it('stays within the triangle and draw-call budget', () => {
    const s = modelStats(rig.root)
    expect(s.triangles).toBeLessThan(25000)
    expect(s.meshes).toBeLessThan(60)
  })
})

describe.each(JETS)('retractable gear and strike points of %s', (id) => {
  const a = info(id)
  const g = a.geometry
  const rig = createAircraftRig(id, false)

  it('hides every wheel inside the fuselage or wing with the gear up', () => {
    pose(rig, id, { gearPosition: 0 })
    for (const w of rig.wheels) {
      const box = wheelBox(rig, w)
      for (const sx of [box.min.x, box.max.x]) {
        for (const sy of [box.min.y, box.max.y]) {
          for (const sz of [box.min.z, box.max.z]) {
            expect(rig.insideEnvelope(new Vector3(sx, sy, sz)), `${w.leg} corner ${sx.toFixed(2)},${sy.toFixed(2)},${sz.toFixed(2)}`).toBe(true)
          }
        }
      }
    }
  })

  it('animates the gear between stowed and down', () => {
    pose(rig, id, { gearPosition: 1 })
    const down = rig.wheels.map((w) => wheelBox(rig, w).min.y)
    pose(rig, id, { gearPosition: 0.5 })
    const mid = rig.wheels.map((w) => wheelBox(rig, w).min.y)
    pose(rig, id, { gearPosition: 0 })
    const up = rig.wheels.map((w) => wheelBox(rig, w).min.y)
    for (let i = 0; i < down.length; i++) {
      expect(up[i]).toBeGreaterThan(down[i] + 0.3)
      expect(mid[i]).toBeGreaterThan(down[i] - 1e-6)
    }
  })

  it('places the tail, wingtips and engines near their strike points', () => {
    pose(rig, id, { gearPosition: 1 })
    const sp = g.strikePoints
    const verts: Vector3[] = []
    forEachStructureVertex(rig.root, (v) => verts.push(v.clone()))
    const lowest = (pred: (v: Vector3) => boolean) => verts.filter(pred).reduce((m, v) => (v.y < m.y ? v : m), new Vector3(0, Infinity, 0))
    const tail = lowest((v) => Math.abs(v.x) < 1.5 && v.z >= sp.tail.z - 0.5)
    expect(Math.abs(tail.y - sp.tail.y)).toBeLessThan(0.4)
    const half = g.wingspan / 2
    for (const side of [-1, 1]) {
      const p = side < 0 ? sp.leftWingtip : sp.rightWingtip
      const tip = lowest((v) => v.x * side > half - 0.25)
      expect(Math.abs(tip.y - p.y)).toBeLessThan(0.3)
      expect(Math.abs(tip.z - p.z)).toBeLessThan(1.6)
      expect(Math.abs(tip.x - p.x)).toBeLessThan(0.3)
    }
    for (const [key, side] of [['leftEngine', -1], ['rightEngine', 1]] as const) {
      const p = sp[key]
      if (!p) continue
      const eng = lowest((v) => v.x * side > Math.abs(p.x) - 1.0 && v.x * side < Math.abs(p.x) + 1.0 && v.y < p.y + 1.5 && Math.abs(v.z - p.z) < 4)
      expect(Math.abs(eng.y - p.y)).toBeLessThan(0.3)
    }
    if (sp.nose) {
      const nose = lowest((v) => v.z < sp.nose.z + 0.3)
      expect(Math.abs(nose.y - sp.nose.y)).toBeLessThan(0.3)
    }
  })
})

describe('control surface sign conventions', () => {
  /** Highest-aft vertex y of the named mesh set that moves between two poses. */
  function movedMeshes(rig: AircraftRig, id: AircraftId, over: Partial<AircraftRenderState>) {
    pose(rig, id)
    const before = new Map<Mesh, Vector3>()
    const aftOf = (m: Mesh) => {
      const pos = m.geometry.getAttribute('position')
      let best = new Vector3(0, 0, -Infinity)
      const v = new Vector3()
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
        if (v.z > best.z) best = v.clone()
      }
      return best
    }
    const meshes: Mesh[] = []
    rig.root.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh)
    })
    for (const m of meshes) before.set(m, aftOf(m))
    pose(rig, id, over)
    const out: { before: Vector3; after: Vector3 }[] = []
    for (const m of meshes) {
      const a = aftOf(m)
      const b = before.get(m)!
      if (a.distanceTo(b) > 1e-4) out.push({ before: b, after: a })
    }
    return out
  }

  for (const id of ['trainer', 'a220', 'a350', 'global8000', 'f22'] as AircraftId[]) {
    it(`${id}: positive aileron lifts the right trailing edge and drops the left`, () => {
      const rig = createAircraftRig(id, false)
      const moved = movedMeshes(rig, id, { surfaces: { elevator: 0, aileron: 0.2, rudder: 0, flaps: 0 } })
      const right = moved.filter((m) => m.before.x > 1)
      const left = moved.filter((m) => m.before.x < -1)
      expect(right.length).toBeGreaterThan(0)
      expect(left.length).toBeGreaterThan(0)
      for (const m of right) expect(m.after.y).toBeGreaterThan(m.before.y)
      for (const m of left) expect(m.after.y).toBeLessThan(m.before.y)
    })

    it(`${id}: positive elevator lifts the trailing edge`, () => {
      const rig = createAircraftRig(id, false)
      const moved = movedMeshes(rig, id, { surfaces: { elevator: 0.2, aileron: 0, rudder: 0, flaps: 0 } })
      expect(moved.length).toBeGreaterThan(0)
      for (const m of moved) expect(m.after.y).toBeGreaterThan(m.before.y)
    })

    it(`${id}: positive rudder swings the trailing edge towards +X`, () => {
      const rig = createAircraftRig(id, false)
      const moved = movedMeshes(rig, id, { surfaces: { elevator: 0, aileron: 0, rudder: 0.2, flaps: 0 } })
      expect(moved.length).toBeGreaterThan(0)
      for (const m of moved) expect(m.after.x).toBeGreaterThan(m.before.x)
    })

    it(`${id}: flaps lower the trailing edge`, () => {
      const rig = createAircraftRig(id, false)
      const moved = movedMeshes(rig, id, { surfaces: { elevator: 0, aileron: 0, rudder: 0, flaps: 0.5 } })
      expect(moved.length).toBeGreaterThan(0)
      for (const m of moved) expect(m.after.y).toBeLessThan(m.before.y)
    })
  }

  it('f22: thrust vector + turns the nozzle trailing edge up', () => {
    const rig = createAircraftRig('f22', false)
    const moved = movedMeshes(rig, 'f22', { thrustVector: 0.3 })
    expect(moved.length).toBeGreaterThan(0)
    for (const m of moved) expect(m.after.y).toBeGreaterThan(m.before.y)
  })
})

describe('model swap and frozen animation', () => {
  it('holds fan spin while frozen and spins otherwise', () => {
    const rig = createAircraftRig('a350', false)
    const spin = () => {
      let r = 0
      rig.root.traverse((o) => {
        if (o.type === 'Group' && o.rotation.z !== 0 && o.children.length === 1 && (o.children[0] as Mesh).isMesh) r += o.rotation.z
      })
      return r
    }
    pose(rig, 'a350', { n1: 0.8 })
    const a = spin()
    pose(rig, 'a350', { n1: 0.8, frozen: true })
    expect(spin()).toBe(a)
    pose(rig, 'a350', { n1: 0.8 })
    expect(spin()).not.toBe(a)
  })

  it('reports triangle counts and draw calls', () => {
    const lines = IDS.map((id) => {
      const s = modelStats(createAircraftRig(id, false).root)
      return `${id}: ${s.triangles} tris, ${s.meshes} meshes`
    })
    console.log(lines.join('\n'))
    expect(lines.length).toBe(5)
  })
})
