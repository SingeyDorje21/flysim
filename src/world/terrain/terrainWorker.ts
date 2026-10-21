/**
 * Terrain chunk worker: builds chunk geometry off the main thread and
 * transfers the typed arrays back. Loaded by TerrainSystem via
 * new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' }).
 */

import { buildChunk } from './chunkBuilder'
import type { ChunkJob, ChunkResult } from './chunkProtocol'

interface WorkerScope {
  onmessage: ((e: MessageEvent<ChunkJob>) => void) | null
  postMessage(message: ChunkResult, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (e: MessageEvent<ChunkJob>) => {
  const { level, cx, cz } = e.data
  const data = buildChunk(level, cx, cz)
  scope.postMessage({ data }, [data.positions.buffer, data.normals.buffer, data.biome.buffer, data.indices.buffer])
}
