/**
 * One flight: physics + keyboard + challenge + render/telemetry publishing.
 * Owns the fixed-timestep loop; the R3F driver calls frame() once per frame.
 * Owned by the orchestrator.
 */

import { getAircraftConfig } from '../config/aircraft'
import type { AircraftId } from '../config/aircraftCatalog'
import { GRAVITY } from '../simulation/atmosphere'
import { approachGuidance, nearestAirport } from '../game/airportGeometry'
import { createChallenge, type Challenge } from '../game/challenges'
import { HOME_PLACE, spawnFor, type FlightPlace } from '../game/spawns'
import { safePitchAtHeight, techniqueFor, type Technique } from '../game/technique'
import { RING_COURSE } from '../game/courses'
import type { FlightResult, GameMode, RingCourseView } from '../game/types'
import { KeyboardControls } from '../input/keyboard'
import { AircraftPhysics } from '../simulation/AircraftPhysics'
import { FixedTimestep } from '../simulation/FixedTimestep'
import { interpolatePose } from '../simulation/interpolate'
import type { AircraftRenderState, ControlInputs, FlightModel, TerrainSampler } from '../simulation/types'
import { publishTelemetry, resetTelemetry, type NavInfo } from '../state/telemetry'
import { getTerrainSampler } from '../world/terrain/terrainSampler'

const TELEMETRY_INTERVAL = 1 / 30
/** Real seconds between the flight being decided and the results screen. */
const RESULT_DELAY = { success: 1.2, failure: 2.5 } as const
const RAD2DEG = 180 / Math.PI

export interface FlightSessionOptions {
  mode: GameMode
  /** Ground the physics collides with; defaults to the mesh at default quality. */
  terrain?: TerrainSampler
  /** Airport and runway end for the start (and the landing target). Defaults to the home field. */
  place?: FlightPlace
  /** Aircraft type for this session (fixed for its lifetime). Default 'trainer'. */
  aircraft?: AircraftId
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
  readonly aircraftId: AircraftId
  /**
   * The F-22 manoeuvres routinely past the angle where its stall flags trip,
   * so it gets no stall warning or horn (its flight controls protect it).
   */
  readonly stallAlerts: boolean
  private readonly technique: Technique
  /** Flare assist stick per m/s of sink beyond the allowance. */
  private readonly flareAssistGain: number
  private assistsSetting = true
  private landed = false
  private flared = false
  private autothrustIntegral = 0
  private autothrustBase = 0.4
  private mode: GameMode
  private place: FlightPlace
  private challenge: Challenge
  private telemetryClock = 0
  private resultDelay: number | null = null
  private reported = false

