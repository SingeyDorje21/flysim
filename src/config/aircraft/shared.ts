/** Parameter blocks shared by several aircraft types. */

import type { FbwConfig, ThrustLapse } from './types'

const DEG = Math.PI / 180

/**
 * High-bypass turbofan thrust lapse: ~0.74 of static thrust at Mach 0.25
 * (rotation), ~0.62 at Mach 0.85; times sigma^0.75 with altitude, so about
 * 0.25 of static thrust at Mach 0.85 and 11 km.
 */
export const HIGH_BYPASS_LAPSE: ThrustLapse = { densityExponent: 0.75, m1: -1.3, m2: 1.0, m3: 0 }

/** Medium-bypass business-jet turbofan (GE Passport, BPR 5.6): slightly flatter lapse. */
export const MEDIUM_BYPASS_LAPSE: ThrustLapse = { densityExponent: 0.72, m1: -0.95, m2: 0.65, m3: 0 }

/**
 * Airbus-style normal law: 2.5 / -1 g, bank protection 67 deg (returns to
 * 33 deg when released), AoA protection (neutral stick holds alpha-prot,
 * full aft alpha-max, both below the stall), pitch attitude +30 / -15 deg,
 * nose-up overspeed protection above VMO / MMO.
 */
export const AIRLINER_FBW: FbwConfig = {
  pitchBandwidth: 1.5,
  rollBandwidth: 1.5,
  yawBandwidth: 1,
  maxPitchRate: 0.1,
  maxRollRate: 15 * DEG,
  maxPedalYawRate: 3 * DEG,
  nzMax: 2.5,
  nzMin: -1,
  pathHoldGain: 0.4,
  bankHoldGain: 0.8,
  bankCompensationDeg: 33,
  bankLimitDeg: 67,
  bankNeutralLimitDeg: 33,
  alphaProtMarginDeg: 4,
  alphaMaxMarginDeg: 2,
  alphaGain: 1,
  pitchLimitUpDeg: 30,
  pitchLimitDownDeg: -15,
  overspeedGain: 1.5,
  betaGain: 1,
  flightBlendTime: 3,
}
