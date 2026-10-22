import { describe, expect, it } from 'vitest'
import { CalloutDetector, type CalloutFrame } from '../../audio/callouts'
import { AIRCRAFT_IDS, type AircraftId } from '../../config/aircraftCatalog'
import { getRunwayEnd, guidanceTo } from '../../game/airportGeometry'
import { createChallenge } from '../../game/challenges'
import { NOSE_DOWN_PITCH_DEG } from '../../game/lessons'
import { FLAPS_UP_FACTOR, techniqueFor } from '../../game/technique'
import { getAircraft } from '../../config/aircraftCatalog'
import type { FlightResult } from '../../game/types'
import { getTelemetry } from '../../state/telemetry'
import { FlightSession } from '../FlightSession'

const FRAME = 1 / 60
const KT = 0.514444

function makeLesson(mode: 'lessonTakeoff' | 'lessonLanding', aircraft: AircraftId) {
  const results: FlightResult[] = []
  const session = new FlightSession({ mode, aircraft, onFinish: (r) => results.push(r) })
  session.reset(mode)
  return { session, results }
}

function hold(session: FlightSession, code: string, on: boolean) {
  if (on) session.keyboard.keyDown(code)
  else session.keyboard.keyUp(code)
}

function tap(session: FlightSession, code: string) {
  session.keyboard.keyDown(code)
  session.keyboard.keyUp(code)
}

function fly(session: FlightSession, seconds: number, control: () => void, done: () => boolean) {
  for (let t = 0; t < seconds && !done(); t += FRAME) {
    control()
    session.frame(FRAME, false)
  }
}

/** A student pilot that does what the coach panel says. */
function takeoffStudent(session: FlightSession, aircraft: AircraftId) {
  const t = techniqueFor(aircraft)
  const s = () => session.physics.state
  let gearPressed = false
  let flapTimer = 0
  return () => {
    const lesson = getTelemetry().lesson
    const step = lesson?.steps[lesson.current]?.title
    hold(session, 'KeyR', s().controls.throttle < (aircraft === 'f22' ? 0.9 : 1))
    // On the runway it deliberately asks for more pitch than allowed: the guard must hold it.
    const targetPitch = s().onGround ? t.rotatePitchDeg + 3 : t.climbPitchDeg
    hold(session, 'KeyS', s().airspeed > t.rotateSpeed && s().pitchDeg < targetPitch)
    hold(session, 'KeyW', !s().onGround && s().pitchDeg > t.climbPitchDeg + 3)
    if (step === 'Gear up' && !gearPressed) {
      tap(session, 'KeyG')
      gearPressed = true
    }
    flapTimer += FRAME
    if (step === 'Flaps up' && s().airspeed > t.rotateSpeed * FLAPS_UP_FACTOR && s().controls.flaps > 0 && flapTimer > 0.5) {
      tap(session, 'KeyZ')
      flapTimer = 0
    }
  }
}

function landingStudent(session: FlightSession, aircraft: AircraftId) {
  const t = techniqueFor(aircraft)
  const end = getRunwayEnd(t.lessonPlace.airportId, t.lessonPlace.runwayEnd)
  const s = () => session.physics.state
  const fbw = getAircraft(aircraft).engineKind !== 'piston'
  let touched = false
  // Glide-path corrections: "small, early corrections" -- a short tap, then wait to see it work.
  let tapKey: 'KeyS' | 'KeyW' | null = null
  let tapTime = 0
  let wait = 0
  return () => {
    const st = s()
    if (st.onGround) touched = true
    if (touched) {
      // Stop step: hands off while the nose wheel comes down, reverse at once, brake once the
      // nose is down (as the coach says).
      for (const k of ['KeyS', 'KeyW', 'KeyR', 'KeyA', 'KeyD']) hold(session, k, false)
      hold(session, 'KeyF', true)
      hold(session, 'KeyB', st.onGround && st.pitchDeg < NOSE_DOWN_PITCH_DEG)
      hold(session, 'KeyY', t.reverse && st.onGround && st.groundSpeed > 20)
      return
    }
    // Autothrust flies the speed in the landing lesson: the student only steers and flares.
    const g = guidanceTo(end, st.position.x, st.position.y, st.position.z)
    const flare = st.heightAboveGround < t.flareHeight
    const glideVs = -st.airspeed * Math.tan((3 * Math.PI) / 180)
    if (fbw) {
      // Fly-by-wire holds the path hands-off: tap when the diamonds drift more than 5 m.
      tapTime -= FRAME
      wait -= FRAME
      if (tapTime <= 0) tapKey = null
      if (!flare && wait <= 0) {
        if (g.vertical < -5 && st.verticalSpeed < glideVs + 0.5) tapKey = 'KeyS'
        // No nose-down corrections in the last 30 m: that is how runways get hit hard.
        else if (st.heightAboveGround > 30 && g.vertical > 5 && st.verticalSpeed > glideVs - 1) tapKey = 'KeyW'
        if (tapKey) {
          tapTime = 0.12
          wait = 2.5
        }
      }
      // Flare as the coach says: raise the nose *gently* to the flare pitch, no further
      // (no more S while the nose is already coming up).
      const noseRising = st.angularVelocity.x * (180 / Math.PI) > 3
      hold(session, 'KeyS', flare ? st.pitchDeg < t.flarePitchDeg && !noseRising : tapKey === 'KeyS')
      hold(session, 'KeyW', !flare && tapKey === 'KeyW')
    } else {
      const vsTarget = flare ? -0.6 : Math.min(0.5, Math.max(glideVs - 2, glideVs - 0.08 * g.vertical))
      hold(session, 'KeyS', st.verticalSpeed < vsTarget - 0.15)
      hold(session, 'KeyW', !flare && st.verticalSpeed > vsTarget + 0.15)
    }
    hold(session, 'KeyD', g.lateral < -8 && st.bankDeg < 5)
    hold(session, 'KeyA', g.lateral > 8 && st.bankDeg > -5)
    void KT
  }
}

