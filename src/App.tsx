import { Analytics } from '@vercel/analytics/react'
import { useAudioUnlock } from './audio/context'
import { GameUI } from './components/GameUI'
import { useHotkeys } from './input/hotkeys'
import { CanvasErrorBoundary } from './session/CanvasErrorBoundary'
import { FlightCanvas } from './session/FlightCanvas'
import { useGameStore } from './state/gameStore'

export default function App() {
  useHotkeys()
  useAudioUnlock()
  const screen = useGameStore((s) => s.screen)
  const inFlight = screen === 'flight' || screen === 'results'

  return (
    <>
      {inFlight && (
        <CanvasErrorBoundary>
          <FlightCanvas />
        </CanvasErrorBoundary>
      )}
      <GameUI />
      <Analytics />
    </>
  )
}
