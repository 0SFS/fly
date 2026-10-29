// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Matrix, Vector3 } from "@babylonjs/core";
import * as aircraftCatalog from "@0sfs/aircraft/aircraftCatalog";
import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import type { DjiQuadModData, QuadcopterModData, QuadVehicleModData } from "@0sfs/mods/schema";
import { releaseFlightStateReads } from "@0sfs/ground-contact/ecefBridge";
import common from "../../../../Quadcopter/public/0sfs-mod.json";
import dji from "../../../../DJI-Quadcopter/public/0sfs-mod.json";
import camera from "../../../../DJI-FC7303/public/0sfs-mod.json";
import mini from "../../../../DJI-Mini2/public/0sfs-mod.json";
import { attach } from "./droneFeature";
import type { CaptureRig } from "@0sfs/drone-camera/captureFrame";
import { noteActiveAircraft, droneHeldCapture, droneHeldGimbal, droneMotorTelemetry, setDroneHeldCapture, setDroneHeldGimbal, setDroneRefusal, droneTelemetry, type DroneFeatureHooks, type DroneStickCommand, type DroneViewContext } from "./droneGate";
import { installDroneCamera, installDjiCommon, installQuadCommon, installQuadVehicle, uninstallQuadVehicle } from "./quadRegistry";
import { getAppSettings } from "foss-earth/settings";

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  render: vi.fn(),
  pose: vi.fn(),
  rotor: vi.fn(),
  capture: vi.fn<CaptureRig["capture"]>(async () => ({ jpeg: new Uint8Array([0xff, 0xd8]), width: 4000, height: 3000, scale: 1 })),
}));
vi.mock("@0sfs/drone-camera/captureFrame", () => ({
  createCaptureRig: () => ({ capture: mocks.capture, proxy: vi.fn(async () => null), dispose: vi.fn() }),
}));
vi.mock("@0sfs/drone-camera/zipStore", async importOriginal => ({
  ...await importOriginal<typeof import("@0sfs/drone-camera/zipStore")>(), downloadZip: mocks.download,
}));
vi.mock("./droneGimbal", () => ({
  createDroneGimbal: () => ({ base: { parent: null }, camera: {}, pose: mocks.pose, followView: vi.fn(), dispose: vi.fn() }),
}));
vi.mock("@0sfs/multirotor/wasm", () => ({ loadMultirotor: () => new Promise(() => {}) }));
vi.mock("@0sfs/rotating-prop", async importOriginal => ({
  ...await importOriginal<typeof import("@0sfs/rotating-prop")>(), createRotatingProp: mocks.rotor,
}));

const command: DroneStickCommand = {
  pitch: 0, roll: 0, vertical: 0, yaw: 0, yawMode: "angularVelocity", yawAngleDeg: null,
  gimbalPitchDeg: 0, sport: false, shutter: false, capture360: true,
};
let hooks: DroneFeatureHooks | null;
let sdk: JSBSimSdk;
let altitudeFt: number;
let simTimeS: number;
const viewState = {
  latDeg: 45, lonDeg: -93, altMeters: 300, rollRad: 0, pitchRad: 0, headingRad: 0,
  airspeedKts: 0, northVelocityFps: 0, eastVelocityFps: 0, verticalSpeedFps: 0, throttleNorm: 0.5,
};

