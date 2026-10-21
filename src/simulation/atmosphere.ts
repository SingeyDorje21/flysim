/**
 * International Standard Atmosphere, pure functions (no allocation).
 *
 *  - Troposphere (-500 .. 11 000 m): temperature falls 6.5 K/km.
 *  - Lower stratosphere (11 000 .. 20 000 m): isothermal 216.65 K, pressure
 *    and density decay exponentially.
 *  - Above 20 km the isothermal layer is simply continued (the sim clamps
 *    at 30 km); the true ISA warms again above 20 km, which no aircraft
 *    here reaches in level flight.
 *
 * Geometric altitude is used as geopotential altitude (< 0.3 % error at 20 km).
 */

export const SEA_LEVEL_DENSITY = 1.225
export const SEA_LEVEL_TEMPERATURE = 288.15
export const SEA_LEVEL_PRESSURE = 101_325
export const GRAVITY = 9.80665
/** Specific gas constant of dry air (J / kg K). */
export const GAS_CONSTANT_AIR = 287.05287
/** Ratio of specific heats of air. */
export const GAMMA_AIR = 1.4

const LAPSE_RATE = 0.0065
const TROPOPAUSE = 11_000
const TROPOPAUSE_TEMPERATURE = SEA_LEVEL_TEMPERATURE - LAPSE_RATE * TROPOPAUSE // 216.65 K
const PRESSURE_EXPONENT = GRAVITY / (LAPSE_RATE * GAS_CONSTANT_AIR) // 5.2559
const TROPOPAUSE_PRESSURE_RATIO = Math.pow(TROPOPAUSE_TEMPERATURE / SEA_LEVEL_TEMPERATURE, PRESSURE_EXPONENT)
const TROPOPAUSE_DENSITY_RATIO = Math.pow(TROPOPAUSE_TEMPERATURE / SEA_LEVEL_TEMPERATURE, PRESSURE_EXPONENT - 1)
const STRATO_SCALE = GRAVITY / (GAS_CONSTANT_AIR * TROPOPAUSE_TEMPERATURE)

/** Altitude range the model is evaluated over (m). */
export const ATMOSPHERE_MIN_ALTITUDE = -500
export const ATMOSPHERE_MAX_ALTITUDE = 30_000

function clampAltitude(altitude: number): number {
  if (!Number.isFinite(altitude)) return 0
  return altitude < ATMOSPHERE_MIN_ALTITUDE ? ATMOSPHERE_MIN_ALTITUDE : altitude > ATMOSPHERE_MAX_ALTITUDE ? ATMOSPHERE_MAX_ALTITUDE : altitude
}

/** Static air temperature (K). */
export function airTemperature(altitude: number): number {
  const h = clampAltitude(altitude)
  return h < TROPOPAUSE ? SEA_LEVEL_TEMPERATURE - LAPSE_RATE * h : TROPOPAUSE_TEMPERATURE
}

/** Density ratio rho / rho0. */
export function densityRatio(altitude: number): number {
  const h = clampAltitude(altitude)
  if (h < TROPOPAUSE) return Math.pow(1 - (LAPSE_RATE / SEA_LEVEL_TEMPERATURE) * h, PRESSURE_EXPONENT - 1)
  return TROPOPAUSE_DENSITY_RATIO * Math.exp(-STRATO_SCALE * (h - TROPOPAUSE))
}

/** Air density (kg/m^3). */
export function airDensity(altitude: number): number {
  return SEA_LEVEL_DENSITY * densityRatio(altitude)
}

/** Static pressure (Pa). */
export function airPressure(altitude: number): number {
  const h = clampAltitude(altitude)
  if (h < TROPOPAUSE) return SEA_LEVEL_PRESSURE * Math.pow(1 - (LAPSE_RATE / SEA_LEVEL_TEMPERATURE) * h, PRESSURE_EXPONENT)
  return SEA_LEVEL_PRESSURE * TROPOPAUSE_PRESSURE_RATIO * Math.exp(-STRATO_SCALE * (h - TROPOPAUSE))
}

/** Speed of sound (m/s). 340.3 at sea level, 295.1 in the stratosphere. */
export function speedOfSound(altitude: number): number {
  return Math.sqrt(GAMMA_AIR * GAS_CONSTANT_AIR * airTemperature(altitude))
}
