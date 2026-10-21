import type { GameMode } from './types'

export interface GameModeInfo {
  id: GameMode
  name: string
  tagline: string
  description: string
  objectives: string[]
  /** Seconds, or null for unlimited. */
  timeLimit: number | null
}

export const GAME_MODES: readonly GameModeInfo[] = [
  {
    id: 'freeFlight',
    name: 'Free Flight',
    tagline: 'Explore the island at your own pace',
    description:
      'Start on runway 36 with the engine idling. Take off, explore the island and land wherever you dare. No time limit.',
    objectives: ['No objectives - just fly', 'The flight ends only if you crash or quit'],
    timeLimit: null,
  },
  {
    id: 'takeoff',
    name: 'Take-off Challenge',
    tagline: 'Get airborne and climb out cleanly',
    description:
      'Line up on runway 36 with one notch of flaps. Apply full power, rotate at around 55 knots and climb to 500 ft above the ground.',
    objectives: [
      'Stay on the runway until you lift off',
      'Climb to 500 ft (150 m) above the ground',
      'Bonus: keep the wings within 30 degrees of level and stay on the centreline',
    ],
    timeLimit: 120,
  },
  {
    id: 'landing',
    name: 'Landing Challenge',
    tagline: 'Bring it down gently on runway 36',
    description:
      'You are on a 3-degree final approach, 2 miles out. Land on the runway, ideally near the aiming point, and stop on the paved surface.',
    objectives: [
      'Touch down on the runway - a sink rate over ~4.5 m/s (900 ft/min) is a crash',
      'Come to a complete stop on the runway',
      'Bonus: gentle touchdown near the aiming point, on the centreline',
    ],
    timeLimit: 240,
  },
  {
    id: 'rings',
    name: 'Ring Course',
    tagline: 'Thread the needle through every ring',
    description:
      'Start airborne south of the airport and fly through each ring in order. The next ring is highlighted. Fastest time wins.',
    objectives: ['Fly through every ring in order', 'Do not crash', 'Finish before the time runs out'],
    timeLimit: 360,
  },
]

export function getModeInfo(mode: GameMode): GameModeInfo {
  const info = GAME_MODES.find((m) => m.id === mode)
  if (!info) throw new Error(`Unknown game mode: ${mode}`)
  return info
}
