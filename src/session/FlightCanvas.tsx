import { Canvas } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { FlightAudio } from '../audio/FlightAudio'
import { QUALITY_PROFILES } from '../config/quality'
import { KeyboardControls } from '../input/keyboard'
import { useGameStore } from '../state/gameStore'
import { FlightWorld } from '../world/FlightWorld'
import { terrainSamplerForQuality } from '../world/terrain/terrainGrid'
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

  // The drawn mesh and the physics ground share one triangulated grid per quality.
  const terrain = terrainSamplerForQuality(quality)
  const [session] = useState(
    () =>
      new FlightSession({ mode, terrain, onFinish: (result) => useGameStore.getState().finishFlight(result) }),
  )

  useEffect(() => {
    session.setTerrain(terrain)
  }, [session, terrain])

  const masterVolume = useGameStore((s) => s.settings.masterVolume)
  const [audio] = useState(() => new FlightAudio())
  useEffect(() => {
    audio.setVolume(masterVolume)
  }, [audio, masterVolume])
  useEffect(() => () => audio.dispose(), [audio])

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
      if (!flightKeysActive()) {
        // A flight key still held from the flight (e.g. Space for brakes) must
        // not auto-repeat into a button focused by the next screen.
        if (e.repeat || session.keyboard.isHeld(e.code)) e.preventDefault()
        return
      }
      session.keyboard.keyDown(e.code, e.repeat)
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const wasHeld = session.keyboard.isHeld(e.code)
      session.keyboard.keyUp(e.code)
      if (wasHeld || (KeyboardControls.isFlightKey(e.code) && flightKeysActive())) e.preventDefault()
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
        <SimulationDriver session={session} audio={audio} />
        <FlightWorld
          renderState={session.renderState}
          terrain={terrain}
          quality={quality}
          cameraMode={cameraMode}
          rings={mode === 'rings' ? session.ringView : null}
          mouseSensitivity={mouseSensitivity}
        />
      </Canvas>
    </div>
  )
}
