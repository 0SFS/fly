// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createWheelSpinState, type WheelSpinState } from "@0sfs/ground-contact/wheelSpin";

const mocks = vi.hoisted(() => {
  const state = { latDeg: 1, lonDeg: 2, altMeters: 1000, headingRad: 0 };
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
    wheelStates: [] as WheelSpinState[],
    runtime: {
      renderer: { mode: "webgl2", engine: {} }, status: { mode: "fallback" }, scene: { onAfterRenderObservable: { add: () => null, remove: () => true } }, getViewState: () => null,
      onDeviceLost: vi.fn(() => () => {}), onDeviceRestored: vi.fn(() => () => {}),
      engine: { getFps: () => 60 }, geospatialCamera: null,
      prepareTerrain: vi.fn(async (request: { altitudeMeters?: number }) => ({ groundHeightMeters: 250, altitudeMeters: request.altitudeMeters ?? 1774 })),
      prepareTerrainRegion: vi.fn(createRegionLease),
      surface: { sample: vi.fn(() => null) },
      getWorldRoot: () => ({}), sky: { getEnvironment: () => null, subscribe: () => () => {}, setGroundLights: vi.fn(), setGroundLightReceiver: vi.fn() }, registerFocusPoint: vi.fn(() => () => {}), setSimViewState: vi.fn(), setSimTick: vi.fn(),
      getGoogleTerrainDetailState: vi.fn(() => null),
      subscribeStatus: vi.fn(() => () => {}),
      isStreamingTiles: () => false,
      onTilesStreamingChange: vi.fn(() => () => {}),
      onRasterDetailFeedback: vi.fn(() => () => {}),
      onDetailAdjusted: vi.fn(() => () => {}),
      getRasterDetailFeedback: vi.fn(() => null),
      setRasterDetailTarget: vi.fn(),
      setGoogleTerrainDetailTarget: vi.fn(),
      setSimRunning: vi.fn(), requestRender: vi.fn(), setMapSource: vi.fn(), setTerrainSource: vi.fn(), destroy: vi.fn(),
    },
    wheelSpin: { step: vi.fn(), reset: vi.fn(), getStates: () => mocks.wheelStates },
    tireAudio: { setEnabled: vi.fn(), setPaused: vi.fn(), setVolume: vi.fn(), update: vi.fn(), dispose: vi.fn(), getStatus: () => null },
    aircraft: {
      root: {}, setViewMode: vi.fn(), toggleViewMode: vi.fn(), getViewMode: () => "third",
      orbitChaseCamera: vi.fn(), zoomChaseCamera: vi.fn(), dispose: vi.fn(),
      modelRoot: {}, setModelLoaded: vi.fn(), getChaseDistanceMeters: () => 14,
      thirdPersonCamera: { position: { y: 2.2, length: () => Math.hypot(2.2, 14) } },
    },
    aircraftModel: {
      getState: () => ({ aircraftId: "cessna-172", lodId: "auto", activeLodId: "lod3", status: "ready", triangles: 876, error: null }),
      getRig: () => null, setAircraft: vi.fn(), setLod: vi.fn(), setRenderStowedGear: vi.fn(), updateGearVisibility: vi.fn(), refreshAutoLod: vi.fn(), dispose: vi.fn(),
    },
    terrainContact: { reset: vi.fn(), update: vi.fn(() => true), getRelocationProposal: vi.fn(() => null), declineRelocation: vi.fn(), acceptRelocation: vi.fn(), ignoreTerrainOverlap: vi.fn(), isTerrainIgnored: vi.fn(() => false) },
    visibleMeshCollision: { reset: vi.fn(), update: vi.fn(() => false), dispose: vi.fn(), setTerrainOverlapIgnored: vi.fn() },
    physics: { reset: vi.fn(), setPaused: vi.fn(), update: vi.fn((_delta, applyInputs) => { applyInputs(); return state; }), getLatestState: () => state, getFault: () => null },
  };
});
vi.mock("foss-earth/runtime", () => ({
  // The runtime's profiling session is real: off, it attaches nothing to the scene.
  createBabylonRuntime: async () => {
    const { createFrameProfileSession } = await import("@foss-earth/renderer/babylon");
    return Object.assign(mocks.runtime, { frameProfile: createFrameProfileSession({ scene: {} as never, engine: { getCaps: () => ({}) } as never, now: () => performance.now() }) });
  },
  RASTER_BASE_MAP_SOURCES: [], TERRAIN_SOURCES: [], resolveTerrainSource: vi.fn(), resolveRasterBaseMapSource: vi.fn(),
  resolveMapRuntimeConfig: () => ({}), applyRendererChoice: vi.fn(), setMapSourcePreference: vi.fn(), setTerrainSourcePreference: vi.fn(),
}));
vi.mock("./jsbsim/createJsbsimRuntime", () => ({ createJsbsimRuntime: async () => ({ physicsHz: 60, sdk: { setPropertyValue: vi.fn(), getPropertyValue: vi.fn(() => 0) }, dispose: vi.fn() }) }));
vi.mock("@0sfs/ground-contact/ecefBridge", () => ({ readFlightState: () => mocks.state }));
vi.mock("./bridge/floatingOrigin", () => ({ createFloatingOrigin: () => ({ aircraftRoot: { setEnabled: vi.fn() }, apply: vi.fn(), dispose: vi.fn() }) }));
vi.mock("./hud/flightCompass", () => ({ createFlightCompass: () => ({ update: vi.fn(), destroy: vi.fn() }) }));
vi.mock("@0sfs/aircraft/createPlaceholderAircraft", () => ({ createPlaceholderAircraft: () => mocks.aircraft }));
vi.mock("@0sfs/ground-contact/createCollisionDebugOverlay", () => ({ createCollisionDebugOverlay: vi.fn(() => ({ setEnabled: vi.fn(), update: vi.fn(), dispose: vi.fn(), legend: vi.fn(() => null) })) }));
vi.mock("@0sfs/ground-contact/createWheelSpinDebugOverlay", () => ({ createWheelSpinDebugOverlay: vi.fn(() => ({ setEnabled: vi.fn(), update: vi.fn(), dispose: vi.fn() })) }));
vi.mock("@0sfs/ground-contact/createWheelSpinExperiment", () => ({ createWheelSpinExperiment: () => mocks.wheelSpin }));
vi.mock("@0sfs/sound/createTireAudio", () => ({ createTireAudio: () => mocks.tireAudio }));
vi.mock("@0sfs/aircraft/createAircraftModel", () => ({ createAircraftModel: () => mocks.aircraftModel }));
vi.mock("@0sfs/aircraft/createAircraftLights", () => ({ createAircraftLights: () => ({ refresh: vi.fn(), dispose: vi.fn() }) }));
vi.mock("@0sfs/aircraft/aircraftAnimation", () => ({ applyAircraftRig: vi.fn(), readControlSurfaceState: () => ({ gearDownNorm: 1 }) }));
vi.mock("./physics/fixedStepLoop", () => ({ HARD_GROUND_IMPACT_FAULT: "Hard ground impact. Reposition the aircraft to recover.", createFixedStepPhysicsLoop: vi.fn(() => mocks.physics) }));
vi.mock("@0sfs/ground-contact/terrainContact", () => ({ createTerrainContact: () => mocks.terrainContact }));
vi.mock("@0sfs/ground-contact/visibleMeshCollision", () => ({ createVisibleMeshCollision: vi.fn(() => mocks.visibleMeshCollision) }));
vi.mock("./hud/flightHud", () => ({ createFlightHud: () => ({ update: vi.fn(), isPilotHolding: () => false, setLayout: vi.fn(), setReadingTints: vi.fn(), destroy: vi.fn() }) }));
vi.mock("./jsbsim/resetFlightLocation", () => ({ resetFlightLocation: () => mocks.state }));
vi.mock("./hud/createFlightHudBar", () => ({ createFlightHudBar: () => ({ update: vi.fn(), setLayout: vi.fn(), destroy: vi.fn() }) }));

