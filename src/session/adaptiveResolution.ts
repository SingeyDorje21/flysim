/**
 * Lowers the canvas resolution (device pixel ratio) when frames take longer
 * than a 60 fps budget, and raises it again once frames come in on time.
 * Uneven frame times feel worse than a slightly softer picture, so this keeps
 * the frame rate steady on weak GPUs.
 *
 * Hysteresis: one second over budget steps down; several seconds on time step
 * up. A step up that is undone soon after doubles the wait before the next try,
 * because every change reallocates the drawing buffer (a hitch of its own).
 */

/** Lowest pixel ratio the governor goes to. */
export const MIN_DPR = 0.75
const STEP = 0.25
/** Frame-time budget (ms): a little over 60 fps. */
const BUDGET_MS = 1000 / 60 + 1
/** Gaps longer than this (ms) are a hidden tab or a stall, not rendering cost. */
const IGNORE_FRAME_MS = 100
/** Length of one measuring window (ms). */
const WINDOW_MS = 1000
/** On-time windows needed before a step up, at first (doubles after a failed try). */
const UP_WINDOWS = 4
const MAX_UP_WINDOWS = 64
/** A step down within this many windows of a step up counts as a failed try. */
const FAILED_TRY_WINDOWS = 3
/** Windows ignored at the start, while shaders compile and the terrain streams in. */
const WARMUP_WINDOWS = 2

export class AdaptiveResolution {
  private readonly levels: number[]
  private level = 0
  private windowMs = 0
  private windowFrames = 0
  private onTime = 0
  private upWindows = UP_WINDOWS
  private sinceUp = Infinity
  private warmup = WARMUP_WINDOWS

  /** `start`: the pixel ratio to start at and never exceed (device ratio capped by quality). */
  constructor(start: number) {
    this.levels = [start]
    for (let d = start - STEP; d >= MIN_DPR - 1e-9; d -= STEP) this.levels.push(Math.round(d * 100) / 100)
  }

  get dpr(): number {
    return this.levels[this.level]
  }

  /** Feeds one frame's duration (ms). Returns the new pixel ratio when it changes, else null. */
  frame(ms: number): number | null {
    if (!(ms > 0) || ms > IGNORE_FRAME_MS) return null
    this.windowMs += ms
    this.windowFrames++
    if (this.windowMs < WINDOW_MS) return null
    const mean = this.windowMs / this.windowFrames
    this.windowMs = 0
    this.windowFrames = 0
    if (this.warmup > 0) {
      this.warmup--
      return null
    }
    this.sinceUp++

    if (mean > BUDGET_MS) {
      this.onTime = 0
      if (this.level === this.levels.length - 1) return null
      if (this.sinceUp <= FAILED_TRY_WINDOWS) this.upWindows = Math.min(MAX_UP_WINDOWS, this.upWindows * 2)
      this.level++
      return this.dpr
    }
    if (++this.onTime < this.upWindows || this.level === 0) return null
    this.onTime = 0
    this.sinceUp = 0
    this.level--
    return this.dpr
  }
}
