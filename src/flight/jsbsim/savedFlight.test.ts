import { describe, expect, it, vi } from "vitest";
import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import {
  applySavedControls,
  captureSavedFlight,
  createSavedFlightStore,
  parseSavedFlight,
  restoreSavedFlight,
  SAVED_FLIGHT_STORAGE_KEY,
  savedFlightTerrainRequest,
  savedFlightPreview,
  type SavedFlight,
} from "./savedFlight";

import { EMPTY_FLIGHT_STATE } from "@0sfs/ground-contact/flightState";
import { flightRegion } from "../flightRegion";
import { flightParameterDefaults } from "../settings/flightParameters";

const FT = 0.3048;
const STANCE = { staticMeters: 1, staticPitchRad: 0, pitchArmMeters: 0, rollArmMeters: 0 };

/** A simulator whose RunIC moves the aircraft to its initial conditions. */
function fakeSdk(values: Record<string, number> = {}) {
  const properties: Record<string, number> = {
    "position/lat-geod-deg": 44.9, "position/long-gc-deg": -93.2, "position/h-sl-ft": 3000 / FT,
    "position/terrain-elevation-asl-ft": 250 / FT,
    "attitude/phi-deg": 10, "attitude/theta-deg": 3, "attitude/psi-deg": 300,
    "velocities/vc-kts": 110, "velocities/v-north-fps": 100, "velocities/v-east-fps": -50, "velocities/v-down-fps": 5,
    "fcs/throttle-cmd-norm": 0.7, "fcs/flap-cmd-norm": 0.5, "gear/gear-cmd-norm": 1,
    "atmosphere/wind-north-fps": -12, "propulsion/engine/set-running": 1,
    ...values,
  };
  const fromIc: Record<string, string> = {
    "ic/lat-geod-deg": "position/lat-geod-deg", "ic/long-gc-deg": "position/long-gc-deg",
    "ic/h-sl-ft": "position/h-sl-ft", "ic/terrain-elevation-ft": "position/terrain-elevation-asl-ft",
    "ic/phi-deg": "attitude/phi-deg", "ic/theta-deg": "attitude/theta-deg", "ic/psi-true-deg": "attitude/psi-deg",
  };
  const sdk = {
    properties,
    getPropertyValue: (key: string) => properties[key] ?? 0,
    setPropertyValue: vi.fn((key: string, value: number) => { properties[key] = value; }),
    resetToInitialConditions: vi.fn(),
    runIc: vi.fn(() => {
      for (const [ic, property] of Object.entries(fromIc)) if (ic in properties) properties[property] = properties[ic];
      return true;
    }),
  };
  return sdk;
}

const asSdk = (sdk: ReturnType<typeof fakeSdk>) => sdk as unknown as JSBSimSdk;

