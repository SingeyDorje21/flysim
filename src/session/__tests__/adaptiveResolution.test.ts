import { describe, expect, it } from 'vitest'
import { AdaptiveResolution, MIN_DPR } from '../adaptiveResolution'

/** Feeds `seconds` of frames of `ms` each (pick `ms` that divides a second, so windows line up); returns every pixel ratio change. */
function run(g: AdaptiveResolution, ms: number, seconds: number): number[] {
  const changes: number[] = []
  for (let t = 0; t < seconds * 1000; t += ms) {
    const d = g.frame(ms)
    if (d !== null) changes.push(d)
  }
  return changes
}

/** Past the start-up windows that are never judged. */
function warm(start: number): AdaptiveResolution {
  const g = new AdaptiveResolution(start)
  run(g, 10, 2)
  return g
}

describe('adaptive resolution', () => {
  it('ignores the first two seconds, while shaders compile and terrain streams in', () => {
    const g = new AdaptiveResolution(1.5)
    expect(run(g, 40, 1.9)).toEqual([])
    expect(g.dpr).toBe(1.5)
  })

  it('steps down 0.25 per second over a 60 fps budget, no lower than the minimum', () => {
    const g = warm(1.5)
    expect(run(g, 20, 1)).toEqual([1.25])
    expect(run(g, 20, 10)).toEqual([1, 0.75])
    expect(g.dpr).toBe(MIN_DPR)
  })

  it('holds steady at 60 fps (vsync) and at higher refresh rates', () => {
    const g = warm(1.5)
    expect(run(g, 1000 / 60, 10)).toEqual([])
    expect(run(g, 1000 / 120, 10)).toEqual([])
    expect(g.dpr).toBe(1.5)
  })

  it('steps back up after a few seconds on time, and waits twice as long after a failed try', () => {
    const g = warm(1.5)
    run(g, 20, 1)
    expect(g.dpr).toBe(1.25)
    // Four on-time seconds: back up.
    expect(run(g, 10, 4)).toEqual([1.5])
    // Over budget straight away: down again, and the next try needs eight seconds.
    expect(run(g, 20, 1)).toEqual([1.25])
    expect(run(g, 10, 7)).toEqual([])
    expect(run(g, 10, 1)).toEqual([1.5])
  })

  it('ignores gaps from a hidden tab or a stall', () => {
    const g = warm(1.5)
    for (let i = 0; i < 20; i++) expect(g.frame(1000)).toBeNull()
    expect(g.dpr).toBe(1.5)
  })

  it('a device already at the minimum has nothing to step', () => {
    const g = warm(0.75)
    expect(run(g, 40, 5)).toEqual([])
  })
})
