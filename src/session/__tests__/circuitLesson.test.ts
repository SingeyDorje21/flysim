import { beforeEach, describe, expect, it } from 'vitest'
import { AIRCRAFT_IDS, getAircraft, type AircraftId } from '../../config/aircraftCatalog'
import { FLAP_DETENTS } from '../../input/keyboard'
import { getRunwayEnd, guidanceTo, headingVector } from '../../game/airportGeometry'
import { NOSE_DOWN_PITCH_DEG } from '../../game/lessons'
import { FLAPS_UP_FACTOR, techniqueFor } from '../../game/technique'
import type { FlightResult } from '../../game/types'
import { resetAutopilot, useAutopilotStore } from '../../state/autopilotStore'
import { getTelemetry } from '../../state/telemetry'
import { getTerrainSampler } from '../../world/terrain/terrainSampler'
import { FlightSession } from '../FlightSession'

const FRAME = 1 / 60
const KT = 0.514444
const DEG = Math.PI / 180

function hold(session: FlightSession, code: string, on: boolean) {
  if (on) session.keyboard.keyDown(code)
  else session.keyboard.keyUp(code)
}

function tap(session: FlightSession, code: string) {
  session.keyboard.keyDown(code)
  session.keyboard.keyUp(code)
}

const stepTitle = () => {
  const l = getTelemetry().lesson
  return l?.steps[l.current]?.title ?? null
}

/**
 * A student who follows the coach through the whole circuit. The take-off and
 * the flare and rollout are flown on the keys, as the take-off and landing
 * lessons' students do; the pattern legs and the final are flown with the
 * autopilot set to the heading, height, speed and glide path the coach asks
 * for (as a tidy pilot would), handing back to the keys for the flare.
 */
