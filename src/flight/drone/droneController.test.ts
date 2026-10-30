import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import type { QuadVehicleModData } from "@0sfs/mods/schema";
import { CONTROL } from "@0sfs/multirotor/layout";
import common from "../../../../Quadcopter/public/0sfs-mod.json";
import dji from "../../../../DJI-Quadcopter/public/0sfs-mod.json";
import camera from "../../../../DJI-FC7303/public/0sfs-mod.json";
import mini from "../../../../DJI-Mini2/public/0sfs-mod.json";
import { createDroneController, planDroneCommand, type DroneCommandInput, type DroneController } from "./droneController";
import { buildDroneProfile, PHYSICS_DT } from "./droneTypes";
import type { DroneFlightModel, DroneFlightSample } from "./droneFlightModel";
import type { DroneStickCommand } from "./droneGate";

const mocks = vi.hoisted(() => ({ create: vi.fn(), clearance: vi.fn() }));
vi.mock("./droneFlightModel", () => ({ createDroneFlightModel: mocks.create }));
vi.mock("@0sfs/ground-contact/groundContactClearance", () => ({ groundContactClearanceMeters: mocks.clearance }));

const profile = buildDroneProfile("dji-mini2", "Mini 2", common.quadcopter, dji.dji, mini.quad as QuadVehicleModData, camera.camera);
const hover: DroneStickCommand = {
  pitch: 0, roll: 0, vertical: 0, yaw: 0, yawMode: "angularVelocity", yawAngleDeg: null,
  gimbalPitchDeg: 0, sport: false, shutter: false, capture360: false,
};
const anchor = { lat: 45, lon: -93, alt: 100 };
const input: DroneCommandInput = {
  profile, command: hover, psi: 0, latDeg: 45, lonDeg: -93, altM: 100, vn: 0, ve: 0, vd: 0, hold: anchor,
  aglM: 100, touchdownAglM: .0232, onGround: false, armed: true, dt: PHYSICS_DT, gimbalDeg: 0,
};
function plan(sticks: Partial<DroneStickCommand> = {}, overrides: Partial<DroneCommandInput> = {}) {
  return planDroneCommand({ ...input, ...overrides, command: { ...hover, ...sticks } });
}

