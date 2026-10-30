/** Key bindings shown in the HUD, the Controls panel and How It Works. Mirrors src/input. */

export interface Binding {
  action: string
  keys: string
}

export const FLIGHT_BINDINGS: readonly Binding[] = [
  { action: 'Pitch (nose down / up)', keys: 'W / S or Up / Down (invertible)' },
  { action: 'Roll left / right', keys: 'A / D or Left / Right' },
  { action: 'Rudder left / right', keys: 'Q / E' },
  { action: 'Throttle up / down', keys: 'R / F, PageUp / PageDown, = / -' },
  { action: 'Flaps extend / retract', keys: '] or X / [ or Z' },
  { action: 'Brakes (hold)', keys: 'B or Space' },
  { action: 'Landing gear up / down', keys: 'G' },
  { action: 'Speed brake toggle', keys: 'V' },
  { action: 'Reverse thrust (hold, on the ground)', keys: 'Y' },
  { action: 'Elevator trim nose up / down', keys: '. / ,' },
  { action: 'Landing assist: fly the approach to the runway ahead down to 100 ft, then hand over for the flare (press again to cancel)', keys: '0' },
]

/** F-22 afterburner has no key: it lights at full throttle. */
export const AFTERBURNER_NOTE = 'The F-22 afterburner engages automatically at full throttle (above 95%).'

export const VIEW_BINDINGS: readonly Binding[] = [
  { action: 'Camera cycle / direct', keys: 'C / 1, 2, 3' },
  { action: 'Pause', keys: 'Esc or P' },
  { action: 'Toggle HUD / instruments', keys: 'H / I' },
  { action: 'World map', keys: 'M' },
  { action: 'Multiplayer leaderboard', keys: 'L' },
]

export const ALL_BINDINGS: readonly Binding[] = [...FLIGHT_BINDINGS, ...VIEW_BINDINGS]

/** Compact [keys, action] pairs for the HUD command list. */
export const HUD_COMMANDS: readonly (readonly [string, string])[] = [
  ['W / S', 'Pitch'],
  ['A / D', 'Roll'],
  ['Q / E', 'Rudder'],
  ['R / F', 'Throttle'],
  ['X / Z', 'Flaps'],
  ['B', 'Brakes'],
  ['G', 'Gear'],
  ['V', 'Speed brk'],
  ['Y', 'Reverse'],
  ['. / ,', 'Trim'],
  ['0', 'Land assist'],
  ['C', 'Camera'],
  ['H / I', 'HUD / panel'],
  ['M', 'Map'],
  ['Esc', 'Pause'],
]
