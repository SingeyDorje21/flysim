/**
 * Streams terrain chunks around the camera: quadtree selection (lod.ts),
 * geometry built in Web Workers (or on the main thread, a little per frame,
 * when workers are unavailable), a capped number of GPU uploads per frame,
 * and an LRU cache that disposes evicted geometries.
 *
 * No holes while streaming: a node is replaced by its children only once all
 * of them can be drawn; until then the node itself (or the nearest ready
 * ancestor) stays on screen.
 */

import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3, type Material } from 'three'
import { buildChunk, type ChunkData } from './chunkBuilder'
import type { ChunkJob, ChunkResult } from './chunkProtocol'
import { MAX_LEVEL, chunkDistance, chunkKey, chunkSize, chunkVisible, shouldSplit } from './lod'

/** New chunk geometries created per frame (GPU uploads). */
const MAX_UPLOADS_PER_FRAME = 3
/** Main-thread fallback build budget per frame (ms); at least one chunk is built. */
const FALLBACK_BUDGET_MS = 4
/** Jobs in flight per worker. */
const JOBS_PER_WORKER = 2
/** Re-run the selection when the camera has moved this far (m). */
const RESELECT_DISTANCE = 30

interface Entry {
  level: number
  cx: number
  cz: number
  ready: boolean
  /** Null for an empty (deep sea) chunk or while pending. */
  mesh: Mesh | null
  lastUsed: number
}

interface Job extends ChunkJob {
  key: string
  priority: number
}

export interface TerrainStreamerOptions {
  material: Material
  viewDistance: number
  lodBias: number
  receiveShadow: boolean
  /** LRU capacity in chunks. */
  cacheSize?: number
  /** Set false to force the main-thread fallback. */
  useWorkers?: boolean
}

export interface TerrainStreamerStats {
  drawn: number
  cached: number
  pending: number
  queued: number
  workers: number
}

export class TerrainStreamer {
  readonly group = new Group()
  private readonly material: Material
  private readonly viewDistance: number
  private readonly lodBias: number
  private readonly receiveShadow: boolean
  private readonly cacheSize: number

  private readonly entries = new Map<string, Entry>()
  private readonly jobs = new Map<string, Job>()
  private readonly uploads: ChunkData[] = []
  private workers: Worker[] = []
  private readonly inflight: Map<string, Job>[] = []
  private drawn = new Set<Entry>()
  private frame = 0
  private lastX = Infinity
  private lastY = Infinity
  private lastZ = Infinity
  private dirty = true
  private disposed = false

  constructor(options: TerrainStreamerOptions) {
    this.material = options.material
    this.viewDistance = options.viewDistance
    this.lodBias = options.lodBias
    this.receiveShadow = options.receiveShadow
    this.cacheSize = options.cacheSize ?? 700
    this.group.name = 'terrain'
    if (options.useWorkers !== false) this.startWorkers()
  }

