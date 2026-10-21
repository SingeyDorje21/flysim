/**
 * Physical layout of the aircraft in BODY coordinates (metres, origin at the
 * CG, +X right, +Y up, +Z tail; see src/simulation/types.ts).
 *
 * Shared contract: physics uses the contact and strike points, the renderer
 * builds the mesh around the same numbers so wheels touch the ground exactly
 * where physics says they do. Owned by the orchestrator.
 */

import type { Vec3 } from '../simulation/types'

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

export const AIRCRAFT_GEOMETRY = {
  /** Low-wing, single-engine, fixed tricycle gear trainer. */
  length: 8.0,
  wingspan: 11.0,

  fuselage: {
    noseZ: -3.2,
    tailZ: 4.8,
    /** Max cross-section half-width and half-height. */
    halfWidth: 0.6,
    halfHeight: 0.65,
    centreY: 0.05,
  },

  wing: {
    /** Root chord line height. */
    rootY: -0.4,
    leadingEdgeZ: -0.6,
    chord: 1.5,
    span: 11.0,
    dihedralDeg: 5,
    area: 16.2,
  },

  horizontalTail: { y: 0.1, leadingEdgeZ: 3.85, chord: 0.9, span: 3.6 },
  verticalTail: { baseY: 0.3, leadingEdgeZ: 3.7, chord: 1.0, height: 1.4 },

  /** Hinge lines for animated surfaces. Chord = movable surface chord. */
  surfaces: {
    elevator: { hingeZ: 4.4, y: 0.1, halfSpan: 1.8, chord: 0.35 },
    rudder: { hingeZ: 4.4, baseY: 0.3, height: 1.4, chord: 0.35 },
    /** |x| range along the span. */
    aileron: { hingeZ: 0.55, innerX: 3.2, outerX: 5.3, chord: 0.35 },
    flap: { hingeZ: 0.55, innerX: 0.7, outerX: 3.2, chord: 0.35 },
  },

  /** Wheel bottoms (ground contact points). */
  gear: {
    mainLeft: v(-1.2, -1.3, 0.4),
    mainRight: v(1.2, -1.3, 0.4),
    nose: v(0, -1.3, -2.3),
    wheelRadius: 0.25,
  },

  /** Parts that end the flight if they touch the ground. */
  strikePoints: {
    // Underside of the drawn tail cone: strikes at ~17 deg nose-up on the mains.
    tail: v(0, -0.08, 4.6),
    leftWingtip: v(-5.5, 0.08, 0.15),
    rightWingtip: v(5.5, 0.08, 0.15),
    propTip: v(0, -0.95, -3.35),
    belly: v(0, -0.6, -0.5),
  },

  propeller: { hub: v(0, 0, -3.35), diameter: 1.9, blades: 2 },

  /** Pilot eye point for the cockpit camera. */
  eyePoint: v(-0.3, 0.55, -0.6),
} as const

/** CG height above the ground when parked level on the gear. */
export const CG_HEIGHT_ON_GEAR = -AIRCRAFT_GEOMETRY.gear.mainLeft.y
