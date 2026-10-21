/**
 * Graphics quality presets. Shared contract: the world reads these numbers,
 * the canvas reads maxDpr, tests check that each step up raises the load.
 * Quality never changes the physics ground (see WORLD.physicsGridStep).
 */

export type Quality = 'low' | 'medium' | 'high'

export const QUALITY_LEVELS: readonly Quality[] = ['low', 'medium', 'high']

export interface QualityProfile {
  /** Terrain is drawn out to this distance from the camera (m). */
  terrainViewDistance: number
  /** Multiplier on level-of-detail switch distances: higher keeps fine detail further out. */
  terrainLodBias: number
  /** Trees per square kilometre of suitable land. */
  treeDensity: number
  /** Trees are drawn within this distance of the camera (m). */
  treeViewDistance: number
  /** Number of cloud puffs over the world. */
  cloudCount: number
  shadows: boolean
  shadowMapSize: number
  /** Distance (m) where fog reaches full density. */
  fogFar: number
  /** Device-pixel-ratio cap for the canvas. */
  maxDpr: number
  /** 'animated' = wave shader with sun glint; 'simple' = flat tinted plane. */
  waterDetail: 'simple' | 'animated'
}

export const QUALITY_PROFILES: Record<Quality, QualityProfile> = {
  low: {
    terrainViewDistance: 12000,
    terrainLodBias: 0.75,
    treeDensity: 40,
    treeViewDistance: 2500,
    cloudCount: 40,
    shadows: false,
    shadowMapSize: 1024,
    fogFar: 14000,
    maxDpr: 1,
    waterDetail: 'simple',
  },
  medium: {
    terrainViewDistance: 20000,
    terrainLodBias: 1,
    treeDensity: 80,
    treeViewDistance: 4000,
    cloudCount: 90,
    shadows: true,
    shadowMapSize: 2048,
    fogFar: 22000,
    maxDpr: 1.5,
    waterDetail: 'animated',
  },
  high: {
    terrainViewDistance: 32000,
    terrainLodBias: 1.4,
    treeDensity: 140,
    treeViewDistance: 6000,
    cloudCount: 160,
    shadows: true,
    shadowMapSize: 4096,
    fogFar: 32000,
    maxDpr: 2,
    waterDetail: 'animated',
  },
}
