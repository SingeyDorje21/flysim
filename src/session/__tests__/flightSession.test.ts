import { describe, expect, it } from 'vitest'
import { RUNWAY, SPAWNS } from '../../config/world'
import type { FlightResult, GameMode } from '../../game/types'
import { getTelemetry } from '../../state/telemetry'
import { FlightSession } from '../FlightSession'

const FRAME = 1 / 60

function makeSession(mode: GameMode) {
  const results: FlightResult[] = []
  const session = new FlightSession({ mode, onFinish: (r) => results.push(r) })
  session.reset(mode)
  return { session, results }
}

/** Run frames until `done` or the time budget runs out. `control` runs before each frame. */
function fly(session: FlightSession, seconds: number, control: () => void, done: () => boolean = () => false) {
  for (let t = 0; t < seconds && !done(); t += FRAME) {
    control()
    session.frame(FRAME, false)
  }
}

function hold(session: FlightSession, code: string, on: boolean) {
  if (on) session.keyboard.keyDown(code)
  else session.keyboard.keyUp(code)
}

describe('FlightSession integration (real terrain, physics and challenge)', () => {
  it('completes the take-off challenge with a simple scripted pilot', () => {
    const { session, results } = makeSession('takeoff')
    const s = () => session.physics.state
    hold(session, 'KeyR', true)
    fly(
      session,
      150,
      () => {
        // Rotate at ~28 m/s, then hold about 8 degrees nose up.
        const wantUp = s().airspeed > 28 && s().pitchDeg < 8
        hold(session, 'KeyS', wantUp)
        hold(session, 'KeyW', s().airspeed > 28 && s().pitchDeg > 12)
      },
      () => results.length > 0,
    )
    expect(results).toHaveLength(1)
    expect(results[0].outcome).toBe('success')
    expect(results[0].mode).toBe('takeoff')
    expect(s().crashed).toBe(false)
  })

  it('completes the landing challenge with a simple scripted approach', () => {
    const { session, results } = makeSession('landing')
    const s = () => session.physics.state
    const glide = Math.tan((3 * Math.PI) / 180)
    let touchedDown = false
    fly(
      session,
      240,
      () => {
        const st = s()
        if (st.onGround) touchedDown = true
        if (touchedDown) {
          // Rollout: stick neutral, idle, brakes.
          for (const k of ['KeyS', 'KeyW', 'KeyR']) hold(session, k, false)
          hold(session, 'KeyF', true)
          hold(session, 'KeyB', st.onGround)
          return
        }
        const agl = st.heightAboveGround
        const flare = agl < 10
        const desired = Math.max(0, (st.position.z - RUNWAY.aimPointZ) * glide)
        const vsTarget = flare ? -0.6 : Math.min(0.5, Math.max(-2.5, -1.9 + 0.1 * (desired - agl)))
        hold(session, 'KeyS', st.verticalSpeed < vsTarget - 0.15)
        // In the flare only back pressure is ever applied.
        hold(session, 'KeyW', !flare && st.verticalSpeed > vsTarget + 0.15)
        hold(session, 'KeyR', !flare && st.airspeed < 33)
        hold(session, 'KeyF', flare || st.airspeed > 38)
      },
      () => results.length > 0,
    )
    expect(results).toHaveLength(1)
    expect(results[0].reason).toBeNull()
    expect(results[0].outcome).toBe('success')
    expect(results[0].mode).toBe('landing')
  })

  it('reports a crash once, after the result delay', () => {
    const { session, results } = makeSession('rings')
    hold(session, 'KeyW', true)
    hold(session, 'KeyF', true)
    fly(session, 120, () => {}, () => results.length > 0)
    expect(session.physics.state.crashed).toBe(true)
    expect(results).toHaveLength(1)
    expect(results[0].outcome).toBe('failure')
    expect(results[0].reason).toBeTruthy()
    fly(session, 5, () => {})
    expect(results).toHaveLength(1)
    // The wreck's engine is stopped for rendering and instruments alike.
    expect(session.renderState.engineRpm).toBe(0)
    expect(getTelemetry().rpm).toBe(0)
    expect(getTelemetry().engineRunning).toBe(false)
  })

  it('does not advance while frozen (pause)', () => {
    const { session } = makeSession('rings')
    session.frame(FRAME, false)
    const before = session.physics.state.simTime
    for (let i = 0; i < 120; i++) session.frame(FRAME, true)
    expect(session.physics.state.simTime).toBe(before)
    expect(session.renderState.frozen).toBe(true)
    session.frame(FRAME, false)
    expect(session.renderState.frozen).toBe(false)
  })

  it('reset after a flight leaves no stale state', () => {
    const { session, results } = makeSession('rings')
    hold(session, 'KeyW', true)
    fly(session, 120, () => {}, () => results.length > 0)
    const teleport = session.renderState.teleportId
    session.ringView.nextIndex = 3

    session.reset('rings')
    const st = session.physics.state
    expect(st.crashed).toBe(false)
    expect(st.simTime).toBe(0)
    expect(st.position.x).toBeCloseTo(SPAWNS.rings.position.x, 6)
    expect(st.position.z).toBeCloseTo(SPAWNS.rings.position.z, 6)
    expect(session.ringView.nextIndex).toBe(0)
    expect(session.renderState.teleportId).toBe(teleport + 1)
    expect(session.renderState.crashed).toBe(false)
    const tel = getTelemetry()
    expect(tel.crashed).toBe(false)
    expect(tel.challenge?.elapsed).toBe(0)
    expect(tel.challenge?.status).toBe('active')

    // Held keys were released by the reset, so the aircraft flies hands-off.
    fly(session, 2, () => {})
    expect(session.physics.state.crashed).toBe(false)
  })

  it('starts each ground mode resting on the runway and parked', () => {
    for (const mode of ['freeFlight', 'takeoff'] as const) {
      const { session } = makeSession(mode)
      fly(session, 3, () => {})
      const st = session.physics.state
      expect(st.onGround).toBe(true)
      expect(st.crashed).toBe(false)
      expect(st.groundSpeed).toBeLessThan(0.5)
    }
  })

  it('renders the interpolated pose between fixed steps', () => {
    const { session } = makeSession('rings')
    fly(session, 1, () => {})
    const prev = session.physics.previousState.position
    const curr = session.physics.state.position
    const r = session.renderState.position
    const lo = Math.min(prev.z, curr.z) - 1e-9
    const hi = Math.max(prev.z, curr.z) + 1e-9
    expect(r.z).toBeGreaterThanOrEqual(lo)
    expect(r.z).toBeLessThanOrEqual(hi)
  })
})
