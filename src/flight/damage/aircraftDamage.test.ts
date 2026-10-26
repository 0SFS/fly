import { expect, it } from "vitest";
import { createAircraftDamage } from "./aircraftDamage";

it("keeps damage state within a model and resets only on an explicit implementation change", () => {
  const damage = createAircraftDamage();
  damage.applyImpact({ points: 75 });
  expect(damage.setImplementation("health-v1")).toBe(false);
  expect(damage.snapshot().health).toBe(25);
  expect(damage.setImplementation("off-v1")).toBe(true);
  expect(damage.applyImpact({ points: 1000 })).toBe(false);
  expect(damage.snapshot()).toMatchObject({ model: "off", health: 100, destroyed: false });
  damage.setImplementation("health-v1");
  expect(damage.snapshot()).toMatchObject({ model: "health", health: 100, destroyed: false });
});
