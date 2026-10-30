// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlightHudOptions } from "./hud/flightHud";
import type { FlightControlPanelOptions } from "./hud/FlightControlPanel";

const mocks = vi.hoisted(() => {
  const state = { latDeg: 1, lonDeg: 2, altMeters: 1000, headingRad: 0, rollRad: 0, pitchRad: 0, verticalSpeedFps: 0, airspeedKts: 110 };
  // Every region the flight asks for is ready at once, over ground at 250 m.
  // Moving a region reports it again, as the runtime does.
  const createRegionLease = (request: import("foss-earth/runtime").TerrainRegionOptions) => {
    const progress: import("foss-earth/runtime").TerrainRegionProgress = {
      state: "ready", minimumReady: true, finalReady: true, readyTiles: 1, totalTiles: 1, pendingTiles: 0,
      estimatedRemainingMs: null, reason: null, groundHeightMeters: 250, sourceGeneration: 1,
    };
    let released = false;
    return {
      read: () => progress,
      update: vi.fn<(region: import("foss-earth/runtime").TerrainRegion) => void>(() => queueMicrotask(() => { if (!released) request.onProgress?.(progress); })),
      release: vi.fn(() => { released = true; }),
      setVisible: vi.fn(),
    };
  };
  return {
    state,
    properties: {} as Record<string, number>,
    sdk: {
      setPropertyValue: vi.fn(),
      run: vi.fn(),
      getPropertyValue: vi.fn((property: string) => {
        if (property in mocks.properties) return mocks.properties[property];
        if (property === "fcs/throttle-cmd-norm") return 0.65;
        if (property === "gear/gear-cmd-norm") return 1;
        // The engine runs, as a flight starts: an engine that is off holds the throttle at idle.
        if (property.endsWith("/set-running")) return 1;
        return 0;
      }),
    },
    disposeSdk: vi.fn(),
    runtime: {
      renderer: { mode: "webgl2", engine: {} }, status: { mode: "fallback" }, scene: { onAfterRenderObservable: { add: () => null, remove: () => true } }, getViewState: () => null,
      onDeviceLost: vi.fn(() => () => {}), onDeviceRestored: vi.fn(() => () => {}),
      engine: { getFps: () => 60 }, geospatialCamera: null,
      prepareTerrain: vi.fn(async (request: { altitudeMeters?: number; altitudeAboveGroundMeters?: number }) => ({
        groundHeightMeters: 250, altitudeMeters: request.altitudeMeters ?? 250 + (request.altitudeAboveGroundMeters ?? 1524),
      })),
      prepareTerrainRegion: vi.fn(createRegionLease),
      surface: { sample: vi.fn(() => null) },
      getWorldRoot: () => ({}), sky: { getEnvironment: () => null, subscribe: () => () => {}, setGroundLights: vi.fn(), setGroundLightReceiver: vi.fn() }, registerFocusPoint: vi.fn(() => () => {}), setSimViewState: vi.fn(), setSimTick: vi.fn(), setSimRunning: vi.fn(),
      getGoogleTerrainDetailState: vi.fn(() => null),
      getTileMetrics: vi.fn(() => null),
      getMapDownloadBytesPerSecond: vi.fn(() => 0),
      subscribeStatus: vi.fn(() => () => {}),
      isStreamingTiles: () => false,
      onTilesStreamingChange: vi.fn(() => () => {}),
      onRasterDetailFeedback: vi.fn(() => () => {}),
      onDetailAdjusted: vi.fn(() => () => {}),
      getRasterDetailFeedback: vi.fn(() => null),
      setRasterDetailTarget: vi.fn(),
      setGoogleTerrainDetailTarget: vi.fn(),
      requestRender: vi.fn(), destroy: vi.fn(),
    },
    aircraft: {
      setViewMode: vi.fn(), getViewMode: () => "third", toggleViewMode: vi.fn(), dispose: vi.fn(),
      orbitChaseCamera: vi.fn(), zoomChaseCamera: vi.fn(), modelRoot: {}, setModelLoaded: vi.fn(),
      getChaseDistanceMeters: () => 14,
      thirdPersonCamera: { position: { y: 2.2, length: () => Math.hypot(2.2, 14) } },
    },
    aircraftModel: {
      getState: () => ({ status: "ready" }), getRig: () => null,
      setAircraft: vi.fn(), setLod: vi.fn(), setRenderStowedGear: vi.fn(), updateGearVisibility: vi.fn(), refreshAutoLod: vi.fn(), dispose: vi.fn(),
    },
    terrainContact: { update: vi.fn(() => true), reset: vi.fn(), getRelocationProposal: vi.fn(() => null), declineRelocation: vi.fn(), acceptRelocation: vi.fn(), ignoreTerrainOverlap: vi.fn(), isTerrainIgnored: vi.fn(() => false) },
    visibleMeshCollision: { update: vi.fn(() => false), reset: vi.fn(), dispose: vi.fn(), setTerrainOverlapIgnored: vi.fn() },
    physics: {
      reset: vi.fn(), setPaused: vi.fn(), update: vi.fn(), getLatestState: () => state, getFault: () => null,
    },
    createHud: vi.fn(() => ({ update: vi.fn(), setGearDown: vi.fn(), refreshFlaps: vi.fn(), isPilotHolding: vi.fn(() => false), setLayout: vi.fn(), setReadingTints: vi.fn(), destroy: vi.fn() })),
    createPanel: vi.fn(() => ({ update: vi.fn(), openOrSelectTab: vi.fn(), toggleTab: vi.fn(), destroy: vi.fn() })),
    createHudBar: vi.fn(() => ({ update: vi.fn(), setLayout: vi.fn(), destroy: vi.fn() })),
  };
});
vi.mock("foss-earth/runtime", () => ({
  // The runtime's profiling session is real: off, it attaches nothing to the scene.
  createBabylonRuntime: async () => {
    const { createFrameProfileSession } = await import("@foss-earth/renderer/babylon");
    const { Observable } = await import("@babylonjs/core");
    Object.assign(mocks.runtime.scene, Object.fromEntries([
      "onBeforeAnimationsObservable", "onAfterRenderObservable",
      "onBeforeActiveMeshesEvaluationObservable", "onAfterActiveMeshesEvaluationObservable",
      "onBeforeRenderTargetsRenderObservable", "onAfterRenderTargetsRenderObservable",
      "onBeforeDrawPhaseObservable", "onAfterDrawPhaseObservable",
    ].map(name => [name, new Observable()])));
    return Object.assign(mocks.runtime, { frameProfile: createFrameProfileSession({ scene: mocks.runtime.scene as never, engine: { getCaps: () => ({}) } as never, now: () => performance.now() }) });
  },
  RASTER_BASE_MAP_SOURCES: [], TERRAIN_SOURCES: [], resolveTerrainSource: vi.fn(),
  resolveRasterBaseMapSource: vi.fn(), resolveMapRuntimeConfig: () => ({}),
  applyRendererChoice: vi.fn(), setMapSourcePreference: vi.fn(), setTerrainSourcePreference: vi.fn(),
}));
vi.mock("foss-earth/input", () => ({
  loadInputModePreference: () => "mouse", loadInputSensitivityPreference: () => ({}),
  loadOrbitInvertSettings: () => ({ invertYaw: false, invertPitch: false, recenterMode: "hold" }),
  saveOrbitInvertSettings: vi.fn(),
}));
vi.mock("./jsbsim/createJsbsimRuntime", () => ({ createJsbsimRuntime: async () => ({ physicsHz: 60, sdk: mocks.sdk, dispose: mocks.disposeSdk }) }));
vi.mock("@0sfs/ground-contact/ecefBridge", () => ({ readFlightState: () => mocks.state }));
vi.mock("./bridge/floatingOrigin", () => ({ createFloatingOrigin: () => ({ aircraftRoot: { setEnabled: vi.fn() }, apply: vi.fn(), dispose: vi.fn() }) }));
vi.mock("./hud/flightCompass", () => ({ createFlightCompass: () => ({ update: vi.fn(), destroy: vi.fn() }) }));
vi.mock("@0sfs/aircraft/createPlaceholderAircraft", () => ({ createPlaceholderAircraft: () => mocks.aircraft }));
vi.mock("@0sfs/aircraft/createAircraftModel", () => ({ createAircraftModel: () => mocks.aircraftModel }));
vi.mock("@0sfs/aircraft/createAircraftLights", () => ({ createAircraftLights: () => ({ refresh: vi.fn(), dispose: vi.fn() }) }));
vi.mock("@0sfs/aircraft/aircraftAnimation", () => ({ applyAircraftRig: vi.fn(), readControlSurfaceState: vi.fn(() => ({ gearDownNorm: 1 })) }));
vi.mock("./physics/fixedStepLoop", () => ({ HARD_GROUND_IMPACT_FAULT: "Hard ground impact. Reposition the aircraft to recover.", createFixedStepPhysicsLoop: () => mocks.physics }));
vi.mock("@0sfs/ground-contact/terrainContact", () => ({ createTerrainContact: () => mocks.terrainContact }));
vi.mock("@0sfs/ground-contact/visibleMeshCollision", () => ({ createVisibleMeshCollision: () => mocks.visibleMeshCollision }));
vi.mock("@0sfs/controls/flightCameraInput", () => ({ attachFlightCameraInput: () => vi.fn() }));
vi.mock("./hud/flightHud", () => ({ createFlightHud: mocks.createHud }));
vi.mock("./hud/createFlightControlPanel", () => ({ createFlightControlPanel: mocks.createPanel }));
vi.mock("./hud/createFlightHudBar", () => ({ createFlightHudBar: mocks.createHudBar }));
vi.mock("./jsbsim/resetFlightLocation", () => ({ resetFlightLocation: vi.fn((_sdk: unknown, location: { latDeg: number; lonDeg: number; altMeters?: number }) => {
  Object.assign(mocks.state, { latDeg: location.latDeg, lonDeg: location.lonDeg,
    ...(location.altMeters !== undefined ? { altMeters: location.altMeters } : {}) });
  return mocks.state;
}) }));

