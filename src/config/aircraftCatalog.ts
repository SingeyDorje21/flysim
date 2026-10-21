/**
 * The flyable aircraft. Shared contract, owned by the orchestrator.
 *
 * - `geometry` is the PHYSICS-relevant layout in body coordinates (metres,
 *   origin at the CG, +X right wing, +Y up, +Z tail, nose along -Z). Physics
 *   uses the gear and strike points; the 3D model must put its wheels and
 *   extremities exactly there and match length/wingspan.
 * - `specs` are published figures shown in the hangar (sources noted).
 * - `speeds` drive spawns, HUD hints and instrument scales (m/s). Approach
 *   and rotation speeds are not in the sources and are estimates.
 */

import type { Vec3 } from '../simulation/types'
import { AIRCRAFT_GEOMETRY } from './aircraftGeometry'

export type AircraftId = 'trainer' | 'f22' | 'a220' | 'a350' | 'global8000'

export const AIRCRAFT_IDS: readonly AircraftId[] = ['trainer', 'f22', 'a220', 'a350', 'global8000']

export type EngineKind = 'piston' | 'turbofan' | 'afterburningTurbofan'

export interface AircraftGeometry {
  length: number
  wingspan: number
  height: number
  wing: { area: number; meanChord: number; span: number }
  gear: { nose: Vec3; mainLeft: Vec3; mainRight: Vec3; wheelRadius: number; retractable: boolean }
  /** Points that end the flight if they touch the ground (tail, wingtips, engine pods, propeller...). */
  strikePoints: Record<string, Vec3>
  /** Pilot eye point for the cockpit camera. */
  eyePoint: Vec3
}

export interface AircraftSpeeds {
  /** 1 g stall, clean (m/s). */
  stallClean: number
  /** Rotation speed (m/s). */
  rotate: number
  /** Final approach speed (m/s). */
  approach: number
  /** Maximum operating speed near sea level (m/s), for the airspeed scale. */
  maxOperating: number
  /** Maximum operating Mach number, if limited by Mach. */
  maxMach: number | null
}

