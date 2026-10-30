import { readFileSync } from "node:fs";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { afterEach, describe, expect, it } from "vitest";
import type { SurfaceHit, SurfaceQuery } from "foss-earth/runtime";
import { readFlightState } from "@0sfs/ground-contact/ecefBridge";
import { groundContactClearanceMeters } from "@0sfs/ground-contact/groundContactClearance";
import { validFlightState } from "@0sfs/ground-contact/safeFlightState";
import { createTerrainContact } from "@0sfs/ground-contact/terrainContact";
import { bootstrapAircraft } from "../jsbsim/bootstrapC172";
import { getFdmProfile } from "../jsbsim/fdmProfiles";
import { resolveAircraftDataFiles } from "../jsbsim/hydrateJsbsimData";
import { createFixedStepPhysicsLoop, HARD_GROUND_IMPACT_FAULT } from "./fixedStepLoop";
import { DEFAULT_PHYSICS_HZ, physicsStepSeconds } from "./physicsRate";

const FEET = 0.3048;
const DEG = Math.PI / 180;
/**
 * A pilot's F-35B, stalled into trees, from their bug report: 61 kt, banked
 * 32° left and pitched 23° up, sinking 3 m/s, at full power.
 */
const CRASH = {
  latDeg: 44.97583689487486, lonDeg: -93.23853438500512, altMeters: 224.73554687390327,
  rollRad: -0.5645752408071465, pitchRad: 0.39635249696265634, headingRad: 0.7395690888303782,
  northFps: 81.8004459172852, eastFps: 62.40095710982424, upFps: -9.85596449071263, throttleNorm: 0.99,
};
/** How far its lowest contact was inside the canopy the step loop was given. */
const DEPTH_METERS = 0.544;
const manifest: unknown = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8"));
const instances: JSBSimSdk[] = [];
afterEach(() => { for (const sdk of instances.splice(0)) sdk.destroy(); });

/** The F-35B stopped by the impact guard where the pilot's stopped, with its contact and loop as the app drives them. */
async function crashedF35() {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false } });
  instances.push(sdk);
  const profile = getFdmProfile("f-35b");
  for (const file of resolveAircraftDataFiles(manifest, profile.dataPackage ?? "f-35b")) {
    sdk.writeDataFile(file, readFileSync(`public/jsbsim-data/${file}`, "utf8"));
  }
  // Placed well above the canopy first, so terrain contact has flown over it before the impact.
  await bootstrapAircraft(sdk, "f-35b", DEFAULT_PHYSICS_HZ, { latDeg: CRASH.latDeg, lonDeg: CRASH.lonDeg,
    altFt: (CRASH.altMeters + 100) / FEET, headingDeg: CRASH.headingRad / DEG, airspeedKts: 61,
    throttleNorm: CRASH.throttleNorm, engineRunning: true });
  let canopyMeters = CRASH.altMeters - 100;
  const surface: SurfaceQuery = { sample: () => ({ heightMeters: canopyMeters, revision: 1 }) as SurfaceHit, raycast: () => null };
  const contact = createTerrainContact(sdk, surface, profile.stance, { bodyProbes: profile.bodyCollisionProbes });
  expect(contact.update(false, false, true, true)).toBe(true);
  for (const [property, value] of Object.entries({
    "ic/h-sl-ft": CRASH.altMeters / FEET, "ic/phi-deg": CRASH.rollRad / DEG, "ic/theta-deg": CRASH.pitchRad / DEG,
    "ic/psi-true-deg": CRASH.headingRad / DEG, "ic/vn-fps": CRASH.northFps, "ic/ve-fps": CRASH.eastFps, "ic/vd-fps": -CRASH.upFps,
  })) sdk.setPropertyValue(property, value);
  expect(sdk.runIc()).toBe(true);
  const roll = sdk.getPropertyValue("attitude/phi-deg") * DEG, pitch = sdk.getPropertyValue("attitude/theta-deg") * DEG;
  canopyMeters = sdk.getPropertyValue("position/h-sl-ft") * FEET - groundContactClearanceMeters(sdk, roll, pitch) + DEPTH_METERS;
  const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: DEFAULT_PHYSICS_HZ });
  const dt = physicsStepSeconds(DEFAULT_PHYSICS_HZ);
  const step = () => loop.update(dt, () => contact.update(false, false, true, true));
  step();
  expect(loop.getFault()).toBe(HARD_GROUND_IMPACT_FAULT);
  expect(loop.getGroundImpact()!.depthMeters).toBeCloseTo(DEPTH_METERS, 3);
  return { sdk, contact, loop, step, canopyMeters, lifted: readFlightState(sdk) };
}

/**
 * Flies `seconds`, failing on any fault or on any frame terrain contact held
 * instead of stepping; returns the fastest climb, in m/s, as a launch off a
 * spring would show.
 */
function flyOn(run: Awaited<ReturnType<typeof crashedF35>>, seconds: number): number {
  let climb = 0;
  const frames = seconds * DEFAULT_PHYSICS_HZ;
  const before = run.loop.getTimeAccounting().acceptedSteps;
  for (let frame = 0; frame < frames; frame++) {
    const state = run.step();
    expect(run.loop.getFault(), `after ${(frame / DEFAULT_PHYSICS_HZ).toFixed(2)} s`).toBeNull();
    expect(validFlightState(state)).toBe(true);
    climb = Math.max(climb, state.verticalSpeedFps * FEET);
  }
  expect(run.loop.getTimeAccounting().acceptedSteps - before).toBe(frames);
  expect(run.contact.getRelocationProposal()).toBeNull();
  return climb;
}

describe("a hard ground impact in trees", () => {
  it("stops on the same impact again when only the fault is cleared, as Resume used to", async () => {
    const run = await crashedF35();
    run.contact.reset();
    run.loop.reset();
    run.step();
    expect(run.loop.getFault()).toBe(HARD_GROUND_IMPACT_FAULT);
  });

  it("flies on from where it stopped after Resume, on a floor held under it, without a second impact or a launch", async () => {
    const run = await crashedF35();
    run.contact.flyOnFromImpact();
    run.loop.reset();
    expect(run.contact.isTerrainIgnored()).toBe(true);
    expect(flyOn(run, 3)).toBeLessThan(3);
  });

  it("settles onto the canopy after Move up by the depth and 10 cm, without a second impact or a launch", async () => {
    const run = await crashedF35();
    run.contact.liftFromImpact(DEPTH_METERS + 0.1);
    run.loop.reset();
    expect(run.contact.isTerrainIgnored()).toBe(false);
    run.lifted = readFlightState(run.sdk);
    expect(flyOn(run, 3)).toBeLessThan(3);
    // It fell onto the canopy, and the canopy carries it: nothing has fallen through.
    const settled = readFlightState(run.sdk);
    expect(settled.altMeters).toBeGreaterThan(run.canopyMeters);
    expect(settled.altMeters).toBeLessThan(run.lifted.altMeters - 0.1);
  });
});
