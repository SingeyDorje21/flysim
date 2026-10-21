import { describe, expect, it } from 'vitest'
import { RUNWAY } from '../../config/world'
import type { AircraftState } from '../../simulation/types'
import { TAKEOFF_TARGET_AGL, createChallenge } from '../challenges'
import { RING_COURSE } from '../courses'
import type { RingCourseView } from '../types'

const DT = 1 / 120

function makeState(over: Partial<AircraftState> = {}): AircraftState {
  return {
    position: { x: 0, y: RUNWAY.elevation + 1.3, z: 700 },
    velocity: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, flaps: 0, brakes: 0, trim: 0 },
    surfaces: { elevator: 0, aileron: 0, rudder: 0, flaps: 0 },
    engine: { running: true, rpm: 700, spool: 0, thrust: 0 },
    airspeed: 0,
    groundSpeed: 0,
    altitude: RUNWAY.elevation + 1.3,
    heightAboveGround: 0,
    verticalSpeed: 0,
    angleOfAttack: 0,
    sideslip: 0,
    headingDeg: 0,
    pitchDeg: 0,
    bankDeg: 0,
    gForce: 1,
    stallWarning: false,
    stalled: false,
    onGround: true,
    crashed: false,
    crashReason: null,
    simTime: 0,
    ...over,
  }
}

function steps(n: number, fn: (i: number) => void) {
  for (let i = 0; i < n; i++) fn(i)
}

describe('crash and time limit handling', () => {
  it('fails with the physics crash reason', () => {
    const c = createChallenge('freeFlight')
    c.update(makeState({ crashed: true, crashReason: 'Wingtip strike' }), DT)
    expect(c.result?.outcome).toBe('failure')
    expect(c.result?.reason).toBe('Wingtip strike')
    expect(c.result?.score).toBe(0)
    expect(c.progress.status).toBe('failure')
  })

  it('fails when the time limit runs out', () => {
    const c = createChallenge('takeoff')
    steps(121 * 120, () => c.update(makeState(), DT))
    expect(c.result?.headline).toBe('Out of time')
  })

  it('free flight never ends on its own', () => {
    const c = createChallenge('freeFlight')
    steps(600, () => c.update(makeState({ onGround: false, heightAboveGround: 300 }), DT))
    expect(c.result).toBeNull()
    expect(c.progress.timeLimit).toBeNull()
  })

  it('ignores updates once decided', () => {
    const c = createChallenge('freeFlight')
    c.update(makeState({ crashed: true }), DT)
    const result = c.result
    c.update(makeState(), DT)
    expect(c.result).toBe(result)
  })
})

describe('take-off challenge', () => {
  it('fails on a runway excursion before lift-off', () => {
    const c = createChallenge('takeoff')
    c.update(makeState({ position: { x: 40, y: 13, z: 200 } }), DT)
    expect(c.result?.headline).toBe('Runway excursion')
  })

  it('succeeds after lift-off and a climb to the target height', () => {
    const c = createChallenge('takeoff')
    let z = 740
    steps(20 * 120, () => {
      z -= 0.2
      c.update(makeState({ position: { x: 1, y: 13, z }, airspeed: 25 }), DT)
    })
    let agl = 0
    while (!c.result && agl < 400) {
      agl += 0.03
      z -= 0.3
      c.update(
        makeState({ onGround: false, heightAboveGround: agl, position: { x: 1, y: 13 + agl, z }, airspeed: 35, bankDeg: 5 }),
        DT,
      )
    }
    expect(agl).toBeGreaterThanOrEqual(TAKEOFF_TARGET_AGL)
    expect(c.result?.outcome).toBe('success')
    expect(c.result!.score).toBeGreaterThanOrEqual(100)
    expect(c.result!.score).toBeLessThanOrEqual(1000)
    expect(c.result!.stats.some((s) => s.label === 'Lift-off distance')).toBe(true)
  })
})

