import { Vector3 } from 'three'

/** Direction towards the sun (unit vector). South-east, fairly high. */
export const SUN_DIR = new Vector3(0.5, 0.72, 0.48).normalize()

export const HORIZON_COLOR = 0xbcd6ea
export const ZENITH_COLOR = 0x3f78c4
export const SKY_RADIUS = 30000
