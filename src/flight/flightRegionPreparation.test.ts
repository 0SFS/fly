import { describe, expect, it, vi } from "vitest";
import type { BabylonRuntime, TerrainRegionOptions, TerrainRegionProgress, TerrainRegion } from "foss-earth/runtime";
import { EMPTY_FLIGHT_STATE } from "@0sfs/ground-contact/flightState";
import type { FlightLoadingScreen, FlightSpawnOverride } from "../loading/createFlightLoadingScreen";
import { createFlightRegionPreparation } from "./flightRegionPreparation";
import { flightParameterDefaults } from "./settings/flightParameters";

const progress = (extra: Partial<TerrainRegionProgress> = {}): TerrainRegionProgress => ({
  state: "loading", minimumReady: false, finalReady: false, readyTiles: 0, totalTiles: 1,
  pendingTiles: 1, estimatedRemainingMs: null, reason: "Loading local terrain", groundHeightMeters: null,
  sourceGeneration: 1, ...extra,
});
const state = { ...EMPTY_FLIGHT_STATE, latDeg: 34, lonDeg: -118, altMeters: 50.25 };

function setup(initial = progress(), parameters = flightParameterDefaults()) {
  const leases: Array<{
    options: TerrainRegionOptions; read: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>; setVisible: ReturnType<typeof vi.fn>; emit(next: TerrainRegionProgress): void;
  }> = [];
  let override: FlightSpawnOverride | null = null;
  const loading = {
    setSpawnOverride: vi.fn((next: FlightSpawnOverride | null) => { override = next; }),
    setPhase: vi.fn(),
  } as unknown as FlightLoadingScreen;
  const runtime = {
    prepareTerrainRegion: vi.fn((options: TerrainRegionOptions) => {
      let current = initial;
      const lease = {
        options,
        read: vi.fn(() => current), release: vi.fn(),
        // Moving a lease invalidates old-region readiness immediately.
        update: vi.fn<(region: TerrainRegion) => void>(() => { current = { ...current, finalReady: false, minimumReady: false }; }),
        setVisible: vi.fn(),
        emit(next: TerrainRegionProgress) { current = next; options.onProgress?.(next); },
      };
      leases.push(lease);
      return lease;
    }),
  } as unknown as BabylonRuntime;
  const confirmRaise = vi.fn(async () => true);
  const onProgress = vi.fn();
  const preparation = createFlightRegionPreparation({
    parameters, drone: true, loading, onProgress,
    groundClearanceMeters: 1.17, confirmRaise,
  });
  return { preparation, runtime, leases, loading, confirmRaise, onProgress, override: () => override };
}