  constructor(options: FlightSessionOptions) {
    this.terrainTarget = options.terrain ?? getTerrainSampler()
    this.mode = options.mode
    this.place = options.place ?? HOME_PLACE
    this.aircraftId = options.aircraft ?? 'trainer'
    this.stallAlerts = this.aircraftId !== 'f22'
    this.technique = techniqueFor(this.aircraftId)
    // A direct-law stick moves the elevator, a fly-by-wire stick asks for load factor (about
    // 1 g extra at full stick with the gear down): enough to arrest the excess sink in ~1.5 s.
    this.flareAssistGain = getAircraftConfig(this.aircraftId).fbw ? 1 / (GRAVITY * 1.5) : 0.6
    this.onFinish = options.onFinish
    this.physics = new AircraftPhysics({
      terrain: this.terrain,
      spawn: spawnFor(this.mode, this.place, this.aircraftId),
      aircraft: this.aircraftId,
    })
    this.timestep = new FixedTimestep({ dt: this.physics.fixedDt })
    this.challenge = createChallenge(this.mode, this.ringView, this.place, this.aircraftId)
    const s = this.physics.state
    this.renderState = {
      position: { ...s.position },
      orientation: { ...s.orientation },
      velocity: { ...s.velocity },
      surfaces: { ...s.surfaces },
      engineRpm: s.engine.rpm,
      aircraftId: this.aircraftId,
      n1: s.engine.n1,
      afterburner: s.engine.afterburner,
      gearPosition: s.gearPosition,
      speedbrakePosition: s.speedbrakePosition,
      thrustVector: s.thrustVector,
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

  /** Back to the spawn of `mode` at `place` with no leftover state. */
  reset(mode: GameMode = this.mode, place: FlightPlace = this.place): void {
    this.mode = mode
    this.place = place
    this.physics.reset(spawnFor(mode, place, this.aircraftId))
    this.timestep.reset()
    this.challenge = createChallenge(mode, this.ringView, place, this.aircraftId)
    this.syncKeyboard()
    this.telemetryClock = 0
    this.resultDelay = null
    this.reported = false
    this.landed = false
    this.flared = false
    this.autothrustIntegral = 0
    this.autothrustBase = this.physics.state.controls.throttle
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

  /** Completed lesson steps so far (0 outside Flight School). */
  get lessonStep(): number {
    return this.challenge.lessonView?.stepCounter ?? 0
  }

  /** Flight assists from settings; lessons always have them. */
  setAssists(on: boolean): void {
    this.assistsSetting = on
  }

  private get assistsActive(): boolean {
    return this.assistsSetting || this.mode === 'lessonTakeoff' || this.mode === 'lessonLanding'
  }

  /**
   * Tail-strike guard: on the ground and in the first metres of climb, ease
   * the stick back toward neutral as the predicted pitch (half a second
   * ahead) nears the safe pitch for the current wheel height, and push the
   * nose down past it. The tail clears more with every metre of climb.
   */
  private applyTailStrikeGuard(controls: ControlInputs): void {
    const s = this.physics.state
    const h = s.onGround ? 0 : s.heightAboveGround
    if (h > 12) return
    // Judge clearance at the wheel height expected 0.6 s from now (descending closes it).
    const limit = safePitchAtHeight(this.technique, h + Math.min(0, s.verticalSpeed) * 0.6)
    const predicted = s.pitchDeg + s.angularVelocity.x * RAD2DEG * 0.5
    const allowed = (limit - predicted) * 0.35
    if (controls.pitch > allowed) controls.pitch = Math.max(-1, allowed)
  }

  /**
   * Landing-lesson flare assist: near the runway, add a little nose-up when
   * sinking faster than 2 m/s, and ignore back pressure once the descent has
   * stopped so the aircraft cannot balloon and drop in. The pilot still flies
   * the flare; this only trims the extremes.
   */
  private applyFlareAssist(controls: ControlInputs): void {
    const s = this.physics.state
    const h = s.heightAboveGround
    if (this.mode !== 'lessonLanding') return
    // On the runway the aircraft's derotation law lowers the nose (AircraftPhysics).
    if (s.onGround) return
    if (h > this.technique.flareHeight) return
    // Sink rate allowed for this height: about 2.4 m/s at the flare height, 0.8 m/s at the runway.
    const allowed = -(0.8 + (1.6 * h) / this.technique.flareHeight)
    if (s.verticalSpeed > -0.3) controls.pitch = Math.min(controls.pitch, 0)
    else if (s.verticalSpeed < allowed) {
      controls.pitch = Math.max(controls.pitch, Math.min(1, (allowed - s.verticalSpeed) * this.flareAssistGain))
    }
  }

  /**
   * Landing-lesson autothrust: hold the approach speed with the throttle
   * (as airliners do on final), then close it at flare height. The keyboard
   * lever follows, so the pilot takes over seamlessly on the ground.
   */
  private applyApproachAutothrust(controls: ControlInputs, dt: number): void {
    const s = this.physics.state
    if (this.mode !== 'lessonLanding' || s.onGround || this.landed) {
      if (s.onGround) this.landed = true
      return
    }
    const t = this.technique
    if (this.flared || s.heightAboveGround < t.flareHeight) {
      // Once the flare starts the throttle stays closed, even if the aircraft floats back up.
      this.flared = true
      controls.throttle = 0
    } else {
      const error = t.approachSpeed - s.airspeed
      this.autothrustIntegral = Math.max(-0.5, Math.min(0.5, this.autothrustIntegral + error * dt * 0.01))
      controls.throttle = Math.max(0, Math.min(1, this.autothrustBase + error * 0.08 + this.autothrustIntegral))
    }
    this.keyboard.setThrottle(controls.throttle)
  }

  private readonly stepOnce = (dt: number): void => {
    const controls = this.keyboard.update(dt)
    this.applyFlareAssist(controls)
    // The tail-strike guard has the final say over pitch.
    if (this.assistsActive) this.applyTailStrikeGuard(controls)
    this.applyApproachAutothrust(controls, dt)
    this.physics.setControls(controls)
    this.physics.step()
    this.keyboard.syncGear(this.physics.state.controls.gear)
    this.challenge.update(this.physics.state, dt)
  }

  private syncKeyboard(): void {
    const c = this.physics.state.controls
    this.keyboard.reset({ throttle: c.throttle, flaps: c.flaps, trim: c.trim, gear: c.gear, speedbrake: c.speedbrake })
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
    r.n1 = s.engine.n1
    r.afterburner = s.engine.afterburner
    r.gearPosition = s.gearPosition
    r.speedbrakePosition = s.speedbrakePosition
    r.thrustVector = s.thrustVector
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
      stallWarning: this.stallAlerts && s.stallWarning,
      stalled: this.stallAlerts && s.stalled,
      onGround: s.onGround,
      crashed: s.crashed,
      crashReason: s.crashReason,
      simTime: s.simTime,
      position: { ...s.position },
      challenge: this.challenge.progress,
      nav: this.navInfo(),
      aircraftId: this.aircraftId,
      mach: s.mach,
      n1: s.engine.n1,
      afterburner: s.engine.afterburner,
      gearPosition: s.gearPosition,
      gearLever: s.controls.gear,
      speedbrake: s.speedbrakePosition,
      reverse: s.controls.reverse,
      lesson: this.challenge.lessonView ?? null,
    })
  }

  private navInfo(): NavInfo {
    const s = this.physics.state
    const { x, y, z } = s.position
    const near = nearestAirport(x, z)
    const app = s.onGround ? null : approachGuidance(x, y, z, s.headingDeg)
    return {
      nearest: {
        code: near.airport.code,
        name: near.airport.name,
        distance: near.distance,
        bearingDeg: near.bearingDeg,
      },
      approach: app && {
        code: app.end.airport.code,
        runway: app.end.designator,
        distance: app.distance,
        lateral: app.lateral,
        vertical: app.vertical,
      },
    }
  }
}
