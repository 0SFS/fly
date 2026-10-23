/**
 * The physics rate: how many fixed steps the native flight model takes per
 * simulated second. A flight has one rate. Its step, `1 / physicsHz`, goes to
 * the native model, the fixed-step loop and everything that consumes an
 * accepted step; a change applies to the next flight, never mid-flight.
 * Render FPS is separate: the display interpolates between accepted steps.
 *
 * Policy: 60 Hz by default, 30 Hz as a cheaper option still to be validated,
 * and 120 Hz only when chosen by hand: no preset, device heuristic or fallback
 * selects it (docs/proposals/g-vision-response-curves.md, "Physics-rate policy
 * for implementation").
 */
export const PHYSICS_RATES_HZ = [30, 60, 120] as const;
export type PhysicsHz = (typeof PHYSICS_RATES_HZ)[number];

/** The flight's rate when nothing else is saved. */
export const DEFAULT_PHYSICS_HZ = 60 satisfies PhysicsHz;

/**
 * The rate every flight ran at before the rate was a setting. Evidence,
 * fixtures and harnesses recorded then keep it by naming it, so none of them
 * moves to the new default without saying so.
 */
export const LEGACY_PHYSICS_HZ_120 = 120 satisfies PhysicsHz;
/** One step at {@link LEGACY_PHYSICS_HZ_120}. */
export const LEGACY_FIXED_DT_120 = 1 / LEGACY_PHYSICS_HZ_120;

/**
 * How far behind real time one update may catch up: the 50 ms that six
 * 120 Hz steps always gave. In whole steps: 2 at 30 Hz (66.7 ms), 3 at 60 Hz
 * and 6 at 120 Hz (50 ms each).
 */
export const CATCH_UP_HORIZON_MS = 50;

/** The settings registry's id for the saved rate. */
export const PHYSICS_RATE_PARAMETER_ID = "osfs.physics.rate";

export function isPhysicsHz(value: unknown): value is PhysicsHz {
  return (PHYSICS_RATES_HZ as readonly unknown[]).includes(value);
}

function checked(physicsHz: PhysicsHz): PhysicsHz {
  if (!isPhysicsHz(physicsHz)) throw new Error(`Unsupported physics rate ${String(physicsHz)} Hz; expected one of ${PHYSICS_RATES_HZ.join(", ")}.`);
  return physicsHz;
}

/** One fixed step, in seconds. */
export function physicsStepSeconds(physicsHz: PhysicsHz): number {
  return 1 / checked(physicsHz);
}

/** The most steps one update may take: the catch-up horizon in whole steps, rounded up. */
export function maxCatchUpSteps(physicsHz: PhysicsHz): number {
  // Integer milliseconds keep 60 Hz at exactly 3 steps (0.05 × 60 rounds up to 4 in binary).
  return Math.ceil(checked(physicsHz) * CATCH_UP_HORIZON_MS / 1000);
}

/** The saved rate, as the registry validated it. */
export function readPhysicsHz(parameters: { get(id: typeof PHYSICS_RATE_PARAMETER_ID): string }): PhysicsHz {
  const value = Number(parameters.get(PHYSICS_RATE_PARAMETER_ID));
  return checked(value as PhysicsHz);
}