describe("drone velocity commands and holds", () => {
  it("captures each stopped stick group independently, including the deadzone", () => {
    expect(plan({ pitch: .02, roll: -.02, vertical: .02 }, { hold: null }).hold).toEqual(anchor);
    expect(plan({ pitch: .1 }, { hold: null }).hold).toEqual({ lat: null, lon: null, alt: 100 });
    expect(plan({ vertical: .1 }, { hold: null }).hold).toEqual({ lat: 45, lon: -93, alt: null });
    expect(plan().hold).toBe(anchor);
  });
  it("brakes horizontal motion before capturing the stopping point", () => {
    const moving = plan({ pitch: 1 }, { vn: 10 });
    expect(moving.hold).toEqual({ lat: null, lon: null, alt: 100 });
    expect(anchor).toEqual({ lat: 45, lon: -93, alt: 100 });
    const released = plan({}, { hold: moving.hold, vn: 10 });
    const braking = plan({}, { hold: released.hold, latDeg: 45 + 12 / 111320, vn: 2 });
    expect(braking.flight).toMatchObject({ vn: 0, ve: 0, vd: 0 });
    expect(braking.hold).toEqual({ lat: null, lon: null, alt: 100 });
    const stopped = plan({}, { hold: braking.hold, latDeg: 45 + 15 / 111320, vn: .05 });
    expect(stopped.hold).toEqual({ lat: 45 + 15 / 111320, lon: -93, alt: 100 });
    expect(stopped.flight.vn).toBeCloseTo(0);
    expect(plan({}, { hold: stopped.hold, latDeg: 45 + 16 / 111320, vn: .4 }).flight.vn).toBeCloseTo(-.6);
  });
  it("waits for the combined horizontal speed before holding, including after a reset", () => {
    const braking = plan({}, { hold: null, vn: .08, ve: .08 });
    expect(braking.hold).toEqual({ lat: null, lon: null, alt: 100 });
    expect(braking.flight).toMatchObject({ vn: 0, ve: 0 });
    expect(plan({}, { hold: braking.hold, vn: .06, ve: .06 }).hold).toEqual(anchor);
  });
  it.each([-1, 1])("brakes vertical motion before capturing height with sign %s", sign => {
    const moving = plan({ vertical: sign }, { vd: -sign * 3 });
    expect(moving.hold).toEqual({ lat: 45, lon: -93, alt: null });
    const braking = plan({}, { hold: moving.hold, altM: 100 + sign * 2, vd: -sign });
    expect(braking.flight.vd).toBeCloseTo(0);
    expect(braking.hold?.alt).toBeNull();
    const stopped = plan({}, { hold: braking.hold, altM: 100 + sign * 4, vd: -sign * .05 });
    expect(stopped.flight.vd).toBeCloseTo(0);
    expect(stopped.hold?.alt).toBe(100 + sign * 4);
    expect(plan({}, { hold: stopped.hold, altM: 100 + sign * 5, vd: -sign * .4 }).flight.vd).toBeCloseTo(sign * .6);
  });
  it("captures one stopping point while the other group is still braking", () => {
    const horizontal = plan({}, { hold: null, vn: .05, vd: -2 });
    expect(horizontal.hold).toEqual({ lat: 45, lon: -93, alt: null });
    const vertical = plan({}, { hold: null, vn: 2, vd: .05 });
    expect(vertical.hold).toEqual({ lat: null, lon: null, alt: 100 });
  });
  it("keeps latched holds through wind, yaw and mode changes", () => {
    const result = plan({ yaw: 1, sport: true }, { vn: 3, ve: 4, vd: -2 });
    expect(result.hold).toBe(anchor);
    for (const velocity of [result.flight.vn, result.flight.ve, result.flight.vd]) expect(velocity).toBeCloseTo(0);
  });
  it.each([1, -1])("pulls north, east and altitude back toward the anchor with sign %s", sign => {
    const result = plan({}, {
      latDeg: 45 + sign * 2 / 111320,
      lonDeg: -93 + sign * 2 / (Math.cos(Math.PI / 4) * 111320), altM: 100 + sign * 2,
    });
    expect(result.flight.vn).toBeCloseTo(-sign * 1.2);
    expect(result.flight.ve).toBeCloseTo(-sign * 1.2);
    expect(result.flight.vd).toBeCloseTo(sign * 1.2);
    expect(result.hold).toBe(anchor);
  });
  it("wraps the longitude error at the date line using the anchor latitude", () => {
    const result = plan({}, { latDeg: 60, lonDeg: -179.999999,
      hold: { lat: 60, lon: 179.999999, alt: 100 } });
    expect(result.flight.ve).toBeCloseTo(-.6 * .000002 * .5 * 111320);
  });
  it("caps horizontal and vertical hold speeds in both directions", () => {
    expect(plan({}, { latDeg: 46, lonDeg: -92, altM: 200 }).flight)
      .toMatchObject({ vn: -4.8, ve: -4.8, vd: 3 });
    expect(plan({}, { latDeg: 44, lonDeg: -94, altM: 0 }).flight)
      .toMatchObject({ vn: 4.8, ve: 4.8, vd: -3 });
  });
  it("clears only the horizontal anchor when translating and keeps altitude hold", () => {
    const result = plan({ pitch: 1 }, { latDeg: 46, lonDeg: -92, altM: 102 });
    expect(result.hold).toEqual({ lat: null, lon: null, alt: 100 });
    expect(result.flight.vd).toBeCloseTo(1.2);
  });
  it("clears only altitude when climbing and keeps the horizontal hold signs", () => {
    const result = plan({ vertical: 1 }, { latDeg: 46, lonDeg: -92, altM: 102 });
    expect(result.hold).toEqual({ lat: 45, lon: -93, alt: null });
    expect(result.flight).toMatchObject({ vn: -4.8, ve: -4.8, vd: -3 });
  });
  it("clears hold when both groups move, then reacquires the new position", () => {
    expect(plan({ roll: 1, vertical: 1 }).hold).toBeNull();
    expect(plan({}, { hold: null, latDeg: 46, lonDeg: -92, altM: 150 }).hold)
      .toEqual({ lat: 46, lon: -92, alt: 150 });
  });
  it.each([[0, 5, 2.5], [Math.PI / 2, -2.5, 5], [Math.PI, -5, -2.5]])(
    "maps forward/right commands at heading %s to N/E", (psi, vn, ve) => {
      const result = plan({ pitch: .5, roll: .25 }, { psi });
      expect(result.flight.vn).toBeCloseTo(vn);
      expect(result.flight.ve).toBeCloseTo(ve);
    });
  it.each([false, true])("takes speed, climb, descent, tilt and yaw limits from sport=%s", sport => {
    const mode = sport ? profile.modes.sport : profile.modes.normal;
    const result = plan({ sport, pitch: 1, vertical: 1, yaw: .5 });
    expect(result.flight.vn).toBe(mode.speedMps);
    expect(result.flight.vd).toBe(-mode.climbMps);
    expect(result.flight.tanTiltMax).toBeCloseTo(Math.tan(mode.tiltMaxDeg * Math.PI / 180));
    expect(result.flight.yawRateMaxRad).toBeCloseTo(mode.yawRateDeg * Math.PI / 180);
    expect(result.flight.yawMode).toBe(CONTROL.YAW_RATE);
    expect(result.flight.yaw).toBeCloseTo(.5 * mode.yawRateDeg * Math.PI / 180);
    expect(plan({ sport, vertical: -1 }).flight.vd).toBe(mode.descentMps);
  });
  it("maps angle yaw to an absolute radian heading, and holds heading without a target", () => {
    expect(plan({ yawMode: "angle", yawAngleDeg: -170, yaw: 1 }).flight)
      .toMatchObject({ yawMode: CONTROL.YAW_HEADING, yaw: -170 * Math.PI / 180 });
    expect(plan({ yawMode: "angle" }, { psi: 1.2 }).flight.yaw).toBe(1.2);
    expect(plan({ yaw: .02 }).flight.yaw).toBe(0);
  });
  it.each([[0, .1], [.0232, .1], [1, .4884], [100, 3]])("slows a descent at AGL %s to %s m/s", (aglM, vd) => {
    expect(plan({ vertical: -1 }, { aglM }).flight.vd).toBeCloseTo(vd);
    expect(plan({}, { aglM, altM: 200 }).flight.vd).toBeCloseTo(vd);
    expect(plan({ vertical: 1 }, { aglM }).flight.vd).toBe(-3);
  });
  it("starts the landing flare above the airframe's feet", () => {
    expect(plan({ vertical: -1 }, { aglM: 1, touchdownAglM: .0347 }).flight.vd).toBeCloseTo(.48265);
    expect(plan({ vertical: -.05 }, { aglM: .01 }).flight.vd).toBeCloseTo(.1);
  });
  it("keeps the mode descent limit when terrain is unavailable", () => {
    expect(plan({ vertical: -1 }, { aglM: null }).flight.vd).toBe(3);
  });
  it("keeps the gimbal limits and slew", () => {
    expect(plan({ gimbalPitchDeg: -90 }).gimbalDeg).toBe(-1.5);
    expect(plan({ gimbalPitchDeg: 90 }, { gimbalDeg: 19.5 }).gimbalDeg).toBe(20);
    expect(plan({ gimbalPitchDeg: -120 }, { gimbalDeg: -89.5 }).gimbalDeg).toBe(-90);
  });
  it.each([
    [false, false, 0, CONTROL.MODE_STOPPED], [false, true, 1, CONTROL.MODE_STOPPED],
    [true, true, 0, CONTROL.MODE_IDLE], [true, true, -1, CONTROL.MODE_IDLE],
    [true, true, .1, CONTROL.MODE_FLYING], [true, false, -1, CONTROL.MODE_FLYING],
  ] as const)("selects plant mode for armed=%s, onGround=%s, vertical=%s", (armed, onGround, vertical, mode) => {
    expect(plan({ vertical }, { armed, onGround }).flight.mode).toBe(mode);
  });
});