import { resetAppSettings, SETTINGS_STORAGE_KEY } from "foss-earth/settings";
import { createFlightSimApp } from "./createFlightSimApp";
import { createFixedStepPhysicsLoop } from "./physics/fixedStepLoop";

// Each test is a fresh page: the app registry reads the stubbed storage again.
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); resetAppSettings(); });

/** What the settings record holds for this page. */
const saved = (storage: Map<string, string>): Record<string, unknown> =>
  (JSON.parse(storage.get(SETTINGS_STORAGE_KEY) ?? "{\"values\":{}}") as { values: Record<string, unknown> }).values;

function environment(pads: unknown[] = []) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => pads });
  // Web Audio present so the Slip cue can resolve active.
  vi.stubGlobal("AudioContext", class {});
  return storage;
}

async function mount() {
  const root = document.createElement("div");
  document.body.append(root);
  let app!: Awaited<ReturnType<typeof createFlightSimApp>>;
  await act(async () => { app = await createFlightSimApp(root); });
  const onStep = vi.mocked(createFixedStepPhysicsLoop).mock.calls.at(-1)![1]!;
  const tick = mocks.runtime.setSimTick.mock.calls.at(-1)![0] as (dt: number) => void;
  const openTab = async (label: string) => {
    const launcher = root.querySelector<HTMLButtonElement>('[aria-label="Open right panel"]')
      ?? root.querySelector<HTMLButtonElement>('.foss-earth-tab-strip [aria-label="Open new tab"]')!;
    await act(async () => launcher.click());
    const item = Array.from(root.querySelectorAll<HTMLButtonElement>(".foss-earth-new-tab-choice")).find(button => button.textContent === label)!;
    await act(async () => item.click());
  };
  const choose = async (label: string, value: string) => {
    const select = root.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  };
  const pause = () => act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyP" })));
  return { root, app, onStep: () => onStep(mocks.state as never, 1 / 60), tick, openTab, choose, pause };
}

