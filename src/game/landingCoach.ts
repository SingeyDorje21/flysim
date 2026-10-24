/**
 * Landing coach: plain-language advice while landing outside Flight School.
 * It reads the approach (speed against the aircraft's approach speed, glide
 * path, centreline, sink rate, flare) and says what to change. The advice
 * never quotes readings: the pilot already has those on the HUD.
 */

import { getAircraftConfig } from '../config/aircraft'
import type { TelemetrySnapshot } from '../state/telemetry'
import { techniqueFor } from './technique'

const KT = 0.514444
const DEG = 180 / Math.PI
/** The coach looks after the last part of the approach only (m above the ground). */
const COACH_HEIGHT = 450
/** At most this many tips at once, most urgent first. */
const MAX_TIPS = 2
/** A touchdown verdict stays up this long (sim s). */
export const VERDICT_SECONDS = 6

export type Tone = 'warn' | 'info' | 'good'

export interface Advice {
  id: string
  text: string
  tone: Tone
}

/** Pitch keys depend on the invert-pitch setting. */
export interface PitchKeys {
  noseUp: string
  noseDown: string
}

export function pitchKeys(invertPitch: boolean): PitchKeys {
  return invertPitch ? { noseUp: 'W', noseDown: 'S' } : { noseUp: 'S', noseDown: 'W' }
}

/**
 * True while the aircraft is landing: airborne, low, not climbing, and either
 * lined up with a runway or descending with the gear down (a field landing).
 * Flight School lessons have their own coach.
 */
export function isLanding(t: TelemetrySnapshot): boolean {
  if (t.onGround || t.crashed || t.lesson) return false
  if (t.heightAboveGround > COACH_HEIGHT || t.verticalSpeed > 1) return false
  return t.nav.approach !== null || (t.gearPosition > 0.9 && t.verticalSpeed < -0.5)
}

/** What to change right now, most urgent first (empty when not landing). */
export function landingAdvice(t: TelemetrySnapshot, keys: PitchKeys): Advice[] {
  if (!isLanding(t)) return []
  const tech = techniqueFor(t.aircraftId)
  const h = t.heightAboveGround
  const sink = -t.verticalSpeed
  const fast = t.airspeed - tech.approachSpeed
  const flaring = h <= tech.flareHeight * 2
  const tips: Advice[] = []
  const add = (id: string, text: string, tone: Tone = 'info') => tips.push({ id, text, tone })

  if (t.stallWarning || t.stalled) add('stall', 'Stall warning: lower the nose and add power (R)', 'warn')
  if (tech.retractableGear && t.gearLever < 0.5) add('gear', 'Lower the landing gear (G)', 'warn')

  if (flaring) {
    if (t.pitchDeg > tech.tailStrikePitchDeg - 1.5) add('tail', 'Stop raising the nose: the tail is close to the runway', 'warn')
    if (h <= tech.flareHeight && sink > 1.5) add('flare', `Flare now: ease the nose up (${keys.noseUp})`, 'warn')
    else if (sink > 3.5) add('flare-early', `Sinking fast: start the flare (${keys.noseUp})`, 'warn')
    if (t.verticalSpeed > 0.5) add('balloon', `Floating up: ease the nose down a touch (${keys.noseDown})`)
    if (Math.abs(t.bankDeg) > 5) add('level', 'Level the wings before touchdown (A / D)')
    if (t.throttle > 0.15) add('idle', 'Close the throttle for touchdown (F)')
    if (tips.length === 0) add('hold', 'Good flare: hold the attitude and let it settle', 'good')
    return tips.slice(0, MAX_TIPS)
  }

  if (Math.abs(t.bankDeg) > 20) add('level', 'Too much bank: level the wings (A / D)', 'warn')
  if (h < 400 && t.flaps < tech.landingFlaps - 0.05) add('flaps', 'Extend the flaps for landing (X)')
  if (fast > 15 * KT) add('speed', 'Much too fast: close the throttle (F)', 'warn')
  else if (fast > 7 * KT) add('speed', 'A little fast: reduce power (F)')
  else if (fast < -5 * KT) add('speed', 'Too slow: add power (R)', 'warn')

  const app = t.nav.approach
  if (app && app.distance > 300) {
    const pathDev = Math.atan2(app.vertical, app.distance) * DEG
    const lineDev = Math.atan2(app.lateral, app.distance) * DEG
    if (pathDev > 0.6) add('high', `Above the glide path: lower the nose a little (${keys.noseDown}) and reduce power`)
    else if (pathDev < -0.6) add('low', `Below the glide path: raise the nose a little (${keys.noseUp}) and add power`, 'warn')
    if (lineDev > 1.5) add('line', 'Right of the centreline: bank gently left (A)')
    else if (lineDev < -1.5) add('line', 'Left of the centreline: bank gently right (D)')
  }

  // A 3 degree path sinks at about airspeed x sin(3 deg).
  const pathSink = t.airspeed * Math.sin(3 / DEG)
  if (sink > Math.max(pathSink * 1.6, pathSink + 2)) {
    add('sink', `Descending too fast: raise the nose slightly (${keys.noseUp}) and add a little power`, 'warn')
  }
  if (tips.length === 0) add('ok', 'On track: hold this speed and descent', 'good')
  // Warnings first; otherwise keep the order above.
  return [...tips.filter((a) => a.tone === 'warn'), ...tips.filter((a) => a.tone !== 'warn')].slice(0, MAX_TIPS)
}

export interface Verdict {
  tone: Tone
  title: string
  text: string
}

/** How the touchdown went, judged against this aircraft's hard-landing limit. */
export function touchdownVerdict(t: TelemetrySnapshot): Verdict | null {
  const td = t.touchdown
  if (!td || t.crashed || !t.onGround || t.lesson || t.simTime - td.simTime > VERDICT_SECONDS) return null
  const limit = getAircraftConfig(t.aircraftId).crash.hardLandingSinkRate
  if (td.sink < limit * 0.35) return { tone: 'good', title: 'Smooth landing!', text: 'Hold the brakes (B) to stop' }
  if (td.sink < limit) return { tone: 'info', title: 'Firm landing', text: 'Next time start the flare a little earlier' }
  return {
    tone: 'warn',
    title: 'Hard landing',
    text: 'Too much sink at touchdown: hold the approach speed and flare earlier',
  }
}
