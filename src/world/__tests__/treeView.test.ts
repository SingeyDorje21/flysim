import { describe, expect, it } from 'vitest'
import { TREE_TILE } from '../terrain/treePlacement'
import { treeTileInView, treeViewFor, treeViewTurned } from '../terrain/treeView'

const tileAt = (x: number, z: number): [number, number] => [Math.floor(x / TREE_TILE), Math.floor(z / TREE_TILE)]
/** Camera at the origin looking along +z, level, 65 deg fov, 16:9. */
const ahead = treeViewFor(0, 0, 0, 0, 1, 65, 16 / 9)

describe('tree view culling', () => {
  it('keeps tiles ahead and to the sides of the view, drops those behind', () => {
    expect(treeTileInView(ahead, ...tileAt(0, 3000))).toBe(true)
    expect(treeTileInView(ahead, ...tileAt(2500, 2500))).toBe(true)
    expect(treeTileInView(ahead, ...tileAt(-2500, 2500))).toBe(true)
    expect(treeTileInView(ahead, ...tileAt(0, -3000))).toBe(false)
    expect(treeTileInView(ahead, ...tileAt(2000, -2500))).toBe(false)
  })

  it('always keeps the tiles around the camera', () => {
    for (const [x, z] of [
      [0, -300],
      [-400, -400],
      [500, 0],
    ])
      expect(treeTileInView(ahead, ...tileAt(x, z))).toBe(true)
  })

  it('keeps every tile when looking steeply down or up', () => {
    const down = treeViewFor(0, 0, 0, -1, 0.5, 65, 16 / 9)
    expect(down.halfAngle).toBe(Infinity)
    expect(treeTileInView(down, ...tileAt(0, -3000))).toBe(true)
  })

  it('every corner of the screen is inside the cone with room to turn before the next rewrite', () => {
    // Screen corner of a level camera, turned another 10 deg (the rewrite threshold).
    const tanV = Math.tan((32.5 * Math.PI) / 180)
    const corner = Math.atan(tanV * Math.hypot(1, 16 / 9))
    expect(ahead.halfAngle).toBeGreaterThan(corner + (10 * Math.PI) / 180)
  })

  it('asks for a rewrite after a 10 deg turn, not before', () => {
    const turn = (deg: number) => treeViewFor(0, 0, Math.sin((deg * Math.PI) / 180), 0, Math.cos((deg * Math.PI) / 180), 65, 16 / 9)
    expect(treeViewTurned(ahead, turn(5))).toBe(false)
    expect(treeViewTurned(ahead, turn(15))).toBe(true)
    expect(treeViewTurned(ahead, treeViewFor(0, 0, 0, -1, 0.1, 65, 16 / 9))).toBe(true)
  })
})
