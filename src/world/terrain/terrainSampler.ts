/**
 * The single ground sampler shared by physics, cameras, trees and challenges.
 * Contract (owned by the orchestrator, implemented by the terrain module):
 * heightAt/surfaceAt describe the triangulated WORLD.physicsGridStep grid,
 * which is exactly the mesh drawn at the finest level of detail.
 *
 * Interim implementation until the streaming terrain lands: the old
 * fixed-resolution grid.
 */

import type { TerrainSampler } from '../../simulation/types'
import { terrainSamplerForQuality } from './terrainGrid'

export function getTerrainSampler(): TerrainSampler {
  return terrainSamplerForQuality('high')
}
