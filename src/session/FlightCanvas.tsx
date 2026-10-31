import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { FlightAudio } from '../audio/FlightAudio'
import { QUALITY_PROFILES } from '../config/quality'
import { KeyboardControls } from '../input/keyboard'
import { useGameStore } from '../state/gameStore'
import { inMultiplayer, sendRespawn, useMultiplayerStore } from '../state/multiplayerStore'
import { FlightWorld } from '../world/FlightWorld'
import { getTerrainSampler } from '../world/terrain/terrainSampler'
import { AdaptiveResolution, MIN_DPR } from './adaptiveResolution'
import { FlightSession } from './FlightSession'
import { SimulationDriver } from './SimulationDriver'

function flightKeysActive(): boolean {
  const s = useGameStore.getState()
  return s.screen === 'flight' && !s.paused && s.overlay === 'none'
}

/** Steps the canvas resolution down while frames run over budget, and back up when they don't. */
function ResolutionGovernor({ maxDpr, onChange }: { maxDpr: number; onChange: (dpr: number) => void }) {
  const governor = useMemo(
    () => new AdaptiveResolution(Math.max(MIN_DPR, Math.min(window.devicePixelRatio || 1, maxDpr))),
    [maxDpr],
  )
  useEffect(() => onChange(governor.dpr), [governor, onChange])
  useFrame((_, delta) => {
    const next = governor.frame(delta * 1000)
    if (next !== null) onChange(next)
  })
  return null
}

/** The 3D view plus the simulation; mounted while a flight or its results are on screen. */
export function FlightCanvas() {
  const mode = useGameStore((s) => s.mode)
  const flightId = useGameStore((s) => s.flightId)
  const cameraMode = useGameStore((s) => s.cameraMode)
  const quality = useGameStore((s) => s.settings.quality)
  const invertPitch = useGameStore((s) => s.settings.invertPitch)
  const mouseSensitivity = useGameStore((s) => s.settings.mouseSensitivity)
  // Pixel ratio chosen by the ResolutionGovernor (null until it starts).
  const [dpr, setDpr] = useState<number | null>(null)

  // One ground for physics and rendering at every quality level.
  const terrain = getTerrainSampler()
  const timeOfDay = useGameStore((s) => s.settings.timeOfDay)
  // The aircraft is fixed while the canvas is mounted (it can only change from the menus).
  const [session] = useState(
    () =>
      new FlightSession({
        mode,
        terrain,
        aircraft: useGameStore.getState().aircraftId,
        multiplayerStart: inMultiplayer(),
        // Online a crash shows the respawn panel, not the results screen.
        onFinish: (result) => {
          if (inMultiplayer()) useMultiplayerStore.getState().reportCrash(result.reason ?? result.headline)
          else useGameStore.getState().finishFlight(result)
        },
      }),
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

  const airportId = useGameStore((s) => s.airportId)
  const runwayEnd = useGameStore((s) => s.runwayEnd)

  // Start and every restart: back to the spawn, no stale state.
  useEffect(() => {
    // Online uses the multiplayer start; after a lost connection (flying solo) back to the usual line-up.
    const online = inMultiplayer()
    session.setMultiplayerStart(online)
    session.reset(mode, { airportId, runwayEnd })
    // Multiplayer: every (re)spawn restarts the server's collision grace window.
    if (online) sendRespawn()
    // A focused menu button would otherwise eat Space (brakes).
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }, [session, mode, flightId, airportId, runwayEnd])

  useEffect(() => {
    session.keyboard.invertPitch = invertPitch
  }, [session, invertPitch])

  const assists = useGameStore((s) => s.settings.assists)
  useEffect(() => {
    session.setAssists(assists)
  }, [session, assists])

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
        dpr={dpr ?? [1, QUALITY_PROFILES[quality].maxDpr]}
        gl={{ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' }}
        camera={{ fov: 65, near: 0.2, far: 60000 }}
      >
        <SimulationDriver session={session} audio={audio} />
        <ResolutionGovernor maxDpr={QUALITY_PROFILES[quality].maxDpr} onChange={setDpr} />
        <FlightWorld
          renderState={session.renderState}
          terrain={terrain}
          quality={quality}
          cameraMode={cameraMode}
          rings={mode === 'rings' ? session.ringView : null}
          mouseSensitivity={mouseSensitivity}
          timeOfDay={timeOfDay}
        />
      </Canvas>
    </div>
  )
}
