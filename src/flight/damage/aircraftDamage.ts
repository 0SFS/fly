import type { DamageImplementation } from "@0sfs/multiplayer/sharedSettings";
import { createAircraftHealth, type AircraftHealthSnapshot, type HealthImpact } from "./aircraftHealth";

export type AircraftDamageSnapshot = Omit<AircraftHealthSnapshot, "model"> & { model: "off" | "health" };

/** Select a retained model explicitly; changing model starts a fresh damage life. */
export function createAircraftDamage(initialHealth = 100, initialImplementation: DamageImplementation = "health-v1") {
  if (initialImplementation !== "off-v1" && initialImplementation !== "health-v1") throw new Error("Unsupported damage implementation.");
  const health = createAircraftHealth(initialHealth);
  let implementation = initialImplementation;
  return {
    setImplementation(next: DamageImplementation): boolean {
      if (next !== "off-v1" && next !== "health-v1") throw new Error("Unsupported damage implementation.");
      if (next === implementation) return false;
      implementation = next; health.reset(); return true;
    },
    applyImpact(impact: HealthImpact) { return implementation === "health-v1" && health.applyImpact(impact); },
    reset() { health.reset(); },
    get implementation() { return implementation; },
    snapshot(): AircraftDamageSnapshot {
      return implementation === "health-v1" ? health.snapshot()
        : { model: "off", health: 100, maxHealth: 100, destroyed: false };
    },
  };
}
