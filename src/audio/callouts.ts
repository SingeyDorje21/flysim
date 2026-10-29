/**
 * Spoken cockpit callouts, like a real flight deck: "Rotate" at Vr,
 * "Positive rate" after lift-off, radio-altitude calls on the way down and
 * "Retard" for jets at 20 ft. CalloutDetector is pure (testable); speak()
 * uses the browser's speech synthesis when it exists.
 */

export interface CalloutFrame {
  airspeed: number
  /** Rotation speed of this aircraft (m/s). */
  rotateSpeed: number
  onGround: boolean
  verticalSpeed: number
  /** Height of the wheels above the ground (m). */
  heightAboveGround: number
  throttle: number
  jet: boolean
  /** Changes on spawn/restart. */
  teleportId: number
}

const FT = 0.3048
/** Descending radio-altitude calls (ft) and their words. */
const HEIGHT_CALLS: readonly [number, string][] = [
  [500, 'Five hundred'],
  [100, 'One hundred'],
  [50, 'Fifty'],
  [40, 'Forty'],
  [30, 'Thirty'],
  [20, 'Twenty'],
  [10, 'Ten'],
]

export class CalloutDetector {
  private prev: CalloutFrame | null = null
  private rotateCalled = false
  private positiveRateCalled = false
  private airborneFor = 0
  /** Height calls already made on this descent. */
  private readonly made = new Set<number>()

  detect(f: CalloutFrame, dt: number): string[] {
    const prev = this.prev
    this.prev = { ...f }
    if (!prev || prev.teleportId !== f.teleportId) {
      this.rotateCalled = false
      this.positiveRateCalled = false
      this.airborneFor = 0
      this.made.clear()
      return []
    }
    const calls: string[] = []

    if (f.onGround) {
      this.airborneFor = 0
      if (!this.rotateCalled && f.throttle > 0.5 && prev.airspeed < f.rotateSpeed && f.airspeed >= f.rotateSpeed) {
        this.rotateCalled = true
        calls.push('Rotate')
      }
      // Stopped again after a landing: re-arm for the next take-off.
      if (f.airspeed < 5) {
        this.rotateCalled = false
        this.positiveRateCalled = false
      }
      this.made.clear()
      return calls
    }

    this.airborneFor += dt
    if (!this.positiveRateCalled && this.airborneFor > 1 && f.verticalSpeed > 1 && f.heightAboveGround < 100) {
      this.positiveRateCalled = true
      calls.push('Positive rate')
    }

    const hFt = f.heightAboveGround / FT
    const prevFt = prev.heightAboveGround / FT
    if (hFt > 600) this.made.clear()
    if (f.verticalSpeed < -0.5) {
      for (const [mark, word] of HEIGHT_CALLS) {
        if (!this.made.has(mark) && prevFt > mark && hFt <= mark) {
          this.made.add(mark)
          calls.push(word)
          if (mark === 20 && f.jet && f.throttle > 0.05) calls.push('Retard')
        }
      }
    }
    return calls
  }
}

/** Speak a callout with the browser voice; silently does nothing where unsupported. */
export function speak(text: string, volume: number): void {
  try {
    const synth = globalThis.speechSynthesis
    if (!synth || typeof SpeechSynthesisUtterance !== 'function' || volume <= 0) return
    // Never let calls queue up behind each other: the newest is the relevant one.
    if (synth.pending) synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.15
    u.volume = Math.min(1, volume * 1.4)
    synth.speak(u)
  } catch {
    // Speech unavailable.
  }
}

/** Silence any callout being spoken or queued (pause, results, quitting the flight). */
export function stopSpeech(): void {
  try {
    const synth = globalThis.speechSynthesis
    if (synth && (synth.speaking || synth.pending)) synth.cancel()
  } catch {
    // Speech unavailable.
  }
}
