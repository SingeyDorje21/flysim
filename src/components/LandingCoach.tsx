import { landingAdvice, pitchKeys, touchdownVerdict } from '../game/landingCoach'
import { useAutopilotStore } from '../state/autopilotStore'
import { useGameStore } from '../state/gameStore'
import { useTelemetry } from '../state/telemetry'

/** Mid-left landing tips while on approach, then a verdict on the touchdown. */
export function LandingCoach() {
  const t = useTelemetry()
  const invertPitch = useGameStore((s) => s.settings.invertPitch)
  // While the landing assist flies, tips would only contradict it.
  const assisting = useAutopilotStore((s) => s.assist !== null)
  const verdict = touchdownVerdict(t)
  const tips = verdict || assisting ? [] : landingAdvice(t, pitchKeys(invertPitch))
  if (!verdict && tips.length === 0) return null

  return (
    <aside className="landing-coach" data-testid="landing-coach" aria-live="polite" aria-label="Landing coach">
      <div className="landing-coach-label">Landing coach</div>
      {verdict ? (
        <div className={`landing-tip tone-${verdict.tone}`} data-testid="landing-verdict">
          <strong>{verdict.title}</strong>
          <span>{verdict.text}</span>
        </div>
      ) : (
        tips.map((a) => (
          // Keyed by the tip, so a new tip replays the slide-in.
          <div key={a.id} className={`landing-tip tone-${a.tone}`} data-testid={`landing-tip-${a.id}`}>
            {a.text}
          </div>
        ))
      )}
    </aside>
  )
}
