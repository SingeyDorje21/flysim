/**
 * Multiplayer state for the one shared sky (low frequency: status, roster,
 * leaderboard, grades). The remote aircraft poses are high frequency and live
 * in `remotePoses`, which the renderer samples per frame. Nothing here opens a
 * socket until the player joins the sky, so single player is untouched.
 */

import { create } from 'zustand'
import type { AircraftId } from '../config/aircraftCatalog'
import { MultiplayerClient, type LocalPose, type SocketFactory } from '../net/client'
import {
  cleanName,
  type ErrorCode,
  type GradeKind,
  type LeaderboardEntry,
  type PlayerId,
  type RosterEntry,
  type ServerMessage,
} from '../net/protocol'
import { RemotePoses } from '../net/remotePoses'
import { useGameStore } from './gameStore'

export type MultiplayerStatus = 'idle' | 'connecting' | 'inSky' | 'reconnecting' | 'error'
export type MultiplayerError = ErrorCode | 'UNREACHABLE' | 'NO_SERVER' | 'DISCONNECTED' | 'BAD_NAME'

/** How long a leaderboard row flashes after a crash or collision reset its score (ms). */
export const RESET_FLASH_MS = 1600
/** How long a take-off or landing grade stays on the HUD (ms). */
export const GRADE_SHOW_MS = 4000

export interface ShownGrade {
  kind: GradeKind
  label: string
  delta: number
  multiplier: number
  /** performance.now() ms after which it is hidden. */
  until: number
}

export interface MultiplayerState {
  status: MultiplayerStatus
  error: MultiplayerError | null
  errorMessage: string | null
  myId: PlayerId | null
  roster: RosterEntry[]
  leaderboard: LeaderboardEntry[]
  /** Per pilot: until when (performance.now() ms) the leaderboard row flashes after a reset. */
  resetFlashUntil: Record<PlayerId, number>
  /** This pilot's latest take-off or landing grade. */
  lastGrade: ShownGrade | null
  /** Crash reason from a collision involving this player, waiting for the simulation to apply it. */
  pendingCrash: string | null
  /** Set when this player's flight ended in a crash: the crash panel offers a respawn. */
  crashReason: string | null
  /** The connection died during a flight: the flight offers to continue solo. */
  connectionLost: boolean
  /** Scoreboard shown (while Tab is held). */
  boardVisible: boolean
  playerName: string

  setPlayerName(name: string): void
  /** Connect and fly from the airport and runway chosen in the game store. */
  joinSky(aircraftId: AircraftId): void
  leaveSky(): void
  /** The simulation applied pendingCrash. */
  consumeCrash(): void
  /** The flight ended (crash) while online: show the crash panel instead of the results screen. */
  reportCrash(reason: string): void
  /** Back to the chosen runway (restarts the flight; the session tells the server). */
  respawn(): void
  /** After a lost connection: keep flying in single player (restarting if the aircraft had crashed). */
  continueSolo(): void
  setBoardVisible(visible: boolean): void
  clearError(): void
}

/** High-frequency remote poses, sampled by the renderer. */
export const remotePoses = new RemotePoses()

const NAME_KEY = 'flysim-mp-name'
const ERROR_TEXT: Record<MultiplayerError, string> = {
  SERVER_FULL: 'The sky is full right now. Try again in a little while.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  BAD_MESSAGE: 'The server rejected the request.',
  VERSION_MISMATCH: 'The server runs a different version. Reload the page.',
  NOT_JOINED: 'Not connected to the sky.',
  UNREACHABLE: "Can't reach the multiplayer server.",
  NO_SERVER: 'No multiplayer server is configured for this site.',
  DISCONNECTED: 'Lost the connection to the multiplayer server.',
  BAD_NAME: "Enter a pilot name: 1-16 letters, digits, spaces or . _ ' -",
}

