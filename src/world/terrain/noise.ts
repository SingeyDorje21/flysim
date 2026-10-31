/**
 * Deterministic, allocation-free 2D noise for the terrain (pure TS, no three.js,
 * no Math.sin). Shared by the height field, the chunk builder (also inside the
 * terrain worker) and tree placement, so every thread computes identical values.
 */

/** Integer hash of a lattice point, returns [0, 1). */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) * (1 / 4294967296)
}

/** Smooth (quintic) value noise, -1..1. One lattice cell = 1 unit. */
export function valueNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1
}

/** Partial derivatives of the last noiseD2 call (module scratch, no allocation). */
export let noiseDX = 0
export let noiseDZ = 0

/** Value noise -1..1 with analytic derivatives, written to noiseDX / noiseDZ. */
export function noiseD2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const du = 30 * fx * fx * (fx * (fx - 2) + 1)
  const dv = 30 * fz * fz * (fz * (fz - 2) + 1)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  const k = a - b - c + d
  noiseDX = 2 * du * (b - a + k * v)
  noiseDZ = 2 * dv * (c - a + k * u)
  return (a + (b - a) * u + (c - a) * v + k * u * v) * 2 - 1
}

/** Gradient (Perlin-style) noise, roughly -1..1, with quintic fade. One lattice cell = 1 unit. */
export function gradNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const ga = grad(ix, iz, seed, fx, fz)
  const gb = grad(ix + 1, iz, seed, fx - 1, fz)
  const gc = grad(ix, iz + 1, seed, fx, fz - 1)
  const gd = grad(ix + 1, iz + 1, seed, fx - 1, fz - 1)
  return 1.4 * (ga + (gb - ga) * u + (gc - ga) * v + (ga - gb - gc + gd) * u * v)
}

/** Dot product of a hashed unit gradient (16 directions) with (dx, dz). */
function grad(ix: number, iz: number, seed: number, dx: number, dz: number): number {
  const k = Math.floor(hash2(ix, iz, seed) * 16) & 15
  return GX[k] * dx + GZ[k] * dz
}
const GX = new Float64Array(16)
const GZ = new Float64Array(16)
for (let k = 0; k < 16; k++) {
  // Exact table built once; identical in every thread of the same engine.
  GX[k] = Math.cos((k * Math.PI) / 8)
  GZ[k] = Math.sin((k * Math.PI) / 8)
}

/** Ridged multifractal on gradient noise, 0..1: sharp crests, smooth valleys. */
export function ridgedGrad2(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let px = x
  let pz = z
  let weight = 1
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(gradNoise2(px, pz, seed + i * 211))
    n = n < 0 ? 0 : n
    n *= n
    n *= weight
    weight = n * 1.8 > 1 ? 1 : n * 1.8
    sum += amp * n
    norm += amp
    amp *= 0.5
    const nx = 1.6 * px - 1.2 * pz + 13.1
    pz = 1.2 * px + 1.6 * pz + 29.9
    px = nx
  }
  return sum / norm
}

/** Fractal Brownian motion, roughly -1..1. Octaves are rotated to hide the lattice. */
export function fbm2(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let px = x
  let pz = z
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(px, pz, seed + i * 101)
    norm += amp
    amp *= 0.5
    // Rotate ~37 degrees and double the frequency.
    const nx = 1.6 * px - 1.2 * pz + 17.3
    pz = 1.2 * px + 1.6 * pz + 31.7
    px = nx
  }
  return sum / norm
}

/**
 * "Eroded" fbm: each octave is damped where the accumulated slope is steep,
 * which gives smooth valleys and gullied flanks. Roughly -1..1.
 */
export function erodedFbm2(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let dx = 0
  let dz = 0
  let px = x
  let pz = z
  let f = 1
  for (let i = 0; i < octaves; i++) {
    const n = noiseD2(px, pz, seed + i * 307)
    // Derivatives in base-coordinate units (rotation keeps the length).
    dx += noiseDX * f
    dz += noiseDZ * f
    sum += (amp * n) / (1 + 0.35 * (dx * dx + dz * dz))
    norm += amp
    amp *= 0.5
    f *= 2
    const nx = 1.6 * px - 1.2 * pz + 7.7
    pz = 1.2 * px + 1.6 * pz + 3.1
    px = nx
  }
  return sum / norm
}

export function smoothstep(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a)
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return t * t * (3 - 2 * t)
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