function circuitStudent(session: FlightSession, aircraft: AircraftId) {
  const t = techniqueFor(aircraft)
  const end = getRunwayEnd(t.lessonPlace.airportId, t.lessonPlace.runwayEnd)
  const fbw = getAircraft(aircraft).engineKind !== 'piston'
  const s = () => session.physics.state
  const fieldHeight = end.airport.elevation + t.circuit.height
  let gearPressed = false
  let flapTimer = 0
  let onAp = false
  let touched = false
  let tapKey: 'KeyS' | 'KeyW' | null = null
  let tapTime = 0
  let wait = 0

  const setAp = (headingDeg: number, glide: boolean, speed: number) => {
    const st = s()
    const g = guidanceTo(end, st.position.x, st.position.y, st.position.z)
    const vs = -st.groundSpeed * Math.tan(3 * DEG) - Math.max(-6, Math.min(6, g.vertical / 12))
    useAutopilotStore.setState({
      ap: true,
      athr: true,
      vertical: glide ? 'VS' : 'ALT',
      targets: { speed, headingDeg: ((headingDeg % 360) + 360) % 360, altitude: glide ? -1e5 : fieldHeight, verticalSpeed: glide ? vs : 0 },
      dialed: { speed: true, headingDeg: true, altitude: true, verticalSpeed: true },
    })
  }

  return () => {
    const st = s()
    const step = stepTitle()
    flapTimer += FRAME
    // The autopilot flies the pattern and the final down to the flare; the flare, touchdown and
    // rollout are flown on the keys, as in the landing lesson.
    const pattern = ['Upwind', 'Crosswind', 'Downwind', 'Before landing', 'Base turn', 'Base', 'Final turn', 'Line up', 'Gear down', 'Speed', 'Descend']
    // The autopilot only engages from 100 ft: until 200 ft keep flying the climb on the keys.
    const airborneEnough = st.heightAboveGround > 60 || onAp
    if (step && pattern.includes(step) && airborneEnough) {
      if (!onAp) {
        for (const k of ['KeyR', 'KeyS', 'KeyW', 'KeyF']) hold(session, k, false)
        onAp = true
      }
      const slow = t.approachSpeed * 1.15
      const climb = t.circuit.speed
      if (step === 'Upwind') setAp(end.headingDeg, false, climb)
      else if (step === 'Crosswind') setAp(end.headingDeg - 90, false, climb)
      else if (step === 'Downwind') setAp(end.headingDeg + 180, false, climb)
      else if (step === 'Before landing' || step === 'Base turn') {
        setAp(end.headingDeg + 180, false, slow)
        if (t.retractableGear && st.controls.gear < 0.5 && flapTimer > 1) {
          tap(session, 'KeyG')
          flapTimer = 0
        }
        if (st.controls.flaps < t.landingFlaps - 1e-6 && flapTimer > 1 && st.airspeed < slow + 15 * KT) {
          tap(session, 'KeyX')
          flapTimer = 0
        }
      } else if (step === 'Base') setAp(end.headingDeg + 90, true, slow)
      else {
        // Final turn and final: steer the track for the centreline (closing it in ~15 s) on the glide path.
        const g = guidanceTo(end, st.position.x, st.position.y, st.position.z)
        const intercept = Math.max(-30, Math.min(30, Math.atan2(g.lateral, st.groundSpeed * 15) / DEG))
        const track = Math.atan2(st.velocity.x, -st.velocity.z) / DEG
        const drift = ((track - st.headingDeg + 540) % 360) - 180
        setAp(end.headingDeg - intercept - drift, true, slow)
        // The lesson's approach autothrust takes the throttle from the line-up on.
        if (step !== 'Final turn') useAutopilotStore.setState({ athr: false })
      }
      return
    }
    if (onAp) {
      // Established on final: hands back on the keys for the rest of the landing.
      useAutopilotStore.setState({ ap: false, athr: false })
      onAp = false
    }
    const takeoff = ['Power', 'Keep straight', 'Rotate', 'Climb', 'Gear up', 'Flaps up']
    // Still climbing to autopilot height in the first pattern step counts as the take-off too.
    if (!step || takeoff.includes(step) || (pattern.includes(step) && !airborneEnough)) {
      // The take-off, as in the take-off lesson.
      hold(session, 'KeyR', st.controls.throttle < (aircraft === 'f22' ? 0.9 : 1))
      const targetPitch = st.onGround ? t.rotatePitchDeg + 3 : t.climbPitchDeg
      hold(session, 'KeyS', st.airspeed > t.rotateSpeed && st.pitchDeg < targetPitch)
      hold(session, 'KeyW', !st.onGround && st.pitchDeg > t.climbPitchDeg + 3)
      if (step === 'Gear up' && !gearPressed) {
        tap(session, 'KeyG')
        gearPressed = true
      }
      if (step === 'Flaps up') gearPressed = false
      if (step === 'Flaps up' && st.airspeed > t.rotateSpeed * FLAPS_UP_FACTOR && st.controls.flaps > 0 && flapTimer > 0.5) {
        tap(session, 'KeyZ')
        flapTimer = 0
      }
      return
    }
    // Final approach, flare and rollout on the keys (as in the landing lesson).
    if (st.onGround) touched = true
    const g = guidanceTo(end, st.position.x, st.position.y, st.position.z)
    if (touched) {
      for (const k of ['KeyS', 'KeyW', 'KeyR', 'KeyA', 'KeyD']) hold(session, k, false)
      hold(session, 'KeyF', true)
      hold(session, 'KeyB', st.onGround && st.pitchDeg < NOSE_DOWN_PITCH_DEG)
      hold(session, 'KeyY', t.reverse && st.onGround && st.groundSpeed > 20)
      return
    }
    const flare = st.heightAboveGround < t.flareHeight
    const glideVs = -st.airspeed * Math.tan(3 * DEG)
    if (fbw) {
      tapTime -= FRAME
      wait -= FRAME
      if (tapTime <= 0) tapKey = null
      if (!flare && wait <= 0) {
        if (g.vertical < -5 && st.verticalSpeed < glideVs + 0.5) tapKey = 'KeyS'
        else if (st.heightAboveGround > 30 && g.vertical > 5 && st.verticalSpeed > glideVs - 1) tapKey = 'KeyW'
        if (tapKey) {
          tapTime = 0.12
          wait = 2.5
        }
      }
      const noseRising = st.angularVelocity.x / DEG > 3
      hold(session, 'KeyS', flare ? st.pitchDeg < t.flarePitchDeg && !noseRising : tapKey === 'KeyS')
      hold(session, 'KeyW', !flare && tapKey === 'KeyW')
    } else {
      // Handed over trimmed in the flare: gentle back pressure while it sinks; if it floats
      // (trimmed for the powered descent, now at idle), ease the nose down a little.
      void glideVs
      hold(session, 'KeyS', st.verticalSpeed < -0.9 && st.pitchDeg < t.flarePitchDeg + 3)
      hold(session, 'KeyW', st.verticalSpeed > -0.2 && st.pitchDeg > 1)
    }
    // Above the flare steer for the centreline (as in the landing lesson); in it, wings level.
    // Handed over lined up at the flare by the autopilot: wings level is all it needs.
    hold(session, 'KeyD', st.bankDeg < -3)
    hold(session, 'KeyA', st.bankDeg > 3)
  }
}

function makeCircuit(aircraft: AircraftId) {
  const results: FlightResult[] = []
  const session = new FlightSession({ mode: 'lessonCircuit', aircraft, onFinish: (r) => results.push(r) })
  session.reset('lessonCircuit')
  return { session, results }
}