describe("flight region placement preparation", () => {
  it("skips every map wait at the exact requested altitude without inventing a ground height", async () => {
    const fixture = setup();
    const pending = fixture.preparation.prepare(fixture.runtime, state, new AbortController().signal, { aircraftAltitudeMeters: 50.25 });
    expect(fixture.override()?.detail).toContain("50.3 m");
    expect(fixture.override()?.detail).toContain("unknown");
    expect(fixture.override()?.aboveGround).toBeUndefined();
    fixture.override()!.onClick();
    await expect(pending).resolves.toEqual({ altitudeMeters: 50.25, groundHeightMeters: undefined, overridden: true });
    expect(fixture.confirmRaise).not.toHaveBeenCalled();
    expect(fixture.override()).toBeNull();
    fixture.preparation.dispose();
  });

  it("only offers raising above a known higher surface, and requires that proposal's confirmation", async () => {
    const fixture = setup(progress({ groundHeightMeters: 100 }));
    const abort = new AbortController();
    const pending = fixture.preparation.prepare(fixture.runtime, state, abort.signal, { aircraftAltitudeMeters: 50.25 });
    expect(fixture.override()?.detail).toBe("Spawn at 50.3 m, 49.8 m below the ground loaded so far. Map detail is still loading.");
    fixture.override()!.aboveGround!.onClick();
    await expect(pending).resolves.toEqual({ altitudeMeters: 101.17, groundHeightMeters: 100, overridden: true });
    expect(fixture.confirmRaise).toHaveBeenCalledWith(state, 101.17, expect.any(AbortSignal));
    fixture.preparation.dispose();
    const below = setup(progress({ groundHeightMeters: 20 }));
    const second = below.preparation.prepare(below.runtime, state, new AbortController().signal, { aircraftAltitudeMeters: 50.25 });
    expect(below.override()?.aboveGround).toBeUndefined();
    expect(below.override()?.detail).toBe("Spawn at 50.3 m, 30.3 m above the ground loaded so far. Map detail is still loading.");
    below.override()!.onClick();
    await second;
    below.preparation.dispose();
  });

  it("keeps waiting after declining the suggested raise and still allows spawning in place", async () => {
    const fixture = setup(progress({ groundHeightMeters: 100 }));
    fixture.confirmRaise.mockResolvedValue(false);
    const pending = fixture.preparation.prepare(fixture.runtime, state, new AbortController().signal, { aircraftAltitudeMeters: 50.25 });
    let settled = false;
    void pending.then(() => { settled = true; });
    fixture.override()!.aboveGround!.onClick();
    await Promise.resolve();
    expect(settled).toBe(false);
    fixture.override()!.onClick();
    await expect(pending).resolves.toMatchObject({ altitudeMeters: 50.25, overridden: true });
    fixture.preparation.dispose();
  });

  it("aborts pending preparation and rejects stale override actions", async () => {
    const fixture = setup();
    const abort = new AbortController();
    const pending = fixture.preparation.prepare(fixture.runtime, state, abort.signal, { aircraftAltitudeMeters: 50.25 });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const stale = fixture.override()!;
    abort.abort();
    await rejection;
    expect(fixture.override()).toBeNull();
    stale.onClick();
    expect(fixture.confirmRaise).not.toHaveBeenCalled();
    fixture.preparation.dispose();
  });

  it("ignores progress from a superseded destination's lease", async () => {
    const fixture = setup();
    const first = fixture.preparation.prepare(fixture.runtime, state, new AbortController().signal);
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const next = { ...state, latDeg: 45, altMeters: 75 };
    const second = fixture.preparation.prepare(fixture.runtime, next, new AbortController().signal);
    await rejected;
    let settled = false;
    void second.then(() => { settled = true; });
    fixture.leases[0].emit(progress({ finalReady: true, minimumReady: true, groundHeightMeters: 10 }));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(fixture.onProgress).not.toHaveBeenCalled();
    fixture.leases[1].emit(progress({ finalReady: true, minimumReady: true, groundHeightMeters: 20 }));
    await expect(second).resolves.toEqual({ altitudeMeters: 75, groundHeightMeters: 20, overridden: false });
    fixture.preparation.dispose();
  });

  it("waits for the new sphere after resolving a fresh AGL destination's altitude", async () => {
    const fixture = setup(progress({ finalReady: true, minimumReady: true, groundHeightMeters: 100 }));
    const pending = fixture.preparation.prepare(fixture.runtime, { ...state, altMeters: 1524 }, new AbortController().signal, { aboveGroundMeters: 20 });
    let settled = false;
    void pending.then(() => { settled = true; });
    expect(fixture.leases[0].update).toHaveBeenCalledWith(expect.objectContaining({ center: { latDeg: 34, lonDeg: -118, altitudeMeters: 120 } }));
    await Promise.resolve();
    expect(settled).toBe(false);
    fixture.leases[0].emit(progress({ finalReady: true, minimumReady: true, groundHeightMeters: 100 }));
    await expect(pending).resolves.toEqual({ altitudeMeters: 120, groundHeightMeters: 100, overridden: false });
    fixture.preparation.dispose();
  });

  it("offers the aircraft's own altitude only once it exists while a fresh AGL destination has no ground height", async () => {
    const fixture = setup(progress({ finalReady: true, minimumReady: true }));
    const pending = fixture.preparation.prepare(fixture.runtime, state, new AbortController().signal, { aboveGroundMeters: 20 });
    expect(fixture.loading.setPhase).toHaveBeenLastCalledWith("terrain", expect.objectContaining({ state: "loading", detail: expect.stringContaining("ground height") }));
    // Physics has not initialized: no override may bypass it.
    expect(fixture.override()).toBeNull();
    fixture.preparation.allowOverride(1524);
    expect(fixture.override()?.detail).toContain("1524.0 m");
    expect(fixture.override()?.aboveGround).toBeUndefined();
    fixture.override()!.onClick();
    await expect(pending).resolves.toEqual({ altitudeMeters: 1524, groundHeightMeters: undefined, overridden: true });
    fixture.preparation.dispose();
  });

  it("spawns an AGL start at the ground-relative altitude its card shows, never below the gear clearance", async () => {
    const fixture = setup(progress({ groundHeightMeters: 100 }));
    const pending = fixture.preparation.prepare(fixture.runtime, { ...state, altMeters: 1524 }, new AbortController().signal, { aboveGroundMeters: 0, aircraftAltitudeMeters: 1524 });
    expect(fixture.preparation.target()?.altMeters).toBeCloseTo(101.17);
    expect(fixture.override()?.detail).toContain("101.2 m");
    fixture.override()!.onClick();
    await expect(pending).resolves.toEqual({ altitudeMeters: 101.17, groundHeightMeters: 100, overridden: true });
    fixture.preparation.dispose();
  });

  it("shows the region while its wait is open, in flight too or never, as Show loading region says", async () => {
    const parameters = flightParameterDefaults();
    const fixture = setup(progress(), parameters);
    const pending = fixture.preparation.prepare(fixture.runtime, state, new AbortController().signal, { aircraftAltitudeMeters: 50.25 });
    const lease = fixture.leases[0];
    expect(lease.setVisible).toHaveBeenLastCalledWith(true);
    lease.emit(progress({ finalReady: true, minimumReady: true, groundHeightMeters: 10 }));
    await pending;
    // Flying: by default the region was shown only while the card waited.
    expect(lease.setVisible).toHaveBeenLastCalledWith(false);
    parameters.set("osfs.region.show", "always");
    fixture.preparation.showRegion();
    expect(lease.setVisible).toHaveBeenLastCalledWith(true);
    parameters.set("osfs.region.show", "off");
    fixture.preparation.showRegion();
    expect(lease.setVisible).toHaveBeenLastCalledWith(false);
    const next = fixture.preparation.prepare(fixture.runtime, state, new AbortController().signal, { aircraftAltitudeMeters: 50.25 });
    const rejected = expect(next).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.leases[1].setVisible).not.toHaveBeenCalledWith(true);
    fixture.preparation.dispose();
    await rejected;
  });

  it("closes an unanswered raise prompt when the map finishes first", async () => {
    const fixture = setup(progress({ groundHeightMeters: 100 }));
    let promptSignal: AbortSignal | null = null;
    fixture.confirmRaise.mockImplementation((_from, _altitude, signal: AbortSignal) => {
      promptSignal = signal;
      return new Promise<boolean>(resolve => signal.addEventListener("abort", () => resolve(false)));
    });
    const pending = fixture.preparation.prepare(fixture.runtime, state, new AbortController().signal, { aircraftAltitudeMeters: 50.25 });
    fixture.override()!.aboveGround!.onClick();
    expect(promptSignal!.aborted).toBe(false);
    fixture.leases[0].emit(progress({ finalReady: true, minimumReady: true, groundHeightMeters: 100 }));
    await expect(pending).resolves.toEqual({ altitudeMeters: 50.25, groundHeightMeters: 100, overridden: false });
    expect(promptSignal!.aborted).toBe(true);
    fixture.preparation.dispose();
  });
});
