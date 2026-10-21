/**
 * Flight-model parameters per aircraft type. The schema lives in
 * ./aircraft/types.ts, one file per type in ./aircraft/.
 *
 * GAME WEIGHTS (documented in each file):
 *   trainer     1,100 kg  (MTOW)
 *   f22        29,400 kg  (empty + ~8 t internal fuel + air-to-air load)
 *   a220       56,720 kg  (80 % of 70,900 kg MTOW)
 *   a350      226,400 kg  (80 % of 283,000 kg MTOW)
 *   global8000 41,680 kg  (80 % of 52,100 kg MTOW)
 */

import type { AircraftId } from './aircraftCatalog'
import { A220_CONFIG } from './aircraft/a220'
import { A350_CONFIG } from './aircraft/a350'
import { F22_CONFIG } from './aircraft/f22'
import { GLOBAL8000_CONFIG } from './aircraft/global8000'
import { TRAINER_CONFIG } from './aircraft/trainer'
import type { AircraftConfig } from './aircraft/types'

export type {
  AeroConfig,
  AfterburnerConfig,
  AircraftConfig,
  CompressibilityConfig,
  EngineConfig,
  FbwConfig,
  GroundSurfaceFriction,
  PistonEngineConfig,
  ReverserConfig,
  SpeedbrakeConfig,
  ThrustLapse,
  ThrustVectorConfig,
  TurbofanEngineConfig,
} from './aircraft/types'
export { gearSprings, inertiaFromGyration } from './aircraft/types'
export { A220_CONFIG, A350_CONFIG, F22_CONFIG, GLOBAL8000_CONFIG, TRAINER_CONFIG }

/** The light trainer (the Phase 1 aircraft). */
export const DEFAULT_AIRCRAFT = TRAINER_CONFIG

export const AIRCRAFT_CONFIGS: Readonly<Record<AircraftId, AircraftConfig>> = {
  trainer: TRAINER_CONFIG,
  f22: F22_CONFIG,
  a220: A220_CONFIG,
  a350: A350_CONFIG,
  global8000: GLOBAL8000_CONFIG,
}

export function getAircraftConfig(id: AircraftId): AircraftConfig {
  const c = AIRCRAFT_CONFIGS[id]
  if (!c) throw new Error(`Unknown aircraft: ${id}`)
  return c
}
