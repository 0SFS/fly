import { afterEach, describe, expect, it, vi } from "vitest";
import type { BabylonRuntime, RasterBaseMapSource, TerrainPreparationProgress, TerrainPreparationResult } from "foss-earth/runtime";
import { prepareTerrainWithRecovery } from "./terrainRecovery";

const backup = { id: "usgs-imagery", label: "USGS Imagery" } as RasterBaseMapSource;
const ready = { groundHeightMeters: 250, altitudeMeters: 1250 };
const request = { latDeg: 45, lonDeg: -93, altitudeAboveGroundMeters: 1000 };
const progress = (readySamples = 0, visibleTiles = 1): TerrainPreparationProgress => ({
  phase: "loading", readySamples, totalSamples: 9, progress: readySamples / 9, message: "Waiting for ground",
  diagnostics: { status: "loading", provider: "Google 3D Tiles", elapsedMs: 0, stalledForMs: 0, timeoutMs: 120000,
    activeElevationRequests: null, queuedElevationRequests: null, pendingTiles: 1, visibleTiles, centerQuality: null, requiredQuality: null, lastError: null },
});

function fixture(mode: BabylonRuntime["status"]["mode"] = "google-tiles") {
  const runtime = {
    status: { mode, lastError: null as string | null },
    prepareTerrain: vi.fn<BabylonRuntime["prepareTerrain"]>().mockResolvedValue(ready),
    setMapSource: vi.fn(() => { runtime.status.mode = "raster-basemap"; }),
  };
  const options = { fallbackSource: backup, stalledAfterMs: 15000, onFallback: vi.fn(), onRecovered: vi.fn() };
  return { runtime: runtime as typeof runtime & Pick<BabylonRuntime, "status">, options };
}

afterEach(() => vi.useRealTimers());

