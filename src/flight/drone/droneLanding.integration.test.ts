import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import type { SurfaceHit, SurfaceQuery } from "foss-earth/runtime";
import { groundContactClearanceMeters } from "@0sfs/ground-contact/groundContactClearance";
import { createTerrainContact } from "@0sfs/ground-contact/terrainContact";
import type { QuadVehicleModData } from "@0sfs/mods/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createDroneController, type DroneController } from "./droneController";
import type { DroneStickCommand } from "./droneGate";
import { resolveQuadPropeller } from "./quadRegistry";
import { buildDroneProfile, PHYSICS_DT } from "./droneTypes";

/*
 * Lands each DJI drone on map ground that keeps sharpening under it, as Google
 * tiles do while the camera comes down with the drone, and checks that the
 * ground keeps holding it up.
 *
 * Real JSBSim, the drone's own model, its flight controller and the real
 * terrain contact, stepped the way the app's physics loop steps them: the
 * terrain contact runs before every step, and a step it refuses is not taken,
 * which freezes the drone and its props on screen.
 */

const FT = 0.3048;
/** Height of the landing site above sea level, in metres. */
const GROUND = 256;
const START_ABOVE_GROUND = 1.5;
/** A pilot answers a terrain question this long after it appears: the time to read the card. */
const READ_FRAMES = Math.round(1.5 / PHYSICS_DT);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const readJson = (path: string) => JSON.parse(readFileSync(root + path, "utf8"));
const shared = readJson("Quadcopter/public/0sfs-mod.json").quadcopter;
const dji = readJson("DJI-Quadcopter/public/0sfs-mod.json").dji;
const drones = [["DJI-Mini2", "DJI-FC7303"], ["DJI-Air-2S", "DJI-FC3411"]].map(([directory, cameraDirectory]) => {
  const manifest = readJson(directory + "/public/0sfs-mod.json");
  const id = manifest.aircraft.definitions[0].id as string;
  const quad = { ...manifest.quad as QuadVehicleModData, propeller: resolveQuadPropeller(manifest.quad) };
  return { directory, id, manifest, fdm: manifest.aircraft.fdmProfiles[id],
    profile: buildDroneProfile(id, manifest.name, shared, dji, quad, readJson(cameraDirectory + "/public/0sfs-mod.json").camera) };
});
type Drone = (typeof drones)[number];

const live: { sdk: JSBSimSdk; controller: DroneController }[] = [];
afterEach(() => {
  for (const { sdk, controller } of live.splice(0)) { controller.dispose(); sdk.destroy(); }
});

async function boot(drone: Drone) {
  const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false, stripAnsi: true } });
  const controller = createDroneController(drone.profile);
  live.push({ sdk, controller });
  sdk.configurePaths({ rootDir: "/runtime", aircraftPath: "aircraft", enginePath: "engine", systemsPath: "systems" });
  for (const file of drone.manifest.jsbsimFiles as string[]) {
    sdk.writeDataFile(file, readFileSync(`${root}${drone.directory}/public/jsbsim-data/${file}`, "utf8"));
  }
  expect(sdk.loadModel(drone.fdm.model)).toBe(true);
  sdk.setDt(PHYSICS_DT);
  const initial = {
    "ic/lat-geod-deg": 44.977753, "ic/long-gc-deg": -93.265011,
    "ic/h-sl-ft": (GROUND + START_ABOVE_GROUND) / FT, "ic/terrain-elevation-ft": GROUND / FT,
    "ic/psi-true-deg": 0, "ic/theta-deg": 0, "ic/phi-deg": 0, "ic/vc-kts": 0,
    ...drone.fdm.initialProperties as Record<string, number>,
  };
  const batch = sdk.createPropertyBatch(Object.keys(initial), { create: true });
  try { batch.write(Object.values(initial)); } finally { batch.dispose(); }
  expect(sdk.runIc()).toBe(true);
  return { sdk, controller };
}

/** Flat map ground: `offset` is how far refinement has moved it, `revision` its version, `missing` drops it from view. */
function mapGround() {
  const map = { offset: 0, revision: 1, missing: false };
  const surface: SurfaceQuery = {
    raycast: () => null,
    sample: () => map.missing ? null : { heightMeters: GROUND + map.offset, revision: map.revision, quality: 15 } as SurfaceHit,
  };
  return { map, surface, height: (): number | null => map.missing ? null : GROUND + map.offset };
}

type Answer = "Resume flight here" | "Teleport above ground";
const sticks = (vertical: number): DroneStickCommand => ({ pitch: 0, roll: 0, vertical, yaw: 0, yawMode: "angularVelocity",
  yawAngleDeg: null, gimbalPitchDeg: 0, sport: false, shutter: false, capture360: false });

/**
 * Descends with the stick held down, lands, keeps holding until the props stop,
 * then lets go. Meanwhile the map sharpens: a finer tile 4 cm higher while the
 * drone is still 15 cm up, 3 cm higher again just after touchdown, 2 cm lower
 * once it has disarmed, then the tile under it drops out of view for 0.75 s
 * and comes back 5 cm higher. Google's revision also changes every quarter
 * second, as it does whenever the camera moves.
 */