describe('Flight School lessons can be completed by following the coach', () => {
  it.each(AIRCRAFT_IDS)('%s take-off lesson', (aircraft) => {
    const { session, results } = makeLesson('lessonTakeoff', aircraft)
    fly(session, 240, takeoffStudent(session, aircraft), () => results.length > 0)
    expect(results).toHaveLength(1)
    expect(results[0].outcome, `${results[0].headline}: ${results[0].reason}`).toBe('success')
  }, 60000)

  it.each(AIRCRAFT_IDS)('%s landing lesson', (aircraft) => {
    const { session, results } = makeLesson('lessonLanding', aircraft)
    fly(session, 300, landingStudent(session, aircraft), () => results.length > 0)
    expect(results).toHaveLength(1)
    expect(results[0].outcome, `${results[0].headline}: ${results[0].reason}`).toBe('success')
  }, 60000)
})

describe('coach view', () => {
  it('starts on the first step with an instruction, keys and a cue, and publishes it', () => {
    const { session } = makeLesson('lessonTakeoff', 'a350')
    session.frame(1 / 30, false)
    const lesson = getTelemetry().lesson
    expect(lesson?.title).toBe('A350-900 take-off')
    expect(lesson?.current).toBe(0)
    expect(lesson?.keys).toContain('R')
    expect(lesson?.cue?.kind).toBe('percent')
    expect(lesson?.steps.map((s) => s.title)).toEqual(['Power', 'Keep straight', 'Rotate', 'Climb', 'Gear up', 'Flaps up', 'Climb out'])
  })

  it('a crash ends the lesson with a specific coaching tip', () => {
    const { session } = makeLesson('lessonTakeoff', 'a350')
    const lesson = createChallenge('lessonTakeoff', undefined, undefined, 'a350')
    lesson.update({ ...session.physics.state, crashed: true, crashReason: 'Tail strike' }, FRAME)
    expect(lesson.result?.outcome).toBe('failure')
    expect(lesson.result?.headline).toBe('Tail strike')
    expect(lesson.result?.reason).toMatch(/Raise it slowly/)
  })

  it('lessons start at an airport long enough for the aircraft', () => {
    for (const id of AIRCRAFT_IDS) {
      const t = techniqueFor(id)
      const end = getRunwayEnd(t.lessonPlace.airportId, t.lessonPlace.runwayEnd)
      expect(end.runway.def.length, id).toBeGreaterThanOrEqual(Math.min(2600, t.rotateSpeed * 25))
    }
  })
})

describe('tail-strike guard (flight assists)', () => {
  it('holding full back stick at rotation no longer strikes the A350 tail', () => {
    const { session } = makeLesson('lessonTakeoff', 'a350')
    const t = techniqueFor('a350')
    hold(session, 'KeyR', true)
    let maxGroundPitch = 0
    fly(
      session,
      120,
      () => {
        hold(session, 'KeyS', session.physics.state.airspeed > t.rotateSpeed)
        if (session.physics.state.onGround) maxGroundPitch = Math.max(maxGroundPitch, session.physics.state.pitchDeg)
      },
      () => session.physics.state.heightAboveGround > 30 || session.physics.state.crashed,
    )
    expect(session.physics.state.crashReason).toBeNull()
    expect(maxGroundPitch).toBeLessThan(t.tailStrikePitchDeg)
  }, 60000)
})

describe('voice callouts', () => {
  const base: CalloutFrame = {
    airspeed: 0,
    rotateSpeed: 40,
    onGround: true,
    verticalSpeed: 0,
    heightAboveGround: 0,
    throttle: 1,
    jet: true,
    teleportId: 1,
  }

  it('calls Rotate at Vr and Positive rate after lift-off', () => {
    const d = new CalloutDetector()
    d.detect(base, FRAME)
    expect(d.detect({ ...base, airspeed: 39 }, FRAME)).toEqual([])
    expect(d.detect({ ...base, airspeed: 41 }, FRAME)).toEqual(['Rotate'])
    expect(d.detect({ ...base, airspeed: 42 }, FRAME)).toEqual([])
    const calls: string[] = []
    for (let i = 0; i < 120; i++) {
      calls.push(...d.detect({ ...base, onGround: false, airspeed: 45, verticalSpeed: 3, heightAboveGround: 5 + i * 0.05 }, FRAME))
    }
    expect(calls).toEqual(['Positive rate'])
  })

  it('counts down the radio altitude on approach and says Retard for jets with power on', () => {
    const d = new CalloutDetector()
    const air = { ...base, onGround: false, airspeed: 70, verticalSpeed: -3.5, throttle: 0.4 }
    d.detect({ ...air, heightAboveGround: 200 }, FRAME)
    const calls: string[] = []
    for (let h = 200; h >= 0.5; h -= 0.5) calls.push(...d.detect({ ...air, heightAboveGround: h }, FRAME))
    expect(calls).toEqual(['Five hundred', 'One hundred', 'Fifty', 'Forty', 'Thirty', 'Twenty', 'Retard', 'Ten'])
  })

  it('stays quiet on a restart', () => {
    const d = new CalloutDetector()
    d.detect(base, FRAME)
    expect(d.detect({ ...base, airspeed: 41, teleportId: 2 }, FRAME)).toEqual([])
  })
})