describe("terrain provider recovery", () => {
  it("reports a Google failure that selected the backup before preparation began", async () => {
    const { runtime, options } = fixture("raster-basemap");
    runtime.status.lastError = "Google HTTP 403";
    expect(await prepareTerrainWithRecovery(runtime, request, { ...options, googleRequested: true })).toEqual(ready);
    expect(options.onFallback).toHaveBeenCalledOnce();
    expect(options.onRecovered).toHaveBeenCalledWith(backup);
    expect(runtime.prepareTerrain).toHaveBeenCalledOnce();
  });

  it("follows lazy Google initialization before recovering a failed Google preparation", async () => {
    const { runtime, options } = fixture("raster-basemap");
    runtime.prepareTerrain.mockImplementationOnce(async () => {
      runtime.status.mode = "google-tiles";
      throw new Error("Google code arrived; source changed");
    }).mockRejectedValueOnce(new Error("Google HTTP 403"));
    expect(await prepareTerrainWithRecovery(runtime, request, options)).toEqual(ready);
    expect(runtime.prepareTerrain).toHaveBeenCalledTimes(3);
    expect(runtime.setMapSource).toHaveBeenCalledExactlyOnceWith(backup);
  });

  it("continues preparation after the runtime falls back on a Google HTTP error", async () => {
    const { runtime, options } = fixture();
    runtime.prepareTerrain.mockImplementationOnce(async () => {
      runtime.status.mode = "raster-basemap";
      runtime.status.lastError = "Google HTTP 403";
      throw new Error("Map source changed while preparing the destination");
    });
    expect(await prepareTerrainWithRecovery(runtime, request, options)).toEqual(ready);
    expect(runtime.prepareTerrain).toHaveBeenCalledTimes(2);
    expect(runtime.prepareTerrain).toHaveBeenLastCalledWith(request);
    expect(runtime.setMapSource).not.toHaveBeenCalled();
    expect(options.onRecovered).toHaveBeenCalledWith(backup);
  });

  it.each(["403", "429", "503", "network failure"])("prepares backup ground once after Google %s", async error => {
    const { runtime, options } = fixture();
    runtime.prepareTerrain.mockRejectedValueOnce(new Error(error));
    expect(await prepareTerrainWithRecovery(runtime, request, options)).toEqual(ready);
    expect(runtime.setMapSource).toHaveBeenCalledExactlyOnceWith(backup);
    expect(options.onFallback).toHaveBeenCalledOnce();
    expect(options.onRecovered).toHaveBeenCalledOnce();
  });

  it("times out even when visible parent tiles and request churn never supply usable ground", async () => {
    vi.useFakeTimers();
    const { runtime, options } = fixture();
    let publish!: (p: TerrainPreparationProgress) => void;
    let signal!: NonNullable<Parameters<BabylonRuntime["prepareTerrain"]>[0]["signal"]>;
    runtime.prepareTerrain.mockImplementationOnce(async r => {
      publish = r.onProgress!; signal = r.signal!;
      publish(progress());
      return new Promise<TerrainPreparationResult>(() => {});
    });
    const flight = prepareTerrainWithRecovery(runtime, request, options);
    await vi.advanceTimersByTimeAsync(10000);
    publish(progress(0, 7));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await flight).toEqual(ready);
    expect(signal.aborted).toBe(true);
    expect(runtime.setMapSource).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives actual ground improvement another stall interval", async () => {
    vi.useFakeTimers();
    const { runtime, options } = fixture();
    let publish!: (p: TerrainPreparationProgress) => void;
    let finish!: (terrain: TerrainPreparationResult) => void;
    runtime.prepareTerrain.mockImplementationOnce(r => {
      publish = r.onProgress!;
      return new Promise(resolve => { finish = resolve; });
    });
    const flight = prepareTerrainWithRecovery(runtime, request, options);
    await vi.advanceTimersByTimeAsync(14000);
    publish(progress(1));
    await vi.advanceTimersByTimeAsync(14000);
    expect(runtime.setMapSource).not.toHaveBeenCalled();
    finish(ready);
    expect(await flight).toEqual(ready);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never falls back after cancellation, even if a provider ignores abort", async () => {
    vi.useFakeTimers();
    const { runtime, options } = fixture();
    const abort = new AbortController();
    runtime.prepareTerrain.mockImplementationOnce(() => new Promise(() => {}));
    const flight = prepareTerrainWithRecovery(runtime, { ...request, signal: abort.signal }, options);
    const rejected = expect(flight).rejects.toMatchObject({ name: "AbortError" });
    abort.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(15000);
    expect(runtime.setMapSource).not.toHaveBeenCalled();
    expect(options.onFallback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start an already cancelled request", async () => {
    const { runtime, options } = fixture();
    const abort = new AbortController(); abort.abort();
    await expect(prepareTerrainWithRecovery(runtime, { ...request, signal: abort.signal }, options)).rejects.toMatchObject({ name: "AbortError" });
    expect(runtime.prepareTerrain).not.toHaveBeenCalled();
  });

  it("does not replace an explicit map change with an outage fallback", async () => {
    const { runtime, options } = fixture();
    runtime.prepareTerrain.mockImplementationOnce(async () => {
      runtime.status.mode = "raster-basemap";
      throw new Error("Source changed");
    });
    expect(await prepareTerrainWithRecovery(runtime, request, options)).toEqual(ready);
    expect(runtime.setMapSource).not.toHaveBeenCalled();
    expect(options.onFallback).not.toHaveBeenCalled();
  });

  it("propagates a progress consumer error without blaming the provider", async () => {
    const { runtime, options } = fixture();
    const error = new Error("UI callback failed");
    runtime.prepareTerrain.mockImplementationOnce(async r => { r.onProgress!(progress()); return ready; });
    await expect(prepareTerrainWithRecovery(runtime, { ...request, onProgress: () => { throw error; } }, options)).rejects.toBe(error);
    expect(runtime.setMapSource).not.toHaveBeenCalled();
  });

  it("keeps both errors and stops if backup terrain also fails", async () => {
    const { runtime, options } = fixture();
    const google = new Error("Google denied"); const raster = new Error("Elevation offline");
    runtime.prepareTerrain.mockRejectedValueOnce(google).mockRejectedValueOnce(raster);
    const failure = await prepareTerrainWithRecovery(runtime, request, options).catch(error => error as Error);
    expect(failure.message).toContain("Google 3D Tiles and the backup terrain could not load");
    expect((failure.cause as AggregateError).errors).toEqual([google, raster]);
    expect(runtime.prepareTerrain).toHaveBeenCalledTimes(2);
    expect(options.onRecovered).not.toHaveBeenCalled();
  });

  it.each(["raster-basemap", "fallback"] as const)("keeps an ordinary %s preparation unchanged", async mode => {
    const { runtime, options } = fixture(mode);
    expect(await prepareTerrainWithRecovery(runtime, request, options)).toEqual(ready);
    expect(runtime.prepareTerrain).toHaveBeenCalledExactlyOnceWith(request);
    expect(options.onFallback).not.toHaveBeenCalled();
  });
});