export interface AircraftInfo {
  id: AircraftId
  name: string
  manufacturer: string
  role: string
  engineKind: EngineKind
  engines: number
  /** One-line hangar description. */
  blurb: string
  /** Published figures for the hangar card (display strings). */
  specs: { label: string; value: string }[]
  speeds: AircraftSpeeds
  /** Runway length (m) needed for a comfortable take-off at game weight; shorter runways warn. */
  minRunway: number
  /** Flap lever setting (0..1) for take-off and landing spawns. */
  takeoffFlaps: number
  landingFlaps: number
  /** Chase camera distance behind and height above the CG (m). */
  camera: { chaseDistance: number; chaseHeight: number }
  geometry: AircraftGeometry
  /** Where the figures come from. */
  sources: string[]
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

const TRAINER_GEOMETRY: AircraftGeometry = {
  length: AIRCRAFT_GEOMETRY.length,
  wingspan: AIRCRAFT_GEOMETRY.wingspan,
  height: 2.7,
  wing: { area: AIRCRAFT_GEOMETRY.wing.area, meanChord: AIRCRAFT_GEOMETRY.wing.chord, span: AIRCRAFT_GEOMETRY.wing.span },
  gear: { ...AIRCRAFT_GEOMETRY.gear, retractable: false },
  strikePoints: { ...AIRCRAFT_GEOMETRY.strikePoints },
  eyePoint: AIRCRAFT_GEOMETRY.eyePoint,
}

export const AIRCRAFT: readonly AircraftInfo[] = [
  {
    id: 'trainer',
    name: 'FS-1 Trainer',
    manufacturer: 'FlySim',
    role: 'Light single-engine trainer',
    engineKind: 'piston',
    engines: 1,
    blurb: 'Forgiving piston trainer. Fits every runway on the island.',
    specs: [
      { label: 'Max take-off weight', value: '1,100 kg' },
      { label: 'Engine', value: '1 x 134 kW piston' },
      { label: 'Cruise', value: '110 kt' },
    ],
    speeds: { stallClean: 27, rotate: 28, approach: 33, maxOperating: 70, maxMach: null },
    minRunway: 500,
    takeoffFlaps: 1 / 3,
    landingFlaps: 1 / 3,
    camera: { chaseDistance: 14, chaseHeight: 3.5 },
    geometry: TRAINER_GEOMETRY,
    sources: ['Fictional trainer modelled on light single-engine aircraft'],
  },
  {
    id: 'f22',
    name: 'F-22 Raptor',
    manufacturer: 'Lockheed Martin',
    role: 'Fifth-generation air superiority fighter',
    engineKind: 'afterburningTurbofan',
    engines: 2,
    blurb: 'Supercruise, afterburner and thrust vectoring. Extremely agile, very fast.',
    specs: [
      { label: 'Length / span', value: '18.92 m / 13.56 m' },
      { label: 'Wing area', value: '78.04 m²' },
      { label: 'Empty / max take-off weight', value: '19,700 kg / 38,000 kg' },
      { label: 'Engines', value: '2 x F119: 120 kN dry, 160 kN with afterburner' },
      { label: 'Max speed', value: 'Mach 2.25 at altitude; supercruise Mach 1.76' },
      { label: 'Service ceiling', value: '65,000 ft' },
      { label: 'Thrust vectoring', value: '±20° pitch' },
      { label: 'g limits', value: '+9.0 / -3.0' },
    ],
    speeds: { stallClean: 62, rotate: 72, approach: 75, maxOperating: 410, maxMach: 2.25 },
    minRunway: 1200,
    takeoffFlaps: 0,
    landingFlaps: 0,
    camera: { chaseDistance: 26, chaseHeight: 6 },
    geometry: {
      length: 18.92,
      wingspan: 13.56,
      height: 5.08,
      wing: { area: 78.04, meanChord: 6.3, span: 13.56 },
      gear: { nose: v(0, -1.9, -6.3), mainLeft: v(-1.6, -1.9, 1.0), mainRight: v(1.6, -1.9, 1.0), wheelRadius: 0.4, retractable: true },
      strikePoints: {
        tail: v(0, -0.6, 7.5),
        leftWingtip: v(-6.78, -0.45, 3.2),
        rightWingtip: v(6.78, -0.45, 3.2),
        nose: v(0, -0.5, -9.9),
        belly: v(0, -1.0, 0),
      },
      eyePoint: v(0, 0.9, -6.0),
    },
    sources: ['https://en.wikipedia.org/wiki/Lockheed_Martin_F-22_Raptor (specifications)', 'Approach and rotate speeds, runway need: estimates'],
  },
  {
    id: 'a220',
    name: 'A220-300',
    manufacturer: 'Airbus',
    role: 'Narrow-body twin-engine airliner',
    engineKind: 'turbofan',
    engines: 2,
    blurb: 'Modern fly-by-wire narrow-body with geared turbofans. Needs a regional runway.',
    specs: [
      { label: 'Length / span', value: '38.71 m / 35.1 m' },
      { label: 'Wing area', value: '112.3 m²' },
      { label: 'Empty / max take-off weight', value: '37,080 kg / 70,900 kg' },
      { label: 'Engines', value: '2 x PW1500G, 98-108.5 kN' },
      { label: 'Cruise', value: 'Mach 0.78 typical, 0.82 max' },
      { label: 'Ceiling', value: '41,000 ft' },
      { label: 'Take-off / landing field', value: '1,900 m / 1,510 m' },
    ],
    speeds: { stallClean: 62, rotate: 72, approach: 67, maxOperating: 170, maxMach: 0.82 },
    minRunway: 1900,
    takeoffFlaps: 1 / 3,
    landingFlaps: 1,
    camera: { chaseDistance: 55, chaseHeight: 12 },
    geometry: {
      length: 38.7,
      wingspan: 35.1,
      height: 11.5,
      wing: { area: 112.3, meanChord: 3.6, span: 35.1 },
      gear: { nose: v(0, -3.3, -14.5), mainLeft: v(-3.35, -3.3, 1.5), mainRight: v(3.35, -3.3, 1.5), wheelRadius: 0.6, retractable: true },
      strikePoints: {
        tail: v(0, -1.2, 13),
        leftWingtip: v(-17.55, 0.7, 4.5),
        rightWingtip: v(17.55, 0.7, 4.5),
        leftEngine: v(-5.5, -2.7, -1.5),
        rightEngine: v(5.5, -2.7, -1.5),
        belly: v(0, -1.9, 0),
      },
      eyePoint: v(-0.5, 1.2, -15.5),
    },
    sources: ['https://en.wikipedia.org/wiki/Airbus_A220 (A220-300 specifications)', 'Approach and rotate speeds: estimates'],
  },
  {
    id: 'a350',
    name: 'A350-900',
    manufacturer: 'Airbus',
    role: 'Wide-body long-haul airliner',
    engineKind: 'turbofan',
    engines: 2,
    blurb: 'Heavy wide-body. Slow to react, long take-off roll: international airports only.',
    specs: [
      { label: 'Length / span', value: '67 m / 64.75 m' },
      { label: 'Wing area', value: '442 m²' },
      { label: 'Empty / max take-off weight', value: '115,700 kg / 283,000 kg' },
      { label: 'Engines', value: '2 x Trent XWB-84, 370 kN' },
      { label: 'Cruise', value: 'Mach 0.85 design; 903 km/h' },
      { label: 'Ceiling', value: '43,100 ft' },
      { label: 'Take-off / landing distance', value: '2,600 m / 2,000 m' },
    ],
    // Flown at MTOW (283 t), so the speeds are the heavy-weight estimates.
    speeds: { stallClean: 80, rotate: 80, approach: 76, maxOperating: 175, maxMach: 0.89 },
    minRunway: 2600,
    takeoffFlaps: 1 / 3,
    landingFlaps: 1,
    camera: { chaseDistance: 95, chaseHeight: 20 },
    geometry: {
      length: 66.8,
      wingspan: 64.75,
      height: 17.05,
      wing: { area: 442, meanChord: 7.4, span: 64.75 },
      gear: { nose: v(0, -5.0, -26.5), mainLeft: v(-5.3, -5.0, 2.2), mainRight: v(5.3, -5.0, 2.2), wheelRadius: 0.75, retractable: true },
      strikePoints: {
        tail: v(0, -1.0, 22),
        leftWingtip: v(-32.4, 1.5, 9),
        rightWingtip: v(32.4, 1.5, 9),
        leftEngine: v(-10.5, -4.1, -5),
        rightEngine: v(10.5, -4.1, -5),
        belly: v(0, -3.0, 0),
      },
      eyePoint: v(-0.6, 1.8, -27.5),
    },
    sources: ['https://en.wikipedia.org/wiki/Airbus_A350 (A350-900 specifications)', 'Approach and rotate speeds: estimates'],
  },
  {
    id: 'global8000',
    name: 'Global 8000',
    manufacturer: 'Bombardier',
    role: 'Ultra-long-range business jet',
    engineKind: 'turbofan',
    engines: 2,
    blurb: 'Fast business jet with rear-mounted engines. Short landings, Mach 0.95 top end.',
    specs: [
      { label: 'Length / span', value: '34 m / 32 m' },
      { label: 'Wing area', value: '116.5 m² (Global 7500 figure)' },
      { label: 'Basic operating / max take-off weight', value: '28,000 kg / 52,100 kg (Global 7500 figures)' },
      { label: 'Engines', value: '2 x GE Passport, 84.2 kN (+7%)' },
      { label: 'Speed', value: 'Mach 0.85 typical, 0.92 ultra-high; MMO 0.95' },
      { label: 'Ceiling', value: '51,000 ft' },
      { label: 'Take-off / landing distance', value: '1,760 m / 680 m' },
    ],
    speeds: { stallClean: 55, rotate: 64, approach: 57, maxOperating: 175, maxMach: 0.95 },
    minRunway: 1760,
    takeoffFlaps: 1 / 3,
    landingFlaps: 1,
    camera: { chaseDistance: 50, chaseHeight: 10 },
    geometry: {
      length: 33.8,
      wingspan: 31.7,
      height: 8.2,
      wing: { area: 116.5, meanChord: 3.9, span: 31.7 },
      gear: { nose: v(0, -2.3, -13.5), mainLeft: v(-1.9, -2.3, 1.6), mainRight: v(1.9, -2.3, 1.6), wheelRadius: 0.45, retractable: true },
      strikePoints: {
        tail: v(0, -0.6, 12),
        leftWingtip: v(-15.85, 0.4, 3.5),
        rightWingtip: v(15.85, 0.4, 3.5),
        belly: v(0, -1.4, 0),
      },
      eyePoint: v(-0.4, 0.9, -14.5),
    },
    sources: ['https://en.wikipedia.org/wiki/Bombardier_Global_7500 (Global 8000 / 7500 specifications)', 'Approach and rotate speeds: estimates'],
  },
]

export function getAircraft(id: AircraftId): AircraftInfo {
  const a = AIRCRAFT.find((x) => x.id === id)
  if (!a) throw new Error(`Unknown aircraft: ${id}`)
  return a
}
