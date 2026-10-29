import { Analytics } from '@vercel/analytics/react'
import { lazy, Suspense } from 'react'
import { useAudioUnlock } from './audio/context'
import { GameUI } from './components/GameUI'
import { useHotkeys } from './input/hotkeys'
import { CanvasErrorBoundary } from './session/CanvasErrorBoundary'
import { useGameStore } from './state/gameStore'

// three.js, R3F and the world are only needed once a flight starts; the menu loads without them.
const loadFlightCanvas = () => import('./session/FlightCanvas')
const FlightCanvas = lazy(() => loadFlightCanvas().then((m) => ({ default: m.FlightCanvas })))
// Fetch it in the background while the player is still in the menus.
if (typeof window !== 'undefined') window.setTimeout(() => void loadFlightCanvas().catch(() => {}), 1500)

export default function App() {
  useHotkeys()
  useAudioUnlock()
  const screen = useGameStore((s) => s.screen)
  const inFlight = screen === 'flight' || screen === 'results'

  return (
    <>
      {inFlight && (
        <CanvasErrorBoundary>
          <Suspense fallback={null}>
            <FlightCanvas />
          </Suspense>
        </CanvasErrorBoundary>
      )}
      <GameUI />
      <Analytics />
    </>
  )
}
