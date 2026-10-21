/**
 * Aerodynamic coefficient model (pure functions, no state).
 *
 * CL(alpha): linear up to the critical AoA and held at CLmax beyond it, then
 * blended (smoothstep over stallBlendDeg) into flat-plate lift k sin(2 alpha).
 * CD = CD0 + flaps + (1 - s) k_i CL^2 (ground effect reduces it)
 *      + s (k_i CLmax^2 + flat-plate drag k sin^2 alpha).
 */

import type { AircraftConfig } from '../config/aircraft'
import { DEG2RAD, clamp, smoothstep } from './math'

type Aero = AircraftConfig['aero']

/** Lift-effect shape of the flap fraction: the first notch gives the most. */
export function flapShape(flapFraction: number): number {
  const f = clamp(flapFraction, 0, 1)
  return 1 - (1 - f) * (1 - f)
}

/** 0 = attached flow, 1 = fully stalled (flat plate). */
export function stallBlend(alpha: number, aero: Aero): number {
  const crit = aero.alphaCritDeg * DEG2RAD
  const critNeg = aero.alphaCritNegDeg * DEG2RAD
  const width = aero.stallBlendDeg * DEG2RAD
  if (alpha > crit) return smoothstep(crit, crit + width, alpha)
  if (alpha < critNeg) return smoothstep(-critNeg, -critNeg + width, -alpha)
  return 0
}

export interface AeroCoefficients {
  cl: number
  cd: number
  /** Stall blend 0..1. */
  stall: number
}

/**
 * Lift and drag coefficients.
 * @param groundEffect 0 (free air) .. 1 (wing on the ground)
 */
export function aeroCoefficients(
  alpha: number,
  flapFraction: number,
  groundEffect: number,
  aero: Aero,
  out: AeroCoefficients,
): AeroCoefficients {
  const crit = aero.alphaCritDeg * DEG2RAD
  const critNeg = aero.alphaCritNegDeg * DEG2RAD
  const flapCl = aero.flapCl * flapShape(flapFraction)
  const aAttached = clamp(alpha, critNeg, crit)
  const clAttached = aero.cl0 + flapCl + aero.clAlpha * aAttached
  const s = stallBlend(alpha, aero)
  const sina = Math.sin(alpha)
  const clFlat = aero.flatPlateLift * Math.sin(2 * alpha)
  const ge = clamp(groundEffect, 0, 1)
  const cl = ((1 - s) * clAttached + s * clFlat) * (1 + aero.groundEffectLift * ge)

  const induced = aero.inducedK * clAttached * clAttached
  const cd =
    aero.cd0 +
    aero.flapCd * clamp(flapFraction, 0, 1) +
    (1 - s) * induced * (1 - aero.groundEffectInducedDrag * ge) +
    s * (induced + aero.flatPlateDrag * sina * sina)

  out.cl = cl
  out.cd = cd
  out.stall = s
  return out
}

/** Convenience wrapper (allocates) for tests and tools: free-air CL. */
export function liftCoefficient(alpha: number, flapFraction: number, aero: Aero): number {
  return aeroCoefficients(alpha, flapFraction, 0, aero, { cl: 0, cd: 0, stall: 0 }).cl
}