describe('landing challenge', () => {
  it('fails when touching down off the runway', () => {
    const c = createChallenge('landing')
    c.update(makeState({ onGround: false, position: { x: 0, y: 40, z: 1500 }, verticalSpeed: -2 }), DT)
    c.update(makeState({ onGround: true, position: { x: 0, y: 13, z: 1000 } }), DT)
    expect(c.result?.headline).toBe('Missed the runway')
  })

  it('scores a gentle touchdown at the aim point and a stop on the runway', () => {
    const c = createChallenge('landing')
    c.update(
      makeState({ onGround: false, position: { x: 0, y: 14, z: RUNWAY.aimPointZ + 5 }, verticalSpeed: -0.6, airspeed: 30 }),
      DT,
    )
    c.update(makeState({ onGround: true, position: { x: 0.5, y: 13, z: RUNWAY.aimPointZ }, airspeed: 30, groundSpeed: 30 }), DT)
    expect(c.result).toBeNull()
    steps(120, (i) =>
      c.update(makeState({ onGround: true, position: { x: 0.5, y: 13, z: RUNWAY.aimPointZ - 300 - i * 0.01 }, groundSpeed: 0.1 }), DT),
    )
    expect(c.result?.outcome).toBe('success')
    expect(c.result!.score).toBeGreaterThan(900)
    const sink = c.result!.stats.find((s) => s.label === 'Touchdown sink rate')
    expect(sink?.value).toBeCloseTo(-0.6, 5)
  })

  it('penalises a hard touchdown', () => {
    const c = createChallenge('landing')
    c.update(makeState({ onGround: false, position: { x: 0, y: 14, z: 500 }, verticalSpeed: -3.5 }), DT)
    c.update(makeState({ onGround: true, position: { x: 0, y: 13, z: 500 }, airspeed: 30 }), DT)
    steps(120, () => c.update(makeState({ onGround: true, position: { x: 0, y: 13, z: 100 }, groundSpeed: 0 }), DT))
    expect(c.result?.outcome).toBe('success')
    expect(c.result!.reason).toBe('Hard touchdown')
    expect(c.result!.score).toBeLessThan(600)
  })
})

describe('ring course', () => {
  const ringView = (): RingCourseView => ({ rings: RING_COURSE, nextIndex: 0 })

  function flyThrough(c: ReturnType<typeof createChallenge>, index: number, offset = 0) {
    const r = RING_COURSE[index]
    const h = (r.headingDeg * Math.PI) / 180
    const dir = { x: Math.sin(h), z: -Math.cos(h) }
    for (const d of [-5, 5]) {
      c.update(
        makeState({
          onGround: false,
          position: { x: r.position.x + dir.x * d + offset, y: r.position.y, z: r.position.z + dir.z * d },
        }),
        DT,
      )
    }
  }

  it('counts a pass through the ring and ignores a miss', () => {
    const view = ringView()
    const c = createChallenge('rings', view)
    flyThrough(c, 0, 50)
    expect(view.nextIndex).toBe(0)
    flyThrough(c, 0, 5)
    expect(view.nextIndex).toBe(1)
    expect(c.progress.detail).toBe(`Ring 2 of ${RING_COURSE.length}`)
  })

  it('does not count a ring flown through backwards', () => {
    const view = ringView()
    const c = createChallenge('rings', view)
    const r = RING_COURSE[0]
    c.update(makeState({ onGround: false, position: { ...r.position, z: r.position.z - 5 } }), DT)
    c.update(makeState({ onGround: false, position: { ...r.position, z: r.position.z + 5 } }), DT)
    expect(view.nextIndex).toBe(0)
  })

  it('completes the course after every ring in order', () => {
    const view = ringView()
    const c = createChallenge('rings', view)
    RING_COURSE.forEach((_, i) => flyThrough(c, i))
    expect(view.nextIndex).toBe(RING_COURSE.length)
    expect(c.result?.outcome).toBe('success')
    expect(c.result?.headline).toBe('Course complete!')
  })

  it('resets the shared view when a new challenge starts', () => {
    const view = ringView()
    view.nextIndex = 4
    createChallenge('rings', view)
    expect(view.nextIndex).toBe(0)
  })
})
