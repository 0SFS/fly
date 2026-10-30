import { describe, expect, it, vi } from "vitest";
import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import { resetFlightLocation } from "./resetFlightLocation";
import { getFdmProfile } from "./fdmProfiles";

describe("resetFlightLocation", () => {
  function setup(success = true) {
    const values: Record<string, number> = {
      "position/lat-geod-deg": 1, "position/long-gc-deg": 2,
      "position/h-sl-ft": 10000, "velocities/vc-kts": 120, "attitude/psi-deg": 300,
      "fcs/throttle-cmd-norm": 0.65,
    };
    const sdk = {
      resetToInitialConditions: vi.fn(),
      getPropertyValue: (key: string) => values[key] ?? 0,
      setPropertyValue: vi.fn((key: string, value: number) => { values[key] = value; }),
      runIc: vi.fn(() => {
        values["position/lat-geod-deg"] = values["ic/lat-geod-deg"];
        values["position/long-gc-deg"] = values["ic/long-gc-deg"];
        return success;
      }),
    };
    return { ...sdk, values };
  }
  it("resets the loaded aircraft using geodetic latitude and retains altitude/speed", () => {
    const sdk = setup();
    const state = resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 46.7867, lonDeg: -92.1005 });
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/lat-geod-deg", 46.7867);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/long-gc-deg", -92.1005);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/h-sl-ft", 10000);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/vc-kts", 120);
    expect(sdk.runIc).toHaveBeenCalledTimes(2);
    expect(state).toMatchObject({ latDeg: 46.7867, lonDeg: -92.1005, altMeters: 3048 });
  });
  it("keeps a requested altitude below newly prepared terrain instead of silently raising it", () => {
    const sdk = setup();
    resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 45, lonDeg: -93, altMeters: 250 }, 400);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/h-sl-ft", 250 / 0.3048);
    // JSBSim does not start on that ground: its gear would begin 150 m compressed.
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/terrain-elevation-ft", (250 - 10_000) / 0.3048);
  });
  it("gives JSBSim the ground under an aircraft placed at or above its stance", () => {
    const sdk = setup();
    resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 45, lonDeg: -93, altMeters: 402 }, 400);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/h-sl-ft", 402 / 0.3048);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/terrain-elevation-ft", 400 / 0.3048);
  });
  it("stands the engine test stand on its gear rather than at the ground's height", () => {
    const sdk = { ...setup(), setHoldDown: vi.fn() };
    resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 45, lonDeg: -93, altMeters: 400 }, 400, "cessna-172", { holdDown: true });
    const stance = getFdmProfile("cessna-172").stance.staticMeters + 0.17;
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/h-sl-ft", (400 + stance) / 0.3048);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/terrain-elevation-ft", 400 / 0.3048);
  });
  it("sets runway departure heading, ground elevation, gear, brakes and zero ground speed", () => {
    const sdk = setup();
    resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 45, lonDeg: -93, altMeters: 300,
      flightPreset: { mode: "departure", headingDeg: 90, groundElevationMeters: 300, flightPathDeg: 0 } });
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/terrain-elevation-ft", 300 / 0.3048);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/h-sl-ft", 301.5 / 0.3048);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/psi-true-deg", 90);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/vg-fps", 0);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("fcs/brake-cmd-norm", 1);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("fcs/left-brake-cmd-norm", 1);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("fcs/throttle-cmd-norm", 0);
  });
  it("matches a multiplayer host's heading and speed without replacing aircraft configuration", () => {
    const sdk = setup();
    resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 45, lonDeg: -93, altMeters: 2500, headingDeg: 90, airspeedKts: 180 });
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/psi-true-deg", 90);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/vc-kts", 180);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("fcs/throttle-cmd-norm", 0.65);
  });
  it("sets arrival altitude and C172 approach speed, releasing the departure brakes", () => {
    const sdk = setup();
    resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 45, lonDeg: -93, altMeters: 800,
      flightPreset: { mode: "arrival", headingDeg: 270, groundElevationMeters: 300, flightPathDeg: -3 } });
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/h-sl-ft", 800 / 0.3048);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/vc-kts", 75);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/gamma-deg", -3);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("fcs/brake-cmd-norm", 0);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("fcs/left-brake-cmd-norm", 0);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("fcs/throttle-cmd-norm", 0.35);
  });
  it.each(["departure", "arrival"] as const)("moves a stopped, hot static fixture using %s runway geometry without applying flight controls", mode => {
    const base = setup();
    const metal = "propulsion/engine/thermal/metal-temperature-state-k";
    const initialized = "propulsion/engine/thermal/initialized";
    const conversion = ["fcs/stovl-cmd-norm", "fcs/stovl-pos-norm"];
    Object.assign(base.values, {
      "fcs/throttle-cmd-norm": 0.8,
      "propulsion/engine/set-running": 0,
      "gear/gear-cmd-norm": 0,
      "gear/gear-pos-norm": 0,
      "fcs/flap-cmd-norm": 0.2,
      [metal]: 980, [initialized]: 1,
      [conversion[0]]: 0.7, [conversion[1]]: 0.6,
    });
    const catalog = [`${metal} (RW)`, `${initialized} (R)`, ...conversion.map(path => `${path} (RW)`)];
    base.resetToInitialConditions.mockImplementation(() => { base.values[metal] = 273.15; base.values[initialized] = 0; });
    const sdk = { ...base, setHoldDown: vi.fn(),
      queryPropertyCatalog: vi.fn((query: string) => catalog.filter(line => line.startsWith(query)).join("\n")),
    };
    resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 45, lonDeg: -93, altMeters: 800,
      flightPreset: { mode, headingDeg: 350, groundElevationMeters: 300, flightPathDeg: mode === "arrival" ? -3 : 0 },
    }, 300, "f-35b", { holdDown: true });
    expect(sdk.setHoldDown).toHaveBeenCalledWith(true);
    expect(sdk.setHoldDown.mock.invocationCallOrder[0]).toBeLessThan(sdk.runIc.mock.invocationCallOrder[0]!);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/psi-true-deg", 350);
    for (const property of ["ic/vc-kts", "ic/vg-fps", "ic/theta-deg", "ic/alpha-deg", "ic/gamma-deg"]) {
      expect(sdk.setPropertyValue).toHaveBeenCalledWith(property, 0);
    }
    expect(sdk.setPropertyValue).not.toHaveBeenCalledWith("propulsion/set-running", -1);
    expect(base.values["fcs/throttle-cmd-norm"]).toBe(0.8);
    expect(base.values["gear/gear-pos-norm"]).toBe(0);
    expect(base.values["fcs/flap-cmd-norm"]).toBe(0.2);
    expect(conversion.map(path => base.values[path])).toEqual([0.7, 0.6]);
    expect(base.values[metal]).toBe(980);
    expect(base.values["ic/h-sl-ft"]).toBeCloseTo((mode === "departure" ? 301.437 : 800) / 0.3048, 6);
  });
  it.each(["free", "departure", "arrival"] as const)("preserves native metal state before warm initialization on %s relocation", mode => {
    const base = setup();
    const states = [
      "propulsion/engine/thermal/metal-temperature-state-k",
      "propulsion/engine[2]/thermal/metal-temperature-state-k",
    ];
    const flags = states.map(path => path.replace(/metal-temperature-state-k$/, "initialized"));
    states.forEach((path, index) => { base.values[path] = [910, 705][index]; base.values[flags[index]] = 1; });
    base.values["propulsion/engine/set-running"] = 1;
    const catalog = [...states.map(path => `${path} (RW)`), ...flags.map(path => `${path} (R)`)];
    const startupStates: number[][] = [];
    base.resetToInitialConditions.mockImplementation(() => {
      states.forEach((path, index) => { base.values[path] = 273.15; base.values[flags[index]] = 0; });
    });
    base.setPropertyValue.mockImplementation((path, value) => {
      base.values[path] = value;
      const index = states.indexOf(path);
      if (index >= 0) base.values[flags[index]] = 1;
      if (path === "propulsion/set-running") {
        startupStates.push(states.map(state => base.values[state]));
        states.forEach((state, slot) => {
          if (!base.values[flags[slot]]) base.values[state] = 1200;
        });
      }
    });
    const sdk = { ...base, queryPropertyCatalog: vi.fn((query: string) => catalog.filter(line => line.startsWith(query)).join("\n")) };
    const location = { latDeg: 45, lonDeg: -93, altMeters: 800,
      ...(mode === "free" ? {} : { flightPreset: {
        mode, headingDeg: 90, groundElevationMeters: 300, flightPathDeg: mode === "arrival" ? -3 : 0,
      } }) };
    resetFlightLocation(sdk as unknown as JSBSimSdk, location, undefined, "f-35b");
    expect(startupStates).toEqual([[910, 705]]);
    expect(states.map(path => base.values[path])).toEqual([910, 705]);
    const firstRun = base.runIc.mock.invocationCallOrder[0];
    for (const path of states) {
      const index = base.setPropertyValue.mock.calls.findIndex(([written]) => written === path);
      expect(base.setPropertyValue.mock.invocationCallOrder[index]).toBeLessThan(firstRun);
    }
    expect(sdk.queryPropertyCatalog.mock.calls.filter(([query]) => query === "propulsion/engine")).toHaveLength(1);
  });
  it("leaves a pending native thermal seed uninitialized for a new runway start", () => {
    const base = setup();
    const state = "propulsion/engine/thermal/metal-temperature-state-k";
    const initialized = "propulsion/engine/thermal/initialized";
    base.values[state] = 400;
    base.values[initialized] = 0;
    base.resetToInitialConditions.mockImplementation(() => { base.values[state] = 273.15; base.values[initialized] = 0; });
    base.setPropertyValue.mockImplementation((path, value) => {
      base.values[path] = value;
      if (path === state) base.values[initialized] = 1;
      if (path === "propulsion/set-running" && !base.values[initialized]) {
        base.values[state] = 850;
        base.values[initialized] = 1;
      }
    });
    const sdk = { ...base, queryPropertyCatalog: (query: string) => query === "propulsion/engine"
      ? `${state} (RW)\n${initialized} (R)` : "" };
    resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 45, lonDeg: -93, altMeters: 300,
      flightPreset: { mode: "departure", headingDeg: 90, groundElevationMeters: 300, flightPathDeg: 0 } }, undefined, "f-35b");
    expect(base.setPropertyValue.mock.calls.filter(([path]) => path === state)).toEqual([]);
    expect(base.values[state]).toBe(850);
    expect(base.values[initialized]).toBe(1);
  });
  it("reports an engine re-evaluation failure instead of returning a stale location state", () => {
    const sdk = setup();
    sdk.runIc.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(() => resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 45, lonDeg: -93 })).toThrow("initialize engines");
  });
  it("starts a shared flight at its pitch, along its climb angle, with the angle to the air between them", () => {
    const sdk = setup();
    resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 45, lonDeg: -93, altMeters: 2500, pitchDeg: 8, flightPathDeg: 3 }, undefined, "f-35b");
    const before = sdk.setPropertyValue.mock.calls.slice(0, sdk.setPropertyValue.mock.calls.findIndex(([path]) => path.startsWith("fcs/")));
    expect(before).toContainEqual(["ic/gamma-deg", 3]);
    expect(before).toContainEqual(["ic/alpha-deg", 5]);
    // Without airspeed JSBSim levels the nose while fitting alpha: the pitch is set last.
    expect(before.filter(([path]) => path === "ic/theta-deg").at(-1)).toEqual(["ic/theta-deg", 8]);
    expect(before.findLastIndex(([path]) => path === "ic/theta-deg")).toBeGreaterThan(before.findIndex(([path]) => path === "ic/alpha-deg"));
  });
  it("keeps a runway preset's and a static fixture's own attitude over a shared one", () => {
    const runway = setup();
    resetFlightLocation(runway as unknown as JSBSimSdk, { latDeg: 45, lonDeg: -93, altMeters: 800, pitchDeg: 20, flightPathDeg: 10,
      flightPreset: { mode: "arrival", headingDeg: 270, groundElevationMeters: 300, flightPathDeg: -3 } });
    expect(runway.setPropertyValue).toHaveBeenCalledWith("ic/gamma-deg", -3);
    expect(runway.setPropertyValue).toHaveBeenCalledWith("ic/alpha-deg", 6);
    expect(runway.setPropertyValue).not.toHaveBeenCalledWith("ic/theta-deg", 20);
    const base = setup();
    const held = { ...base, setHoldDown: vi.fn(), queryPropertyCatalog: () => "" };
    resetFlightLocation(held as unknown as JSBSimSdk, { latDeg: 45, lonDeg: -93, altMeters: 300, pitchDeg: 20, flightPathDeg: 10 }, 300, "cessna-172", { holdDown: true });
    expect(held.setPropertyValue.mock.calls.filter(([path]) => path.startsWith("ic/theta-deg") || path === "ic/gamma-deg"))
      .toEqual([["ic/theta-deg", 0], ["ic/gamma-deg", 0]]);
  });
  it("rejects invalid input before mutating JSBSim and reports RunIC failure", () => {
    const sdk = setup(false);
    expect(() => resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: NaN, lonDeg: 0 })).toThrow("Invalid");
    expect(() => resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 0, lonDeg: 0, pitchDeg: 91 })).toThrow("Invalid");
    expect(() => resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 0, lonDeg: 0, flightPathDeg: Number.NaN })).toThrow("Invalid");
    expect(sdk.setPropertyValue).not.toHaveBeenCalled();
    expect(() => resetFlightLocation(sdk as unknown as JSBSimSdk, { latDeg: 45, lonDeg: 0 })).toThrow("JSBSim");
  });
});
