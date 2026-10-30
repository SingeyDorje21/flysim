/**
 * Multiplayer room state (low frequency: status, roster, leaderboard). The
 * remote aircraft poses are high frequency and live in `remotePoses`, which
 * the renderer samples per frame. Nothing here opens a socket until the
 * player creates or joins a room, so single player is untouched.
 */

import { create } from 'zustand'
import type { AircraftId } from '../config/aircraftCatalog'
import { HOME_PLACE, type FlightPlace } from '../game/spawns'
import { MultiplayerClient, type Hello, type LocalPose, type SocketFactory } from '../net/client'
import {
  cleanName,
  isValidRoomCode,
  normalizeRoomCode,
  type ErrorCode,
  type LeaderboardEntry,
  type PlayerId,
  type RosterEntry,
  type ServerMessage,
} from '../net/protocol'
import { RemotePoses } from '../net/remotePoses'
import { useGameStore } from './gameStore'

export type MultiplayerStatus = 'idle' | 'connecting' | 'inRoom' | 'reconnecting' | 'error'
export type MultiplayerError = ErrorCode | 'UNREACHABLE' | 'NO_SERVER' | 'DISCONNECTED' | 'BAD_NAME'

/** How long a leaderboard row flashes after a collision reset its score (ms). */
export const RESET_FLASH_MS = 1600

export interface MultiplayerState {
  status: MultiplayerStatus
  error: MultiplayerError | null
  errorMessage: string | null
  code: string | null
  myId: PlayerId | null
  slot: number
  roster: RosterEntry[]
  leaderboard: LeaderboardEntry[]
  /** Per pilot: until when (performance.now() ms) the leaderboard row flashes after a reset. */
  resetFlashUntil: Record<PlayerId, number>
  /** Crash reason from a collision involving this player, waiting for the simulation to apply it. */
  pendingCrash: string | null
  /** Set when this player's flight ended in a crash: the crash panel offers a respawn. */
  crashReason: string | null
  /** The room connection died during a flight: the flight offers to continue solo. */
  connectionLost: boolean
  /** In-flight leaderboard shown (L toggles it). */
  boardVisible: boolean
  playerName: string

  setPlayerName(name: string): void
  createRoom(aircraftId: AircraftId): void
  joinRoom(code: string, aircraftId: AircraftId): void
  leaveRoom(): void
  /** The simulation applied pendingCrash. */
  consumeCrash(): void
  /** The flight ended (crash) while in a room: show the crash panel instead of the results screen. */
  reportCrash(reason: string): void
  /** Back to this player's spawn slot (restarts the flight; the session tells the server). */
  respawn(): void
  /** After a lost connection: keep flying in single player (restarting if the aircraft had crashed). */
  continueSolo(): void
  toggleBoard(): void
  clearError(): void
}

/** High-frequency remote poses, sampled by the renderer. */
export const remotePoses = new RemotePoses()

const NAME_KEY = 'flysim-mp-name'
const ERROR_TEXT: Record<MultiplayerError, string> = {
  BAD_CODE: 'No room with that code. Check it and try again.',
  ROOM_FULL: 'That room is full.',
  SERVER_FULL: 'The multiplayer server is full. Try again later.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  BAD_MESSAGE: 'The server rejected the request.',
  VERSION_MISMATCH: 'The server runs a different version. Reload the page.',
  NOT_IN_ROOM: 'Not in a room.',
  UNREACHABLE: "Can't reach the multiplayer server.",
  NO_SERVER: 'No multiplayer server is configured for this site.',
  DISCONNECTED: 'Lost the connection to the room.',
  BAD_NAME: "Enter a pilot name: 1-16 letters, digits, spaces or . _ ' -",
}

