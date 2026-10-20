import type { FlightState } from "@0sfs/ground-contact/flightState";
import type { ParameterValue, SettingsRegistry } from "foss-earth/settings";

export type BenchmarkRouteId = "cruise" | "low";

/** Candidate straight track through Stockton's flat Central Valley terrain.
 * Google coverage and the ground profile must be checked by a live run; these
 * coordinates alone do not establish either. No route changes normal starts.
 */
export const BENCHMARK_ROUTES = {
  cruise: { id: "cruise", latDeg: 37.91, lonDeg: -121.285, headingDeg: 0, heightAboveGroundMeters: 1500, airspeedKts: 110, durationSeconds: 180 },
  low: { id: "low", latDeg: 37.91, lonDeg: -121.285, headingDeg: 0, heightAboveGroundMeters: 150, airspeedKts: 110, durationSeconds: 180 },
} as const;
export type BenchmarkRoute = (typeof BENCHMARK_ROUTES)[BenchmarkRouteId];

/** A published build may be profiled, but an ordinary visit never reads route. */
export function requestedBenchmarkRoute(search: string): BenchmarkRoute | null {
  const params = new URLSearchParams(search);
  if (params.get("dev") !== "1") return null;
  const id = params.get("route");
  return id === "cruise" || id === "low" ? BENCHMARK_ROUTES[id] : null;
}

/** Required only for this visit. Releasing the forces reveals saved values. */
export function forceBenchmarkRouteSettings(settings: SettingsRegistry, route: BenchmarkRoute): () => void {
  const values: Record<string, ParameterValue> = {
    "osfs.aircraft.id": "cessna-172", "osfs.aircraft.generation": "cessna-172", "osfs.aircraft.lod": "auto",
    "osfs.start.resume": false,
    "osfs.start.latitude": route.latDeg, "osfs.start.longitude": route.lonDeg,
    "osfs.start.heading": route.headingDeg, "osfs.start.heightAboveGround": route.heightAboveGroundMeters,
    "osfs.start.airspeed": route.airspeedKts, "osfs.start.throttle": 0.65,
    "osfs.autopilot.backend": "ours", "osfs.autopilot.throttleMode": "airspeed",
    ...Object.fromEntries(["roll", "pitch", "yaw", "throttle", "gear", "flaps"].map(axis => [`osfs.autopilot.axes.${axis}`, true])),
    "osfs.assist.autoFlaps": false,
    "map.source.basemap": "google",
  };
  const release = Object.entries(values).map(([id, value]) => settings.force(id, value, `W0 ${route.id} benchmark route (this visit only)`));
  return () => { for (const stop of release.reverse()) stop(); };
}

export interface BenchmarkRouteSample {
  elapsedSeconds: number;
  latDeg: number;
  lonDeg: number;
  altitudeMslMeters: number;
  headingDeg: number;
  airspeedKts: number;
  groundHeightMeters: number | null;
}

export interface BenchmarkRouteSnapshot {
  route: BenchmarkRoute;
  aircraft: "cessna-172";
  status: "running" | "complete" | "failed";
  failure: string | null;
  elapsedSeconds: number;
  acceptedSteps: number;
  /** Epoch-aligned monotonic wall clock at the first accepted step; null before flight advances. */
  startedAtEpochMs: number | null;
  /** Epoch-aligned monotonic wall clock at completion or failure, including failure before the first step. */
  completedAtEpochMs: number | null;
  targetAltitudeMslMeters: number;
  altitudeReference: "initial-ground-plus-requested-clearance";
  settings: Record<string, ParameterValue>;
  coverageValidation: "unverified";
  samples: readonly BenchmarkRouteSample[];
  maxAltitudeErrorMeters: number;
  maxHeadingErrorDeg: number;
}