let sample: DroneFlightSample;
let model: DroneFlightModel;
const sdk = {} as JSBSimSdk;
beforeEach(() => {
  sample = { vn: 0, ve: 0, vd: 0, u: 0, v: 0, w: 0, p: 0, q: 0, r: 0, phi: 0, theta: 0, psi: 0,
    massKg: .249, ixx: .00032, iyy: .0004341, izz: .0006932, rho: 1.225, aglM: 100,
    latDeg: 45, lonDeg: -93, altM: 100, onGround: true, simTimeS: 10, reset: false };
  const telemetry = { rpm: [0, 0, 0, 0], hoverRpm: 9000, maxRpm: 13300, onGround: true, aglM: 100, simTimeS: 10 };
  model = { read: vi.fn(() => sample), step: vi.fn(() => telemetry), telemetry: () => telemetry,
    status: () => ({ backend: "typescript", reason: null }), reset: vi.fn(), dispose: vi.fn() };
  mocks.create.mockReset().mockReturnValue(model);
  mocks.clearance.mockReset().mockReturnValue(.0232);
});
function step(controller: DroneController, sticks: Partial<DroneStickCommand> = {}) {
  return controller.step(sdk, { ...hover, ...sticks }, PHYSICS_DT, 0);
}
function lastFlight() { return vi.mocked(model.step).mock.lastCall![0]; }

