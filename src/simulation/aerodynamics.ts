/**
 * Aerodynamic coefficient model (pure functions, no state).
 *
 * CL(alpha): linear up to the critical AoA and held at CLmax beyond it, then
 * blended (smoothstep over stallBlendDeg) into flat-plate lift k sin(2 alpha).
 * The critical AoA grows with the slats (first flap detent).
 * CD = CD0 + flaps + (1 - s) k_i CL^2 (ground effect reduces it)
 *      + s (k_i CLmax^2 + flat-plate drag k sin^2 alpha) + compressibility(M).
 */

import type { AeroConfig, CompressibilityConfig } from '../config/aircraft'
import { DEG2RAD, clamp, smoothstep } from './math'

type Aero = AeroConfig

/** Lift-effect shape of the flap fraction: the first notch gives the most. */
export function flapShape(flapFraction: number): number {
  const f = clamp(flapFraction, 0, 1)
  return 1 - (1 - f) * (1 - f)
}

/** Slat extension 0..1: fully out from the first detent (lever 1/3). */
export function slatFraction(flapFraction: number): number {
  return clamp(flapFraction * 3, 0, 1)
}

/** Positive critical AoA (deg) for this flap / slat setting. */
export function criticalAlphaDeg(flapFraction: number, aero: Aero): number {
  return aero.slatAlphaCritDeg > 0 ? aero.alphaCritDeg + aero.slatAlphaCritDeg * slatFraction(flapFraction) : aero.alphaCritDeg
}

/** 0 = attached flow, 1 = fully stalled (flat plate). `critDeg` defaults to the clean critical AoA. */
export function stallBlend(alpha: number, aero: Aero, critDeg: number = aero.alphaCritDeg): number {
  const crit = critDeg * DEG2RAD
  const critNeg = aero.alphaCritNegDeg * DEG2RAD
  const width = aero.stallBlendDeg * DEG2RAD
  if (alpha > crit) return smoothstep(crit, crit + width, alpha)
  if (alpha < critNeg) return smoothstep(-critNeg, -critNeg + width, -alpha)
  return 0
}

/** Transonic / supersonic drag increment (see CompressibilityConfig). */
export function compressibilityDrag(mach: number, c: CompressibilityConfig | null): number {
  if (c === null || !(mach > c.mcrit)) return 0
  if (mach <= c.mpeak) {
    const x = (mach - c.mcrit) / (c.mpeak - c.mcrit)
    return c.cdPeak * Math.pow(x, c.exponent)
  }
  const m = Math.min(mach, 10)
  return c.cdSupersonic + (c.cdPeak - c.cdSupersonic) * Math.exp(-(m - c.mpeak) / c.decay)
}

/** Induced-drag factor multiplier with Mach (1 when subsonic or incompressible). */
export function inducedMachFactor(mach: number, c: CompressibilityConfig | null): number {
  if (c === null || c.inducedMachGain === 0 || !(mach > 0.9)) return 1
  return 1 + c.inducedMachGain * (Math.min(mach, 10) - 0.9)
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
 * @param mach Mach number (0 = incompressible)
 */
export function aeroCoefficients(
  alpha: number,
  flapFraction: number,
  groundEffect: number,
  aero: Aero,
  out: AeroCoefficients,
  mach = 0,
): AeroCoefficients {
  const critDeg = criticalAlphaDeg(flapFraction, aero)
  const crit = critDeg * DEG2RAD
  const critNeg = aero.alphaCritNegDeg * DEG2RAD
  const flapCl = aero.flapCl * flapShape(flapFraction)
  const aAttached = clamp(alpha, critNeg, crit)
  const clAttached = aero.cl0 + flapCl + aero.clAlpha * aAttached
  const s = stallBlend(alpha, aero, critDeg)
  const sina = Math.sin(alpha)
  const clFlat = aero.flatPlateLift * Math.sin(2 * alpha)
  const ge = clamp(groundEffect, 0, 1)
  const cl = ((1 - s) * clAttached + s * clFlat) * (1 + aero.groundEffectLift * ge)

  const comp = aero.compressibility
  const induced = aero.inducedK * inducedMachFactor(mach, comp) * clAttached * clAttached
  const cd =
    aero.cd0 +
    aero.flapCd * clamp(flapFraction, 0, 1) +
    (1 - s) * induced * (1 - aero.groundEffectInducedDrag * ge) +
    s * (induced + aero.flatPlateDrag * sina * sina) +
    compressibilityDrag(mach, comp)

  out.cl = cl
  out.cd = cd
  out.stall = s
  return out
}

/** Convenience wrapper (allocates) for tests and tools: free-air CL. */
export function liftCoefficient(alpha: number, flapFraction: number, aero: Aero): number {
  return aeroCoefficients(alpha, flapFraction, 0, aero, { cl: 0, cd: 0, stall: 0 }).cl
}
