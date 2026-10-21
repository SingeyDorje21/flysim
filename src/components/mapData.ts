import { WORLD } from '../config/world'
import { naturalHeightAt } from '../world/terrain/heightField'

const GRID = 64

export interface LandRun {
  x: number
  z: number
  w: number
  h: number
}

/** Coarse land mask: horizontal runs of cells above sea level (world metres, centred on 0,0). */
export function sampleLandRuns(
  size: number,
  grid = GRID,
  heightAt: (x: number, z: number) => number = naturalHeightAt,
): LandRun[] {
  const cell = size / grid
  const runs: LandRun[] = []
  for (let j = 0; j < grid; j++) {
    const z = -size / 2 + (j + 0.5) * cell
    let start = -1
    for (let i = 0; i <= grid; i++) {
      const land = i < grid && heightAt(-size / 2 + (i + 0.5) * cell, z) > WORLD.seaLevel
      if (land && start < 0) start = i
      if (!land && start >= 0) {
        runs.push({ x: -size / 2 + start * cell, z: -size / 2 + j * cell, w: (i - start) * cell, h: cell })
        start = -1
      }
    }
  }
  return runs
}
