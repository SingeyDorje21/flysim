import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { getAircraft, type AircraftId } from '../../config/aircraftCatalog'
import type { CameraMode } from '../../game/types'
import type { AircraftRenderState, TerrainSampler } from '../../simulation/types'

const FOV: Record<CameraMode, number> = { chase: 62, cockpit: 78, free: 60 }
const MIN_ABOVE_GROUND = 2
const CHASE_OFFSET_K = 3.5 // 1/s, damping of the camera swing
const CHASE_LOOK_K = 6
/** Look-ahead point distance, as a multiple of the chase distance. */
const CHASE_LOOK_AHEAD_K = 1.2
/** Free-orbit zoom limits as multiples of the aircraft length. */
const ORBIT_MIN_K = 0.6
const ORBIT_MAX_K = 6
const ORBIT_START_K = 3
const FAR_PLANE = 60000

// Scratch objects (no per-frame allocation).
const _q = new Quaternion()
const _fwd = new Vector3()
const _fh = new Vector3()
const _target = new Vector3()
const _look = new Vector3()
const _eye = new Vector3()

interface RigState {
  teleportId: number
  aircraftId: AircraftId | null
  mode: CameraMode | null
  offset: Vector3
  lookOffset: Vector3
  lastFh: Vector3
  yaw: number
  pitch: number
  dist: number
}

interface CameraRigProps {
  renderState: AircraftRenderState
  terrain: TerrainSampler
  mode: CameraMode
  mouseSensitivity: number
}

/** Drives the R3F default camera (chase / cockpit / free orbit). Place before Sky/Ocean so they follow the final camera pose. */
export function CameraRig({ renderState, terrain, mode, mouseSensitivity }: CameraRigProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const sens = useRef(mouseSensitivity)
  sens.current = mouseSensitivity
  /** Zoom limits of the current aircraft, read by the wheel handler. */
  const limits = useRef({ min: 8, max: 80 })

  const rig = useRef<RigState>({
    teleportId: Number.NaN,
    aircraftId: null,
    mode: null,
    offset: new Vector3(0, 3.5, 14),
    lookOffset: new Vector3(),
    lastFh: new Vector3(0, 0, -1),
    yaw: 0,
    pitch: 0.25,
    dist: 25,
  })

  // Free-look pointer controls.
  useEffect(() => {
    if (mode !== 'free') return
    const el = gl.domElement
    let dragging = false
    let lastX = 0
    let lastY = 0
    const down = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* pointer may already be gone */
      }
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      const r = rig.current
      const k = 0.005 * sens.current
      r.yaw -= (e.clientX - lastX) * k
      r.pitch = Math.max(-1.45, Math.min(1.45, r.pitch + (e.clientY - lastY) * k))
      lastX = e.clientX
      lastY = e.clientY
    }
    const up = (e: PointerEvent) => {
      dragging = false
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = rig.current
      r.dist = Math.max(limits.current.min, Math.min(limits.current.max, r.dist * Math.exp(e.deltaY * 0.001)))
    }
    const ctx = (e: Event) => e.preventDefault()
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('contextmenu', ctx)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('contextmenu', ctx)
    }
  }, [mode, gl])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const rs = renderState
    const r = rig.current
    const p = rs.position

    const info = getAircraft(rs.aircraftId)
    const length = info.geometry.length
    const chaseDistance = info.camera.chaseDistance
    const chaseHeight = info.camera.chaseHeight
    limits.current.min = ORBIT_MIN_K * length
    limits.current.max = ORBIT_MAX_K * length

    // Projection settings. The near plane scales with the aircraft so a 67 m
    // airliner keeps depth precision at 100 m while the cockpit stays tight.
    const fov = FOV[mode]
    const near = mode === 'cockpit' ? 0.15 : Math.min(1, Math.max(0.2, length * 0.012))
    if (camera.fov !== fov || camera.near !== near || camera.far !== FAR_PLANE) {
      camera.fov = fov
      camera.near = near
      camera.far = FAR_PLANE
      camera.updateProjectionMatrix()
    }

    _q.set(rs.orientation.x, rs.orientation.y, rs.orientation.z, rs.orientation.w)
    _fwd.set(0, 0, -1).applyQuaternion(_q)
    // Horizontal forward (kept from last frame when pointing straight up/down).
    const hl = Math.hypot(_fwd.x, _fwd.z)
    if (hl > 0.05) r.lastFh.set(_fwd.x / hl, 0, _fwd.z / hl)
    _fh.copy(r.lastFh)

    const prevAircraft = r.aircraftId
    const snap = r.teleportId !== rs.teleportId || r.mode !== mode || r.aircraftId !== rs.aircraftId
    r.teleportId = rs.teleportId
    r.aircraftId = rs.aircraftId

    if (mode === 'cockpit') {
      const e = info.geometry.eyePoint
      _eye.set(e.x, e.y, e.z).applyQuaternion(_q)
      camera.position.set(p.x + _eye.x, p.y + _eye.y, p.z + _eye.z)
      camera.quaternion.copy(_q)
    } else if (mode === 'chase') {
      // Desired swing offset: behind (mostly along the heading, a little along the
      // actual nose direction) and above.
      _target.copy(_fh).multiplyScalar(0.75).addScaledVector(_fwd, 0.25).normalize().multiplyScalar(-chaseDistance)
      _target.y += chaseHeight
      _look.copy(_fh).multiplyScalar(chaseDistance * CHASE_LOOK_AHEAD_K)
      _look.y += chaseHeight * 0.25
      if (snap) {
        r.offset.copy(_target)
        r.lookOffset.copy(_look)
      } else {
        r.offset.lerp(_target, 1 - Math.exp(-CHASE_OFFSET_K * dt))
        r.lookOffset.lerp(_look, 1 - Math.exp(-CHASE_LOOK_K * dt))
      }
      camera.position.set(p.x + r.offset.x, p.y + r.offset.y, p.z + r.offset.z)
      const floor = terrain.heightAt(camera.position.x, camera.position.z) + MIN_ABOVE_GROUND
      if (camera.position.y < floor) camera.position.y = floor
      camera.lookAt(p.x + r.lookOffset.x, p.y + r.lookOffset.y, p.z + r.lookOffset.z)
    } else {
      if (r.mode !== 'free' || r.aircraftId !== prevAircraft) {
        // Entering free look (or a new aircraft): start behind the aircraft.
        r.yaw = Math.atan2(-_fh.x, -_fh.z)
        r.pitch = 0.25
        r.dist = Math.max(limits.current.min, Math.min(limits.current.max, ORBIT_START_K * length))
      }
      r.dist = Math.max(limits.current.min, Math.min(limits.current.max, r.dist))
      const cp = Math.cos(r.pitch)
      camera.position.set(
        p.x + r.dist * cp * Math.sin(r.yaw),
        p.y + r.dist * Math.sin(r.pitch),
        p.z + r.dist * cp * Math.cos(r.yaw),
      )
      const floor = terrain.heightAt(camera.position.x, camera.position.z) + MIN_ABOVE_GROUND
      if (camera.position.y < floor) camera.position.y = floor
      camera.lookAt(p.x, p.y, p.z)
    }
    r.mode = mode
  })

  return null
}
