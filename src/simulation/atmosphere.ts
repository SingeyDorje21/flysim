/** International Standard Atmosphere (troposphere), pure functions. */

export const SEA_LEVEL_DENSITY = 1.225
export const SEA_LEVEL_TEMPERATURE = 288.15
export const GRAVITY = 9.80665

/** Air density (kg/m^3) at geometric altitude h (m). Clamped to -500..11000 m. */
export function airDensity(altitude: number): number {
  const h = Number.isFinite(altitude) ? Math.min(11000, Math.max(-500, altitude)) : 0
  return SEA_LEVEL_DENSITY * Math.pow(1 - 2.25577e-5 * h, 4.2559)
}
