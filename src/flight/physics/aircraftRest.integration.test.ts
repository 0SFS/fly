import { readFileSync } from "node:fs";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import type { SurfaceHit, SurfaceQuery } from "foss-earth/runtime";
import { createTerrainContact } from "@0sfs/ground-contact/terrainContact";
import { readControlSurfaceState } from "@0sfs/aircraft/aircraftAnimation";
import { afterEach, describe, expect, it } from "vitest";
import { getFdmProfile } from "../jsbsim/fdmProfiles";
import { createFixedStepPhysicsLoop } from "./fixedStepLoop";
import { createAircraftRest, readAircraftMotion } from "./aircraftRest";

/*
 * A C172 set down on flat ground with its engine off, stepped the way the app
 * steps it at its default 60 Hz: it must come to rest, so a parked aircraft
 * stops costing power, and the residual motion it rests with is printed.
 */

const FT = 0.3048;
const GROUND = 300;
const DT = 1 / 60;
const instances: JSBSimSdk[] = [];
afterEach(() => { for (const sdk of instances.splice(0)) sdk.destroy(); });

async function parkedC172(dropMeters: number) {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false } });
  instances.push(sdk);
  const manifest = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8")) as { files: string[] };
  for (const file of manifest.files) sdk.writeDataFile(file, readFileSync(`public/jsbsim-data/${file}`, "utf8"));
  sdk.configurePaths({ rootDir: "/runtime", aircraftPath: "aircraft", enginePath: "engine", systemsPath: "systems" });
  sdk.loadModel("c172p");
  sdk.setDt(DT);
  const stance = getFdmProfile("cessna-172").stance;
  for (const [property, value] of Object.entries({ "ic/lat-geod-deg": 34, "ic/long-gc-deg": -118.3,
    "ic/h-sl-ft": (GROUND + stance.staticMeters + dropMeters) / FT, "ic/terrain-elevation-ft": GROUND / FT,
    "ic/psi-true-deg": 0, "ic/theta-deg": 2.48, "ic/vc-kts": 0,
    "fcs/mixture-cmd-norm": 0, "fcs/throttle-cmd-norm": 0 })) sdk.setPropertyValue(property, value);
  expect(sdk.runIc()).toBe(true);
  const surface: SurfaceQuery = { raycast: () => null,
    sample: () => ({ heightMeters: GROUND, revision: 1, quality: 15 } as SurfaceHit) };
  return { sdk, contact: createTerrainContact(sdk, surface, stance, { automaticMoveMeters: () => 1 }) };
}

describe("a parked C172 with real JSBSim", () => {
  it.each([0, 0.2])("comes to rest after settling from %s m onto its gear", async drop => {
    const { sdk, contact } = await parkedC172(drop);
    const loop = createFixedStepPhysicsLoop(sdk, undefined, { physicsHz: 60 });
    const rest = createAircraftRest();
    let restedAt = -1;
    let worst = { speed: 0, rate: 0 };
    for (let frame = 0; frame < 15 / DT && restedAt < 0; frame++) {
      loop.update(DT, contact.update);
      const motion = readAircraftMotion(sdk);
      const surfaces = readControlSurfaceState(sdk as never, "cessna-172");
      const onGround = [0, 1, 2].some(unit => sdk.getPropertyValue(`gear/unit[${unit}]/WOW`) > 0.5);
      if (frame * DT > 1) worst = { speed: Math.max(worst.speed, motion.speedMetersPerSecond), rate: Math.max(worst.rate, motion.rateRadPerSecond) };
      const pose = [surfaces.aileronLeftRad, surfaces.elevatorRad, surfaces.rudderRad, surfaces.flapRad, surfaces.gearDownNorm];
      if (rest.observe({ eligible: onGround && surfaces.propellerRadPerSec < 0.1, ...motion, pose }, DT)) restedAt = frame * DT;
    }
    const final = readAircraftMotion(sdk);
    console.table([{ drop, restedAtS: restedAt, finalSpeed: final.speedMetersPerSecond, finalRate: final.rateRadPerSecond,
      worstSpeedAfter1s: worst.speed, worstRateAfter1s: worst.rate }]);
    expect(loop.getFault()).toBeNull();
    expect(restedAt).toBeGreaterThan(0);
    expect(restedAt).toBeLessThan(6);
  });
});
