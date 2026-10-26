/** Shared lifecycle for damage models. Each model owns its impact and state types. */
export interface AircraftDamageModel<Impact, State> {
  readonly id: string;
  applyImpact(impact: Impact): boolean;
  reset(): void;
  snapshot(): State;
}

export const AIRCRAFT_MAX_HEALTH = 100;

export interface HealthImpact {
  /** Gameplay points, not joules or a fraction of a physical component. */
  points: number;
}

export interface AircraftHealthSnapshot {
  model: "health";
  health: number;
  maxHealth: number;
  destroyed: boolean;
}

export type DamageAction = { type: "test-hit" } | { type: "repair" };

/** The cheapest damage model: one pool for the entire aircraft, updated only on hits. */
export function createAircraftHealth(initialHealth = AIRCRAFT_MAX_HEALTH): AircraftDamageModel<HealthImpact, AircraftHealthSnapshot> {
  if (!Number.isFinite(initialHealth) || initialHealth < 0 || initialHealth > AIRCRAFT_MAX_HEALTH) {
    throw new RangeError("Aircraft health must be between 0 and 100.");
  }
  let health = initialHealth;
  return {
    id: "health",
    applyImpact({ points }) {
      // Invalid or negative damage must never heal an aircraft.
      if (!Number.isFinite(points) || points <= 0 || health === 0) return false;
      health = Math.max(0, health - points);
      return true;
    },
    reset() { health = AIRCRAFT_MAX_HEALTH; },
    snapshot: () => ({ model: "health", health, maxHealth: AIRCRAFT_MAX_HEALTH, destroyed: health === 0 }),
  };
}
