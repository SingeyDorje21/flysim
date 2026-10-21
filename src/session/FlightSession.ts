/**
 * One flight: physics + keyboard + challenge + render/telemetry publishing.
 * Owns the fixed-timestep loop; the R3F driver calls frame() once per frame.
 * Owned by the orchestrator.
 */

import { SPAWNS } from '../config/world'
import { createChallenge, type Challenge } from '../game/challenges'
import { RING_COURSE } from '../game/courses'
import type { FlightResult, GameMode, RingCourseView } from '../game/types'
import { KeyboardControls } from '../input/keyboard'
import { AircraftPhysics } from '../simulation/AircraftPhysics'
import { FixedTimestep } from '../simulation/FixedTimestep'
import { interpolatePose } from '../simulation/interpolate'
import type { AircraftRenderState, FlightModel, TerrainSampler } from '../simulation/types'
import { publishTelemetry, resetTelemetry } from '../state/telemetry'
import { getTerrainSampler } from '../world/terrain/terrainSampler'

const TELEMETRY_INTERVAL = 1 / 30
/** Real seconds between the flight being decided and the results screen. */
const RESULT_DELAY = { success: 1.2, failure: 2.5 } as const
const RAD2DEG = 180 / Math.PI

export interface FlightSessionOptions {
  mode: GameMode
  /** Ground the physics collides with; defaults to the mesh at default quality. */
  terrain?: TerrainSampler
  onFinish(result: FlightResult): void
}

export class FlightSession {
  /**
   * Stable sampler handed to the physics. It forwards to the sampler of the
   * currently drawn mesh, which setTerrain() swaps when the quality changes.
   */
  readonly terrain: TerrainSampler = {
    heightAt: (x, z) => this.terrainTarget.heightAt(x, z),
    surfaceAt: (x, z) => this.terrainTarget.surfaceAt(x, z),
  }
  private terrainTarget: TerrainSampler
  readonly physics: FlightModel
  readonly keyboard = new KeyboardControls()
  /** Stable object handed to the ring renderer; the ring challenge mutates nextIndex. */
  readonly ringView: RingCourseView = { rings: RING_COURSE, nextIndex: 0 }
  readonly renderState: AircraftRenderState

  private readonly timestep: FixedTimestep
  private readonly onFinish: (result: FlightResult) => void
  private mode: GameMode
  private challenge: Challenge
  private telemetryClock = 0
  private resultDelay: number | null = null
  private reported = false

  constructor(options: FlightSessionOptions) {
    this.terrainTarget = options.terrain ?? getTerrainSampler()
    this.mode = options.mode
    this.onFinish = options.onFinish
    this.physics = new AircraftPhysics({ terrain: this.terrain, spawn: SPAWNS[this.mode] })
    this.timestep = new FixedTimestep({ dt: this.physics.fixedDt })
    this.challenge = createChallenge(this.mode, this.ringView)
    const s = this.physics.state
    this.renderState = {
      position: { ...s.position },
      orientation: { ...s.orientation },
      velocity: { ...s.velocity },
      surfaces: { ...s.surfaces },
      engineRpm: s.engine.rpm,
      airspeed: s.airspeed,
      onGround: s.onGround,
      crashed: s.crashed,
      frozen: false,
      teleportId: 0,
    }
    this.syncKeyboard()
  }

  get currentMode(): GameMode {
    return this.mode
  }

  /** Collide with the mesh that is actually drawn (call when the quality changes). */
  setTerrain(terrain: TerrainSampler): void {
    this.terrainTarget = terrain
  }

  /** Back to the spawn of `mode` with no leftover state. */
  reset(mode: GameMode = this.mode): void {
    this.mode = mode
    this.physics.reset(SPAWNS[mode])
    this.timestep.reset()
    this.challenge = createChallenge(mode, this.ringView)
    this.syncKeyboard()
    this.telemetryClock = 0
    this.resultDelay = null
    this.reported = false
    this.renderState.teleportId++
    this.syncRenderState(1)
    this.publish()
  }

  /** Called once per rendered frame. While frozen (paused, results) nothing advances. */
  frame(frameDt: number, frozen: boolean): void {
    this.renderState.frozen = frozen
    if (frozen) return
    const alpha = this.timestep.advance(frameDt, this.stepOnce)
    this.syncRenderState(alpha)

    this.telemetryClock += frameDt
    if (this.telemetryClock >= TELEMETRY_INTERVAL) {
      this.telemetryClock %= TELEMETRY_INTERVAL
      this.publish()
    }

    const result = this.challenge.result
    if (result && !this.reported) {
      this.resultDelay ??= RESULT_DELAY[result.outcome]
      this.resultDelay -= frameDt
      if (this.resultDelay <= 0) {
        this.reported = true
        this.publish()
        this.onFinish(result)
      }
    }
  }

  dispose(): void {
    this.keyboard.releaseAll()
    resetTelemetry()
  }

  private readonly stepOnce = (dt: number): void => {
    this.physics.setControls(this.keyboard.update(dt))
    this.physics.step()
    this.challenge.update(this.physics.state, dt)
  }

  private syncKeyboard(): void {
    const c = this.physics.state.controls
    this.keyboard.reset({ throttle: c.throttle, flaps: c.flaps, trim: c.trim })
  }

  private syncRenderState(alpha: number): void {
    const s = this.physics.state
    const r = this.renderState
    // A crashed aircraft no longer steps, so interpolating would jitter.
    interpolatePose(this.physics.previousState, s, s.crashed ? 1 : alpha, r)
    r.velocity.x = s.velocity.x
    r.velocity.y = s.velocity.y
    r.velocity.z = s.velocity.z
    r.surfaces.elevator = s.surfaces.elevator
    r.surfaces.aileron = s.surfaces.aileron
    r.surfaces.rudder = s.surfaces.rudder
    r.surfaces.flaps = s.surfaces.flaps
    r.engineRpm = s.engine.rpm
    r.airspeed = s.airspeed
    r.onGround = s.onGround
    r.crashed = s.crashed
  }

  private publish(): void {
    const s = this.physics.state
    publishTelemetry({
      airspeed: s.airspeed,
      groundSpeed: s.groundSpeed,
      altitude: s.altitude,
      heightAboveGround: s.heightAboveGround,
      verticalSpeed: s.verticalSpeed,
      headingDeg: s.headingDeg,
      pitchDeg: s.pitchDeg,
      bankDeg: s.bankDeg,
      angleOfAttackDeg: s.angleOfAttack * RAD2DEG,
      sideslipDeg: s.sideslip * RAD2DEG,
      gForce: s.gForce,
      throttle: s.controls.throttle,
      rpm: s.engine.rpm,
      engineRunning: s.engine.running,
      flaps: s.controls.flaps,
      flapsDeg: s.surfaces.flaps * RAD2DEG,
      brakes: s.controls.brakes,
      trim: s.controls.trim,
      stick: { pitch: s.controls.pitch, roll: s.controls.roll, yaw: s.controls.yaw },
      stallWarning: s.stallWarning,
      stalled: s.stalled,
      onGround: s.onGround,
      crashed: s.crashed,
      crashReason: s.crashReason,
      simTime: s.simTime,
      position: { ...s.position },
      challenge: this.challenge.progress,
    })
  }
}
