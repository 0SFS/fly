import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flightAttitudeToQuaternion } from "@0sfs/ground-contact/ecefBridge";
import { createRemoteAircraft } from "./remoteAircraft";
import { pose } from "../../../../multiplayer/tests/fixture";
import { geodeticToEcef } from "foss-earth/cameraMath";
import { buildWorldShiftFrame } from "../bridge/enuFrame";

vi.mock("@0sfs/aircraft/createAircraftModel", () => ({ createAircraftModel: () => ({
  dispose: vi.fn(), getRig: () => null, updateGearVisibility: vi.fn(),
}) }));
const resources: (() => void)[] = [];
afterEach(() => { for (const dispose of resources.splice(0)) dispose(); });
function setup() {
  const engine = new NullEngine(); const scene = new Scene(engine);
  const remote = createRemoteAircraft(scene, vi.fn());
  resources.push(() => { remote.dispose(); scene.dispose(); engine.dispose(); });
  return { remote, scene };
}
function frameAt(local: { latDeg: number; lonDeg: number; altMeters: number }) {
  const lat = local.latDeg * Math.PI / 180, lon = local.lonDeg * Math.PI / 180;
  const origin = geodeticToEcef(lat, lon, local.altMeters);
  return { origin, m: buildWorldShiftFrame(lat, lon, local.altMeters, origin).m };
}
describe("remote aircraft in the moving local frame", () => {
  it("matches local attitude at the same place and rebases when the local aircraft moves", () => {
    const { remote, scene } = setup();
    const aircraft = pose({ rollRad: 0.2, pitchRad: 0.1, headingRad: 1.3 });
    remote.update({ pose: aircraft, stale: false, held: false, leadMs: 0 }, frameAt(aircraft), 0);
    const root = scene.getTransformNodeByName("multiplayer-aircraft")!;
    expect(root.position.length()).toBeLessThan(0.001);
    const expected = flightAttitudeToQuaternion(aircraft.rollRad, aircraft.pitchRad, aircraft.headingRad);
    expect(Math.abs(root.rotationQuaternion!.dot(expected))).toBeCloseTo(1, 6);
    remote.update({ pose: aircraft, stale: false, held: false, leadMs: 0 }, frameAt({ ...aircraft, altMeters: aircraft.altMeters + 100 }), 0);
    expect(Vector3.Distance(root.position, new Vector3(0, -100, 0))).toBeLessThan(0.001);
  });
  it("uses a visible fallback for unknown aircraft and hides it after disconnect", () => {
    const { remote, scene } = setup(); const aircraft = pose({ aircraftId: "unknown-plane" });
    remote.update({ pose: aircraft, stale: true, held: false, leadMs: 100 }, frameAt(aircraft), 0);
    expect(scene.getMeshByName("multiplayer-fallback-wing")!.isEnabled()).toBe(true);
    remote.update(undefined, null, 0);
    expect(scene.getTransformNodeByName("multiplayer-aircraft")!.isEnabled()).toBe(false);
  });
});