function loadName(): string {
  try {
    return globalThis.localStorage?.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

/** The deployed sky server (render.yaml). VITE_MP_SERVER_URL overrides it, e.g. if Render picked another name. */
export const DEFAULT_SERVER_URL = 'wss://flysim-rooms.onrender.com'

/** Where the sky server lives: VITE_MP_SERVER_URL, else port 8787 on a local dev host, else the deployed server. */
export function multiplayerServerUrl(): string | null {
  const env = import.meta.env?.VITE_MP_SERVER_URL as string | undefined
  if (env) return env
  const host = globalThis.location?.hostname
  if (host && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) return `ws://${host}:8787`
  return DEFAULT_SERVER_URL
}

let client: MultiplayerClient | null = null
/** The current connection has had a `welcome` (a later one is a rejoin after a reconnect). */
let welcomed = false
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
  myId: null,
  roster: [],
  leaderboard: [],
  resetFlashUntil: {},
  lastGrade: null,
  pendingCrash: null,
  crashReason: null,
  connectionLost: false,
  boardVisible: false,
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
        set({ status: 'inSky', myId: msg.id, error: null, errorMessage: null })
        if (!first) {
          // Rejoined after a dropped connection with a new id: drop everything keyed by the old one.
          remotePoses.clear()
          set({ roster: [], leaderboard: [], resetFlashUntil: {}, pendingCrash: null })
        }
        // Straight onto the chosen runway.
        if (first) enterMultiplayerFlight()
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
      case 'grade':
        set({
          lastGrade: {
            kind: msg.kind,
            label: msg.label,
            delta: msg.delta,
            multiplier: msg.multiplier,
            until: now() + GRADE_SHOW_MS,
          },
        })
        return
      case 'collision': {
        if (!s.myId || (msg.a !== s.myId && msg.b !== s.myId)) return
        const other = s.roster.find((p) => p.id === (msg.a === s.myId ? msg.b : msg.a))
        set({ pendingCrash: `Mid-air collision with ${other?.name ?? 'another aircraft'}` })
        return
      }
      case 'error':
        // Errors before the welcome end the attempt; a refused rejoin after a dropped
        // connection (the sky filled up meanwhile) ends it too. Once in, they are informational.
        if (s.status === 'connecting') fail(msg.code)
        else if (s.status === 'reconnecting') fail('DISCONNECTED')
        return
    }
  }

  return {
    ...IDLE,
    error: null,
    errorMessage: null,
    playerName: loadName(),

    setPlayerName: (playerName) => {
      set({ playerName })
      try {
        globalThis.localStorage?.setItem(NAME_KEY, playerName)
      } catch {
        // storage blocked
      }
    },

    joinSky: (aircraftId) => {
      const name = cleanName(get().playerName)
      if (!name) return fail('BAD_NAME')
      const url = serverUrlOverride === undefined ? multiplayerServerUrl() : serverUrlOverride
      if (!url) return fail('NO_SERVER')
      client?.close()
      remotePoses.clear()
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
      c.start({ name, aircraftId })
    },

    leaveSky: () => {
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
    setBoardVisible: (boardVisible) => {
      if (get().boardVisible !== boardVisible) set({ boardVisible })
    },
    clearError: () => set((s) => ({ error: null, errorMessage: null, status: s.status === 'error' ? 'idle' : s.status })),
  }
})

/** True while this browser is in the shared sky (including a brief reconnect). */
export function inMultiplayer(): boolean {
  const { status } = useMultiplayerStore.getState()
  return status === 'inSky' || status === 'reconnecting'
}

/** Upload the local aircraft pose (throttled); a no-op outside the sky. */
export function sendLocalPose(pose: LocalPose): void {
  if (client && useMultiplayerStore.getState().status === 'inSky') client.sendPose(pose, now())
}

/** Tell the server this player respawned (restarts its collision grace window). */
export function sendRespawn(): void {
  client?.sendRespawn()
}

/** Fly online: Free Flight from the middle of the airport and runway the player picked. */
export function enterMultiplayerFlight(): void {
  useGameStore.getState().startFlight('freeFlight')
}

// Leaving the flight for any other screen (main menu, ...) leaves the sky.
useGameStore.subscribe((s, prev) => {
  if (s.screen === prev.screen || s.screen === 'multiplayer' || s.screen === 'flight' || s.screen === 'results') return
  const mp = useMultiplayerStore.getState()
  if (mp.status !== 'idle' && mp.status !== 'error') mp.leaveSky()
  else if (mp.connectionLost) useMultiplayerStore.setState({ connectionLost: false, crashReason: null })
})