const clamp = (value: number, lower: number, upper: number): number => Math.max(lower, Math.min(upper, value));
const wrap = (radians: number): number => ((radians + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
const DEG = Math.PI / 180;
const MAX_PITCH = 12 * DEG;
// The C172 start uses its placement attitude, not a trimmed level-flight
// attitude. Correct the altitude sooner and remove that bias in seconds,
// rather than letting a slow integral accumulate a 35 m initial climb.
const ALTITUDE_KP = 0.009; // radians per metre
const ALTITUDE_KI = 0.0003; // radians per metre-second
const VERTICAL_SPEED_KD = 0.045; // radians per metre/second (up positive)
const finiteState = (state: FlightState): boolean => [state.latDeg, state.lonDeg, state.altMeters,
  state.pitchRad, state.headingRad, state.verticalSpeedFps, state.airspeedKts].every(Number.isFinite);

export interface BenchmarkRouteController {
  readonly status: BenchmarkRouteSnapshot["status"];
  snapshot(): BenchmarkRouteSnapshot;
  /** Targets for the existing AP's inner attitude and airspeed controllers. */
  targets(state: FlightState): { rollRad: number; pitchRad: number; headingRad: number; airspeedKts: number };
  /** Called only after an accepted native physics step, never a rendered frame. */
  acceptStep(state: FlightState, groundHeight: () => number | null): boolean;
  fail(reason: string): void;
}

export function createBenchmarkRouteController(
  route: BenchmarkRoute,
  initial: FlightState,
  groundHeightMeters: number,
  fixedDtSeconds: number,
  settings: Record<string, ParameterValue>,
  metadataNowEpochMs: () => number = () => performance.timeOrigin + performance.now(),
): BenchmarkRouteController {
  if (!Number.isFinite(fixedDtSeconds) || fixedDtSeconds <= 0
    || !Number.isFinite(groundHeightMeters) || !finiteState(initial)) throw new Error("Invalid benchmark route initial state.");
  const targetAltitudeMslMeters = groundHeightMeters + route.heightAboveGroundMeters;
  const totalSteps = Math.round(route.durationSeconds / fixedDtSeconds);
  const stepsPerSample = Math.max(1, Math.round(1 / fixedDtSeconds));
  let acceptedSteps = 0;
  let status: BenchmarkRouteSnapshot["status"] = "running";
  let failure: string | null = null;
  let startedAtEpochMs: number | null = null;
  let completedAtEpochMs: number | null = null;
  const fail = (reason: string): void => {
    if (status !== "running") return;
    completedAtEpochMs = metadataNowEpochMs();
    status = "failed";
    failure = reason;
  };
  let pitchIntegralRad = 0;
  const pitchDemand = (state: FlightState, error: number): number => initial.pitchRad
    + error * ALTITUDE_KP - state.verticalSpeedFps * 0.3048 * VERTICAL_SPEED_KD + pitchIntegralRad;
  let maxAltitudeErrorMeters = Math.abs(initial.altMeters - targetAltitudeMslMeters);
  let maxHeadingErrorDeg = 0;
  const samples: BenchmarkRouteSample[] = [];
  const sample = (state: FlightState, ground: number | null): void => {
    samples.push({ elapsedSeconds: acceptedSteps * fixedDtSeconds, latDeg: state.latDeg, lonDeg: state.lonDeg,
      altitudeMslMeters: state.altMeters, headingDeg: ((state.headingRad / DEG) % 360 + 360) % 360,
      airspeedKts: state.airspeedKts, groundHeightMeters: Number.isFinite(ground) ? ground : null });
  };
  sample(initial, groundHeightMeters);
  return {
    get status() { return status; },
    snapshot: () => ({ route: { ...route }, aircraft: "cessna-172", status, failure,
      elapsedSeconds: Math.min(route.durationSeconds, acceptedSteps * fixedDtSeconds), acceptedSteps, startedAtEpochMs, completedAtEpochMs,
      targetAltitudeMslMeters, altitudeReference: "initial-ground-plus-requested-clearance", settings: { ...settings },
      coverageValidation: "unverified", samples: samples.map(value => ({ ...value })), maxAltitudeErrorMeters, maxHeadingErrorDeg }),
    targets(state) {
      const headingRad = route.headingDeg * DEG;
      if (!finiteState(state)) {
        fail("Non-finite flight state during benchmark route.");
        return { rollRad: 0, pitchRad: 0, headingRad, airspeedKts: route.airspeedKts };
      }
      // The ordinary AP holds attitude, not altitude. This dev-only outer loop
      // supplies pitch and bank targets; the same AP still owns the surfaces.
      const altitudeError = targetAltitudeMslMeters - state.altMeters;
      return {
        rollRad: clamp(wrap(headingRad - state.headingRad) * 1.3, -15 * DEG, 15 * DEG),
        pitchRad: clamp(pitchDemand(state, altitudeError), -MAX_PITCH, MAX_PITCH),
        headingRad, airspeedKts: route.airspeedKts,
      };
    },
    acceptStep(state, groundHeight) {
      if (status !== "running") return status === "complete";
      if (!finiteState(state)) { fail("Non-finite flight state during benchmark route."); return false; }
      if (acceptedSteps === 0) startedAtEpochMs = metadataNowEpochMs();
      acceptedSteps += 1;
      if (acceptedSteps >= totalSteps) completedAtEpochMs = metadataNowEpochMs();
      const error = targetAltitudeMslMeters - state.altMeters;
      // Do not wind up farther into the pitch limit. An error pointing away
      // from saturation may still unwind the integral after a disturbance.
      const demand = pitchDemand(state, error);
      if (Math.abs(demand) < MAX_PITCH || Math.sign(error) !== Math.sign(demand)) {
        pitchIntegralRad = clamp(pitchIntegralRad + error * fixedDtSeconds * ALTITUDE_KI, -10 * DEG, 10 * DEG);
      }
      maxAltitudeErrorMeters = Math.max(maxAltitudeErrorMeters, Math.abs(error));
      maxHeadingErrorDeg = Math.max(maxHeadingErrorDeg, Math.abs(wrap(route.headingDeg * DEG - state.headingRad)) / DEG);
      if (acceptedSteps % stepsPerSample === 0 || acceptedSteps >= totalSteps) sample(state, groundHeight());
      if (acceptedSteps >= totalSteps) status = "complete";
      return status === "complete";
    },
    fail,
  };
}

declare global {
  interface Window {
    /** Dev-only W0 metadata, including the 1 Hz actual track and stop state. */
    osfsFlightRoute?: Pick<BenchmarkRouteController, "snapshot" | "status">;
  }
}
