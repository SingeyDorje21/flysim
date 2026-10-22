/**
 * Autopilot contracts shared by the controller, the session and the panel.
 * Values are SI (m/s, m); headings in degrees true.
 */

/** Selected targets, as dialled on the autopilot panel. */
export interface AutopilotTargets {
  /** Airspeed held by the autothrust (m/s). */
  speed: number
  /** 0..360 */
  headingDeg: number
  /** Selected altitude (m above sea level). */
  altitude: number
  /** Selected vertical speed for V/S mode (m/s, + = climb). */
  verticalSpeed: number
}

/**
 * ALT: climb or descend to the selected altitude and hold it.
 * VS: fly the selected vertical speed; captures the selected altitude on the way.
 */
export type VerticalMode = 'ALT' | 'VS'

export type TargetField = keyof AutopilotTargets

/** What the pilot asked for on the panel. */
export interface AutopilotCommand {
  ap: boolean
  athr: boolean
  vertical: VerticalMode
  targets: AutopilotTargets
}

/** Mode annunciation shown on the HUD (like an airliner's flight mode annunciator). */
export type VerticalAnnunciation = 'ALT' | 'ALT*' | 'CLB' | 'DES' | 'V/S'
