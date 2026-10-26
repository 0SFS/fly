import { describe, expect, it } from "vitest";
import { createAircraftHealth } from "./aircraftHealth";

describe("whole-aircraft health", () => {
  it("accumulates hits, clamps lethal damage, and stays destroyed until reset", () => {
    const model = createAircraftHealth();
    model.applyImpact({ points: 25 });
    model.applyImpact({ points: 12.5 });
    expect(model.snapshot()).toMatchObject({ health: 62.5, destroyed: false });
    expect(model.applyImpact({ points: 1000 })).toBe(true);
    expect(model.snapshot()).toMatchObject({ health: 0, destroyed: true });
    expect(model.applyImpact({ points: 25 })).toBe(false);
    model.reset();
    expect(model.snapshot()).toEqual({ model: "health", health: 100, maxHealth: 100, destroyed: false });
  });

  it("rejects invalid damage and never exposes mutable live state", () => {
    const model = createAircraftHealth(50);
    for (const points of [-25, 0, NaN, Infinity, -Infinity]) {
      expect(model.applyImpact({ points })).toBe(false);
    }
    const snapshot = model.snapshot();
    snapshot.health = 100;
    expect(model.snapshot().health).toBe(50);
    for (const initial of [-1, 101, NaN, Infinity]) expect(() => createAircraftHealth(initial)).toThrow(RangeError);
  });
});