async function land(drone: Drone, answer: Answer) {
  const { sdk, controller } = await boot(drone);
  const { map, surface, height } = mapGround();
  const contact = createTerrainContact(sdk, surface, drone.fdm.stance, { bodyProbes: [] });
  const legs = groundContactClearanceMeters(sdk, 0, 0);
  const altitude = () => sdk.getPropertyValue("position/h-sl-ft") * FT;
  const wow = () => [0, 1, 2, 3].map(unit => sdk.getPropertyValue(`contact/unit[${unit}]/WOW`));
  const asked = new Map<number, number>();
  const run = {
    frames: 0, heldFrames: 0, touchdown: -1, disarmed: -1, surfaceAtTouchdown: Number.NaN,
    lowestSurface: GROUND, lowestAboveLowestSurface: Number.POSITIVE_INFINITY,
    lowestFloorBelowLowestSurface: Number.POSITIVE_INFINITY, armed: true,
  };
  const refine = (metres: number) => { map.offset += metres; map.revision++; };
  let flared = false;
  while (run.frames < 20 / PHYSICS_DT && !(run.disarmed >= 0 && run.frames > run.disarmed + 4 / PHYSICS_DT)) {
    const frame = run.frames++;
    if (frame % 30 === 0) map.revision++;
    const surfaceNow = height();
    if (!flared && surfaceNow !== null && altitude() - surfaceNow < 0.15) { flared = true; refine(0.04); }
    if (run.touchdown >= 0 && frame === run.touchdown + 36) refine(0.03);
    if (run.disarmed >= 0 && frame === run.disarmed + 72) refine(-0.02);
    if (run.disarmed >= 0 && frame === run.disarmed + 120) map.missing = true;
    if (run.disarmed >= 0 && frame === run.disarmed + 210) { map.missing = false; refine(0.05); }

    const proposal = contact.getRelocationProposal();
    if (proposal) {
      if (!asked.has(proposal.id)) asked.set(proposal.id, frame);
      if (frame - asked.get(proposal.id)! >= READ_FRAMES) {
        if (answer === "Resume flight here") contact.declineRelocation(proposal.id);
        else expect.soft(contact.acceptRelocation(proposal.id)).toBe(true);
      }
    }
    if (contact.update(false, true, true, true) === false) { run.heldFrames++; continue; }
    const holdingDown = run.disarmed < 0 || frame < run.disarmed + 0.5 / PHYSICS_DT;
    const step = controller.step(sdk, sticks(holdingDown ? -1 : 0), PHYSICS_DT, contact.isTerrainIgnored() ? null : height());
    if (!sdk.run()) throw new Error("JSBSim stopped");
    run.armed = step.armed;
    const shown = height();
    if (shown !== null) run.lowestSurface = Math.min(run.lowestSurface, shown);
    run.lowestAboveLowestSurface = Math.min(run.lowestAboveLowestSurface, altitude() - run.lowestSurface);
    if (run.touchdown < 0 && wow().some(value => value === 1)) { run.touchdown = frame; run.surfaceAtTouchdown = shown ?? Number.NaN; }
    if (run.touchdown >= 0) {
      run.lowestFloorBelowLowestSurface = Math.min(run.lowestFloorBelowLowestSurface,
        sdk.getPropertyValue("position/terrain-elevation-asl-ft") * FT - run.lowestSurface);
      if (run.disarmed < 0 && !step.armed) run.disarmed = frame;
    }
  }
  const summary = { aircraft: drone.id, answer, questions: asked.size, heldSeconds: run.heldFrames * PHYSICS_DT,
    touchdownS: run.touchdown * PHYSICS_DT, disarmedS: run.disarmed * PHYSICS_DT,
    lowestCgAboveGroundM: run.lowestAboveLowestSurface, lowestFloorM: run.lowestFloorBelowLowestSurface,
    finalCgAboveShownGroundM: altitude() - (height() ?? Number.NaN), wow: wow().join(",") };
  console.table([summary]);
  return { sdk, run, legs, summary, altitude, wow, finalSurface: height() };
}

function expectStillStanding({ sdk, run, summary, wow }: Awaited<ReturnType<typeof land>>) {
  const detail = JSON.stringify(summary);
  expect.soft(run.heldFrames, `physics paused, freezing the drone and its props: ${detail}`).toBe(0);
  expect.soft(run.touchdown, `never touched down: ${detail}`).toBeGreaterThanOrEqual(0);
  expect.soft(run.disarmed, `the props never stopped: ${detail}`).toBeGreaterThanOrEqual(0);
  expect.soft(run.lowestAboveLowestSurface, `sank below the ground: ${detail}`).toBeGreaterThan(0);
  expect.soft(run.lowestFloorBelowLowestSurface, `the ground was taken away from under the landed drone: ${detail}`).toBeGreaterThan(-0.001);
  expect.soft(wow(), `not standing on all four feet: ${detail}`).toEqual([1, 1, 1, 1]);
  expect.soft(Math.abs(sdk.getPropertyValue("velocities/v-down-fps") * FT), `still moving: ${detail}`).toBeLessThan(0.01);
  expect.soft(run.armed).toBe(false);
  expect.soft(sdk.getPropertyValue("multirotor/armed")).toBe(0);
}

describe.each(drones)("$id landing on map ground that sharpens under it", drone => {
  it("stays standing where it landed when the pilot answers Resume flight here", async () => {
    const landing = await land(drone, "Resume flight here");
    expectStillStanding(landing);
    // Its position is kept: it stands on the ground it touched down on.
    const above = landing.altitude() - landing.run.surfaceAtTouchdown;
    expect.soft(above, JSON.stringify(landing.summary)).toBeGreaterThan(0);
    expect.soft(above, JSON.stringify(landing.summary)).toBeLessThan(landing.legs);
  });

  it("stands on the sharpened ground when the pilot answers Teleport above ground", async () => {
    const landing = await land(drone, "Teleport above ground");
    expectStillStanding(landing);
    const above = landing.altitude() - (landing.finalSurface ?? Number.NaN);
    expect.soft(above, JSON.stringify(landing.summary)).toBeGreaterThan(0);
    expect.soft(above, JSON.stringify(landing.summary)).toBeLessThan(landing.legs);
  });
});
