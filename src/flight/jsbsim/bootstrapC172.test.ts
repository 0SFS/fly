import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import { describe, expect, it, vi } from "vitest";
import { bootstrapAircraft, bootstrapC172p } from "./bootstrapC172";
import { LEGACY_FIXED_DT_120, LEGACY_PHYSICS_HZ_120 } from "../physics/physicsRate";

describe("bootstrapC172p", () => {
  it("starts the engine and re-evaluates requested controls before returning", async () => {
    const events: string[] = [];
    const sdk = {
      configurePaths: vi.fn(),
      loadModel: vi.fn(() => true),
      setDt: vi.fn(),
      getDeltaT: vi.fn(() => LEGACY_FIXED_DT_120),
      runIc: vi.fn(() => {
        events.push("runIc");
        return true;
      }),
      setPropertyValue: vi.fn((property: string, value: number) => {
        if (property === "fcs/mixture-cmd-norm" || property === "fcs/throttle-cmd-norm" || property === "propulsion/magneto_cmd" || property === "propulsion/set-running") {
          events.push(`${property}=${value}`);
        }
      }),
    } as unknown as JSBSimSdk;

    await bootstrapC172p(sdk, LEGACY_PHYSICS_HZ_120);

    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/h-sl-ft", 5000);
    expect(sdk.setDt).toHaveBeenCalledWith(LEGACY_FIXED_DT_120);
    expect(sdk.getDeltaT).toHaveBeenCalled();
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/lat-geod-deg", 44.977753);
    expect(events.slice(0, 4)).toEqual([
      "runIc",
      "fcs/throttle-cmd-norm=0.65",
      "propulsion/set-running=-1",
      "propulsion/magneto_cmd=3",
    ]);
    expect(Number(events[4]?.split("=")[1])).toBeCloseTo(1, 3);
    expect(events.slice(-2)).toEqual(["fcs/throttle-cmd-norm=0.65", "runIc"]);
    expect(sdk.runIc).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when the SDK cannot configure dt", async () => {
    const sdk = {
      configurePaths: vi.fn(),
      loadModel: vi.fn(() => true),
      runIc: vi.fn(() => true),
      setPropertyValue: vi.fn(),
    } as unknown as JSBSimSdk;

    await expect(bootstrapC172p(sdk, LEGACY_PHYSICS_HZ_120)).rejects.toThrow("missing setDt");
    expect(sdk.setPropertyValue).not.toHaveBeenCalled();
  });
});

describe("the physics rate the native model is initialized with", () => {
  it.each([30, 60, 120] as const)("steps the model 1/%i s", async physicsHz => {
    let deltaT = Number.NaN;
    const sdk = {
      configurePaths: vi.fn(), loadModel: vi.fn(() => true), runIc: vi.fn(() => true), setPropertyValue: vi.fn(),
      setDt: vi.fn((seconds: number) => { deltaT = seconds; }), getDeltaT: vi.fn(() => deltaT),
    } as unknown as JSBSimSdk;
    await bootstrapC172p(sdk, physicsHz);
    expect(sdk.setDt).toHaveBeenCalledExactlyOnceWith(1 / physicsHz);
  });

  it("refuses a model that keeps another step", async () => {
    const sdk = {
      configurePaths: vi.fn(), loadModel: vi.fn(() => true), runIc: vi.fn(() => true), setPropertyValue: vi.fn(),
      setDt: vi.fn(), getDeltaT: vi.fn(() => LEGACY_FIXED_DT_120),
    } as unknown as JSBSimSdk;
    await expect(bootstrapC172p(sdk, 60)).rejects.toThrow("JSBSim dt mismatch");
    expect(sdk.runIc).not.toHaveBeenCalled();
  });
});

describe("native model capabilities", () => {
  function sdkWithCatalog(catalog: string[]) {
    return {
      configurePaths: vi.fn(), loadModel: vi.fn(() => true),
      setDt: vi.fn(), getDeltaT: vi.fn(() => LEGACY_FIXED_DT_120),
      getPropertyCatalog: vi.fn(() => catalog),
      runIc: vi.fn(() => true), setPropertyValue: vi.fn(),
    };
  }

  it.each([
    { catalog: [] },
    { catalog: ["propulsion/engine/body-force-z-lbs (RW)"] },
    { catalog: ["propulsion/engine[1]/body-force-z-lbs (R)"] },
  ])("rejects absent or writable substitutes before evaluating the aircraft: $catalog", async ({ catalog }) => {
    const sdk = sdkWithCatalog(catalog);
    await expect(bootstrapAircraft(sdk as unknown as JSBSimSdk, "f-35b", LEGACY_PHYSICS_HZ_120))
      .rejects.toThrow("Install a compatible JSBSim SDK and matching aircraft data");
    expect(sdk.setDt).not.toHaveBeenCalled();
    expect(sdk.setPropertyValue).not.toHaveBeenCalled();
    expect(sdk.runIc).not.toHaveBeenCalled();
  });

  it.each(["propulsion/engine/body-force-z-lbs", "propulsion/engine[0]/body-force-z-lbs"])(
    "accepts the native read-only engine-zero spelling %s", async path => {
      const sdk = sdkWithCatalog([`${path} (R)`]);
      await bootstrapAircraft(sdk as unknown as JSBSimSdk, "f-35b", LEGACY_PHYSICS_HZ_120);
      expect(sdk.runIc).toHaveBeenCalledTimes(2);
    },
  );
});
