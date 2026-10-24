import { WORLD } from '../config/world'
import { naturalHeightAt } from '../world/terrain/heightField'

/** Relief image resolution (pixels per side). ~65k height samples, a few tens of ms, built once. */
const RELIEF_PX = 256

type Rgb = readonly [number, number, number]

/** Hypsometric colours: [height m, colour], interpolated between stops. */
const LAND_STOPS: readonly (readonly [number, Rgb])[] = [
  [0, [214, 200, 150]],
  [6, [104, 150, 84]],
  [120, [78, 128, 70]],
  [400, [128, 132, 84]],
  [800, [140, 112, 84]],
  [1300, [150, 146, 140]],
  [1700, [240, 240, 240]],
]
const SHALLOW: Rgb = [70, 150, 190]
const DEEP: Rgb = [14, 44, 78]

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function colourAt(h: number): Rgb {
  if (h <= WORLD.seaLevel) {
    const t = Math.min(1, -h / 150) ** 0.6
    return [lerp(SHALLOW[0], DEEP[0], t), lerp(SHALLOW[1], DEEP[1], t), lerp(SHALLOW[2], DEEP[2], t)]
  }
  for (let i = 1; i < LAND_STOPS.length; i++) {
    const [h1, c1] = LAND_STOPS[i]
    if (h < h1) {
      const [h0, c0] = LAND_STOPS[i - 1]
      const t = (h - h0) / (h1 - h0)
      return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)]
    }
  }
  return LAND_STOPS[LAND_STOPS.length - 1][1]
}

/**
 * Shaded-relief colours for a size x size world square centred on 0,0: height
 * tint plus hillshade lit from the north-west. Row 0 is the north edge.
 * Returns RGB bytes, `px * px * 3`.
 */
export function reliefPixels(
  size: number,
  px = RELIEF_PX,
  heightAt: (x: number, z: number) => number = naturalHeightAt,
): Uint8ClampedArray {
  const cell = size / px
  const heights = new Float32Array(px * px)
  for (let j = 0; j < px; j++) {
    const z = -size / 2 + (j + 0.5) * cell
    for (let i = 0; i < px; i++) heights[j * px + i] = heightAt(-size / 2 + (i + 0.5) * cell, z)
  }
  const at = (i: number, j: number) =>
    heights[Math.min(px - 1, Math.max(0, j)) * px + Math.min(px - 1, Math.max(0, i))]
  // Light from the north-west, 45 degrees up; relief exaggerated so hills read at map scale.
  const lx = -0.5
  const lz = -0.5
  const ly = Math.SQRT1_2
  const exaggerate = 4
  const out = new Uint8ClampedArray(px * px * 3)
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      const h = heights[j * px + i]
      const c = colourAt(h)
      let shade = 1
      if (h > WORLD.seaLevel) {
        const dx = ((at(i + 1, j) - at(i - 1, j)) / (2 * cell)) * exaggerate
        const dz = ((at(i, j + 1) - at(i, j - 1)) / (2 * cell)) * exaggerate
        const len = Math.sqrt(dx * dx + dz * dz + 1)
        const lit = (-dx * lx + ly - dz * lz) / len
        shade = 0.55 + 0.65 * Math.max(0, lit)
      }
      const o = (j * px + i) * 3
      out[o] = c[0] * shade
      out[o + 1] = c[1] * shade
      out[o + 2] = c[2] * shade
    }
  }
  return out
}

/** 24-bit BMP data URL from top-down RGB rows (no canvas needed, so it also works in tests). */
export function rgbToBmpDataUrl(rgb: Uint8ClampedArray, w: number, h: number): string {
  const stride = Math.ceil((w * 3) / 4) * 4
  const fileSize = 54 + stride * h
  const bytes = new Uint8Array(fileSize)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x42 // 'B'
  bytes[1] = 0x4d // 'M'
  view.setUint32(2, fileSize, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, w, true)
  view.setInt32(22, h, true) // positive height: rows stored bottom-up
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, stride * h, true)
  for (let y = 0; y < h; y++) {
    const row = 54 + (h - 1 - y) * stride
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3
      bytes[row + x * 3] = rgb[s + 2]
      bytes[row + x * 3 + 1] = rgb[s + 1]
      bytes[row + x * 3 + 2] = rgb[s]
    }
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:image/bmp;base64,${btoa(bin)}`
}

let reliefCache: string | null = null

/** The island's shaded-relief map image, built once and shared by every map view. */
export function reliefImageUrl(): string {
  reliefCache ??= rgbToBmpDataUrl(reliefPixels(WORLD.terrainSize), RELIEF_PX, RELIEF_PX)
  return reliefCache
}
