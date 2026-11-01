import { readFileSync } from "node:fs";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { describe, expect, it, vi } from "vitest";
import type { SurfaceQuery, SurfaceHit } from "foss-earth/runtime";
import { createTerrainContact, syncTerrainContact } from "@0sfs/ground-contact/terrainContact";
import { createFixedStepPhysicsLoop } from "./fixedStepLoop";
import { bootstrapC172p } from "../jsbsim/bootstrapC172";
import { getFdmProfile } from "../jsbsim/fdmProfiles";
import { LEGACY_PHYSICS_HZ_120 } from "./physicsRate";

const C172_STATIC_METERS = getFdmProfile("cessna-172").stance.staticMeters;

describe("displayed terrain contact", () => {
  it("does not halt flight for a transient optional visible-mesh miss", () => {
    const sdk = {
      getPropertyValue: vi.fn((property: string) => property === "position/lat-geod-deg" ? 34 : property === "position/long-gc-deg" ? -118 : property === "position/h-sl-ft" ? 10 : 0),
      setPropertyValue: vi.fn(),
      resetToInitialConditions: vi.fn(),
      runIc: vi.fn(() => true),
    } as unknown as JSBSimSdk;
    let hit: SurfaceHit | null = { heightMeters: 0, revision: 1 } as SurfaceHit;
    const surface: SurfaceQuery = { raycast: () => null, sample: () => hit };
    const contact = createTerrainContact(sdk, surface, getFdmProfile("cessna-172").stance);
    // A height has to exist before a miss can be called transient.
    contact.update(false);
    hit = null;
    expect(contact.update(false)).toBe(true);
    expect(contact.update()).toBe(false);
  });

  it("uses Google terrain chosen at the flight-ready World detail regardless of geometric-error metadata", () => {
    const properties: Record<string, number> = {
      "position/lat-geod-deg": 34, "position/long-gc-deg": -118,
      "position/h-sl-ft": (300 + C172_STATIC_METERS) / 0.3048,
    };
    const sdk = {
      getPropertyValue: vi.fn((property: string) => properties[property] ?? 0),
      setPropertyValue: vi.fn((property: string, value: number) => { properties[property] = value; }),
      resetToInitialConditions: vi.fn(), runIc: vi.fn(() => true),
    } as unknown as JSBSimSdk;
    let hit: SurfaceHit | null = { heightMeters: 300, revision: 1, geometricErrorMeters: 500_000 } as SurfaceHit;
    const contact = createTerrainContact(sdk, { raycast: () => null, sample: () => hit }, getFdmProfile("cessna-172").stance);
    expect(contact.update(true, true, true)).toBe(true);

    hit = null;
    expect(contact.update(true, true, true)).toBe(true);
    expect(contact.getBlockReason()).toBeNull();

    // Tile metadata can be replaced while its mesh remains visible. It is not
    // part of the flight policy and cannot make a flyable scene stop.
    hit = { heightMeters: 300, revision: 2 } as SurfaceHit;
    expect(contact.update(true, true, true)).toBe(true);
    expect(contact.getBlockReason()).toBeNull();
  });

  it("holds Google contact only when the caller's World-detail policy requires it", () => {
    const properties: Record<string, number> = {
      "position/lat-geod-deg": 34, "position/long-gc-deg": -118,
      "position/h-sl-ft": (300 + C172_STATIC_METERS) / 0.3048,
    };
    const sdk = {
      getPropertyValue: vi.fn((property: string) => properties[property] ?? 0),
      setPropertyValue: vi.fn((property: string, value: number) => { properties[property] = value; }),
      resetToInitialConditions: vi.fn(), runIc: vi.fn(() => true),
    } as unknown as JSBSimSdk;
    const hit: SurfaceHit = { heightMeters: 300, revision: 1, geometricErrorMeters: 1 } as SurfaceHit;
    const contact = createTerrainContact(sdk, { raycast: () => null, sample: () => hit }, getFdmProfile("cessna-172").stance);

    expect(contact.update(true, true)).toBe(false);
    expect(contact.getBlockReason()).toBe("coarse");
    expect(contact.update(true, true, true)).toBe(true);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("position/terrain-elevation-asl-ft", 300 / 0.3048);
  });

  it("refuses to step before any terrain height exists, in either map mode", () => {
    // Google 3D Tiles publish nothing until the first tiles land. Stepping then
    // drops the aircraft toward a ground plane JSBSim has not been told about,
    // and the gear model resolves the penetration explosively once the real
    // surface arrives - tens of thousands of knots in a single step.
    const sdk = {
      getPropertyValue: vi.fn((property: string) => property === "position/lat-geod-deg" ? 34 : property === "position/long-gc-deg" ? -118 : 0),
      setPropertyValue: vi.fn(),
      resetToInitialConditions: vi.fn(),
      runIc: vi.fn(() => true),
    } as unknown as JSBSimSdk;
    let hit: SurfaceHit | null = null;
    const surface: SurfaceQuery = { raycast: () => null, sample: () => hit };
    const contact = createTerrainContact(sdk, surface, getFdmProfile("cessna-172").stance);

    expect(contact.update(false)).toBe(false);
    expect(contact.update(true)).toBe(false);
    // Flight spawn preparation has already written a known terrain elevation
    // into JSBSim. After that point a streaming miss cannot become a second
    // loading gate.
    expect(contact.update(false, true, true, true)).toBe(true);
    // JSBSim must not be told a terrain elevation it cannot support either.
    expect(sdk.setPropertyValue).not.toHaveBeenCalledWith("position/terrain-elevation-asl-ft", expect.anything());

    hit = { heightMeters: 120, revision: 1 } as SurfaceHit;
    expect(contact.update(false)).toBe(false);
    expect(contact.getBlockReason()).toBe("relocation");
    contact.declineRelocation(contact.getRelocationProposal()!.id);

    // A later miss is now genuinely transient and may be tolerated.
    hit = null;
    expect(contact.update(false)).toBe(true);

    // Repositioning starts over: the new location has no established height.
    contact.reset();
    expect(contact.update(false)).toBe(false);
  });

  it("updates the real JSBSim collision elevation when the visible surface changes", async () => {
    const sdk = await JSBSimSdk.create({ moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
      persistence: { enabled: false }, log: { console: false } });
    const manifest = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8")) as { files: string[] };
    for (const file of manifest.files) sdk.writeDataFile(file, readFileSync(`public/jsbsim-data/${file}`, "utf8"));
    await bootstrapC172p(sdk, LEGACY_PHYSICS_HZ_120);
    const surface: SurfaceQuery = { raycast: () => null, sample: () => ({ heightMeters: 251.9 } as SurfaceHit) };
    expect(syncTerrainContact(sdk, surface)).toBe(true);
    sdk.run();
    expect(sdk.getPropertyValue("position/terrain-elevation-asl-ft") * 0.3048).toBeCloseTo(251.9, 4);
    surface.sample = () => ({ heightMeters: 32.6 } as SurfaceHit);
    syncTerrainContact(sdk, surface); sdk.run();
    expect(sdk.getPropertyValue("position/terrain-elevation-asl-ft") * 0.3048).toBeCloseTo(32.6, 4);
  });
  it("does not advance physics through missing terrain or accumulate a catch-up jump", () => {
    const sdk = { getPropertyValue: vi.fn((key: string) => key === "position/lat-geod-deg" ? 34
      : key === "position/h-sl-ft" ? 1000 : 0), setPropertyValue: vi.fn(), run: vi.fn(() => true) };
    const loop = createFixedStepPhysicsLoop(sdk as unknown as JSBSimSdk, undefined, { physicsHz: LEGACY_PHYSICS_HZ_120 });
    const surface: SurfaceQuery = { raycast: () => null, sample: () => null };
    for (let i = 0; i < 10; i++) loop.update(0.1, () => syncTerrainContact(sdk as unknown as JSBSimSdk, surface));
    expect(sdk.run).not.toHaveBeenCalled();
    expect(sdk.setPropertyValue).not.toHaveBeenCalled();
    loop.update(1 / 120, () => true);
    expect(sdk.run).toHaveBeenCalledOnce();
  });
  it("ignores a surface sample a kilometre above a flying aircraft", () => {
    const properties: Record<string, number> = {
      "position/lat-geod-deg": 34, "position/long-gc-deg": -118, "position/h-sl-ft": 1000,
    };
    const sdk = {
      getPropertyValue: vi.fn((property: string) => properties[property] ?? 0),
      setPropertyValue: vi.fn((property: string, value: number) => { properties[property] = value; }),
      resetToInitialConditions: vi.fn(),
      runIc: vi.fn(() => true),
    } as unknown as JSBSimSdk;
    let hit: SurfaceHit = { heightMeters: 100, revision: 1 } as SurfaceHit;
    const surface: SurfaceQuery = { raycast: () => null, sample: () => hit };
    const contact = createTerrainContact(sdk, surface, getFdmProfile("cessna-172").stance);
    expect(contact.update(false)).toBe(true);

    hit = { heightMeters: 2000, revision: 2 } as SurfaceHit;
    expect(contact.update(false)).toBe(true);
    // Neither adopted as the collision elevation nor used to move the aircraft.
    expect(sdk.setPropertyValue).not.toHaveBeenCalledWith("position/terrain-elevation-asl-ft", 2000 / 0.3048);
    expect(sdk.runIc).not.toHaveBeenCalled();
    // Raster has no second source of truth, so it holds instead of guessing.
    expect(contact.update(true)).toBe(false);

    hit = { heightMeters: 100, revision: 3 } as SurfaceHit;
    expect(contact.update(false)).toBe(true);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("position/terrain-elevation-asl-ft", 100 / 0.3048);
  });
  it("ignores a surface that jumps a kilometre between frames even when it lands just above the aircraft", () => {
    // The reported failure: cruising at 10,000 ft in Google tiles mode, the
    // sampled surface arrived just above the aircraft. JSBSim's ground plane is
    // horizontal, so the gear springs fired straight up and the whole velocity
    // came out vertical - 36,000 kt in a single step.
    const properties: Record<string, number> = {
      "position/lat-geod-deg": 44.977753, "position/long-gc-deg": -93.265011,
      "position/h-sl-ft": 10_000,
    };
    const sdk = {
      getPropertyValue: vi.fn((property: string) => properties[property] ?? 0),
      setPropertyValue: vi.fn((property: string, value: number) => { properties[property] = value; }),
      resetToInitialConditions: vi.fn(),
      runIc: vi.fn(() => true),
    } as unknown as JSBSimSdk;
    let hit: SurfaceHit = { heightMeters: 250, revision: 1 } as SurfaceHit;
    const surface: SurfaceQuery = { raycast: () => null, sample: () => hit };
    const contact = createTerrainContact(sdk, surface, getFdmProfile("cessna-172").stance);
    expect(contact.update(false)).toBe(true);

    // Only 150 m above the aircraft, so the rise limit alone would allow it.
    hit = { heightMeters: 3200, revision: 2 } as SurfaceHit;
    expect(contact.update(false)).toBe(true);
    expect(sdk.setPropertyValue).not.toHaveBeenCalledWith("position/terrain-elevation-asl-ft", 3200 / 0.3048);
    expect(sdk.runIc).not.toHaveBeenCalled();
  });
  it("keeps flying when the surface cannot be measured but the ground is far below", () => {
    // Terrain reaches the physics only through the gear contacts, so holding a
    // cruising aircraft because a raster tile has not been fetched freezes the
    // simulation for no gain - it looked like a hang for minutes at 10,000 ft.
    const properties: Record<string, number> = {
      "position/lat-geod-deg": 44.98, "position/long-gc-deg": -93.27, "position/h-sl-ft": 10_000,
    };
    const sdk = {
      getPropertyValue: vi.fn((property: string) => properties[property] ?? 0),
      setPropertyValue: vi.fn((property: string, value: number) => { properties[property] = value; }),
      resetToInitialConditions: vi.fn(),
      runIc: vi.fn(() => true),
    } as unknown as JSBSimSdk;
    let hit: SurfaceHit | null = { heightMeters: 250, revision: 1 } as SurfaceHit;
    const surface: SurfaceQuery = { raycast: () => null, sample: () => hit };
    const contact = createTerrainContact(sdk, surface, getFdmProfile("cessna-172").stance);

    // Establish a height on the ramp so placement is behind us.
    properties["position/h-sl-ft"] = 300 / 0.3048;
    expect(contact.update(true)).toBe(true);

    // Climb away and lose the surface. Raster is the strict mode, and even it
    // must not hold the simulation up here.
    properties["position/h-sl-ft"] = 10_000;
    hit = null;
    for (let step = 0; step < 120; step += 1) expect(contact.update(true)).toBe(true);

    // Descending back into gear range without a surface restores the hold.
    properties["position/h-sl-ft"] = 400 / 0.3048;
    expect(contact.update(true)).toBe(false);

    // A surface found under a blind aircraft is trusted like a fresh
    // placement: it may have flown over a hill it could never see, and the
    // gear model cannot resolve that penetration.
    properties["position/h-sl-ft"] = 200 / 0.3048;
    hit = { heightMeters: 260, revision: 2 } as SurfaceHit;
    expect(contact.update(true)).toBe(false);
    const proposed = contact.getRelocationProposal()!;
    expect(proposed.reason).toBe("surface regained above the aircraft");
    expect(sdk.setPropertyValue).not.toHaveBeenCalledWith("ic/h-sl-ft", expect.anything());
    expect(contact.acceptRelocation(proposed.id)).toBe(true);
    expect(sdk.setPropertyValue).toHaveBeenCalledWith("ic/h-sl-ft", expect.closeTo((260 + C172_STATIC_METERS) / 0.3048, 1));
  });

  it("does not reposition a parked aircraft when single frames of surface go missing", () => {
    // Google publishes only what is currently drawn, so misses come and go
    // while taxiing. Treating one as a blind stretch teleported the aircraft
    // off its own springs every time - sinking, then popping back up.
    const properties: Record<string, number> = {
      "position/lat-geod-deg": 44.98, "position/long-gc-deg": -93.27,
      "position/h-sl-ft": (250 + C172_STATIC_METERS) / 0.3048,
    };
    const sdk = {
      getPropertyValue: vi.fn((property: string) => properties[property] ?? 0),
      setPropertyValue: vi.fn((property: string, value: number) => { properties[property] = value; }),
      resetToInitialConditions: vi.fn(),
      runIc: vi.fn(() => true),
    } as unknown as JSBSimSdk;
    let hit: SurfaceHit | null = { heightMeters: 250, revision: 1 } as SurfaceHit;
    const surface: SurfaceQuery = { raycast: () => null, sample: () => hit };
    const contact = createTerrainContact(sdk, surface, getFdmProfile("cessna-172").stance);
    expect(contact.update(false)).toBe(true);

    for (let step = 0; step < 200; step += 1) {
      // Settled on the springs, a few centimetres below the nominal stance.
      properties["position/h-sl-ft"] = (250 + C172_STATIC_METERS - 0.04) / 0.3048;
      hit = step % 7 === 0 ? null : { heightMeters: 250, revision: 1 } as SurfaceHit;
      expect(contact.update(false)).not.toBe("reset");
    }
    expect(sdk.runIc).not.toHaveBeenCalled();
  });
  it("keeps the support plane at a small rise after taxiing onto it and stopping", () => {
    const properties: Record<string, number> = {
      "position/lat-geod-deg": 44.98, "position/long-gc-deg": -93.27,
      "position/h-sl-ft": (250 + C172_STATIC_METERS) / 0.3048,
    };
    const sdk = {
      getPropertyValue: vi.fn((property: string) => properties[property] ?? 0),
      setPropertyValue: vi.fn((property: string, value: number) => { properties[property] = value; }),
      resetToInitialConditions: vi.fn(), runIc: vi.fn(() => true),
    } as unknown as JSBSimSdk;
    let height = 250;
    const contact = createTerrainContact(sdk, { raycast: () => null,
      sample: () => ({ heightMeters: height, revision: 1 } as SurfaceHit) }, getFdmProfile("cessna-172").stance);
    expect(contact.update(false)).toBe(true);
    // Below the 0.58 m snap threshold. Previously the low-pass adopted only
    // 5 mm of this 30 cm rise, then kept that low floor once travel stopped.
    properties["position/long-gc-deg"] += 0.005 / (111320 * Math.cos(44.98 * Math.PI / 180));
    height = 250.3;
    expect(contact.update(false)).toBe(true);
    expect(properties["position/terrain-elevation-asl-ft"] * 0.3048).toBeCloseTo(height, 8);
    for (let step = 0; step < 60; step++) {
      expect(contact.update(false)).toBe(true);
      expect(properties["position/terrain-elevation-asl-ft"] * 0.3048).toBeCloseTo(height, 8);
    }
    // A parked changed sample or a downward sample must be adopted too. No
    // distance is needed to release an old filtered elevation.
    for (height of [250.4, 250.1, 249.8]) {
      expect(contact.update(false)).toBe(true);
      expect(properties["position/terrain-elevation-asl-ft"] * 0.3048).toBeCloseTo(height, 8);
    }
  });

  it("gives JSBSim the sampled surface without smoothing its height", () => {
    // Even centimetre-scale details come from the same displayed terrain;
    // there is no independent rolling-height estimate.
    const properties: Record<string, number> = {
      "position/lat-geod-deg": 44.98, "position/long-gc-deg": -93.27,
      "position/h-sl-ft": (250 + C172_STATIC_METERS) / 0.3048,
    };
    const elevations: number[] = [];
    const sdk = {
      getPropertyValue: vi.fn((property: string) => properties[property] ?? 0),
      setPropertyValue: vi.fn((property: string, value: number) => {
        properties[property] = value;
        if (property === "position/terrain-elevation-asl-ft") elevations.push(value * 0.3048);
      }),
      resetToInitialConditions: vi.fn(),
      runIc: vi.fn(() => true),
    } as unknown as JSBSimSdk;
    let hit: SurfaceHit = { heightMeters: 250, revision: 1 } as SurfaceHit;
    const surface: SurfaceQuery = { raycast: () => null, sample: () => hit };
    const contact = createTerrainContact(sdk, surface, getFdmProfile("cessna-172").stance);
    contact.update(false);

    // Move 5 mm between these deliberately noisy samples.
    const metresPerDegreeLon = 111320 * Math.cos(44.98 * Math.PI / 180);
    for (let step = 0; step < 300; step += 1) {
      properties["position/long-gc-deg"] += 0.005 / metresPerDegreeLon;
      hit = { heightMeters: 250 + (step % 2 === 0 ? 0.04 : -0.04), revision: 1 } as SurfaceHit;
      contact.update(false);
      expect(elevations.at(-1)).toBeCloseTo(hit.heightMeters, 8);
    }
    expect(Math.max(...elevations)).toBeCloseTo(250.04, 8);
    expect(Math.min(...elevations)).toBeCloseTo(249.96, 8);

    // A kerb is not noise: the wheel has to climb it at once.
    hit = { heightMeters: 251, revision: 1 } as SurfaceHit;
    contact.update(false);
    expect(elevations.at(-1)).toBeCloseTo(251, 6);
  });
});
