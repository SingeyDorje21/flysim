// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAircraft } from '../../config/aircraftCatalog'
import { techniqueFor } from '../../game/technique'
import type { ChallengeProgress, FlightResult, LessonView } from '../../game/types'
import { useGameStore } from '../../state/gameStore'
import { INITIAL_TELEMETRY, publishTelemetry, resetTelemetry } from '../../state/telemetry'
import { formatSpeed } from '../format'
import { GameUI } from '../GameUI'

const state = () => useGameStore.getState()
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

const lesson: LessonView = {
  title: 'A350-900 take-off',
  steps: [
    { title: 'Power up', done: true },
    { title: 'Roll', done: false },
    { title: 'Rotate', done: false },
  ],
  current: 1,
  instruction: 'Hold the centreline and build speed',
  keys: ['R', 'Q', 'E'],
  cue: { label: 'Airspeed', kind: 'speed', value: 40, target: [60, 80], range: [0, 100] },
  warning: 'Too slow, keep the power on',
  stepCounter: 1,
}

const challenge: ChallengeProgress = {
  status: 'active',
  objective: 'Land on the runway',
  detail: null,
  fraction: null,
  elapsed: 5,
  timeLimit: null,
} as ChallengeProgress

beforeEach(() => {
  useGameStore.setState(useGameStore.getInitialState(), true)
  resetTelemetry()
})
afterEach(cleanup)

describe('Flight School screens', () => {
  it('main menu opens Flight School', () => {
    render(<GameUI />)
    click('Flight School')
    expect(state().screen).toBe('flightSchool')
  })

  it('shows the A350 technique card', () => {
    useGameStore.setState({ screen: 'flightSchool', aircraftId: 'a350' })
    render(<GameUI />)
    const t = techniqueFor('a350')
    expect(screen.getByTestId('tech-rotate').textContent).toBe(formatSpeed(t.rotateSpeed, 'imperial'))
    expect(screen.getByTestId('tech-maxpitch').textContent).toBe(`${Math.round(t.maxGroundPitchDeg)}°`)
    expect(screen.getByTestId('lesson-place').textContent).toContain('runway')
    expect(getAircraft('a350').name).toBeTruthy()
  })

  it('lesson buttons start the right modes and Back returns', () => {
    useGameStore.setState({ screen: 'flightSchool' })
    render(<GameUI />)
    click('Start Take-off Lesson')
    expect(state().mode).toBe('lessonTakeoff')
    expect(state().screen).toBe('flight')
    cleanup()
    useGameStore.setState({ screen: 'flightSchool' })
    render(<GameUI />)
    click('Start Landing Lesson')
    expect(state().mode).toBe('lessonLanding')
    cleanup()
    useGameStore.setState({ screen: 'flightSchool' })
    render(<GameUI />)
    click('Back')
    expect(state().screen).toBe('mainMenu')
  })

  it('Choose a mode hides lesson modes', () => {
    useGameStore.setState({ screen: 'modeSelect' })
    render(<GameUI />)
    expect(screen.queryByLabelText('Take-off Lesson')).toBeNull()
    expect(screen.queryByLabelText('Landing Lesson')).toBeNull()
    expect(screen.getAllByRole('article', { name: /./ }).length).toBeGreaterThan(0)
  })
})

describe('coach panel', () => {
  const flyWith = (patch: Partial<typeof INITIAL_TELEMETRY>) => {
    useGameStore.setState({ screen: 'flight' })
    render(<GameUI />)
    act(() => publishTelemetry({ ...INITIAL_TELEMETRY, ...patch }))
  }

  it('renders instruction, keys, cue band and warning', () => {
    flyWith({ lesson })
    const coach = screen.getByTestId('coach')
    expect(within(coach).getByText('Hold the centreline and build speed')).toBeTruthy()
    expect(within(coach).getByText('R')).toBeTruthy()
    expect(within(coach).getByText('Q')).toBeTruthy()
    expect(within(coach).getByTestId('coach-cue-value').textContent).toBe(formatSpeed(40, 'imperial'))
    expect(within(coach).getByTestId('coach-band').style.left).toBe('60%')
    expect(within(coach).getByTestId('coach-band').style.width).toBe('20%')
    expect(within(coach).getByTestId('coach-marker').style.left).toBe('40%')
    expect(within(coach).getByTestId('coach-warning').textContent).toContain('Too slow')
  })

  it('shows Lesson complete! when all steps are done', () => {
    flyWith({
      lesson: { ...lesson, current: 3, cue: null, warning: null, steps: lesson.steps.map((s) => ({ ...s, done: true })) },
    })
    expect(screen.getByText('Lesson complete!')).toBeTruthy()
  })

  it('is hidden when there is no lesson', () => {
    flyWith({ lesson: null })
    expect(screen.queryByTestId('coach')).toBeNull()
  })

  it('hides the challenge panel during a lesson', () => {
    flyWith({ lesson, challenge })
    expect(screen.queryByTestId('challenge')).toBeNull()
    act(() => publishTelemetry({ ...INITIAL_TELEMETRY, lesson: null, challenge }))
    expect(screen.getByTestId('challenge')).toBeTruthy()
  })
})

describe('lesson results and settings', () => {
  const lessonResult: FlightResult = {
    mode: 'lessonLanding',
    outcome: 'failure',
    headline: 'Crashed',
    reason: 'You flared too late: start easing the nose up at 30 ft',
    score: 0,
    timeSec: 90,
    stats: [],
  }

  it('shows the Coach\'s tip and lesson buttons', () => {
    useGameStore.setState({ screen: 'results', result: lessonResult })
    render(<GameUI />)
    const tip = screen.getByTestId('coach-tip')
    expect(tip.textContent).toContain("Coach's tip")
    expect(tip.textContent).toContain('flared too late')
    click('Try again')
    expect(state().screen).toBe('flight')
    cleanup()
    useGameStore.setState({ screen: 'results', result: lessonResult })
    render(<GameUI />)
    click('Flight School')
    expect(state().screen).toBe('flightSchool')
    cleanup()
    useGameStore.setState({ screen: 'results', result: lessonResult })
    render(<GameUI />)
    click('Main Menu')
    expect(state().screen).toBe('mainMenu')
  })

  it('non-lesson results keep Retry / Choose Mode', () => {
    useGameStore.setState({ screen: 'results', result: { ...lessonResult, mode: 'landing' } })
    render(<GameUI />)
    expect(screen.queryByTestId('coach-tip')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose Mode' })).toBeTruthy()
  })

  it('settings toggles update the store', () => {
    useGameStore.setState({ overlay: 'settings' })
    render(<GameUI />)
    fireEvent.click(screen.getByLabelText('Flight assists (tail-strike guard)'))
    expect(state().settings.assists).toBe(false)
    fireEvent.click(screen.getByLabelText('Voice callouts'))
    expect(state().settings.voiceCallouts).toBe(false)
  })
})
