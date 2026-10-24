import { describe, expect, it } from 'vitest'
import { reliefPixels, rgbToBmpDataUrl } from '../mapData'

describe('map relief', () => {
  it('tints sea blue and land green from the height field', () => {
    // West half sea (-50 m), east half low land (+50 m).
    const px = 8
    const rgb = reliefPixels(1000, px, (x) => (x < 0 ? -50 : 50))
    const pixel = (i: number, j: number) => Array.from(rgb.subarray((j * px + i) * 3, (j * px + i) * 3 + 3))
    const [sr, , sb] = pixel(1, 4)
    const [lr, lg, lb] = pixel(6, 4)
    expect(sb).toBeGreaterThan(sr)
    expect(lg).toBeGreaterThan(lr)
    expect(lg).toBeGreaterThan(lb)
  })

  it('encodes a valid 24-bit BMP with padded rows', () => {
    const w = 3
    const h = 2
    const url = rgbToBmpDataUrl(new Uint8ClampedArray(w * h * 3).fill(200), w, h)
    expect(url.startsWith('data:image/bmp;base64,')).toBe(true)
    const bytes = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0))
    const view = new DataView(bytes.buffer)
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('BM')
    expect(view.getInt32(18, true)).toBe(w)
    expect(view.getInt32(22, true)).toBe(h)
    expect(view.getUint16(28, true)).toBe(24)
    // 3 px * 3 bytes = 9, padded to 12 per row.
    expect(bytes.length).toBe(54 + 12 * h)
  })
})
