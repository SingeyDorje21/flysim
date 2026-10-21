/** Messages between TerrainSystem and the terrain worker. */

import type { ChunkData } from './chunkBuilder'

export interface ChunkJob {
  level: number
  cx: number
  cz: number
}

export interface ChunkResult {
  data: ChunkData
}
