import { Box3, BufferGeometry, Mesh, Vector3, type Object3D } from 'three'

/** Visit world-space vertices of every mesh not under a `userData.noBounds` subtree. */
export function forEachStructureVertex(root: Object3D, visit: (v: Vector3, mesh: Mesh) => void): void {
  root.updateMatrixWorld(true)
  const v = new Vector3()
  const walk = (o: Object3D) => {
    if (o.userData.noBounds) return
    if ((o as Mesh).isMesh) {
      const m = o as Mesh
      const pos = m.geometry.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
        visit(v, m)
      }
    }
    for (const c of o.children) walk(c)
  }
  walk(root)
}

export function structureBounds(root: Object3D): Box3 {
  const b = new Box3()
  forEachStructureVertex(root, (v) => b.expandByPoint(v))
  return b
}

function triCount(g: BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.getAttribute('position').count / 3
}

/** Triangles and meshes (= draw calls) over everything in the model. */
export function modelStats(root: Object3D): { triangles: number; meshes: number } {
  let triangles = 0
  let meshes = 0
  root.traverse((o) => {
    if ((o as Mesh).isMesh) {
      meshes++
      triangles += triCount((o as Mesh).geometry)
    }
  })
  return { triangles, meshes }
}
