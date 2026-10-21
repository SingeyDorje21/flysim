/**
 * Fixed-timestep accumulator. Converts variable frame times into a whole
 * number of fixed simulation steps and returns the interpolation alpha.
 *
 * - NaN, infinite or negative frame times count as 0.
 * - Frame times are capped at maxFrameDt and the number of steps per call at
 *   maxSubSteps, so a long stall (tab in background) never spirals.
 */
export class FixedTimestep {
  readonly dt: number
  private readonly maxSubSteps: number
  private readonly maxFrameDt: number
  private accumulator = 0

  constructor(opts: { dt: number; maxSubSteps?: number; maxFrameDt?: number }) {
    const dt = opts.dt
    this.dt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 120
    const maxFrame = opts.maxFrameDt
    this.maxFrameDt = maxFrame !== undefined && Number.isFinite(maxFrame) && maxFrame > 0 ? maxFrame : 0.1
    const maxSub = opts.maxSubSteps
    this.maxSubSteps =
      maxSub !== undefined && Number.isFinite(maxSub) && maxSub >= 1
        ? Math.floor(maxSub)
        : Math.max(1, Math.ceil(this.maxFrameDt / this.dt))
  }

  /** Runs `step` zero or more times; returns alpha in [0, 1). */
  advance(frameDt: number, step: (dt: number) => void): number {
    let frame = Number.isFinite(frameDt) && frameDt > 0 ? frameDt : 0
    if (frame > this.maxFrameDt) frame = this.maxFrameDt
    this.accumulator += frame

    const dt = this.dt
    // Tolerance so 1/60 reliably gives two 1/120 steps despite rounding.
    const eps = dt * 1e-6
    let steps = 0
    while (this.accumulator + eps >= dt && steps < this.maxSubSteps) {
      step(dt)
      this.accumulator -= dt
      steps++
    }
    if (this.accumulator + eps >= dt) {
      // Hit the sub-step cap: drop the backlog instead of carrying it forward.
      this.accumulator = this.accumulator % dt
    }
    if (this.accumulator < 0) this.accumulator = 0

    const alpha = this.accumulator / dt
    return alpha >= 1 ? 0.999999 : alpha < 0 ? 0 : alpha
  }

  reset(): void {
    this.accumulator = 0
  }
}