describe('circuit lesson', () => {
  beforeEach(() => resetAutopilot())

  it('walks through the take-off, the four legs of the circuit and the landing', () => {
    const { session } = makeCircuit('trainer')
    session.frame(1 / 30, false)
    const lesson = getTelemetry().lesson
    expect(lesson?.title).toBe('FS-1 Trainer circuit')
    expect(lesson?.steps.map((s) => s.title)).toEqual([
      'Power',
      'Keep straight',
      'Rotate',
      'Climb',
      'Gear up',
      'Flaps up',
      'Upwind',
      'Crosswind',
      'Downwind',
      'Before landing',
      'Base turn',
      'Base',
      'Final turn',
      'Line up',
      'Gear down',
      'Speed',
      'Descend',
      'Flare',
      'Stop',
    ])
  })

  it('starts lined up on the lesson runway, and keeps the approach assists out of the take-off', () => {
    const { session } = makeCircuit('a220')
    const t = techniqueFor('a220')
    const end = getRunwayEnd(t.lessonPlace.airportId, t.lessonPlace.runwayEnd)
    const s = () => session.physics.state
    expect(s().onGround).toBe(true)
    expect(s().headingDeg).toBeCloseTo(end.headingDeg, 0)
    // Full power, then full back stick from rotation: no flare-assist clamp after lift-off,
    // and the approach autothrust leaves the throttle alone.
    hold(session, 'KeyR', true)
    let maxPitchAfterLiftoff = -90
    for (let i = 0; i < 60 * 60 && s().heightAboveGround < 20; i++) {
      hold(session, 'KeyS', s().airspeed > t.rotateSpeed)
      session.frame(FRAME, false)
      if (!s().onGround) maxPitchAfterLiftoff = Math.max(maxPitchAfterLiftoff, s().pitchDeg)
    }
    expect(s().heightAboveGround).toBeGreaterThan(5)
    expect(s().controls.throttle).toBe(1)
    expect(s().controls.pitch).toBeGreaterThan(0.5)
    expect(maxPitchAfterLiftoff).toBeGreaterThan(t.rotatePitchDeg)
  })

  for (const id of AIRCRAFT_IDS) {
    it(`${id}: can be flown from take-off to a full stop by following the coach`, () => {
      const { session, results } = makeCircuit(id)
      const student = circuitStudent(session, id)
      let last: string | null = null
      const trace: string[] = []
      for (let t = 0; t < 1500 && results.length === 0; t += FRAME) {
        student()
        session.frame(FRAME, false)
        const now = stepTitle()
        if (now !== last) {
          const st = session.physics.state
          trace.push(`${t.toFixed(0)}s ${now} agl ${st.heightAboveGround.toFixed(0)} kt ${(st.airspeed / KT).toFixed(0)} hdg ${st.headingDeg.toFixed(0)}`)
          last = now
        }
      }
      expect(results.length, `no result at ${stepTitle()} | ${trace.join(' | ')}`).toBe(1)
      // On failure the message carries the step-by-step trace of the flight.
      expect(results[0].outcome, `${results[0].headline} at ${stepTitle()} | ${trace.join(' | ')}`).toBe('success')
      expect(results[0].headline).toBe('Circuit complete: take-off to touchdown!')
      // The touchdown is measured (not the take-off roll's first frame).
      const sink = results[0].stats.find((s) => s.label === 'Touchdown sink rate')
      expect(sink?.value).toBeLessThan(0)
    }, 180000)
  }

  it('every lesson circuit clears the terrain by a wide margin', () => {
    const terrain = getTerrainSampler()
    for (const id of AIRCRAFT_IDS) {
      const t = techniqueFor(id)
      const end = getRunwayEnd(t.lessonPlace.airportId, t.lessonPlace.runwayEnd)
      const c = t.circuit
      const d = headingVector(end.headingDeg)
      // `along` past the threshold, `left` of the centreline.
      const at = (along: number, left: number) => ({
        x: end.threshold.x + d.x * along + d.z * left,
        z: end.threshold.z + d.z * along - d.x * left,
      })
      const upwind = end.runway.def.length + 5000
      const legs: [number, number, number, number][] = [
        [end.runway.def.length, 0, upwind, 0],
        [upwind, 0, upwind, c.offset],
        [upwind, c.offset, -c.finalLength, c.offset],
        [-c.finalLength, c.offset, -c.finalLength, 0],
      ]
      for (const [a0, l0, a1, l1] of legs) {
        for (let f = 0; f <= 1; f += 0.01) {
          const p = at(a0 + (a1 - a0) * f, l0 + (l1 - l0) * f)
          expect(terrain.heightAt(p.x, p.z) - end.airport.elevation, id).toBeLessThan(c.height - 150)
        }
      }
    }
  })

  it('uses a flap detent for the landing flaps of every aircraft', () => {
    for (const id of AIRCRAFT_IDS) {
      expect(FLAP_DETENTS.some((d) => Math.abs(d - techniqueFor(id).landingFlaps) < 1e-6), id).toBe(true)
    }
  })
})
