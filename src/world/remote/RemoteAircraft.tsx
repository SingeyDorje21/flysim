import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CanvasTexture, Group, Sprite, SpriteMaterial, SRGBColorSpace } from 'three'
import type { AircraftId } from '../../config/aircraftCatalog'
import { createRemotePose } from '../../net/remotePoses'
import type { RosterEntry } from '../../net/protocol'
import type { AircraftRenderState, TerrainSampler } from '../../simulation/types'
import { remotePoses, useMultiplayerStore } from '../../state/multiplayerStore'
import { AircraftModel } from '../aircraft/AircraftModel'

/** Below this height above the ground a remote aircraft is drawn with its gear down. */
const GEAR_DOWN_HEIGHT = 150
/** Label height above the aircraft's centre (m). */
const LABEL_LIFT = 6

function remoteRenderState(aircraftId: AircraftId): AircraftRenderState {
  return {
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    surfaces: { elevator: 0, aileron: 0, rudder: 0, flaps: 0 },
    engineRpm: 0,
    aircraftId,
    n1: 0,
    afterburner: false,
    gearPosition: 1,
    speedbrakePosition: 0,
    thrustVector: 0,
    airspeed: 0,
    onGround: true,
    crashed: false,
    frozen: false,
    teleportId: 0,
  }
}

/** Screen-constant name tag drawn from a small canvas. */
function useNameTag(name: string) {
  const tag = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    const material = new SpriteMaterial({ map: texture, depthWrite: false, sizeAttenuation: false, transparent: true })
    const sprite = new Sprite(material)
    sprite.scale.set(0.16, 0.04, 1)
    sprite.renderOrder = 10
    const draw = (crashed: boolean) => {
      const g = canvas.getContext('2d')
      if (!g) return
      g.clearRect(0, 0, canvas.width, canvas.height)
      g.font = 'bold 30px system-ui, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.lineWidth = 6
      g.strokeStyle = 'rgba(0, 0, 0, 0.75)'
      const text = crashed ? `${name} (crashed)` : name
      g.strokeText(text, 128, 32, 248)
      g.fillStyle = crashed ? '#ff6b6b' : '#ffffff'
      g.fillText(text, 128, 32, 248)
      texture.needsUpdate = true
    }
    return { sprite, texture, material, draw }
  }, [name])
  useEffect(
    () => () => {
      tag.texture.dispose()
      tag.material.dispose()
    },
    [tag],
  )
  return tag
}

function RemotePlane({ entry, terrain, shadows }: { entry: RosterEntry; terrain: TerrainSampler; shadows: boolean }) {
  const [rs] = useState(() => remoteRenderState(entry.aircraftId))
  const [pose] = useState(createRemotePose)
  const group = useRef<Group>(null)
  const tag = useNameTag(entry.name)
  const drawnCrashed = useRef<boolean | null>(null)

  // Priority -1: before AircraftModel (priority 0) reads the render state.
  useFrame(() => {
    const g = group.current
    if (!g) return
    const known = remotePoses.sample(entry.id, performance.now(), pose)
    g.visible = known
    if (!known) return
    rs.position.x = pose.position.x
    rs.position.y = pose.position.y
    rs.position.z = pose.position.z
    rs.orientation.x = pose.orientation.x
    rs.orientation.y = pose.orientation.y
    rs.orientation.z = pose.orientation.z
    rs.orientation.w = pose.orientation.w
    rs.velocity.x = pose.velocity.x
    rs.velocity.y = pose.velocity.y
    rs.velocity.z = pose.velocity.z
    rs.onGround = pose.onGround
    rs.crashed = pose.crashed
    rs.frozen = pose.crashed
    rs.airspeed = Math.hypot(pose.velocity.x, pose.velocity.y, pose.velocity.z)
    const running = !pose.crashed
    rs.engineRpm = running ? (pose.onGround ? 900 : 2300) : 0
    rs.n1 = running ? (pose.onGround ? 0.25 : 0.7) : 0
    const height = pose.position.y - terrain.heightAt(pose.position.x, pose.position.z)
    rs.gearPosition = pose.onGround || height < GEAR_DOWN_HEIGHT ? 1 : 0

    tag.sprite.position.set(pose.position.x, pose.position.y + LABEL_LIFT, pose.position.z)
    if (drawnCrashed.current !== pose.crashed) {
      drawnCrashed.current = pose.crashed
      tag.draw(pose.crashed)
    }
  }, -1)

  return (
    <group ref={group} visible={false}>
      <AircraftModel renderState={rs} cameraMode="chase" shadows={shadows} />
      <primitive object={tag.sprite} />
    </group>
  )
}

/** Every other pilot in the multiplayer room. Mounted only while in a room. */
export function RemoteAircraft({ terrain, shadows }: { terrain: TerrainSampler; shadows: boolean }) {
  const roster = useMultiplayerStore((s) => s.roster)
  const myId = useMultiplayerStore((s) => s.myId)
  return (
    <>
      {roster
        .filter((p) => p.id !== myId)
        .map((p) => (
          <RemotePlane key={`${p.id}:${p.aircraftId}`} entry={p} terrain={terrain} shadows={shadows} />
        ))}
    </>
  )
}
