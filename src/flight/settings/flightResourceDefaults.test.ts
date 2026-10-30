import { describe, expect, it } from "vitest";
import { createSettingsRegistry, FOSS_EARTH_PARAMETERS } from "foss-earth/settings";
import { applyFlightResourceDefaults } from "./flightResourceDefaults";
function settings() {
  const registry = createSettingsRegistry({ storage: null, deviceContext: { deviceMemoryGiB: 16, hardwareConcurrency: 10,
    rendererMode: "webgl2", maxTextureSize: 16384 } });
  registry.register(FOSS_EARTH_PARAMETERS);
  return registry;
}
describe("flight resource defaults", () => {
  it("bounds the flight working set independently of reported physical RAM", () => {
    const registry = settings(); const effective = applyFlightResourceDefaults(registry);
    expect(effective["map.terrain.tileSegments"]).toBe(32);
    expect(registry.get("map.imagery.gpuBudget")).toBe(32);
    expect(registry.get("map.source.elevation")).toBe("aws-terrarium");
    expect(registry.get("map.imagery.pageTablePatches")).toBe(256);
    expect(registry.get("map.terrain.maxTiles")).toBe(256);
    registry.setDeviceContext({ deviceMemoryGiB: 64 });
    expect(registry.get("map.imagery.gpuBudget")).toBe(32);
    expect(registry.get("wasm.workers")).toBe(6);
    expect(registry.get("wasm.core.terrain")).toBe("auto");
    expect(registry.get("wasm.threads")).toBe(1);
    expect(registry.get("map.loader.requests")).toBe(2);
    expect(registry.get("map.loader.cacheEntries")).toBe(32);
    expect(registry.get("map.terrain.cachedTiles")).toBe(32);
  });
  it("preserves explicit larger settings across reapplication and device-context changes", () => {
    const registry = settings();
    expect(registry.set("map.imagery.gpuBudget", 256)).toEqual({ ok: true });
    expect(registry.set("map.terrain.maxTiles", 384)).toEqual({ ok: true });
    expect(registry.set("wasm.workers", 12)).toEqual({ ok: true });
    applyFlightResourceDefaults(registry);
    registry.setDeviceContext({ deviceMemoryGiB: 1 }); applyFlightResourceDefaults(registry);
    expect(registry.get("map.imagery.gpuBudget")).toBe(256);
    expect(registry.get("map.terrain.maxTiles")).toBe(384);
    expect(registry.get("wasm.workers")).toBe(12);
    expect(registry.set("map.imagery.gpuBudget", 512)).toEqual({ ok: true });
    applyFlightResourceDefaults(registry);
    expect(registry.get("map.imagery.gpuBudget")).toBe(512);
    registry.reset("map.imagery.gpuBudget"); expect(registry.get("map.imagery.gpuBudget")).toBe(32);
    registry.set("map.source.elevation", "mapterhorn");
    registry.set("wasm.core.terrain", "single");
    applyFlightResourceDefaults(registry);
    expect(registry.get("map.source.elevation")).toBe("mapterhorn");
    expect(registry.get("wasm.core.terrain")).toBe("single");
  });
});
