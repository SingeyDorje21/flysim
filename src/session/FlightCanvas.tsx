import { Canvas } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { QUALITY_PROFILES } from '../config/quality'
import { KeyboardControls } from '../input/keyboard'
import { useGameStore } from '../state/gameStore'
import { FlightWorld } from '../world/FlightWorld'
import { FlightSession } from './FlightSession'
import { SimulationDriver } from './SimulationDriver'

function flightKeysActive(): boolean {
  const s = useGameStore.getState()
  return s.screen === 'flight' && !s.paused && s.overlay === 'none'
}

/** The 3D view plus the simulation; mounted while a flight or its results are on screen. */
export function FlightCanvas() {
  const mode = useGameStore((s) => s.mode)
  const flightId = useGameStore((s) => s.flightId)
  const cameraMode = useGameStore((s) => s.cameraMode)
  const quality = useGameStore((s) => s.settings.quality)
  const invertPitch = useGameStore((s) => s.settings.invertPitch)
  const mouseSensitivity = useGameStore((s) => s.settings.mouseSensitivity)

  const [session] = useState(
    () => new FlightSession({ mode, onFinish: (result) => useGameStore.getState().finishFlight(result) }),
  )

  // Start and every restart: back to the spawn, no stale state.
  useEffect(() => {
    session.reset(mode)
    // A focused menu button would otherwise eat Space (brakes).
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }, [session, mode, flightId])

  useEffect(() => {
    session.keyboard.invertPitch = invertPitch
  }, [session, invertPitch])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !KeyboardControls.isFlightKey(e.code)) return
      if (!flightKeysActive()) return
      session.keyboard.keyDown(e.code, e.repeat)
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      session.keyboard.keyUp(e.code)
      if (KeyboardControls.isFlightKey(e.code) && flightKeysActive()) e.preventDefault()
    }
    const onBlur = () => session.keyboard.releaseAll()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      session.dispose()
    }
  }, [session])

  return (
    <div className="flight-canvas" style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        // three 0.186 removed PCFSoftShadowMap; R3F's default `shadows` would warn and fall back.
        shadows="percentage"
        dpr={[1, QUALITY_PROFILES[quality].maxDpr]}
        gl={{ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' }}
        camera={{ fov: 65, near: 0.2, far: 60000 }}
      >
        <SimulationDriver session={session} />
        <FlightWorld
          renderState={session.renderState}
          terrain={session.terrain}
          quality={quality}
          cameraMode={cameraMode}
          rings={mode === 'rings' ? session.ringView : null}
          mouseSensitivity={mouseSensitivity}
        />
      </Canvas>
    </div>
  )
}
