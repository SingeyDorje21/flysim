import type { SurfaceType, TerrainSampler } from './types'

/** Infinite flat ground at `height`, for tests. */
export function createFlatTerrain(height = 0, surface: SurfaceType = 'paved'): TerrainSampler {
  return {
    heightAt: () => height,
    surfaceAt: () => surface,
  }
}
