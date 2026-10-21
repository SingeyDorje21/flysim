import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../state/gameStore'
import type { FlightSession } from './FlightSession'

/**
 * Advances the session once per rendered frame. Negative priority so the
 * render state is updated before any world useFrame callback (priority 0)
 * reads it; a positive priority would disable R3F's automatic rendering.
 */
export function SimulationDriver({ session }: { session: FlightSession }) {
  useFrame((_, delta) => {
    const { paused, screen, overlay } = useGameStore.getState()
    session.frame(delta, paused || overlay !== 'none' || screen !== 'flight')
  }, -1)
  return null
}
