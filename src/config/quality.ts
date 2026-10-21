/**
 * Graphics quality presets. Shared contract: the world reads these numbers,
 * the canvas reads maxDpr, tests check that each step up raises the load.
 */

export type Quality = 'low' | 'medium' | 'high'

export const QUALITY_LEVELS: readonly Quality[] = ['low', 'medium', 'high']

export interface QualityProfile {
  /** Terrain grid segments per side. */
  terrainSegments: number
  /** Number of cloud puffs. */
  cloudCount: number
  /** Number of instanced trees. */
  treeCount: number
  shadows: boolean
  shadowMapSize: number
  /** Distance (m) where fog reaches full density. */
  fogFar: number
  /** Device-pixel-ratio cap for the canvas. */
  maxDpr: number
}

export const QUALITY_PROFILES: Record<Quality, QualityProfile> = {
  low: {
    terrainSegments: 160,
    cloudCount: 14,
    treeCount: 400,
    shadows: false,
    shadowMapSize: 1024,
    fogFar: 7000,
    maxDpr: 1,
  },
  medium: {
    terrainSegments: 288,
    cloudCount: 40,
    treeCount: 1500,
    shadows: true,
    shadowMapSize: 2048,
    fogFar: 10000,
    maxDpr: 1.5,
  },
  high: {
    terrainSegments: 448,
    cloudCount: 90,
    treeCount: 3500,
    shadows: true,
    shadowMapSize: 4096,
    fogFar: 14000,
    maxDpr: 2,
  },
}
