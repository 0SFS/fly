// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vector3, type Quaternion } from "@babylonjs/core";
vi.mock("./hud/flightCompass", () => ({ createFlightCompass: () => ({ update: vi.fn(), destroy: vi.fn() }) }));
import type { PhoneControlSessionOptions } from "@0sfs/rc/createPhoneControlSession";
import type { ControlSurfaceState } from "@0sfs/controls/flightInputManager";
import type { FlightControlPanelOptions } from "./hud/FlightControlPanel";

const mocks = vi.hoisted(() => {
  const regionProgress: import("foss-earth/runtime").TerrainRegionProgress = {
    state: "ready", minimumReady: true, finalReady: true, readyTiles: 1, totalTiles: 1, pendingTiles: 0,
    estimatedRemainingMs: null, reason: null, groundHeightMeters: 250, sourceGeneration: 1,
  };
  const regionLeases: Array<{
    request: import("foss-earth/runtime").TerrainRegionOptions;
    progress: import("foss-earth/runtime").TerrainRegionProgress;
    emit(update: Partial<import("foss-earth/runtime").TerrainRegionProgress>): void;
    update: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    read(): import("foss-earth/runtime").TerrainRegionProgress;
  }> = [];
  const createRegionLease = (request: import("foss-earth/runtime").TerrainRegionOptions) => {
    let released = false;
    const lease = {
      request, progress: { ...regionProgress },
      update: vi.fn(() => queueMicrotask(() => { if (!released) request.onProgress?.(lease.progress); })),
      release: vi.fn(() => { released = true; }),
      setVisible: vi.fn(),
      read() { return lease.progress; },
      emit(update: Partial<import("foss-earth/runtime").TerrainRegionProgress>) {
        if (released) return;
        Object.assign(lease.progress, update);
        request.onProgress?.(lease.progress);
      },
    };
    regionLeases.push(lease);
    return lease;
  };
  const state = { latDeg: 1, lonDeg: 2, altMeters: 1000, headingRad: 0, airspeedKts: 110 };
  const snapshot = { owner: "local" as "local" | "phone", phase: "paired", quiet: false };
  const phoneControls = { elevator: -0.4, aileron: 0.6, rudder: 0.5, throttle: 0.83, pitchTrim: -0.2, rollTrim: 0.15, flaps: 1 / 3, brake: 1 };
  const engineVisualValues = new Map<string, number>();
  const phone = {
    subscribe: vi.fn(() => vi.fn()), getSnapshot: () => snapshot,
    beforeStep: vi.fn(), takeControl: vi.fn(), noteLocalInput: vi.fn(), isBlending: vi.fn(() => false), cancelHandoff: vi.fn(), reset: vi.fn(), isStarterHeld: vi.fn(() => false),
    takeCameraAim: vi.fn(() => null as { yaw: number; pitch: number; zoom?: number } | null),
    isCameraActive: vi.fn(() => false),
    hasPendingCameraAim: vi.fn(() => false),
    cameraFingers: vi.fn(() => null as number | null),
    onHidden: vi.fn(), syncStatus: vi.fn(), destroy: vi.fn(),
    isConnected: vi.fn(() => snapshot.phase === "paired"), setAttitude: vi.fn(), syncPhoneSettings: vi.fn(),
    getDroneCommand: vi.fn(() => null),
  };
  return {
    state, snapshot, phoneControls, phone, engineVisualValues, regionProgress, regionLeases, createRegionLease,
    createPhoneSession: vi.fn(() => phone),
    pairingPanel: { destroy: vi.fn() }, createPairingPanel: vi.fn(),
    resetLocation: vi.fn(() => state),
    sdk: {
      setPropertyValue: vi.fn(), run: vi.fn(),
      createPropertyBatch: vi.fn((paths: readonly string[]) => ({
        missing: [],
        read: vi.fn((target = new Float64Array(paths.length)) => {
          paths.forEach((path, index) => { target[index] = engineVisualValues.get(path) ?? Number.NaN; });
          return target;
        }),
        dispose: vi.fn(),
      })),
      // The engine runs, as a flight starts: an engine that is off holds the throttle at idle.
      getPropertyValue: vi.fn((property: string) => property === "fcs/throttle-cmd-norm" ? 0.65 : property === "gear/gear-cmd-norm" ? 1
        : property.endsWith("/set-running") ? 1 : 0),
    }, disposeSdk: vi.fn(),
    runtime: {
      renderer: { mode: "webgl2", engine: {} }, status: { mode: "fallback" }, scene: { onAfterRenderObservable: { add: () => null, remove: () => true } }, getViewState: () => null,
      onDeviceLost: vi.fn(() => () => {}), onDeviceRestored: vi.fn(() => () => {}),
      engine: { getFps: () => 60 }, geospatialCamera: null, prepareTerrain: vi.fn(async (request: { altitudeMeters?: number }) => ({ groundHeightMeters: 250, altitudeMeters: request.altitudeMeters ?? 1774 })),
      prepareTerrainRegion: vi.fn(createRegionLease),
      surface: { sample: vi.fn(() => null) },
      getWorldRoot: () => ({}), sky: { getEnvironment: () => null, subscribe: () => () => {}, setGroundLights: vi.fn(), setGroundLightReceiver: vi.fn() }, registerFocusPoint: vi.fn(() => () => {}), setSimViewState: vi.fn(), setSimTick: vi.fn(), setSimRunning: vi.fn(),
      getGoogleTerrainDetailState: vi.fn(() => null),
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
      setViewMode: vi.fn(), getViewMode: () => "third", toggleViewMode: vi.fn(), lookFromCockpit: vi.fn(), dispose: vi.fn(),
      orbitChaseCamera: vi.fn(), zoomChaseCamera: vi.fn(), setChaseFrame: vi.fn(), modelRoot: {}, setModelLoaded: vi.fn(), getChaseDistanceMeters: () => 14,
      thirdPersonCamera: { position: { y: 2.2, length: () => Math.hypot(2.2, 14) } },
    },
    aircraftModel: { getState: () => ({ status: "ready" }), getRig: () => null, setAircraft: vi.fn(), setLod: vi.fn(), setRenderStowedGear: vi.fn(), updateGearVisibility: vi.fn(), refreshAutoLod: vi.fn(), dispose: vi.fn() },
    terrainContact: { update: vi.fn(() => true), reset: vi.fn(), getRelocationProposal: vi.fn(() => null), declineRelocation: vi.fn(), acceptRelocation: vi.fn(), ignoreTerrainOverlap: vi.fn(), isTerrainIgnored: vi.fn(() => false), dispose: vi.fn() },
    visibleMeshCollision: { update: vi.fn(() => false), reset: vi.fn(), dispose: vi.fn(), setTerrainOverlapIgnored: vi.fn() },
    physics: {
      reset: vi.fn(), setPaused: vi.fn(), update: vi.fn(), getLatestState: () => state, getFault: () => null,
    },
    createHud: vi.fn(() => ({ update: vi.fn(), refreshFlaps: vi.fn(), isPilotHolding: vi.fn(() => false), setLayout: vi.fn(), setAttitudeSide: vi.fn(), setReadingTints: vi.fn(), setHidden: vi.fn(), destroy: vi.fn() })),
    createPanel: vi.fn(() => ({ update: vi.fn(), openOrSelectTab: vi.fn(), toggleTab: vi.fn(), destroy: vi.fn() })),
    createHudBar: vi.fn(() => ({ update: vi.fn(), setLayout: vi.fn(), destroy: vi.fn() })),
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
vi.mock("foss-earth/input", () => ({
  loadInputModePreference: () => "mouse", loadInputSensitivityPreference: () => ({}),
  loadOrbitInvertSettings: () => ({ invertYaw: false, invertPitch: false, recenterMode: "hold" }),
  saveOrbitInvertSettings: vi.fn(),
  attachPanoramaLook: () => ({
    get: () => ({ headingDeg: 0, pitchDeg: 0, verticalFovDeg: 60 }), set: vi.fn(), setRates: vi.fn(),
    step: () => false, moving: () => false, detach: vi.fn(),
  }),
}));
vi.mock("./jsbsim/createJsbsimRuntime", () => ({ createJsbsimRuntime: async () => ({ physicsHz: 60, sdk: mocks.sdk, dispose: mocks.disposeSdk }) }));
vi.mock("@0sfs/ground-contact/ecefBridge", () => ({ readFlightState: () => mocks.state }));
vi.mock("./bridge/floatingOrigin", () => ({ createFloatingOrigin: () => ({ aircraftRoot: { setEnabled: vi.fn() }, apply: vi.fn(), dispose: vi.fn() }) }));
vi.mock("@0sfs/aircraft/createPlaceholderAircraft", () => ({ createPlaceholderAircraft: () => mocks.aircraft }));
vi.mock("@0sfs/aircraft/createAircraftModel", () => ({ createAircraftModel: () => mocks.aircraftModel }));
vi.mock("@0sfs/aircraft/createAircraftLights", () => ({ createAircraftLights: () => ({ refresh: vi.fn(), dispose: vi.fn() }) }));
vi.mock("@0sfs/fuel/createExternalTankVisuals", () => ({ createExternalTankVisuals: () => ({
  ready: Promise.resolve(), sync: vi.fn(), jettison: vi.fn(), update: vi.fn(),
  setLifetimeSeconds: vi.fn(), setMaxDetachedTanks: vi.fn(), resetDetached: vi.fn(), dispose: vi.fn(),
}) }));
vi.mock("@0sfs/aircraft/aircraftAnimation", () => ({ applyAircraftRig: vi.fn(), readControlSurfaceState: vi.fn(() => ({ gearDownNorm: 1 })) }));
vi.mock("./physics/fixedStepLoop", () => ({ createFixedStepPhysicsLoop: () => mocks.physics }));
vi.mock("@0sfs/ground-contact/terrainContact", () => ({ createTerrainContact: () => mocks.terrainContact }));
vi.mock("@0sfs/ground-contact/visibleMeshCollision", () => ({ createVisibleMeshCollision: () => mocks.visibleMeshCollision }));
vi.mock("@0sfs/controls/flightCameraInput", () => ({ attachFlightCameraInput: () => vi.fn() }));
vi.mock("./hud/flightHud", () => ({ createFlightHud: mocks.createHud }));
vi.mock("./hud/createFlightControlPanel", () => ({ createFlightControlPanel: mocks.createPanel }));
vi.mock("./hud/createFlightHudBar", () => ({ createFlightHudBar: mocks.createHudBar }));
vi.mock("./jsbsim/resetFlightLocation", () => ({ resetFlightLocation: mocks.resetLocation }));
vi.mock("@0sfs/rc/createPhoneControlSession", () => ({ createPhoneControlSession: mocks.createPhoneSession }));
vi.mock("@0sfs/rc/createPhonePairingPanel", () => ({ createPhonePairingPanel: mocks.createPairingPanel }));

import { getAppSettings, resetAppSettings } from "foss-earth/settings";
import { createFlightSimApp } from "./createFlightSimApp";
import { registerFlightSettings } from "./settings/registerFlightSettings";
import { getAircraftDefinition } from "@0sfs/aircraft/aircraftCatalog";
import { setDroneRefusal } from "./drone/droneGate";
import { parseMessage } from "@0sfs/rc/protocol";

let app: Awaited<ReturnType<typeof createFlightSimApp>> | null = null;
let tick: (dt: number) => void;
let options: PhoneControlSessionOptions;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.engineVisualValues.clear();
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: vi.fn(() => []) });
  mocks.snapshot.owner = "local";
  mocks.snapshot.quiet = false;
  mocks.createPairingPanel.mockReturnValue(mocks.pairingPanel);
  mocks.terrainContact.update.mockReturnValue(true);
  mocks.visibleMeshCollision.update.mockReturnValue(false);
  mocks.physics.update.mockImplementation((_dt, apply: () => boolean | void | "reset") => {
    if (apply() !== false) mocks.sdk.run();
    return mocks.state;
  });
  mocks.phone.beforeStep.mockImplementation((local: ControlSurfaceState) => mocks.snapshot.owner === "phone" ? { ...mocks.phoneControls } : local);
  const revokePhone = () => {
    if (mocks.snapshot.owner === "local") return;
    const controls = options.getStatus().controls;
    mocks.snapshot.owner = "local";
    options.onOwnershipChange("local", controls, false);
  };
  mocks.phone.takeControl.mockImplementation(() => options.setPriority?.("computer"));
  mocks.phone.isBlending.mockImplementation(() => mocks.snapshot.owner === "phone");
  mocks.phone.noteLocalInput.mockImplementation(() => {});
  mocks.phone.reset.mockImplementation(revokePhone);
});