it("queues wheel-model changes until pause, applies audio immediately, and restores them in a new flight", async () => {
  const storage = environment();
  const view = await mount();
  try {
    // Named sets of ground choices are presets, applied in Settings → Presets.
    await view.openTab("Settings");
    const preset = view.root.querySelector<HTMLElement>('[data-preset="osfs-ground-landing-feedback"]')!;
    const button = (text: string) => [...preset.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!;
    await act(async () => button("Apply…").click());
    await act(async () => button("Apply").click());
    await view.openTab("Aircraft");
    expect([...view.root.querySelectorAll(".foss-earth-preset-status")].map(status => status.textContent))
      .toContain("Matches Ground: Landing feedback");
    // Running: the wheel model waits for a safe boundary.
    view.onStep();
    expect(mocks.wheelSpin.step).not.toHaveBeenCalled();
    expect(view.root.querySelector('[aria-label="Wheel response status"]')!.textContent).toMatch(/Applies when the simulation is paused or reset/);
    expect(saved(storage)).toMatchObject({ "osfs.ground.rotation": "inertia", "osfs.ground.tireAudio": "slip" });
    await act(async () => {
      const volume = view.root.querySelector<HTMLInputElement>('[aria-label="Tire audio volume"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(volume, "0.25");
      volume.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(mocks.tireAudio.setVolume).toHaveBeenLastCalledWith(0.25);
    expect(mocks.wheelSpin.reset).not.toHaveBeenCalled();
    await view.pause();
    view.onStep();
    expect(mocks.wheelSpin.step).toHaveBeenLastCalledWith(1 / 60, "inertia");
    expect(mocks.tireAudio.setEnabled).toHaveBeenLastCalledWith(true);
  } finally { await act(async () => view.app.destroy()); }

  mocks.wheelSpin.step.mockClear();
  const second = await mount();
  try {
    second.onStep();
    expect(mocks.wheelSpin.step).toHaveBeenLastCalledWith(1 / 60, "inertia");
  } finally { await act(async () => second.app.destroy()); }
});

it("keeps Debug experiment choices only through the explicit Ground handling action", async () => {
  const storage = environment();
  const view = await mount();
  try {
    await view.openTab("Debug");
    await act(async () => view.root.querySelector<HTMLInputElement>('[role="radiogroup"][aria-label="Wheel spin experiment"] input[value="instant"]')!.click());
    view.onStep();
    expect(mocks.wheelSpin.step).toHaveBeenLastCalledWith(1 / 60, "instant");
    expect(saved(storage)).not.toHaveProperty("osfs.ground.rotation");
    await view.openTab("Aircraft");
    const override = view.root.querySelector('[aria-label="Wheel experiment override"]')!;
    expect(override.textContent).toMatch(/Instant rolling/);
    const keep = override.querySelector<HTMLButtonElement>('button[aria-label="Keep experiment choices"]')!;
    expect(keep.textContent).toBe("Keep");
    await act(async () => keep.click());
    expect(saved(storage)).toMatchObject({ "osfs.ground.rotation": "instant" });
    expect(view.root.querySelector('[aria-label="Wheel experiment override"]')).toBeNull();
    // Keeping what already runs is not a pending mid-flight change.
    expect(view.root.querySelector('[aria-label="Wheel response status"]')).toBeNull();
  } finally { await act(async () => view.app.destroy()); }
});

it("drives gamepad haptics from accepted wheel cues and cancels them on pause", async () => {
  const actuator = { effects: ["dual-rumble"], playEffect: vi.fn(async () => "complete"), reset: vi.fn(async () => "complete") };
  const storage = environment([{ id: "pad", index: 0, connected: true, axes: [0, 0, 0, 0], buttons: [], vibrationActuator: actuator }]);
  storage.set("osfs.ground-interaction.v1", JSON.stringify({ version: 1, rotation: "inertia", haptics: "landing", hapticStrength: 1 }));
  mocks.wheelStates = [0, 1, 2].map(() => createWheelSpinState());
  const view = await mount();
  try {
    await view.openTab("Aircraft");
    expect(view.root.querySelector('[aria-label="Haptic devices"]')!.textContent).toMatch(/Gamepad: Ready/);
    view.onStep();
    for (const wheel of mocks.wheelStates.slice(1)) Object.assign(wheel, { onGround: true, normalLoadNewtons: 5_000, slipPowerWatts: 30_000 });
    for (let step = 0; step < 6; step++) view.onStep();
    await act(async () => view.tick(1 / 60));
    expect(actuator.playEffect).toHaveBeenCalledOnce();
    const [, params] = actuator.playEffect.mock.calls[0] as unknown as [string, { duration: number; strongMagnitude: number }];
    expect(params.duration).toBeLessThanOrEqual(60);
    expect(params.strongMagnitude).toBeGreaterThan(0);
    await view.pause();
    expect(actuator.reset).toHaveBeenCalled();
    await act(async () => view.tick(1 / 60));
    expect(actuator.playEffect).toHaveBeenCalledOnce();
  } finally {
    await act(async () => view.app.destroy());
    mocks.wheelStates = [];
  }
});