describe("drone arming and stepping", () => {
  it("spawns stopped on the ground and arms only above half climb stick", () => {
    const controller = createDroneController(profile);
    expect(step(controller).armed).toBe(false);
    expect(lastFlight().mode).toBe(CONTROL.MODE_STOPPED);
    expect(mocks.clearance).toHaveBeenCalledExactlyOnceWith(sdk, 0, 0);
    expect(step(controller, { vertical: .5 }).armed).toBe(false);
    expect(step(controller, { vertical: .51 }).armed).toBe(true);
    expect(lastFlight().mode).toBe(CONTROL.MODE_FLYING);
    expect(model.step).toHaveBeenLastCalledWith(expect.anything(), true);
    step(controller);
    expect(lastFlight().mode).toBe(CONTROL.MODE_IDLE);
  });
  it("spawns armed in the air and never disarms there on descent", () => {
    sample.onGround = false;
    const controller = createDroneController(profile);
    expect(step(controller).armed).toBe(true);
    for (let i = 0; i < 130; i++) expect(step(controller, { vertical: -1 }).armed).toBe(true);
    expect(lastFlight().mode).toBe(CONTROL.MODE_FLYING);
  });
  it("disarms after a full second below negative half stick on the ground", () => {
    const controller = createDroneController(profile);
    step(controller, { vertical: 1 });
    for (let i = 0; i < 119; i++) expect(step(controller, { vertical: -1 }).armed).toBe(true);
    expect(step(controller, { vertical: -1 }).armed).toBe(false);
    expect(lastFlight().mode).toBe(CONTROL.MODE_STOPPED);
    expect(model.step).toHaveBeenLastCalledWith(expect.anything(), false);
  });
  it("keeps arming and restarts the timer if descent is released early or the feet lift", () => {
    const controller = createDroneController(profile);
    step(controller, { vertical: 1 });
    for (let i = 0; i < 119; i++) step(controller, { vertical: -1 });
    expect(step(controller, { vertical: -.5 }).armed).toBe(true);
    for (let i = 0; i < 119; i++) expect(step(controller, { vertical: -1 }).armed).toBe(true);
    sample.onGround = false;
    step(controller, { vertical: -1 });
    sample.onGround = true;
    expect(step(controller, { vertical: -1 }).armed).toBe(true);
  });
  it("clears hold and reinitializes arming on a simulation reset", () => {
    sample.onGround = false;
    const controller = createDroneController(profile);
    step(controller);
    sample.latDeg = 46; sample.lonDeg = -92; sample.altM = 150;
    sample.reset = true; sample.onGround = true;
    expect(step(controller).armed).toBe(false);
    const flight = lastFlight();
    expect(flight.vn).toBeCloseTo(0); expect(flight.ve).toBeCloseTo(0); expect(flight.vd).toBeCloseTo(0);
    expect(flight.mode).toBe(CONTROL.MODE_STOPPED);
  });
  it("throws the 120 Hz guard once and skips subsequent wrong-rate steps", () => {
    const controller = createDroneController(profile);
    expect(() => controller.step(sdk, hover, 1 / 60, 0)).toThrow("The drone controller steps at 120 Hz.");
    expect(() => controller.step(sdk, hover, 1 / 60, 0)).not.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
    step(controller);
    vi.mocked(model.step).mockClear();
    controller.step(sdk, hover, 1 / 60, 0);
    expect(model.step).not.toHaveBeenCalled();
    controller.reset();
    expect(model.reset).toHaveBeenCalledOnce();
    expect(() => controller.step(sdk, hover, 1 / 60, 0)).toThrow("120 Hz");
  });
  it("skips a bad sample and releases the model when the SDK changes or the controller is disposed", () => {
    const controller = createDroneController(profile);
    vi.mocked(model.read).mockReturnValueOnce(null);
    step(controller);
    expect(model.step).not.toHaveBeenCalled();
    controller.step({} as JSBSimSdk, hover, PHYSICS_DT, 0);
    expect(model.dispose).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    controller.dispose();
    expect(model.dispose).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])("keeps incomplete contact geometry explicit on repeated binding attempts, switching=%s", switching => {
    const controller = createDroneController(profile);
    if (switching) step(controller);
    vi.mocked(model.step).mockClear();
    mocks.create.mockClear();
    mocks.clearance.mockImplementation(() => { throw new Error("JSBSim contact geometry is incomplete."); });
    const nextSdk = {} as JSBSimSdk;
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => controller.step(nextSdk, hover, PHYSICS_DT, 0)).toThrow("JSBSim contact geometry is incomplete.");
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(model.step).not.toHaveBeenCalled();
    expect(model.dispose).toHaveBeenCalledTimes(switching ? 1 : 0);
  });
});
