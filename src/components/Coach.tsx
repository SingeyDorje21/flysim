import type { LessonCue, LessonView } from '../game/types'
import type { Units } from '../state/gameStore'
import { formatCueValue } from './format'

const clamp01 = (n: number): number => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0))

function CueGauge({ cue, units }: { cue: LessonCue; units: Units }) {
  const [rMin, rMax] = cue.range
  const span = rMax - rMin || 1
  const pos = (v: number): number => clamp01((v - rMin) / span) * 100
  const [tMin, tMax] = cue.target
  const inBand = cue.value >= tMin && cue.value <= tMax
  return (
    <div className={`coach-cue${inBand ? ' in-band' : ''}`} data-testid="coach-cue" data-in-band={inBand ? 'true' : 'false'}>
      <div className="coach-cue-head">
        <span className="coach-cue-label">{cue.label}</span>
        <span className="coach-cue-value" data-testid="coach-cue-value">
          {formatCueValue(cue.kind, cue.value, units)}
        </span>
      </div>
      <div
        className="coach-gauge"
        role="meter"
        aria-label={cue.label}
        aria-valuemin={rMin}
        aria-valuemax={rMax}
        aria-valuenow={cue.value}
      >
        <div
          className="coach-band"
          data-testid="coach-band"
          style={{ left: `${pos(tMin)}%`, width: `${Math.max(1, pos(tMax) - pos(tMin))}%` }}
        />
        <div className="coach-marker" data-testid="coach-marker" style={{ left: `${pos(cue.value)}%` }} />
      </div>
      <div className="coach-cue-target" data-testid="coach-cue-target">
        Target {formatCueValue(cue.kind, tMin, units)} to {formatCueValue(cue.kind, tMax, units)}
      </div>
    </div>
  )
}

/** Flight School coach: current step, keys, live cue gauge and corrections. */
export function CoachPanel({ lesson, units }: { lesson: LessonView; units: Units }) {
  const complete = lesson.current >= lesson.steps.length
  const step = lesson.steps[lesson.current]
  return (
    <section className="hud-coach" data-testid="coach" aria-label="Flight coach">
      {lesson.stepCounter > 0 && (
        <span key={lesson.stepCounter} className="coach-flash" data-testid="coach-flash" aria-hidden="true" />
      )}
      <div className="coach-title">{lesson.title}</div>
      <ol className="coach-steps" aria-label="Lesson progress">
        {lesson.steps.map((s, i) => (
          <li
            key={s.title}
            className={s.done ? 'done' : i === lesson.current ? 'current' : ''}
            title={s.title}
            aria-current={i === lesson.current ? 'step' : undefined}
          >
            <span className="sr-only">{`${s.title}${s.done ? ' (done)' : ''}`}</span>
          </li>
        ))}
      </ol>
      <div className="coach-counter">
        {complete
          ? `${lesson.steps.length} / ${lesson.steps.length}`
          : `Step ${lesson.current + 1} / ${lesson.steps.length}`}
        {!complete && step ? ` · ${step.title}` : ''}
      </div>
      {complete ? (
        <div className="coach-complete" role="status">
          Lesson complete!
        </div>
      ) : (
        <>
          <p className="coach-instruction" data-testid="coach-instruction">
            {lesson.instruction}
          </p>
          {lesson.keys.length > 0 && (
            <div className="coach-keys" aria-label="Keys">
              {lesson.keys.map((k, i) => (
                <kbd key={`${k}-${i}`} className="coach-key">
                  {k}
                </kbd>
              ))}
            </div>
          )}
          {lesson.cue && <CueGauge cue={lesson.cue} units={units} />}
        </>
      )}
      {lesson.warning && (
        <div className="coach-warning" role="alert" data-testid="coach-warning">
          {lesson.warning}
        </div>
      )}
    </section>
  )
}
