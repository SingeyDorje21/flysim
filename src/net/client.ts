/**
 * Browser side of the multiplayer connection: one WebSocket, validated
 * inbound messages, throttled pose upload and reconnect with backoff.
 * The socket is injectable so tests run without a network.
 */

import {
  encode,
  parseServerMessage,
  POSE_SEND_HZ,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from './protocol'
import type { AircraftId } from '../config/aircraftCatalog'
import type { Quat, Vec3 } from '../simulation/types'

/** The subset of the browser WebSocket the client uses. */
export interface SocketLike {
  readonly readyState: number
  send(data: string): void
  close(): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export type SocketFactory = (url: string) => SocketLike

const OPEN = 1
const RECONNECT_BASE_MS = 500
const MAX_RECONNECTS = 5

export interface ClientHandlers {
  onMessage(msg: ServerMessage): void
  /** The connection dropped and the client is trying again. */
  onReconnecting(attempt: number): void
  /** Gave up (or closed before ever opening): no more events after this. */
  onGiveUp(everOpened: boolean): void
}

export type Hello =
  | { kind: 'create'; name: string; aircraftId: AircraftId }
  | { kind: 'join'; code: string; name: string; aircraftId: AircraftId }

/** What sendPose needs from the local aircraft state. */
export interface LocalPose {
  position: Vec3
  orientation: Quat
  velocity: Vec3
  onGround: boolean
  crashed: boolean
}

export class MultiplayerClient {
  private socket: SocketLike | null = null
  private closedByUs = false
  private everOpened = false
  private attempts = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private seq = 0
  private lastPoseAt = -Infinity
  /** Room to rejoin after a dropped connection (set by `welcome`). */
  private roomCode: string | null = null
  private hello: Hello | null = null
  private readonly url: string
  private readonly handlers: ClientHandlers
  private readonly factory: SocketFactory

  constructor(
    url: string,
    handlers: ClientHandlers,
    factory: SocketFactory = (u) => new WebSocket(u) as unknown as SocketLike,
  ) {
    this.url = url
    this.handlers = handlers
    this.factory = factory
  }

  start(hello: Hello): void {
    this.hello = hello
    this.open()
  }

  /** Throttled to POSE_SEND_HZ; `nowMs` is a monotonic clock (performance.now()). */
  sendPose(s: LocalPose, nowMs: number): void {
    if (nowMs - this.lastPoseAt < 1000 / POSE_SEND_HZ - 1) return
    this.lastPoseAt = nowMs
    this.send({
      t: 'pose',
      seq: this.seq++,
      p: round3(s.position, 100),
      q: round4(s.orientation),
      v: round3(s.velocity, 100),
      onGround: s.onGround,
      crashed: s.crashed,
    })
  }

  sendRespawn(): void {
    this.send({ t: 'respawn' })
  }

  close(): void {
    this.closedByUs = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const s = this.socket
    this.socket = null
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null
      s.close()
    }
  }

  private send(msg: ClientMessage): void {
    if (this.socket?.readyState === OPEN) this.socket.send(encode(msg))
  }

  private open(): void {
    let s: SocketLike
    try {
      s = this.factory(this.url)
    } catch {
      this.closedByUs = true
      this.handlers.onGiveUp(false)
      return
    }
    this.socket = s
    s.onopen = () => {
      this.everOpened = true
      const h = this.hello!
      const code = this.roomCode ?? (h.kind === 'join' ? h.code : null)
      if (code) this.send({ t: 'join', v: PROTOCOL_VERSION, code, name: h.name, aircraftId: h.aircraftId })
      else this.send({ t: 'create', v: PROTOCOL_VERSION, name: h.name, aircraftId: h.aircraftId })
    }
    s.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      const msg = parseServerMessage(ev.data)
      if (!msg) return
      if (msg.t === 'welcome') {
        this.roomCode = msg.code
        // Only a rejoin that worked earns a fresh set of retries.
        this.attempts = 0
      }
      this.handlers.onMessage(msg)
    }
    s.onerror = () => {}
    s.onclose = () => {
      this.socket = null
      if (this.closedByUs) return
      // Only a connection that worked is worth retrying; never reaching the server is final.
      if (!this.everOpened || this.attempts >= MAX_RECONNECTS) {
        this.closedByUs = true
        this.handlers.onGiveUp(this.everOpened)
        return
      }
      this.attempts++
      this.handlers.onReconnecting(this.attempts)
      this.timer = setTimeout(() => this.open(), RECONNECT_BASE_MS * 2 ** (this.attempts - 1))
    }
  }
}

const round = (x: number, k: number) => Math.round(x * k) / k
const round3 = (v: Vec3, k: number): Vec3 => ({ x: round(v.x, k), y: round(v.y, k), z: round(v.z, k) })
const round4 = (q: Quat): Quat => ({ x: round(q.x, 1e4), y: round(q.y, 1e4), z: round(q.z, 1e4), w: round(q.w, 1e4) })