import { getAppSettings, resetAppSettings } from "foss-earth/settings";
import { createFlightSimApp } from "./createFlightSimApp";
import { flightParameterDefaults } from "./settings/flightParameters";

let app: Awaited<ReturnType<typeof createFlightSimApp>> | null = null;
let tick: (dt: number) => void;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/fly/");
  mocks.runtime.status.mode = "fallback";
  Object.assign(mocks.state, { latDeg: 1, lonDeg: 2, altMeters: 1000, headingRad: 0, rollRad: 0, pitchRad: 0, verticalSpeedFps: 0, airspeedKts: 110 });
  mocks.properties = {};
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    clear: () => values.clear(),
  });
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: vi.fn(() => []) });
  mocks.terrainContact.update.mockReturnValue(true);
  mocks.visibleMeshCollision.update.mockReturnValue(false);
  mocks.physics.update.mockImplementation((_dt, apply: () => boolean | void | "reset") => {
    if (apply() !== false) mocks.sdk.run();
    return mocks.state;
  });
});

afterEach(() => {
  app?.destroy(); app = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  resetAppSettings();
});

async function mount() {
  const root = document.createElement("div");
  document.body.append(root);
  app = await createFlightSimApp(root);
  tick = mocks.runtime.setSimTick.mock.calls.at(-1)![0];
  return root;
}

