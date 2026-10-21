import { useFrame } from '@react-three/fiber'
import type { FlightAudio } from '../audio/FlightAudio'
import { useGameStore } from '../state/gameStore'
import type { FlightSession } from './FlightSession'

/**
 * Advances the session once per rendered frame and feeds the sound engine.
 * Negative priority so the render state is updated before any world useFrame
 * callback (priority 0) reads it; a positive priority would disable R3F's
 * automatic rendering.
 */
export function SimulationDriver({ session, audio }: { session: FlightSession; audio: FlightAudio }) {
  useFrame((_, delta) => {
    const { paused, screen, overlay } = useGameStore.getState()
    const frozen = paused || overlay !== 'none' || screen !== 'flight'
    session.frame(delta, frozen)

    const s = session.physics.state
    audio.update(
      {
        rpm: s.engine.rpm,
        spool: s.engine.spool,
        engineRunning: s.engine.running,
        throttle: s.controls.throttle,
        flaps: s.controls.flaps,
        airspeed: s.airspeed,
        groundSpeed: s.groundSpeed,
        verticalSpeed: s.verticalSpeed,
        onGround: s.onGround,
        stallWarning: s.stallWarning,
        crashed: s.crashed,
        ringsPassed: session.ringView.nextIndex,
        teleportId: session.renderState.teleportId,
        frozen,
      },
      delta,
    )
  }, -1)
  return null
}