describe("saved flight", () => {
  it("captures where the aircraft is, its height above the ground and its pause", () => {
    const flight = captureSavedFlight(asSdk(fakeSdk()), "cessna-172", true, 1234)!;
    expect(flight).toMatchObject({
      version: 1, savedAtMs: 1234, aircraftId: "cessna-172", paused: true,
      latDeg: 44.9, lonDeg: -93.2, headingDeg: 300,
    });
    expect(flight.altMeters).toBeCloseTo(3000);
    expect(flight.aboveGroundMeters).toBeCloseTo(2750);
    expect(flight.simulation.controls["fcs/throttle-cmd-norm"]).toBe(0.7);
    expect(parseSavedFlight(JSON.stringify(flight))).toEqual(flight);
  });

  it("does not save a state outside the flight envelope", () => {
    expect(captureSavedFlight(asSdk(fakeSdk({ "velocities/vc-kts": Number.NaN })), "cessna-172", false)).toBeNull();
  });

  it("records unknown ground as unknown, not as a height kilometres above it", () => {
    const flight = captureSavedFlight(asSdk(fakeSdk({ "position/terrain-elevation-asl-ft": -10000 })), "cessna-172", false)!;
    expect(flight.aboveGroundMeters).toBeNull();
    expect(savedFlightTerrainRequest(flight)).toEqual({ latDeg: 44.9, lonDeg: -93.2, altitudeMeters: flight.altMeters, clearanceMeters: 0 });
  });

  it("prepares terrain for the exact absolute pose, with no climb over nearby hills", () => {
    const flight = captureSavedFlight(asSdk(fakeSdk()), "cessna-172", false)!;
    expect(savedFlightTerrainRequest(flight)).toEqual({
      latDeg: 44.9, lonDeg: -93.2, altitudeMeters: flight.altMeters, clearanceMeters: 0,
    });
  });

  it("previews saved attitude and ground motion with the correct vertical sign", () => {
    const flight = captureSavedFlight(asSdk(fakeSdk()), "cessna-172", true)!;
    const preview = savedFlightPreview(flight, EMPTY_FLIGHT_STATE);
    expect(preview).toMatchObject({ latDeg: 44.9, lonDeg: -93.2, altMeters: flight.altMeters,
      northVelocityFps: 100, eastVelocityFps: -50, verticalSpeedFps: -5, throttleNorm: 0.7 });
    expect(preview.headingRad).toBeCloseTo(300 * Math.PI / 180);
    expect(preview.rollRad).toBeCloseTo(10 * Math.PI / 180);
    expect(preview.pitchRad).toBeCloseTo(3 * Math.PI / 180);
    expect(flightRegion(preview, false, 10, flightParameterDefaults()).region.cone).toBeDefined();
  });

  it("previews a stopped save without inheriting a bootstrap velocity cone, and falls back for missing values", () => {
    const flight = captureSavedFlight(asSdk(fakeSdk({ "velocities/v-north-fps": 0, "velocities/v-east-fps": 0, "velocities/v-down-fps": 0 })), "cessna-172", true)!;
    const fallback = { ...EMPTY_FLIGHT_STATE, northVelocityFps: 200, rollRad: 0.4, pitchRad: 0.2 };
    const preview = savedFlightPreview(flight, fallback);
    expect(flightRegion(preview, false, 10, flightParameterDefaults()).region.cone).toBeUndefined();
    delete flight.simulation.initial["ic/phi-deg"];
    flight.simulation.initial["ic/theta-deg"] = NaN;
    expect(savedFlightPreview(flight, fallback)).toMatchObject({ rollRad: 0.4, pitchRad: 0.2 });
  });

  it.each([
    ["not JSON", "trackpad"],
    ["another version", JSON.stringify({ version: 2 })],
    ["an unknown aircraft", JSON.stringify({ version: 1, aircraftId: "zeppelin" })],
    ["null", "null"],
  ])("ignores a stored value that is %s", (_name, raw) => {
    expect(parseSavedFlight(raw)).toBeNull();
  });

  it("ignores a saved flight with a latitude off the globe", () => {
    const flight = captureSavedFlight(asSdk(fakeSdk()), "cessna-172", false)!;
    expect(parseSavedFlight(JSON.stringify({ ...flight, latDeg: 91 }))).toBeNull();
  });

  it("keeps flying when browser storage refuses, throws or is missing", () => {
    const flight = captureSavedFlight(asSdk(fakeSdk()), "cessna-172", false)!;
    const refusing = createSavedFlightStore({
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("denied"); },
    });
    expect(refusing.read()).toBeNull();
    expect(refusing.write(flight)).toBe(false);
    expect(() => refusing.clear()).not.toThrow();
    expect(createSavedFlightStore(null).write(flight)).toBe(false);
  });

  it("writes, reads back and clears one record", () => {
    const storage = new Map<string, string>();
    const store = createSavedFlightStore({
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
      removeItem: key => { storage.delete(key); },
    });
    const flight = captureSavedFlight(asSdk(fakeSdk()), "cessna-172", false)!;
    expect(store.write(flight)).toBe(true);
    expect([...storage.keys()]).toEqual([SAVED_FLIGHT_STORAGE_KEY]);
    expect(store.read()).toEqual(flight);
    store.clear();
    expect(store.read()).toBeNull();
  });

  describe("restoring", () => {
    const saved = (): SavedFlight => captureSavedFlight(asSdk(fakeSdk()), "cessna-172", true)!;

    it("recovers the pilot brake from legacy saves with only equal wheel brakes", () => {
      const flight = saved();
      delete flight.simulation.controls["fcs/brake-cmd-norm"];
      flight.simulation.controls["fcs/left-brake-cmd-norm"] = flight.simulation.controls["fcs/right-brake-cmd-norm"] = 0.6;
      const sdk = fakeSdk({ "fcs/brake-cmd-norm": 0 });
      applySavedControls(asSdk(sdk), flight, "cessna-172");
      expect(sdk.properties["fcs/brake-cmd-norm"]).toBe(0.6);
      restoreSavedFlight(asSdk(sdk), flight, "cessna-172", { groundHeightMeters: 0, altitudeMeters: 3000 }, STANCE);
      expect(sdk.properties["fcs/brake-cmd-norm"]).toBe(0.6);
    });

    it("keeps absolute altitude when ground changes, along with saved controls and engine", () => {
      const flight = saved();
      const sdk = fakeSdk({
        "position/lat-geod-deg": 10, "position/long-gc-deg": 20, "attitude/psi-deg": 0,
        "fcs/throttle-cmd-norm": 0.3, "fcs/flap-cmd-norm": 0, "propulsion/engine/set-running": 0,
        "atmosphere/wind-north-fps": 0,
      });
      applySavedControls(asSdk(sdk), flight, "cessna-172");
      // The pilot's controls are made from these before the ground is ready.
      expect(sdk.properties["fcs/throttle-cmd-norm"]).toBe(0.7);
      expect(sdk.properties["fcs/flap-cmd-norm"]).toBe(0.5);
      const state = restoreSavedFlight(asSdk(sdk), flight, "cessna-172", { groundHeightMeters: 400, altitudeMeters: 3150 }, STANCE);
      expect(state.latDeg).toBe(44.9);
      expect(state.lonDeg).toBe(-93.2);
      expect(state.altMeters).toBeCloseTo(flight.altMeters);
      expect(state.headingRad * 180 / Math.PI).toBeCloseTo(300);
      expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/terrain-elevation-ft", 400 / FT);
      expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/vn-fps", 100);
      expect(sdk.setPropertyValue).toHaveBeenCalledWith("propulsion/set-running", -1);
      // The Weather tab starts calm each session, so the saved wind stays behind.
      expect(sdk.properties["atmosphere/wind-north-fps"]).toBe(0);
    });

    it("does not move a saved aircraft when refined terrain appears above it", () => {
      const sdk = fakeSdk();
      const flight = saved();
      const state = restoreSavedFlight(asSdk(sdk), flight, "cessna-172", { groundHeightMeters: 4000, altitudeMeters: 5000 }, STANCE);
      expect(state.altMeters).toBeCloseTo(flight.altMeters);
      // That ground is withheld rather than starting the aircraft on contacts buried in it.
      expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/terrain-elevation-ft", (flight.altMeters - 10_000) / FT);
    });

    it("switches Mini 2 to Air 2S near the ground without inheriting a terrain altitude jump", () => {
      const sdk = fakeSdk({ "position/h-sl-ft": 250.1 / FT, "position/terrain-elevation-asl-ft": 250 / FT });
      const flight = captureSavedFlight(asSdk(sdk), "dji-mini2" as SavedFlight["aircraftId"], true)!;
      const request = savedFlightTerrainRequest(flight);
      expect(request.altitudeMeters).toBeCloseTo(250.1);
      expect(request.altitudeAboveGroundMeters).toBeUndefined();
      const switched = restoreSavedFlight(asSdk(fakeSdk()), flight, "dji-air2s" as SavedFlight["aircraftId"], { groundHeightMeters: 350, altitudeMeters: 1350 }, STANCE);
      expect(switched.latDeg).toBe(flight.latDeg);
      expect(switched.lonDeg).toBe(flight.lonDeg);
      expect(switched.altMeters).toBeCloseTo(250.1);
    });

    it("gives another aircraft the saved position and motion but keeps its own controls and engine", () => {
      const flight = saved();
      const sdk = fakeSdk({ "fcs/throttle-cmd-norm": 0.35, "fcs/flap-cmd-norm": 0, "propulsion/engine/set-running": 0 });
      applySavedControls(asSdk(sdk), flight, "cirrus-vision-jet");
      expect(sdk.setPropertyValue).not.toHaveBeenCalled();
      const state = restoreSavedFlight(asSdk(sdk), flight, "cirrus-vision-jet", { groundHeightMeters: 250, altitudeMeters: 3000 }, STANCE);
      expect(state.latDeg).toBe(44.9);
      expect(sdk.properties["fcs/throttle-cmd-norm"]).toBe(0.35);
      expect(sdk.properties["fcs/flap-cmd-norm"]).toBe(0);
      expect(sdk.setPropertyValue).toHaveBeenCalledWith("propulsion/engine/set-running", 0);
    });

    it("refuses a saved flight that lacks part of the initial state", () => {
      const flight = saved();
      const initial = Object.fromEntries(Object.entries(flight.simulation.initial).filter(([name]) => name !== "ic/vn-fps"));
      expect(() => restoreSavedFlight(asSdk(fakeSdk()), { ...flight, simulation: { ...flight.simulation, initial } },
        "cessna-172", { groundHeightMeters: 250, altitudeMeters: 3000 }, STANCE)).toThrow("ic/vn-fps");
    });
  });
});
