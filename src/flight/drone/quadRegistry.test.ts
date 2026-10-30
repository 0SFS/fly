import { describe, expect, it } from "vitest";
import { getRegisteredEngine, registerEngine, unregisterEngine } from "@0sfs/engines/engineRegistry";
import type { QuadVehicleModData } from "@0sfs/mods/schema";
import common from "../../../../Quadcopter/public/0sfs-mod.json";
import dji from "../../../../DJI-Quadcopter/public/0sfs-mod.json";
import camera from "../../../../DJI-FC7303/public/0sfs-mod.json";
import mini from "../../../../DJI-Mini2/public/0sfs-mod.json";
import propulsion from "../../../../DJI-Mini2-propulsion/public/0sfs-mod.json";
import { buildDroneProfile } from "./droneTypes";
import { installQuadVehicle, quadProfile, setQuadProfileBuilder, installQuadCommon, installDjiCommon, installDroneCamera, uninstallQuadVehicle, quadAircraftIds, resolveQuadPropeller, uninstallQuadLayer } from "./quadRegistry";

const vehicle = mini.quad as QuadVehicleModData;

describe("quadcopter propulsion resolution", () => {
  it("takes the engine's physical propeller as the single source of truth", () => {
    expect(resolveQuadPropeller(vehicle)).toEqual(propulsion.engine.electric.propeller);
    expect(resolveQuadPropeller({ ...vehicle, propeller: { ...propulsion.engine.electric.propeller, radiusM: 10 } }).radiusM)
      .toBe(propulsion.engine.electric.propeller.radiusM);
  });
  it("keeps legacy inline airframe mods usable", () => {
    expect(resolveQuadPropeller({ ...vehicle, propulsionId: undefined, propeller: propulsion.engine.electric.propeller }))
      .toBe(propulsion.engine.electric.propeller);
  });
  it("fails explicitly for missing or combustion propulsion instead of falling back", () => {
    expect(() => resolveQuadPropeller({ ...vehicle, propulsionId: "missing" })).toThrow("not installed");
    registerEngine({ id: "test-piston", label: "test", summary: "test", type: "piston", jsbsimEngineFiles: [],
      rotorBlades: { outer: 2, inner: null, outerEstimated: false, innerEstimated: false },
      startSpeed: { property: "rpm", runningAt: 1 }, gauges: { primary: "rpm", secondary: null, label: "RPM" } });
    expect(() => resolveQuadPropeller({ ...vehicle, propulsionId: "test-piston" })).toThrow("not installed");
    expect(() => resolveQuadPropeller({ ...vehicle, propulsionId: undefined })).toThrow("needs an electric propulsionId");
    unregisterEngine("test-piston");
  });
  it("removes only the vehicles that depended on a removed propulsion mod", () => {
    installQuadCommon(common.quadcopter as Parameters<typeof installQuadCommon>[0]);
    installDjiCommon(dji.dji);
    installDroneCamera(camera.id, camera.camera);
    installQuadVehicle("test-kept-quad", "Kept quad", vehicle);
    registerEngine({ ...propulsion.engine, type: "electric", id: "test-electric" });
    installQuadVehicle("test-electric-quad", "Test quad", { ...vehicle, propulsionId: "test-electric" });
    expect(quadAircraftIds()).toContain("test-electric-quad");
    uninstallQuadLayer("example/propulsion", "test-electric");
    unregisterEngine("test-electric");
    expect(quadAircraftIds()).not.toContain("test-electric-quad");
    expect(quadAircraftIds()).toContain("test-kept-quad");
    uninstallQuadVehicle("test-kept-quad");
  });
  it("restores an electric engine shadow without dropping its airframe or retaining cached physics", () => {
    const engine = { ...propulsion.engine, type: "electric" as const, id: "test-shadow-electric" };
    const shadow = { ...engine, electric: { propeller: { ...engine.electric.propeller, radiusM: 0.05 } } };
    installQuadCommon(common.quadcopter as Parameters<typeof installQuadCommon>[0]);
    installDjiCommon(dji.dji);
    installDroneCamera(camera.id, camera.camera);
    setQuadProfileBuilder(buildDroneProfile);
    registerEngine(engine, "baseline");
    installQuadVehicle("test-shadow-quad", "Shadow quad", { ...vehicle, propulsionId: engine.id });
    try {
      const baseline = quadProfile("test-shadow-quad")!;
      expect(baseline.propeller).toBe(engine.electric.propeller);
      registerEngine(shadow, "local:pilot/engine");
      const overridden = quadProfile("test-shadow-quad")!;
      expect(overridden).not.toBe(baseline);
      expect(overridden.propeller.radiusM).toBe(0.05);
      unregisterEngine(engine.id, "local:pilot/engine");
      const lostPropulsion = getRegisteredEngine(engine.id) ? undefined : engine.id;
      uninstallQuadLayer("pilot/engine", lostPropulsion);
      expect(quadAircraftIds()).toContain("test-shadow-quad");
      const restored = quadProfile("test-shadow-quad")!;
      expect(restored).not.toBe(overridden);
      expect(restored.propeller).toBe(engine.electric.propeller);
      unregisterEngine(engine.id, "baseline");
      uninstallQuadLayer("baseline", getRegisteredEngine(engine.id) ? undefined : engine.id);
      expect(quadAircraftIds()).not.toContain("test-shadow-quad");
    } finally {
      unregisterEngine(engine.id, "local:pilot/engine");
      unregisterEngine(engine.id, "baseline");
      uninstallQuadVehicle("test-shadow-quad");
    }
  });
});
