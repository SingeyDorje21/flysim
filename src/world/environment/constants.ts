import { Color, LinearSRGBColorSpace, Vector3 } from 'three'
import type { TimeOfDay } from '../types'

/** Radius of the sky dome (m). It follows the camera, so it only needs to sit inside the camera far plane. */
export const SKY_RADIUS = 30000

/**
 * Everything the sky, lights, water and clouds need for one time of day.
 * Colours are 0xRRGGBB numbers in sRGB, the same as typed in a colour picker.
 * `fogColor` equals `horizonColor`, so the distance fades into the sky.
 */
export interface EnvironmentLook {
  fogColor: number
  horizonColor: number
  zenithColor: number
  /** Unit vector pointing towards the sun. +X is east. */
  sunDirection: Vector3
  sunColor: number
  sunIntensity: number
  hemiSkyColor: number
  hemiGroundColor: number
  hemiIntensity: number
  waterDeep: number
  waterShallow: number
  /** 0..1 brightness multiplier of the water body colour. */
  waterLight: number
  /** Diffuse colour of cloud puffs. */
  cloudColor: number
  /** Self-lit colour of cloud puffs: their shaded underside. */
  cloudShade: number
  cloudShadeIntensity: number
}

function dir(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z).normalize()
}

const LOOKS: Record<TimeOfDay, EnvironmentLook> = {
  // Low warm sun in the east, soft pink-gold horizon.
  morning: {
    fogColor: 0xe8c8b4,
    horizonColor: 0xe8c8b4,
    zenithColor: 0x5c86c4,
    sunDirection: dir(0.9, 0.26, -0.3),
    sunColor: 0xffc890,
    sunIntensity: 2.2,
    hemiSkyColor: 0xcdd6f0,
    hemiGroundColor: 0x6e6858,
    hemiIntensity: 0.95,
    waterDeep: 0x1b4f6e,
    waterShallow: 0x4f9ab0,
    waterLight: 0.8,
    cloudColor: 0xffe6d6,
    cloudShade: 0x9a8aa4,
    cloudShadeIntensity: 0.5,
  },
  // High white sun, blue sky.
  noon: {
    fogColor: 0xbcd6ea,
    horizonColor: 0xbcd6ea,
    zenithColor: 0x3f78c4,
    sunDirection: dir(0.15, 0.96, 0.22),
    sunColor: 0xfff6e8,
    sunIntensity: 2.6,
    hemiSkyColor: 0xcfe4ff,
    hemiGroundColor: 0x6c7a55,
    hemiIntensity: 1.15,
    waterDeep: 0x16618c,
    waterShallow: 0x3fa6b8,
    waterLight: 1,
    cloudColor: 0xffffff,
    cloudShade: 0x8394a8,
    cloudShadeIntensity: 0.55,
  },
  // Low orange sun in the west, deeper blue zenith.
  evening: {
    fogColor: 0xe8a878,
    horizonColor: 0xe8a878,
    zenithColor: 0x1f3f84,
    sunDirection: dir(-0.9, 0.22, 0.3),
    sunColor: 0xff9a50,
    sunIntensity: 2.0,
    hemiSkyColor: 0xa8b0d8,
    hemiGroundColor: 0x5a5048,
    hemiIntensity: 0.8,
    waterDeep: 0x143d5e,
    waterShallow: 0x46788e,
    waterLight: 0.7,
    cloudColor: 0xffc8a0,
    cloudShade: 0x6a5a88,
    cloudShadeIntensity: 0.5,
  },
}

/** The look for a time of day. Pure: the same input always returns the same object. */
export function environmentFor(t: TimeOfDay): EnvironmentLook {
  return LOOKS[t]
}

/**
 * A Color holding the hex digits as raw output values (no sRGB to linear
 * conversion). The sky and water shaders write final display values directly,
 * and scene fog is also mixed in display space, so the three agree exactly.
 */
export function displayColor(hex: number): Color {
  return new Color().setHex(hex, LinearSRGBColorSpace)
}
