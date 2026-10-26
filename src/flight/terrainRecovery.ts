import type { BabylonRuntime, RasterBaseMapSource, TerrainPreparationOptions, TerrainPreparationProgress, TerrainPreparationResult } from "foss-earth/runtime";

type TerrainRuntime = Pick<BabylonRuntime, "status" | "prepareTerrain" | "setMapSource">;

export interface TerrainRecoveryOptions {
  fallbackSource: RasterBaseMapSource;
  /** The runtime may have fallen back before the host's first preparation. */
  googleRequested?: boolean;
  /** Time without an improvement in usable ground, independent of tile queue churn. */
  stalledAfterMs: number;
  onFallback(error: unknown, source: RasterBaseMapSource): void;
  onRecovered(source: RasterBaseMapSource): void;
}

export class TerrainRecoveryError extends Error {
  constructor(googleError: unknown, backupError: unknown) {
    super("Google 3D Tiles and the backup terrain could not load. Check your connection or try another map.", {
      cause: new AggregateError([googleError, backupError], "Both terrain preparations failed."),
    });
    this.name = "TerrainRecoveryError";
  }
}

class ProgressCallbackError {
  readonly cause: unknown;
  constructor(cause: unknown) { this.cause = cause; }
}

/** A visible parent tile is not proof that the ground at the destination can load. */
async function prepareGoogleTerrain(runtime: TerrainRuntime, request: TerrainPreparationOptions, stalledAfterMs: number): Promise<TerrainPreparationResult> {
  const attempt = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let bestSamples = -1;
  let bestQuality = -Infinity;
  let rejectWait!: (error: unknown) => void;
  const wait = new Promise<never>((_resolve, reject) => { rejectWait = reject; });
  const cancel = () => {
    rejectWait(new DOMException("Terrain preparation cancelled.", "AbortError"));
    attempt.abort();
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      rejectWait(new Error("Google 3D Tiles stopped making usable terrain progress."));
      attempt.abort();
    }, stalledAfterMs);
  };
  const onProgress = (progress: TerrainPreparationProgress) => {
    if (closed) return;
    const quality = progress.diagnostics?.centerQuality ?? -Infinity;
    if (progress.readySamples > bestSamples || quality > bestQuality) {
      bestSamples = Math.max(bestSamples, progress.readySamples);
      bestQuality = Math.max(bestQuality, quality);
      arm();
    }
    if (progress.phase === "ready") clearTimeout(timer);
    try { request.onProgress?.(progress); }
    catch (cause) { throw new ProgressCallbackError(cause); }
  };
  try {
    request.signal?.addEventListener("abort", cancel, { once: true });
    if (request.signal?.aborted) throw new DOMException("Terrain preparation cancelled.", "AbortError");
    arm();
    return await Promise.race([runtime.prepareTerrain({ ...request, signal: attempt.signal, onProgress }), wait]);
  } finally {
    closed = true;
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", cancel);
    attempt.abort();
  }
}

/**
 * One Google attempt, then one preparation against real backup terrain. A
 * provider transition invalidates a preparation; it does not invalidate the
 * flight. This never saves a different map preference or accepts the plain globe.
 */
export async function prepareTerrainWithRecovery(runtime: TerrainRuntime, request: TerrainPreparationOptions, options: TerrainRecoveryOptions): Promise<TerrainPreparationResult> {
  const mode = () => runtime.status.mode;
  let failure: { error: unknown } | null = mode() === "raster-basemap" && options.googleRequested && runtime.status.lastError
    ? { error: new Error(runtime.status.lastError) } : null;
  if (mode() !== "google-tiles" && !failure) {
    try { return await runtime.prepareTerrain(request); }
    catch (error) {
      if (request.signal?.aborted || (error instanceof Error && error.name === "AbortError") || mode() !== "google-tiles") throw error;
      // Google code loads lazily while the backup remains visible. Its arrival
      // invalidates that initial preparation; continue on the selected Google map.
    }
  }
  if (!failure) {
    try {
      return await prepareGoogleTerrain(runtime, request, options.stalledAfterMs);
    } catch (error) {
      if (error instanceof ProgressCallbackError) throw error.cause;
      if (request.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      // An explicit source change belongs to the caller, not outage recovery.
      if (mode() !== "google-tiles" && !runtime.status.lastError) return runtime.prepareTerrain(request);
      failure = { error };
    }
  }
  if (request.signal?.aborted) throw new DOMException("Terrain preparation cancelled.", "AbortError");
  options.onFallback(failure.error, options.fallbackSource);
  // The runtime may already have selected this backup after an HTTP error.
  if (mode() !== "raster-basemap") runtime.setMapSource(options.fallbackSource);
  let terrain: TerrainPreparationResult;
  try {
    terrain = await runtime.prepareTerrain(request);
  } catch (backupError) {
    if (request.signal?.aborted || (backupError instanceof Error && backupError.name === "AbortError")) throw backupError;
    throw new TerrainRecoveryError(failure.error, backupError);
  }
  options.onRecovered(options.fallbackSource);
  return terrain;
}