  private startWorkers(): void {
    if (typeof Worker === 'undefined') return
    const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4
    const count = Math.max(1, Math.min(3, hc - 1))
    try {
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' })
        const slot = this.workers.length
        this.inflight.push(new Map())
        worker.onmessage = (e: MessageEvent<ChunkResult>) => this.onResult(slot, e.data.data)
        worker.onerror = (e) => {
          e.preventDefault()
          this.abandonWorkers()
        }
        this.workers.push(worker)
      }
    } catch {
      this.abandonWorkers()
    }
  }

  /** Switch to the main-thread fallback, requeueing whatever was in flight. */
  private abandonWorkers(): void {
    for (const w of this.workers) w.terminate()
    for (const map of this.inflight) {
      for (const job of map.values()) {
        this.entries.delete(job.key)
        this.dirty = true
      }
    }
    this.workers = []
    this.inflight.length = 0
  }

  private onResult(slot: number, data: ChunkData): void {
    if (this.disposed) return
    this.inflight[slot]?.delete(chunkKey(data.level, data.cx, data.cz))
    this.uploads.push(data)
  }

  get stats(): TerrainStreamerStats {
    let pending = 0
    for (const m of this.inflight) pending += m.size
    return { drawn: this.drawn.size, cached: this.entries.size, pending, queued: this.jobs.size, workers: this.workers.length }
  }

  /** Call once per frame with the camera position. */
  update(camX: number, camY: number, camZ: number): void {
    if (this.disposed) return
    this.frame++

    // 1. Upload a few finished chunks.
    for (let n = 0; n < MAX_UPLOADS_PER_FRAME && this.uploads.length > 0; n++) {
      this.upload(this.uploads.shift()!)
      this.dirty = true
    }

    // 2. Re-select when the camera moved or new chunks became ready.
    const dx = camX - this.lastX
    const dy = camY - this.lastY
    const dz = camZ - this.lastZ
    if (this.dirty || dx * dx + dy * dy + dz * dz > RESELECT_DISTANCE * RESELECT_DISTANCE) {
      this.dirty = false
      this.lastX = camX
      this.lastY = camY
      this.lastZ = camZ
      this.select(camX, camY, camZ)
    } else {
      for (const e of this.drawn) e.lastUsed = this.frame
    }

    // 3. Start builds, nearest-coarsest first.
    this.dispatch()

    // 4. Keep the cache bounded.
    if (this.entries.size > this.cacheSize + 32) this.evict()
  }

  private upload(data: ChunkData): void {
    const key = chunkKey(data.level, data.cx, data.cz)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { level: data.level, cx: data.cx, cz: data.cz, ready: false, mesh: null, lastUsed: this.frame }
      this.entries.set(key, entry)
    }
    if (entry.ready) return
    entry.ready = true
    if (data.empty) return

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3))
    geometry.setAttribute('biome', new BufferAttribute(data.biome, 2))
    geometry.setIndex(new BufferAttribute(data.indices, 1))
    const size = chunkSize(data.level)
    geometry.boundingBox = new Box3(new Vector3(0, data.minY, 0), new Vector3(size, data.maxY, size))
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere())

    const mesh = new Mesh(geometry, this.material)
    mesh.name = `terrain-${key}`
    mesh.position.set(data.originX, 0, data.originZ)
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    mesh.receiveShadow = this.receiveShadow
    mesh.visible = false
    entry.mesh = mesh
    this.group.add(mesh)
  }

  private isReady(level: number, cx: number, cz: number): boolean {
    return this.entries.get(chunkKey(level, cx, cz))?.ready === true
  }

  private select(camX: number, camY: number, camZ: number): void {
    const next = new Set<Entry>()
    const renderable = new Map<string, boolean>()
    this.jobs.clear()

    const visible = (l: number, cx: number, cz: number) => chunkVisible(l, cx, cz, camX, camY, camZ, this.viewDistance)
    const split = (l: number, cx: number, cz: number) => shouldSplit(l, cx, cz, camX, camY, camZ, this.lodBias)

    const canRender = (l: number, cx: number, cz: number): boolean => {
      if (!visible(l, cx, cz)) return true
      const key = chunkKey(l, cx, cz)
      const memo = renderable.get(key)
      if (memo !== undefined) return memo
      let ok = this.isReady(l, cx, cz)
      if (!ok && split(l, cx, cz)) {
        ok =
          canRender(l - 1, cx * 2, cz * 2) &&
          canRender(l - 1, cx * 2 + 1, cz * 2) &&
          canRender(l - 1, cx * 2, cz * 2 + 1) &&
          canRender(l - 1, cx * 2 + 1, cz * 2 + 1)
      }
      renderable.set(key, ok)
      return ok
    }

    const request = (l: number, cx: number, cz: number, fallback: boolean) => {
      const key = chunkKey(l, cx, cz)
      if (this.entries.has(key)) return // ready or in flight
      const d = chunkDistance(l, cx, cz, camX, camY, camZ)
      // Fallback ancestors first (coarsest first), then by distance.
      const priority = fallback ? -(l + 1) * 1e7 + d : d
      const old = this.jobs.get(key)
      if (!old || priority < old.priority) this.jobs.set(key, { key, level: l, cx, cz, priority })
    }

    const draw = (l: number, cx: number, cz: number): void => {
      const key = chunkKey(l, cx, cz)
      const entry = this.entries.get(key)
      if (entry) entry.lastUsed = this.frame
      if (split(l, cx, cz)) {
        const c = l - 1
        const kids: [number, number][] = [
          [cx * 2, cz * 2],
          [cx * 2 + 1, cz * 2],
          [cx * 2, cz * 2 + 1],
          [cx * 2 + 1, cz * 2 + 1],
        ]
        const all = kids.every(([kx, kz]) => canRender(c, kx, kz))
        if (all || !entry?.ready) {
          if (!all) request(l, cx, cz, true)
          for (const [kx, kz] of kids) if (visible(c, kx, kz)) draw(c, kx, kz)
          return
        }
        // Keep this node on screen while its children load.
        for (const [kx, kz] of kids) if (visible(c, kx, kz) && !this.isReady(c, kx, kz)) request(c, kx, kz, false)
        next.add(entry)
        return
      }
      if (entry?.ready) next.add(entry)
      else request(l, cx, cz, false)
    }

    if (visible(MAX_LEVEL, 0, 0)) draw(MAX_LEVEL, 0, 0)

    for (const e of this.drawn) if (!next.has(e) && e.mesh) e.mesh.visible = false
    for (const e of next) if (e.mesh) e.mesh.visible = true
    this.drawn = next
  }

  private dispatch(): void {
    if (this.jobs.size === 0) return
    const queue = [...this.jobs.values()].sort((a, b) => a.priority - b.priority)
    let qi = 0
    const take = (): Job | undefined => {
      while (qi < queue.length) {
        const job = queue[qi++]
        if (!this.entries.has(job.key)) return job
      }
      return undefined
    }
    const begin = (job: Job) => {
      this.jobs.delete(job.key)
      this.entries.set(job.key, { level: job.level, cx: job.cx, cz: job.cz, ready: false, mesh: null, lastUsed: this.frame })
    }

    if (this.workers.length > 0) {
      for (let w = 0; w < this.workers.length; w++) {
        const map = this.inflight[w]
        while (map.size < JOBS_PER_WORKER) {
          const job = take()
          if (!job) return
          begin(job)
          map.set(job.key, job)
          const msg: ChunkJob = { level: job.level, cx: job.cx, cz: job.cz }
          this.workers[w].postMessage(msg)
        }
      }
      return
    }

    // Main-thread fallback, spread over frames.
    const t0 = performance.now()
    let built = 0
    while (built === 0 || performance.now() - t0 < FALLBACK_BUDGET_MS) {
      const job = take()
      if (!job) return
      begin(job)
      this.uploads.push(buildChunk(job.level, job.cx, job.cz))
      built++
    }
  }

  private evict(): void {
    const candidates: [string, Entry][] = []
    for (const kv of this.entries) {
      const e = kv[1]
      if (e.ready && !this.drawn.has(e) && e.lastUsed < this.frame) candidates.push(kv)
    }
    candidates.sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    let excess = this.entries.size - this.cacheSize
    for (let i = 0; i < candidates.length && excess > 0; i++, excess--) {
      const [key, e] = candidates[i]
      if (e.mesh) {
        this.group.remove(e.mesh)
        e.mesh.geometry.dispose()
      }
      this.entries.delete(key)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const w of this.workers) w.terminate()
    this.workers = []
    for (const e of this.entries.values()) {
      if (e.mesh) {
        this.group.remove(e.mesh)
        e.mesh.geometry.dispose()
      }
    }
    this.entries.clear()
    this.jobs.clear()
    this.uploads.length = 0
    this.drawn.clear()
  }
}
