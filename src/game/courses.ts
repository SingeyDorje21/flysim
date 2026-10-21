import type { RingDef } from './types'

const RING_RADIUS = 20

/**
 * Ring course: north over the airport, a counter-clockwise loop through the
 * western lowlands, then back towards the runway. Terrain under every ring
 * must stay at least 80 m below the ring centre.
 */
export const RING_COURSE: readonly RingDef[] = [
  { id: 1, position: { x: 0, y: 240, z: 600 }, headingDeg: 0, radius: RING_RADIUS },
  { id: 2, position: { x: 0, y: 220, z: -900 }, headingDeg: 0, radius: RING_RADIUS },
  { id: 3, position: { x: -500, y: 260, z: -2200 }, headingDeg: 339, radius: RING_RADIUS },
  { id: 4, position: { x: -1700, y: 320, z: -2900 }, headingDeg: 300, radius: RING_RADIUS },
  { id: 5, position: { x: -2900, y: 300, z: -2200 }, headingDeg: 240, radius: RING_RADIUS },
  { id: 6, position: { x: -3300, y: 250, z: -800 }, headingDeg: 196, radius: RING_RADIUS },
  { id: 7, position: { x: -2600, y: 200, z: 600 }, headingDeg: 153, radius: RING_RADIUS },
  { id: 8, position: { x: -1300, y: 160, z: 1500 }, headingDeg: 125, radius: RING_RADIUS },
  { id: 9, position: { x: -200, y: 130, z: 2300 }, headingDeg: 126, radius: RING_RADIUS },
]