afterEach(() => {
  app?.destroy(); app = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
  resetAppSettings();
});

/** What the flight hands the side panel; the Remote Control tab calls into it. */
function panelOptions() {
  return mocks.createPanel.mock.calls.at(-1)![2] as FlightControlPanelOptions;
}

async function mount(pair = true) {
  const root = document.createElement("div");
  document.body.append(root);
  app = await createFlightSimApp(root);
  tick = mocks.runtime.setSimTick.mock.calls.at(-1)![0];
  if (pair) {
    await panelOptions().loadPhonePairing();
    options = mocks.createPhoneSession.mock.calls[0][0];
  }
  return root;
}

function grant() {
  mocks.snapshot.owner = "phone";
  options.onOwnershipChange("phone", { ...mocks.phoneControls, elevator: 0, aileron: 0, rudder: 0, brake: 0 }, true);
}

describe("0SFS phone integration", () => {
  it("applies the plane side preference live independently of the drone preference", async () => {
    await mount();
    const hud = mocks.createHud.mock.results.at(-1)!.value;
    expect(hud.setAttitudeSide).toHaveBeenLastCalledWith("left");
    getAppSettings().set("osfs.hud.planeAttitudeSide", "right");
    expect(hud.setAttitudeSide).toHaveBeenLastCalledWith("right");
    const calls = hud.setAttitudeSide.mock.calls.length;
    getAppSettings().set("osfs.hud.droneAttitudeSide", "left");
    expect(hud.setAttitudeSide).toHaveBeenCalledTimes(calls);
  });

  it("uses declared capabilities for both HUD and phone controls", async () => {
    const definition = getAircraftDefinition("cessna-172");
    const previous = definition.controls;
    definition.controls = { ...previous, flaps: false, pitchTrim: false, rollTrim: false, landingGear: false };
    try {
      await mount();
      const capabilities = { flaps: false, pitchTrim: false, rollTrim: false, landingGear: false };
      expect(mocks.createHud.mock.calls.at(-1)![1]).toMatchObject({ drone: false, capabilities });
      const status = options.getStatus();
      expect(status.controlCapabilities).toEqual(capabilities);
      for (const key of ["gearDown", "autoFlaps", "autoTrim"]) expect(status).not.toHaveProperty(key);
      expect(options.setGearDown).toBeUndefined();
      expect(options.setAutoFlaps).toBeUndefined();
      expect(options.setAutoTrim).toBeUndefined();
    } finally { definition.controls = previous; }
  });

  it("distinguishes automatic trim and flap travel from deliberate desktop input during handoff", async () => {
    const previousRead = mocks.sdk.getPropertyValue.getMockImplementation()!;
    let flaps = 0;
    mocks.sdk.getPropertyValue.mockImplementation(property => {
      if (property === "aero/qbar-psf") return 40;
      if (property === "velocities/vt-fps") return 120;
      if (property === "accelerations/qdot-rad_sec2") return 0.3;
      if (property === "accelerations/pdot-rad_sec2") return 0.2;
      if (property === "fcs/flap-pos-deg") return flaps * 30;
      return previousRead(property);
    });
    try {
      await mount();
      const revision = options.getLocalInputRevision!();
      const baseline = options.getStatus().controls;
      for (const position of [0.2, 0.4]) {
        flaps = position;
        mocks.engineVisualValues.set("fcs/flap-pos-deg", position * 30);
        tick(1 / 60);
      }
      expect(options.getStatus().controls.pitchTrim).not.toBe(baseline.pitchTrim);
      expect(options.getStatus().controls.rollTrim).not.toBe(baseline.rollTrim);
      expect(options.getStatus().actualControls?.flaps).toBeCloseTo(0.4);
      expect(options.getStatus().controls.flaps).not.toBeCloseTo(0.4);
      expect(options.getLocalInputRevision!()).toBe(revision);
      expect(mocks.phone.noteLocalInput).not.toHaveBeenCalled();

      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
      expect(options.getLocalInputRevision!()).toBeGreaterThan(revision);
      expect(mocks.phone.noteLocalInput).toHaveBeenCalledOnce();
    } finally { mocks.sdk.getPropertyValue.mockImplementation(previousRead); }
  });

  it("keeps Auto flaps through unchanged phone packets as actual travel changes, then yields to fresh phone input", async () => {
    const previousRead = mocks.sdk.getPropertyValue.getMockImplementation()!;
    let actual = 0;
    mocks.sdk.getPropertyValue.mockImplementation(property => property === "fcs/flap-pos-deg" ? actual * 30 : previousRead(property));
    try {
      await mount(); grant();
      for (const position of [0.4, 0.6]) {
        actual = position; tick(1 / 60);
        expect(getAppSettings().get("osfs.assist.autoFlaps")).toBe(true);
        expect(mocks.snapshot.owner).toBe("phone");
      }
      mocks.phone.beforeStep.mockImplementation(() => ({ ...mocks.phoneControls, flaps: 0.8 }));
      tick(1 / 60);
      expect(getAppSettings().get("osfs.assist.autoFlaps")).toBe(false);
      expect(mocks.sdk.setPropertyValue).toHaveBeenCalledWith("fcs/flap-cmd-norm", 0.8);
      expect(mocks.snapshot.owner).toBe("phone");
      expect(mocks.phone.noteLocalInput).not.toHaveBeenCalled();
    } finally { mocks.sdk.getPropertyValue.mockImplementation(previousRead); }
  });

  it("makes the phone session only when the Remote Control tab asks, once, and leaves flight unchanged", async () => {
    await mount(false);
    expect(mocks.createPhoneSession).not.toHaveBeenCalled();
    tick(1 / 60);
    expect(mocks.sdk.setPropertyValue).toHaveBeenCalledWith("fcs/throttle-cmd-norm", 0.65);

    const mountPairing = await panelOptions().loadPhonePairing();
    expect(mocks.createPhoneSession).toHaveBeenCalledOnce();
    const host = document.createElement("div");
    expect(mountPairing(host, { pairOnOpen: true })).toBe(mocks.pairingPanel);
    expect(mocks.createPairingPanel).toHaveBeenCalledWith(host, mocks.phone, { pairOnOpen: true });
    // The tab comes and goes with the panel; the session and its phone stay.
    expect(await panelOptions().loadPhonePairing()).toBe(mountPairing);
    expect(mocks.createPhoneSession).toHaveBeenCalledOnce();
    expect(mocks.runtime.setSimRunning).toHaveBeenLastCalledWith(true);
  });

  it("lets the tab try again after pairing failed to load", async () => {
    await mount(false);
    mocks.createPhoneSession.mockImplementationOnce(() => { throw new Error("offline"); });
    await expect(panelOptions().loadPhonePairing()).rejects.toThrow("offline");

    await panelOptions().loadPhonePairing();
    expect(mocks.createPhoneSession).toHaveBeenCalledTimes(2);
  });

  it("switches this device to the controller at a clean /rc/, leaving the simulator", async () => {
    await mount(false);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, href: "https://0sfs.github.io/fly/?key=secret#spot", origin: "https://0sfs.github.io", assign });
    panelOptions().onUseAsRemote();
    vi.unstubAllGlobals();

    expect(assign).toHaveBeenCalledWith("/rc/");
    expect(mocks.createPhoneSession).not.toHaveBeenCalled();
  });

  it("keeps the phone active under Mac keys and selects priority without replacing either pilot's controls", async () => {
    await mount();
    getAppSettings().set("osfs.assist.autoFlaps", false);
    grant();
    tick(1 / 60);
    expect(mocks.sdk.setPropertyValue).toHaveBeenCalledWith("fcs/elevator-cmd-norm", -0.4);
    expect(mocks.sdk.setPropertyValue).toHaveBeenCalledWith("fcs/aileron-cmd-norm", 0.6);
    expect(mocks.sdk.setPropertyValue).toHaveBeenCalledWith("fcs/rudder-cmd-norm", -0.5);
    expect(options.getStatus().controls).toEqual(mocks.phoneControls);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(mocks.phone.noteLocalInput).toHaveBeenCalledOnce();
    expect(options.getStatus().owner).toBe("phone");
    expect(mocks.phone.takeControl).not.toHaveBeenCalled();
    const last = (property: string) => mocks.sdk.setPropertyValue.mock.calls.filter(([name]) => name === property).at(-1)?.[1];
    tick(0.1);
    // Phone priority: its -0.4 plus the key's 0.8 using the remaining travel.
    expect(last("fcs/elevator-cmd-norm")).toBeCloseTo(-0.4 + 0.6 * 0.8);
    options.setPriority!("computer");
    expect(getAppSettings().get("osfs.remote.blendPriority")).toBe("computer");
    tick(0);
    expect(last("fcs/elevator-cmd-norm")).toBeCloseTo(0.8 + 0.2 * -0.4);
    expect(options.getStatus().owner).toBe("phone");
    options.setPriority!("phone");
    tick(0);
    expect(last("fcs/elevator-cmd-norm")).toBeCloseTo(-0.4 + 0.6 * 0.8);
    expect(options.getStatus().controls.throttle).toBe(0.83);
    expect(options.getStatus().controls.pitchTrim).toBe(-0.2);
    expect(options.getStatus().controls.flaps).toBe(1 / 3);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
  });

  it("blends this computer's keys with a blending phone's frame at the SDK boundary, and its levers follow", async () => {
    await mount();
    getAppSettings().set("osfs.assist.autoFlaps", false);
    const last = (property: string) => mocks.sdk.setPropertyValue.mock.calls.filter(([name]) => name === property).at(-1)?.[1];
    // A key held here before the phone joins keeps counting after it does.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    mocks.snapshot.owner = "phone";
    mocks.phone.isBlending.mockImplementation(() => true);
    options.onOwnershipChange("phone", { ...mocks.phoneControls, elevator: 0, aileron: 0, rudder: 0, brake: 0 }, true);
    mocks.phone.takeControl.mockClear();
    tick(0.1);
    // The phone's 0.6 has priority; the keys' 0.8 gets the 0.4 it leaves free.
    expect(last("fcs/aileron-cmd-norm")).toBeCloseTo(0.6 + 0.4 * 0.8);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(mocks.phone.takeControl).not.toHaveBeenCalled();
    tick(0.1);
    // Against the phone's -0.4 nose-down: -0.4 + 0.6 × 0.8.
    expect(last("fcs/elevator-cmd-norm")).toBeCloseTo(0.08);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft" }));
    tick(0.1);
    // A lever goes where it was last moved: the keys moved the throttle, the phone did not.
    expect(last("fcs/throttle-cmd-norm")).toBeCloseTo(0.83 + 0.5 * 0.1);
    expect(options.getStatus().controls.throttle).toBeCloseTo(0.88);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ShiftLeft" }));
  });

  it("aborts the current physics step when the freshness guard revokes ownership", async () => {
    await mount();
    grant();
    mocks.phone.beforeStep.mockImplementation(() => {
      mocks.phone.reset();
      options.setPaused(true);
      return false;
    });
    tick(1 / 60);
    expect(mocks.sdk.setPropertyValue).not.toHaveBeenCalled();
    expect(mocks.sdk.run).not.toHaveBeenCalled();
    expect(mocks.runtime.setSimRunning).toHaveBeenLastCalledWith(false);
    expect(mocks.physics.setPaused).toHaveBeenLastCalledWith(true);
  });

  it("does not write controls if a guard pauses while returning a snapshot", async () => {
    await mount();
    grant();
    mocks.phone.beforeStep.mockImplementation(() => { options.setPaused(true); return mocks.phoneControls; });
    tick(1 / 60);
    expect(mocks.sdk.setPropertyValue).not.toHaveBeenCalled();
    expect(mocks.sdk.run).not.toHaveBeenCalled();
  });

  it("checks freshness after synchronous terrain and collision work, including a collision reset", async () => {
    await mount();
    grant();
    let expired = false;
    mocks.phone.beforeStep.mockImplementation(() => expired ? false : mocks.phoneControls);
    mocks.terrainContact.update.mockImplementation(() => {
      // The first call is outside the physics loop. The second represents an
      // expensive in-step surface sample exhausting the input lease.
      if (mocks.terrainContact.update.mock.calls.length >= 2) expired = true;
      return true;
    });
    mocks.visibleMeshCollision.update.mockReturnValue(true);
    tick(1 / 60);
    expect(mocks.phone.beforeStep).toHaveBeenCalledOnce();
    expect(mocks.sdk.setPropertyValue).not.toHaveBeenCalled();
    expect(mocks.sdk.run).not.toHaveBeenCalled();
  });

  it("keeps ownership through explicit pause, cancels handoff immediately, and preserves the resume delta guard", async () => {
    await mount();
    grant();
    // A handoff re-arms profile commands; the next flight frame samples input.
    tick(1 / 60);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyP" }));
    expect(mocks.snapshot.owner).toBe("phone");
    expect(mocks.phone.takeControl).not.toHaveBeenCalled();
    expect(mocks.phone.cancelHandoff).toHaveBeenCalledOnce();
    expect(mocks.phone.syncStatus).toHaveBeenCalledOnce();
    options.setPaused(false);
    tick(60);
    expect(mocks.physics.update).toHaveBeenLastCalledWith(0, expect.any(Function));
  });

  it("keeps a paused Yaw spring drawing and applies spring time changes live", async () => {
    await mount();
    const originalHeading = mocks.state.headingRad;
    try {
      options.setPaused(true);
      const settings = getAppSettings();
      settings.set("osfs.camera.chaseFrame", "yaw");
      settings.set("osfs.camera.yawSpringTime", .5);
      tick(0);
      mocks.state.headingRad = originalHeading + Math.PI / 2;
      mocks.runtime.requestRender.mockClear();
      tick(1 / 60);
      const actualHeading = () => {
        const rotation = mocks.aircraft.setChaseFrame.mock.calls.at(-1)![0] as Quaternion;
        const forward = new Vector3(0, 0, 1).applyRotationQuaternion(rotation);
        return Math.atan2(forward.x, -forward.z);
      };
      const delta = Math.atan2(Math.sin(actualHeading() - originalHeading), Math.cos(actualHeading() - originalHeading));
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThan(.01);
      expect(mocks.runtime.requestRender).toHaveBeenCalled();
      settings.set("osfs.camera.yawSpringTime", 0);
      tick(1 / 60);
      expect(actualHeading()).toBeCloseTo(mocks.state.headingRad, 10);
    } finally { mocks.state.headingRad = originalHeading; }
  });

  it("draws the phone's camera swipe once with Glide off, at the mouse's rate, and pinches the chase distance", async () => {
    // Stored, so the tests after this one start from the default again.
    getAppSettings().set("camera.inertiaDecay", 0);
    try {
      await mount();
      grant();
      // A gesture is what the fingers did, not a rate: the frame length cannot
      // change how far a swipe moves the view.
      mocks.phone.takeCameraAim.mockReturnValueOnce({ yaw: 0.1, pitch: -0.05 });
      tick(0.1);
      expect(mocks.aircraft.orbitChaseCamera).toHaveBeenCalledWith(expect.closeTo(0.5, 5), expect.closeTo(-0.25, 5));
      // Drained by the session, so the next frame draws nothing further.
      mocks.aircraft.orbitChaseCamera.mockClear();
      tick(0.1);
      expect(mocks.aircraft.orbitChaseCamera).not.toHaveBeenCalled();
      // Pinching apart brings the aircraft closer, which is a smaller distance.
      mocks.phone.takeCameraAim.mockReturnValueOnce({ yaw: 0, pitch: 0, zoom: 2 });
      tick(0.1);
      expect(mocks.aircraft.zoomChaseCamera).toHaveBeenCalledWith(0.5);
      expect(mocks.aircraftModel.refreshAutoLod).toHaveBeenCalled();
    } finally {
      getAppSettings().reset("camera.inertiaDecay");
    }
  });

  it("glides the phone's camera swipe on from the lift, and stops it where a finger lands", async () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const frame = () => { now += 1000 / 60; tick(1 / 60); };
    const turned = () => (mocks.aircraft.orbitChaseCamera.mock.calls as unknown as [number, number][])
      .reduce((sum, [yaw]) => sum + yaw, 0);
    await mount();
    grant();
    // A finger swipes 0.01 rad a frame for six frames.
    mocks.phone.cameraFingers.mockReturnValue(1);
    for (let index = 0; index < 6; index++) {
      mocks.phone.takeCameraAim.mockReturnValueOnce({ yaw: 0.002, pitch: 0 });
      frame();
    }
    // The camera eases in behind the finger.
    expect(turned()).toBeGreaterThan(0);
    expect(turned()).toBeLessThan(0.06);
    // It lifts: the camera goes on past where the finger took it.
    mocks.phone.cameraFingers.mockReturnValue(0);
    for (let index = 0; index < 30; index++) frame();
    expect(turned()).toBeGreaterThan(0.06);
    // A finger landing stops it there.
    mocks.phone.cameraFingers.mockReturnValue(1);
    frame();
    const stopped = turned();
    for (let index = 0; index < 10; index++) frame();
    expect(turned()).toBe(stopped);
  });

  it("leaves the chase camera where it was after a swipe made in the cockpit", async () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const frame = () => { now += 1000 / 60; tick(1 / 60); };
    let view: "first" | "third" = "first";
    vi.spyOn(mocks.aircraft, "getViewMode").mockImplementation(() => view);
    await mount();
    grant();
    // A flick and a lift in the cockpit, where the camera pad turns nothing.
    mocks.phone.cameraFingers.mockReturnValue(1);
    for (let index = 0; index < 6; index++) {
      mocks.phone.takeCameraAim.mockReturnValueOnce({ yaw: 0.05, pitch: 0 });
      frame();
    }
    mocks.phone.cameraFingers.mockReturnValue(0);
    frame();
    // Out to the chase view while it would still be gliding.
    view = "third";
    for (let index = 0; index < 60; index++) frame();
    expect(mocks.aircraft.orbitChaseCamera).not.toHaveBeenCalled();
  });

  it("reports the engine reading the HUD is drawing, so the phone shows the same one", async () => {
    await mount();
    grant();
    tick(1 / 60);
    // The mocked model publishes nothing readable, so the phase is still a
    // label and every number is absent rather than a zero the phone would show.
    // What the throttle lever needs comes with it: the engine runs, so the
    // phone's lever offers the shutdown hold rather than a start.
    expect(options.getStatus().engine).toEqual({
      phase: expect.stringMatching(/^[A-Z][A-Z ]*$/), state: "running", start: 1,
      kind: "piston", maxRpm: 2700,
      rotorBlades: { outer: 2, inner: null, outerEstimated: false, innerEstimated: false },
      orbs: { fps: 1000, turnsPerSecond: 2, maxPatternStep: 0.45, pixelRatio: 2, renderer: "auto" },
    });
  });

  it("keeps the WebGPU capture refusal valid on the phone protocol", async () => {
    await mount();
    grant();
    tick(1 / 60);
    setDroneRefusal("360° capture requires WebGPU.");
    try {
      const status = options.getStatus();
      expect(status.engine?.blocked).toBe("360 capture requires WebGPU.");
      expect(parseMessage({ v: 1, type: "heartbeat", session: "test", epoch: 0, lease: 1, status }))
        .toMatchObject({ status: { engine: { blocked: "360 capture requires WebGPU." } } });
    } finally {
      setDroneRefusal(null);
    }
  });

  it("hides this computer's flight UI for a phone, but not past a key pressed here or a phone gone quiet", async () => {
    await mount();
    const hud = mocks.createHud.mock.results[0].value as { setHidden: ReturnType<typeof vi.fn> };
    // The session says when it changes; this one is paired.
    const changed = (mocks.phone.subscribe.mock.calls as unknown as [() => void][])[0][0];
    changed();
    expect(hud.setHidden).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", code: "KeyW" }));
    expect(hud.setHidden).toHaveBeenLastCalledWith(false);
    options.onPhoneInput!();
    expect(hud.setHidden).toHaveBeenLastCalledWith(true);
    mocks.snapshot.quiet = true;
    changed();
    expect(hud.setHidden).toHaveBeenLastCalledWith(false);
    mocks.snapshot.quiet = false;
    changed();
    expect(hud.setHidden).toHaveBeenLastCalledWith(true);
    // The setting on, both screens have it.
    registerFlightSettings(getAppSettings()).set("osfs.remote.hostFlightUi", true);
    expect(hud.setHidden).toHaveBeenLastCalledWith(false);
    expect(hud.setHidden).toHaveBeenCalledTimes(6);
  });

  it("offers the phone the HUD's trim assists, and switches each from it on its own", async () => {
    const parameters = registerFlightSettings(getAppSettings());
    parameters.set("osfs.assist.autoTrim", false);
    parameters.set("osfs.assist.autoRollTrim", false);
    await mount();
    expect(options.getStatus().autoTrim).toEqual({ pitch: false, roll: false });
    options.setAutoTrim!("roll", true);
    expect(options.getStatus().autoTrim).toEqual({ pitch: false, roll: true });
    options.setAutoTrim!("pitch", true);
    options.setAutoTrim!("roll", false);
    expect(options.getStatus().autoTrim).toEqual({ pitch: true, roll: false });
    expect([parameters.get("osfs.assist.autoTrim"), parameters.get("osfs.assist.autoRollTrim")]).toEqual([true, false]);
  });

  it("shares the F-35 afterburner accent through cached native visuals and the phone status", async () => {
    const parameters = registerFlightSettings(getAppSettings());
    const previousAircraft = parameters.get("osfs.aircraft.id");
    parameters.set("osfs.aircraft.id", "f-35b");
    try {
      await mount();
      grant();
      const accent = getAircraftDefinition("f-35b").afterburner!.accentColor;
      for (const observed of [0, 1, Number.NaN, 0]) {
        mocks.engineVisualValues.set("propulsion/engine[0]/augmentation", observed);
        tick(1 / 60);
        expect(options.getStatus().engine?.afterburnerColor).toBe(observed === 1 ? accent : undefined);
      }
      const visualBatches = mocks.sdk.createPropertyBatch.mock.calls.flatMap(([paths], index) =>
        paths.includes("propulsion/engine[0]/augmentation") ? [mocks.sdk.createPropertyBatch.mock.results[index].value] : []);
      expect(visualBatches).toHaveLength(1);
      expect(visualBatches[0].read).toHaveBeenCalledTimes(4);
      expect(mocks.sdk.getPropertyValue).not.toHaveBeenCalledWith("propulsion/engine[0]/augmentation");
    } finally {
      app?.destroy(); app = null;
      parameters.set("osfs.aircraft.id", previousAircraft);
    }
  });

  it("adopts reset state and clears a held local key before a general reposition", async () => {
    await mount();
    getAppSettings().set("osfs.assist.autoFlaps", false);
    grant(); tick(1 / 60);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    tick(0.1);
    expect(options.hasActiveLocalInput()).toBe(true);
    const callbacks = mocks.createPanel.mock.calls[0][2] as { onLocationApply(location: { latDeg: number; lonDeg: number }): void };
    mocks.resetLocation.mockClear();
    callbacks.onLocationApply({ latDeg: 3, lonDeg: 4 });
    [...document.querySelectorAll<HTMLButtonElement>('.flight-placement-dialog button')].find(button => button.textContent === "Yes")!.click();
    await vi.waitFor(() => expect(mocks.resetLocation).toHaveBeenCalledOnce());
    expect(mocks.phone.reset).toHaveBeenCalledOnce();
    expect(mocks.phone.reset.mock.invocationCallOrder[0]).toBeLessThan(mocks.resetLocation.mock.invocationCallOrder[0]);
    expect(options.hasActiveLocalInput()).toBe(false);
    expect(options.getStatus().controls).toEqual({ ...mocks.phoneControls, elevator: 0, aileron: 0, rudder: 0, brake: 0 });
  });

  it("notifies phone state on desktop view changes and pauses/revokes through the visibility handler", async () => {
    await mount();
    grant();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV" }));
    expect(mocks.phone.noteLocalInput).not.toHaveBeenCalled();
    expect(mocks.phone.syncStatus).toHaveBeenCalledOnce();
    const callbacks = mocks.createPanel.mock.calls[0][2] as { onViewModeChange(mode: "first"): void };
    callbacks.onViewModeChange("first");
    expect(mocks.phone.syncStatus).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.phone.onHidden).toHaveBeenCalledOnce();
  });

  it("detaches the session, callbacks, input, and SDK on destroy and ignores late render callbacks", async () => {
    const root = await mount();
    app!.destroy(); app = null;
    const writes = mocks.sdk.setPropertyValue.mock.calls.length;
    tick(1 / 60);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mocks.phone.destroy).toHaveBeenCalledOnce();
    expect(mocks.runtime.setSimTick).toHaveBeenLastCalledWith(null);
    expect(mocks.sdk.setPropertyValue).toHaveBeenCalledTimes(writes);
    expect(mocks.phone.noteLocalInput).not.toHaveBeenCalled();
    expect(mocks.phone.onHidden).not.toHaveBeenCalled();
    expect(mocks.disposeSdk).toHaveBeenCalledOnce();
    expect(root.children).toHaveLength(0);
  });

  it("does not create a late session when destroyed during lazy loading", async () => {
    await mount(false);
    const loading = panelOptions().loadPhonePairing();
    app!.destroy(); app = null;
    await expect(loading).rejects.toThrow();
    expect(mocks.createPhoneSession).not.toHaveBeenCalled();
    expect(mocks.createPairingPanel).not.toHaveBeenCalled();
  });
});