beforeEach(() => {
  mocks.capture.mockClear();
  mocks.download.mockClear();
  mocks.render.mockClear();
  mocks.pose.mockClear();
  mocks.rotor.mockReset().mockImplementation(() => ({ update: vi.fn(), dispose: vi.fn() }));
  setDroneHeldCapture(false);
  setDroneHeldGimbal(0);
  hooks = null;
  altitudeFt = 1000;
  simTimeS = 0;
  const getPropertyValue = (path: string) => ({
    "position/h-sl-ft": altitudeFt, "position/lat-geod-deg": 45, "position/long-gc-deg": -93,
    "attitude/phi-deg": 5, "attitude/theta-deg": 10, "attitude/psi-deg": 0,
    "attitude/phi-rad": 5 * Math.PI / 180, "attitude/theta-rad": 10 * Math.PI / 180,
    "inertia/mass-slugs": .249 / 14.5939029,
    "inertia/ixx-slugs_ft2": 3.2e-4 / (4.4482216152605 * .3048),
    "inertia/iyy-slugs_ft2": 4.341e-4 / (4.4482216152605 * .3048),
    "inertia/izz-slugs_ft2": 6.932e-4 / (4.4482216152605 * .3048),
    "atmosphere/rho-slugs_ft3": 1.225 / 515.3788184,
    "simulation/sim-time-sec": simTimeS,
  }[path] ?? 0);
  sdk = {
    getPropertyValue,
    setPropertyValue: vi.fn(),
    createPropertyBatch: vi.fn((paths: readonly string[]) => ({
      read: (target = new Float64Array(paths.length)) => {
        target.set(paths.map(getPropertyValue));
        return target;
      },
      write: vi.fn(), dispose: vi.fn(),
    })),
  } as unknown as JSBSimSdk;
  installQuadCommon(common.quadcopter as QuadcopterModData);
  installDjiCommon(dji.dji as DjiQuadModData);
  installDroneCamera(camera.id, camera.camera);
  installQuadVehicle("dji-mini-2", "Mini 2", mini.quad as QuadVehicleModData);
  noteActiveAircraft("dji-mini-2");
  attach({ setHooks: next => { hooks = next; }, setMesh: () => {} });
});
afterEach(() => {
  hooks?.dispose();
  releaseFlightStateReads(sdk);
  uninstallQuadVehicle("dji-mini-2");
  noteActiveAircraft("cessna-172");
  document.body.replaceChildren();
});

function step(terrainMeters: number | null, capture360 = true) {
  simTimeS += 1 / 120;
  hooks!.beforeStep({ dtSeconds: 1 / 120, sdk, command: { ...command, capture360 }, terrainMeters });
}

describe("simulated motor telemetry", () => {
  it("publishes live rotor speeds and directions, and freezes the physics clock while paused", () => {
    step(200, false); mountView();
    const telemetry = droneMotorTelemetry()!;
    expect(telemetry).toMatchObject({ aircraftId: "dji-mini-2", source: "simulated", maxRpm: 13300, simTimeS });
    expect(telemetry.hoverRpm).toBeGreaterThan(8000);
    expect(telemetry.motors.map(motor => [motor.position, motor.direction]))
      .toEqual(mini.quad.rotors.map(rotor => [rotor.position, rotor.spin]));
    for (const motor of telemetry.motors) expect(motor.rpm).toBeGreaterThan(8000);
    mountView(true);
    expect(droneMotorTelemetry()).toEqual(telemetry);
    const create = vi.mocked(sdk.createPropertyBatch);
    const disposals = create.mock.results.map(result => result.value.dispose);
    hooks!.dispose(); hooks = null;
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
  });
  it("binds RPM and spin by physical position even when visual indices and directions differ", () => {
    installQuadVehicle("dji-mini-2", "Mini 2", { ...mini.quad,
      rotors: mini.quad.rotors.map(rotor => ({ ...rotor, spin: -rotor.spin })) } as QuadVehicleModData);
    const definition = { ...mini.aircraft.definitions[0],
      rotors: mini.aircraft.definitions[0]!.rotors.map(rotor => ({ ...rotor, direction: 1 })) };
    const lookup = vi.spyOn(aircraftCatalog, "getAircraftDefinition")
      .mockReturnValue(definition as unknown as aircraftCatalog.AircraftDefinition);
    const settings = vi.spyOn(getAppSettings(), "get").mockReturnValue(false);
    const positions = ["rear-right", "front-right", "front-left", "rear-left"];
    const pivots = positions.map((position, index) => ({
      name: definition.rotors[index]!.node,
      computeWorldMatrix: () => {},
      getAbsolutePosition: () => new Vector3(position.endsWith("right") ? -1 : 1, 0, position.startsWith("front") ? 1 : -1),
    }));
    const root = { getChildTransformNodes: () => pivots, computeWorldMatrix: () => {}, getWorldMatrix: () => Matrix.Identity() };
    try {
      step(200, false); mountView(false, root);
      const telemetry = droneMotorTelemetry()!;
      for (const [index, position] of positions.entries()) {
        const motor = telemetry.motors.find(motor => motor.position === position)!;
        expect(mocks.rotor.mock.calls[index]![0].direction).toBe(-motor.direction);
        const update = mocks.rotor.mock.results[index]!.value.update;
        expect(update.mock.calls[0]![0]).toBeCloseTo(motor.rpm * Math.PI / 30);
      }
      mountView(true, root);
      for (const result of mocks.rotor.mock.results) expect(result.value.update.mock.lastCall![2]).toBe(true);
    } finally { lookup.mockRestore(); settings.mockRestore(); }
  });
  it("releases flight batches on a paused switch away and creates fresh ones on return", () => {
    step(200, false); mountView();
    const create = vi.mocked(sdk.createPropertyBatch);
    const batches = create.mock.results.map(result => result.value);
    noteActiveAircraft("cessna-172"); mountView(true);
    for (const batch of batches) expect(batch.dispose).toHaveBeenCalledOnce();
    expect(droneMotorTelemetry()).toBeNull();
    noteActiveAircraft("dji-mini-2"); step(200, false);
    expect(create).toHaveBeenCalledTimes(4);
  });
});
function mountView(paused = false, aircraftRoot: unknown = { getChildTransformNodes: () => [] }) {
  hooks!.afterView({
    state: viewState, rendererMode: "webgpu", paused, terrainMeters: 200,
    scene: { getEngine: () => ({}), getTransformNodeByName: () => null, activeCamera: null },
    aircraftRoot, requestRender: mocks.render,
  } as unknown as DroneViewContext);
}