/** The altitude the start's map region settled on: where the new flight is placed. */
function startRegionAltitude(): number | undefined {
  const lease = mocks.runtime.prepareTerrainRegion.mock.results[0]?.value;
  return lease?.update.mock.calls.at(-1)?.[0].center.altitudeMeters;
}

function hudOptions(): FlightHudOptions {
  return mocks.createHud.mock.calls.at(-1)![1] as FlightHudOptions;
}

function panelOptions(): FlightControlPanelOptions {
  return mocks.createPanel.mock.calls.at(-1)![2] as FlightControlPanelOptions;
}

function lastAileron(): number | undefined {
  for (let i = mocks.sdk.setPropertyValue.mock.calls.length - 1; i >= 0; i -= 1) {
    const [name, value] = mocks.sdk.setPropertyValue.mock.calls[i]!;
    if (name === "fcs/aileron-cmd-norm") return value as number;
  }
  return undefined;
}

describe("0SFS autopilot engage path", () => {
  it("keeps the stick in charge until the HUD master is engaged", async () => {
    await mount();
    tick(1 / 60);
    expect(mocks.sdk.setPropertyValue).toHaveBeenCalledWith("fcs/throttle-cmd-norm", 0.65);
    expect(lastAileron()).toBe(0);
  });

  it("hands roll to our AP after engage, and gives it back when the stick is deflected", async () => {
    await mount();
    hudOptions().onAutopilotEngageChange(true);
    tick(1 / 60);
    mocks.properties["attitude/phi-deg"] = 12;
    mocks.sdk.setPropertyValue.mockClear();
    tick(1 / 60);
    expect(lastAileron()!).toBeLessThan(0);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    mocks.sdk.setPropertyValue.mockClear();
    tick(0.1);
    expect(lastAileron()!).toBeGreaterThan(0.05);
  });

  it("does not let ArduPilot fly when the backend is selected but not connected", async () => {
    await mount();
    panelOptions().onAutopilotSettingsChange({
      version: 1,
      backend: "ardupilot",
      axes: { roll: true, pitch: true, yaw: true, throttle: true, gear: true, flaps: true },
      throttleMode: "airspeed",
    });
    hudOptions().onAutopilotEngageChange(true);
    mocks.properties["attitude/phi-deg"] = 12;
    mocks.sdk.setPropertyValue.mockClear();
    tick(1 / 60);
    expect(lastAileron()).toBe(0);
    expect(mocks.sdk.setPropertyValue).toHaveBeenCalledWith("fcs/throttle-cmd-norm", 0.65);
    expect(getAppSettings().get("osfs.autopilot.backend")).toBe("ardupilot");
  });

  it("ignores route without dev=1 and leaves ordinary flight recording and resume alone", async () => {
    window.history.replaceState(null, "", "/fly/?route=low");
    await mount();
    expect(window.osfsFlightRoute).toBeUndefined();
    expect(getAppSettings().get("osfs.start.resume")).toBe(true);
    // An ordinary new flight starts at the usual height over its ground, not the route's.
    expect(startRegionAltitude()).toBe(250 + flightParameterDefaults().get("osfs.start.heightAboveGround"));
  });

  it("starts the dev route through AP with 150m terrain placement and reversible visit settings", async () => {
    window.history.replaceState(null, "", "/fly/?dev=1&route=low");
    mocks.runtime.status.mode = "google-tiles";
    await mount();
    expect(startRegionAltitude()).toBe(400);
    expect(getAppSettings().get("osfs.start.resume")).toBe(false);
    expect(window.osfsFlightPerformance).toBeDefined();
    expect(window.osfsFlightRoute?.snapshot()).toMatchObject({ aircraft: "cessna-172", status: "running", elapsedSeconds: 0,
      targetAltitudeMslMeters: 400, coverageValidation: "unverified" });
    expect(mocks.state.altMeters).toBe(400);
    tick(1 / 60);
    expect(mocks.createHud.mock.results.at(-1)?.value.update.mock.calls.at(-1)?.[4]).toMatchObject({ engaged: true, ownsPitch: true, ownsRoll: true });
    mocks.state.altMeters = 380;
    mocks.sdk.setPropertyValue.mockClear();
    tick(1 / 60);
    const elevator = mocks.sdk.setPropertyValue.mock.calls.findLast(([name]) => name === "fcs/elevator-cmd-norm")?.[1];
    expect(elevator).toBeLessThan(0); // Existing AP commands nose-up after losing altitude.
    app!.destroy(); app = null;
    expect(window.osfsFlightRoute).toBeUndefined();
    expect(getAppSettings().get("osfs.start.resume")).toBe(true);
  });
});