function loadName(): string {
  try {
    return globalThis.localStorage?.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Where the room server lives: VITE_MP_SERVER_URL, else port 8787 on a local dev host. */
export function multiplayerServerUrl(): string | null {
  const env = import.meta.env?.VITE_MP_SERVER_URL as string | undefined
  if (env) return env
  const host = globalThis.location?.hostname
  if (host && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) return `ws://${host}:8787`
  return null
}

let client: MultiplayerClient | null = null
let helloKind: Hello['kind'] = 'create'
/** The current connection has had a `welcome` (a later one is a rejoin after a reconnect). */
let welcomed = false
/** The player's own airport/runway, restored when they leave multiplayer. */
let savedPlace: FlightPlace | null = null
let socketFactory: SocketFactory | undefined
let serverUrlOverride: string | null | undefined

/** Test seam: fake sockets and a fixed server URL. */
export function setMultiplayerTransport(factory: SocketFactory | undefined, url?: string | null): void {
  socketFactory = factory
  serverUrlOverride = url
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const IDLE = {
  status: 'idle' as MultiplayerStatus,
  code: null,
  myId: null,
  slot: 0,
  roster: [],
  leaderboard: [],
  resetFlashUntil: {},
  pendingCrash: null,
  crashReason: null,
  connectionLost: false,
}

export const useMultiplayerStore = create<MultiplayerState>()((set, get) => {
  const fail = (error: MultiplayerError) => {
    const lostInFlight = welcomed && useGameStore.getState().screen === 'flight'
    const crashReason = get().crashReason
    client?.close()
    client = null
    welcomed = false
    remotePoses.clear()
    set({
      ...IDLE,
      status: 'error',
      error,
      errorMessage: ERROR_TEXT[error],
      connectionLost: lostInFlight,
      crashReason: lostInFlight ? crashReason : null,
    })
  }

  const onMessage = (msg: ServerMessage) => {
    const s = get()
    switch (msg.t) {
      case 'welcome': {
        const first = !welcomed
        welcomed = true
        set({ status: 'inRoom', code: msg.code, myId: msg.id, slot: msg.slot, error: null, errorMessage: null })
        if (!first) {
          // Rejoined after a dropped connection with a new id: drop everything keyed by the old one.
          remotePoses.clear()
          set({ roster: [], leaderboard: [], resetFlashUntil: {}, pendingCrash: null })
        }
        // The creator stays in the lobby to share the code; a joiner goes straight to the runway.
        if (first && helloKind === 'join') enterMultiplayerFlight()
        return
      }
      case 'roster':
        remotePoses.retain(msg.players.map((p) => p.id))
        set({ roster: msg.players })
        return
      case 'snapshot':
        remotePoses.ingest(msg, now())
        return
      case 'leaderboard': {
        const t = now()
        const flash: Record<PlayerId, number> = {}
        for (const e of msg.entries) {
          const before = s.leaderboard.find((x) => x.id === e.id)
          const until = s.resetFlashUntil[e.id] ?? 0
          if (before && e.resets > before.resets) flash[e.id] = t + RESET_FLASH_MS
          else if (until > t) flash[e.id] = until
        }
        set({ leaderboard: msg.entries, resetFlashUntil: flash })
        return
      }
      case 'collision': {
        if (!s.myId || (msg.a !== s.myId && msg.b !== s.myId)) return
        const other = s.roster.find((p) => p.id === (msg.a === s.myId ? msg.b : msg.a))
        set({ pendingCrash: `Mid-air collision with ${other?.name ?? 'another aircraft'}` })
        return
      }
      case 'error':
        // Errors before the welcome end the attempt; a refused rejoin after a dropped
        // connection (the room closed meanwhile) ends it too. In a room they are informational.
        if (s.status === 'connecting') fail(msg.code)
        else if (s.status === 'reconnecting') fail('DISCONNECTED')
        return
    }
  }

  const start = (hello: Hello) => {
    const url = serverUrlOverride === undefined ? multiplayerServerUrl() : serverUrlOverride
    if (!url) return fail('NO_SERVER')
    client?.close()
    remotePoses.clear()
    helloKind = hello.kind
    welcomed = false
    set({ ...IDLE, status: 'connecting', error: null, errorMessage: null })
    const c = new MultiplayerClient(
      url,
      {
        onMessage: (m) => {
          if (client === c) onMessage(m)
        },
        onReconnecting: () => {
          if (client === c) set({ status: 'reconnecting' })
        },
        onGiveUp: (everOpened) => {
          if (client === c) fail(everOpened ? 'DISCONNECTED' : 'UNREACHABLE')
        },
      },
      socketFactory,
    )
    client = c
    c.start(hello)
  }

  const validName = () => {
    const name = cleanName(get().playerName)
    if (!name) fail('BAD_NAME')
    return name
  }

  return {
    ...IDLE,
    error: null,
    errorMessage: null,
    boardVisible: true,
    playerName: loadName(),

    setPlayerName: (playerName) => {
      set({ playerName })
      try {
        globalThis.localStorage?.setItem(NAME_KEY, playerName)
      } catch {
        // storage blocked
      }
    },

    createRoom: (aircraftId) => {
      const name = validName()
      if (name) start({ kind: 'create', name, aircraftId })
    },

    joinRoom: (rawCode, aircraftId) => {
      const name = validName()
      if (!name) return
      const code = normalizeRoomCode(rawCode)
      if (!isValidRoomCode(code)) return fail('BAD_CODE')
      start({ kind: 'join', code, name, aircraftId })
    },

    leaveRoom: () => {
      client?.close()
      client = null
      welcomed = false
      remotePoses.clear()
      set({ ...IDLE, error: null, errorMessage: null })
    },

    consumeCrash: () => set({ pendingCrash: null }),
    reportCrash: (crashReason) => set({ crashReason }),
    respawn: () => {
      set({ crashReason: null, pendingCrash: null })
      useGameStore.getState().restartFlight()
    },
    continueSolo: () => {
      const crashed = get().crashReason !== null
      set({ connectionLost: false, crashReason: null, error: null, errorMessage: null, status: 'idle' })
      // A crashed aircraft never finishes again: start a fresh single-player flight.
      if (crashed) useGameStore.getState().restartFlight()
    },
    toggleBoard: () => set((s) => ({ boardVisible: !s.boardVisible })),
    clearError: () => set((s) => ({ error: null, errorMessage: null, status: s.status === 'error' ? 'idle' : s.status })),
  }
})

/** True while this browser is in a multiplayer room (including a brief reconnect). */
export function inMultiplayerRoom(): boolean {
  const { status } = useMultiplayerStore.getState()
  return status === 'inRoom' || status === 'reconnecting'
}

/** Upload the local aircraft pose (throttled); a no-op outside a room. */
export function sendLocalPose(pose: LocalPose): void {
  if (client && useMultiplayerStore.getState().status === 'inRoom') client.sendPose(pose, now())
}

/** Tell the server this player respawned (restarts its collision grace window). */
export function sendRespawn(): void {
  client?.sendRespawn()
}

/** Fly in the room: Free Flight from the shared home runway (the slot keeps spawns apart). */
export function enterMultiplayerFlight(): void {
  const g = useGameStore.getState()
  savedPlace ??= { airportId: g.airportId, runwayEnd: g.runwayEnd }
  g.selectAirport(HOME_PLACE.airportId, HOME_PLACE.runwayEnd)
  g.startFlight('freeFlight')
}

// Leaving the lobby or the flight for any other screen (main menu, ...) leaves the
// room and gives the player back their own airport choice.
useGameStore.subscribe((s, prev) => {
  if (s.screen === prev.screen || s.screen === 'multiplayer' || s.screen === 'flight' || s.screen === 'results') return
  const mp = useMultiplayerStore.getState()
  if (mp.status !== 'idle' && mp.status !== 'error') mp.leaveRoom()
  else if (mp.connectionLost) useMultiplayerStore.setState({ connectionLost: false, crashReason: null })
  if (savedPlace) {
    const place = savedPlace
    savedPlace = null
    useGameStore.getState().selectAirport(place.airportId, place.runwayEnd)
  }
})