describe("sequence capture pose", () => {
  it.each([200, null])("uses the shutter altitude and terrain %s instead of zero AGL", async terrainMeters => {
    step(terrainMeters);
    mountView();
    // The shutter sees the later native altitude, not the last rendered pose.
    altitudeFt = 2000;
    for (let index = 0; index < 100 && mocks.capture.mock.calls.length === 0; index++) step(terrainMeters);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    const meta = mocks.capture.mock.calls[0]![2];
    expect(meta.mslM).toBeCloseTo(609.6);
    expect(meta.aglM).toBeCloseTo(terrainMeters === null ? 0 : 409.6);
    expect(meta.pitchDeg).toBeCloseTo(10);
    expect(meta.rollDeg).toBeCloseTo(5);
    await Promise.resolve();
  });
});

describe("lazy Camera tab", () => {
  it("owns its controls in a detachable tab and never inserts toolbar actions", () => {
    const toolbar = document.createElement('div');
    toolbar.setAttribute('aria-label', 'Flight simulator controls');document.body.append(toolbar);
    step(200, false);mountView();
    const panel = hooks!.cameraTab!();document.body.append(panel);
    const range = panel.querySelector<HTMLInputElement>('[aria-label="Gimbal pitch"]')!;
    expect(range.min).toBe('-90');expect(range.max).toBe('20');
    range.value = '-30';range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(droneHeldGimbal()).toBe(-30);expect(mocks.render).toHaveBeenCalled();
    panel.remove();document.body.append(hooks!.cameraTab!());mountView();
    expect(hooks!.cameraTab!()).toBe(panel);expect(range.value).toBe('-30');
    expect(toolbar.children.length).toBe(0);
    expect(document.querySelector('[data-drone-actions]')).toBeNull();
    setDroneRefusal('The camera could not read back this frame.');mountView();
    expect(panel.textContent).toContain('The camera could not read back this frame.');
  });
  it("takes a still from the tab while paused, using the current view terrain", async () => {
    mountView(true);
    const panel = hooks!.cameraTab!();document.body.append(panel);
    panel.querySelector<HTMLButtonElement>('[aria-label="Take still"]')!.click();
    mountView(true);
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalled());
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.capture.mock.calls[0]![2]).toMatchObject({ aglM: 100, mslM: 300 });
    expect(mocks.download.mock.calls[0]![0]).toBe('0sfs-still-dji-mini-2.zip');
  });
  it("slews roll/yaw overrides and records the actual pose in still metadata", async () => {
    step(200, false);mountView();
    const panel = hooks!.cameraTab!();document.body.append(panel);
    const roll = panel.querySelector<HTMLInputElement>('[aria-label="Gimbal roll"]')!;
    const yaw = panel.querySelector<HTMLInputElement>('[aria-label="Gimbal yaw"]')!;
    expect([roll.min, roll.max, yaw.min, yaw.max]).toEqual(['-35', '35', '-20', '20']);
    roll.value = '25';roll.dispatchEvent(new Event('input', { bubbles: true }));
    yaw.value = '-15';yaw.dispatchEvent(new Event('input', { bubbles: true }));
    step(200, false);mountView();
    expect(mocks.pose).toHaveBeenLastCalledWith(viewState, expect.any(Number), { rollDeg: 1.5, yawDeg: -1.5 });
    for (let i = 0; i < 30; i++) step(200, false);
    mountView();
    expect(droneTelemetry()?.gimbalRollDeg).toBe(25);
    expect(mocks.pose).toHaveBeenLastCalledWith(viewState, expect.any(Number), { rollDeg: 25, yawDeg: -15 });
    panel.querySelector<HTMLButtonElement>('[aria-label="Take still"]')!.click();mountView(true);
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce());
    expect(mocks.capture.mock.calls[0]![2].gimbalRollDeg).toBeCloseTo(25);
    expect(mocks.capture.mock.calls[0]![2].gimbalYawDeg).toBeCloseTo(-15);
    // Spherical capture temporarily centers the overrides, retaining pilot targets for later.
    step(200);mountView();expect(roll.disabled).toBe(true);expect(yaw.disabled).toBe(true);
    for (let i = 0; i < 30; i++) step(200);
    mountView();expect(droneTelemetry()?.gimbalRollDeg).toBe(0);
    expect(mocks.pose).toHaveBeenLastCalledWith(viewState, expect.any(Number), { rollDeg: 0, yawDeg: 0 });
    panel.querySelector<HTMLButtonElement>('[aria-label="Stop 360 capture"]')!.click();
    step(200, false);mountView();
    expect(roll.value).toBe('25');expect(yaw.value).toBe('-15');
  });
  it("rebinds a paused mount before posing after a switch to a tighter aircraft range", () => {
    installQuadVehicle("dji-air-2s", "Air 2S", { ...mini.quad,
      gimbalRollMinDeg: -45, gimbalRollMaxDeg: 45, gimbalYawMinDeg: -100, gimbalYawMaxDeg: 100 } as QuadVehicleModData);
    try {
      noteActiveAircraft("dji-air-2s");mountView(true);
      const panel = hooks!.cameraTab!();document.body.append(panel);
      const yaw = panel.querySelector<HTMLInputElement>('[aria-label="Gimbal yaw"]')!;
      yaw.value = '80';yaw.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 60; i++) step(200, false);
      mountView(true);
      expect(mocks.pose).toHaveBeenLastCalledWith(viewState, expect.any(Number), { rollDeg: 0, yawDeg: 80 });
      noteActiveAircraft("dji-mini-2");mountView(true);
      expect(yaw.max).toBe('20');expect(yaw.value).toBe('20');
      expect(mocks.pose).toHaveBeenLastCalledWith(viewState, expect.any(Number), { rollDeg: 0, yawDeg: 0 });
    } finally { noteActiveAircraft("dji-mini-2");uninstallQuadVehicle("dji-air-2s"); }
  });
  it("stops a running sequence even when the phone still holds capture, and waits for release", () => {
    step(200);mountView();
    const panel = hooks!.cameraTab!();document.body.append(panel);
    expect(droneTelemetry()?.isCapturing).toBe(true);
    panel.querySelector<HTMLButtonElement>('[aria-label="Stop 360 capture"]')!.click();
    expect(droneHeldCapture()).toBe(false);
    step(200);mountView();
    expect(droneTelemetry()?.isCapturing).toBe(false);
    step(200);mountView();expect(droneTelemetry()?.isCapturing).toBe(false);
    step(200, false);step(200);mountView();
    expect(droneTelemetry()?.isCapturing).toBe(true);
  });
});
