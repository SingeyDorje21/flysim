import { useFrame } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { CalloutDetector, speak, stopSpeech } from '../audio/callouts'
import type { FlightAudio } from '../audio/FlightAudio'
import { getAircraft } from '../config/aircraftCatalog'
import { useGameStore } from '../state/gameStore'
import type { FlightSession } from './FlightSession'

/**
 * Advances the session once per rendered frame and feeds the sound engine and
 * the spoken callouts. Negative priority so the render state is updated
 * before any world useFrame callback (priority 0) reads it; a positive
 * priority would disable R3F's automatic rendering.
 */
export function SimulationDriver({ session, audio }: { session: FlightSession; audio: FlightAudio }) {
  const info = getAircraft(session.aircraftId)
  const engineKind = info.engineKind
  const [callouts] = useState(() => new CalloutDetector())
  useEffect(() => stopSpeech, [])
  useFrame((_, delta) => {
    const { paused, screen, overlay, settings } = useGameStore.getState()
    const frozen = paused || overlay !== 'none' || screen !== 'flight'
    session.frame(delta, frozen)

    const s = session.physics.state
    audio.update(
      {
        engineKind,
        n1: s.engine.n1,
        afterburner: s.engine.afterburner,
        rpm: s.engine.rpm,
        spool: s.engine.spool,
        engineRunning: s.engine.running,
        throttle: s.controls.throttle,
        flaps: s.controls.flaps,
        airspeed: s.airspeed,
        groundSpeed: s.groundSpeed,
        verticalSpeed: s.verticalSpeed,
        onGround: s.onGround,
        stallWarning: session.stallAlerts && s.stallWarning,
        crashed: s.crashed,
        ringsPassed: session.ringView.nextIndex,
        teleportId: session.renderState.teleportId,
        frozen,
        lessonStep: session.lessonStep,
        apDisconnects: session.apDisconnects,
      },
      delta,
    )

    if (frozen || s.crashed) {
      // A callout already being read out stops with the flight.
      stopSpeech()
      return
    }
    const calls = callouts.detect(
      {
        airspeed: s.airspeed,
        rotateSpeed: info.speeds.rotate,
        onGround: s.onGround,
        verticalSpeed: s.verticalSpeed,
        heightAboveGround: s.heightAboveGround,
        throttle: s.controls.throttle,
        jet: engineKind !== 'piston',
        teleportId: session.renderState.teleportId,
      },
      delta,
    )
    if (settings.voiceCallouts) for (const text of calls) speak(text, settings.masterVolume)
  }, -1)
  return null
}
