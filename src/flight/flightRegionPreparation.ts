import type { BabylonRuntime, TerrainRegionLease, TerrainRegionProgress } from "foss-earth/runtime";
import type { FlightState } from "@0sfs/ground-contact/flightState";
import type { FlightParameters } from "./settings/flightParameters";
import type { FlightLoadingScreen } from "../loading/createFlightLoadingScreen";
import { flightRegion } from "./flightRegion";

export interface PreparedFlightRegion { groundHeightMeters: number | undefined; altitudeMeters: number; overridden: boolean }

export interface FlightRegionPlacement {
  /** A fresh start: place this far above the destination's ground (at least the gear clearance). */
  aboveGroundMeters?: number;
  /**
   * The existing aircraft's absolute altitude. Spawn now anyway is offered
   * only once the aircraft exists: omit it until physics has initialized,
   * then call `allowOverride`.
   */
  aircraftAltitudeMeters?: number;
}

/** One demand follows the aircraft through preparation and ordinary flight. */
export function createFlightRegionPreparation(options: {
  parameters: FlightParameters; drone: boolean; loading: FlightLoadingScreen;
  onProgress(progress: TerrainRegionProgress, preview: FlightState): void;
  groundClearanceMeters: number;
  /** Ask about this exact move; `from` is the pose Spawn now anyway would keep. */
  confirmRaise(from: FlightState, altitudeMeters: number, signal: AbortSignal): Promise<boolean>;
}) {
  let lease: TerrainRegionLease | null = null;
  let cancelWait: (() => void) | null = null;
  let current: FlightState | null = null;
  let bodyRadius = options.drone ? 0.5 : 10;
  let lastUpdate = -Infinity;
  let runtime: BabylonRuntime | null = null;
  let report: ((progress: TerrainRegionProgress) => void) | null = null;
  let reoffer: (() => void) | null = null;
  let aircraftAltitude: number | null = null;
  let targetSignature = "";
  let generation = 0;
  // Whether a preparation's wait is open: the loading card is showing it.
  let waiting = false;
  // Map → Detail → Show loading region: while a wait is open, always, or never.
  const showRegion = (): void => {
    const show = options.parameters.get("osfs.region.show");
    lease?.setVisible(show === "always" || (show === "preparing" && waiting));
  };
  const createLease = () => {
    if (!runtime || !current) return;
    const request = flightRegion(current, options.drone, bodyRadius, options.parameters);
    targetSignature = JSON.stringify([request.minimum, request.final]);
    lease?.release();
    lease = null;
    const acquired = ++generation;
    lease = runtime.prepareTerrainRegion({ ...request, onProgress: progress => {
      if (!lease || acquired !== generation) return;
      if (current) options.onProgress(progress, current);
      report?.(progress);
    } });
    showRegion();
  };
  return {
    prepare(nextRuntime: BabylonRuntime, state: FlightState, signal: AbortSignal, placement: FlightRegionPlacement = {}): Promise<PreparedFlightRegion> {
      cancelWait?.();
      lease?.release();
      lease = null;
      runtime = nextRuntime;
      current = { ...state };
      aircraftAltitude = placement.aircraftAltitudeMeters ?? null;
      const { aboveGroundMeters } = placement;
      const aboveGround = aboveGroundMeters === undefined ? undefined : Math.max(aboveGroundMeters, options.groundClearanceMeters);
      // A raise prompt belongs to this wait: finishing or cancelling it closes the prompt.
      const prompts = new AbortController();
      return new Promise((resolve, reject) => {
        let finished = false;
        let ground: number | null = null;
        // Spawn now anyway never samples a new height: an absolute destination
        // keeps its altitude, and a fresh start keeps the aircraft's own until
        // its ground is known.
        const overrideAltitude = (): number | null => aboveGround === undefined ? state.altMeters
          : ground !== null ? current!.altMeters : aircraftAltitude;
        // An override places the aircraft against the ground its card showed.
        const finish = (overridden: boolean, error?: Error, altitude?: number, decidedGround?: number | null) => {
          if (finished) return;
          finished = true;
          signal.removeEventListener("abort", abort);
          prompts.abort();
          report = null;
          reoffer = null;
          cancelWait = null;
          waiting = false;
          showRegion();
          options.loading.setSpawnOverride?.(null);
          if (error) { reject(error); return; }
          const placedGround = overridden ? decidedGround : lease!.read().groundHeightMeters;
          if (overridden) {
            current = { ...current!, altMeters: altitude! };
            lease!.update(flightRegion(current, options.drone, bodyRadius, options.parameters).region);
          }
          resolve({ altitudeMeters: current!.altMeters, groundHeightMeters: placedGround ?? undefined, overridden });
        };
        const abort = () => finish(false, new DOMException("Placement cancelled.", "AbortError"));
        cancelWait = abort;
        signal.addEventListener("abort", abort, { once: true });
        const offerOverride = (): void => {
          const altitude = overrideAltitude();
          if (altitude === null || aircraftAltitude === null) { options.loading.setSpawnOverride?.(null); return; }
          const surface = ground;
          const raised = surface === null ? null : surface + options.groundClearanceMeters;
          // Say where the spawn sits against the ground known so far, above all when it is inside it.
          const relation = surface === null ? ""
            : altitude < surface ? `, ${(surface - altitude).toFixed(1)} m below the ground loaded so far`
              : `, ${(altitude - surface).toFixed(1)} m above the ground loaded so far`;
          options.loading.setSpawnOverride?.({
            label: "Spawn now anyway",
            detail: surface === null
              ? `Spawn at ${altitude.toFixed(1)} m, the aircraft's current altitude. Ground height is unknown.`
              : `Spawn at ${altitude.toFixed(1)} m${relation}. Map detail is still loading.`,
            onClick: () => finish(true, undefined, altitude, surface),
            ...(raised !== null && raised > altitude ? {
              aboveGround: { onClick: () => {
                void options.confirmRaise({ ...current!, altMeters: altitude }, raised, prompts.signal).then(accepted => {
                  if (accepted && !prompts.signal.aborted) finish(true, undefined, raised, surface);
                });
              } },
            } : {}),
          });
        };
        report = progress => {
          if (finished) return;
          ground = progress.groundHeightMeters;
          if (aboveGround !== undefined && ground !== null) {
            const altitude = ground + aboveGround;
            if (Math.abs(altitude - current!.altMeters) > 0.01) {
              current = { ...current!, altMeters: altitude };
              // The moved region reports again once its own coverage is measured.
              lease?.update(flightRegion(current, options.drone, bodyRadius, options.parameters).region);
              options.onProgress(lease?.read() ?? progress, current);
              // The card never offers an altitude other than the one it shows.
              offerOverride();
              return;
            }
          }
          const hasAltitude = aboveGround === undefined || ground !== null;
          options.loading.setPhase("terrain", {
            state: progress.finalReady && hasAltitude ? "ready" : "loading",
            detail: !hasAltitude && progress.finalReady ? "Waiting for ground height to place the aircraft above ground" : progress.reason ?? (progress.minimumReady ? "Refining the map around your aircraft" : "Loading basic map coverage around your aircraft"),
          });
          if (progress.finalReady && hasAltitude) { finish(false); return; }
          offerOverride();
        };
        reoffer = offerOverride;
        if (signal.aborted) { abort(); return; }
        waiting = true;
        createLease();
        if (!finished) report?.(lease!.read());
      });
    },
    /** The aircraft and its physics exist at this absolute altitude: overrides may be offered. */
    allowOverride(altitudeMeters: number) {
      if (!Number.isFinite(altitudeMeters)) return;
      aircraftAltitude = altitudeMeters;
      reoffer?.();
    },
    /** The pose the current preparation (or flight) is loading around. */
    target: (): FlightState | null => current && { ...current },
    update(state: FlightState, radius = bodyRadius, force = false) {
      current = state;
      bodyRadius = Math.max(bodyRadius, radius);
      const now = performance.now();
      if (!lease || !runtime || (!force && now - lastUpdate < 150)) return;
      lastUpdate = now;
      const request = flightRegion(state, options.drone, bodyRadius, options.parameters);
      if (JSON.stringify([request.minimum, request.final]) !== targetSignature) createLease();
      else lease.update(request.region);
    },
    read: () => lease?.read() ?? null,
    /** Applies a changed Show loading region setting. */
    showRegion,
    setBodyRadius(radius: number) {
      if (!Number.isFinite(radius) || radius <= bodyRadius) return;
      bodyRadius = radius;
      if (lease && current) lease.update(flightRegion(current, options.drone, bodyRadius, options.parameters).region);
    },
    dispose() { ++generation; cancelWait?.(); lease?.release(); lease = null; current = null; report = null; },
  };
}
