import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import { isAircraftId, type AircraftId } from "@0sfs/aircraft/aircraftIds";
import { currentAircraftId } from "../aircraft/aircraftAddress";
import { readFlightState } from "@0sfs/ground-contact/ecefBridge";
import type { FlightState } from "@0sfs/ground-contact/flightState";
import { captureSimulation, initialTerrainElevationMeters, restoreSimulation, validFlightState, type AircraftClearanceStance, type SimulationSnapshot } from "@0sfs/ground-contact/safeFlightState";

/**
 * The flight in progress, kept in browser storage so the next session carries
 * on from it rather than starting over at the start position: the simulator's
 * own recovery snapshot (position, attitude, velocities, controls, fuel and
 * engine), and what the app needs before the simulator is ready, which is
 * where to prepare the ground, how high above it, and whether it was paused.
 */
export const SAVED_FLIGHT_STORAGE_KEY = "osfs.saved-flight.v1";

const METERS_PER_FOOT = 0.3048;
/**
 * Lower than any ground on Earth (the Dead Sea shore is at -430 m). Below it,
 * the terrain height the simulator held was a placeholder for unknown ground.
 */
const LOWEST_GROUND_METERS = -1000;
/** The session sets its own wind: the Weather tab starts calm and does not keep it. */
const SESSION_CONTROLS = /^atmosphere\//;

export interface SavedFlight {
  version: 1;
  /** When it was saved, in milliseconds since the Unix epoch. */
  savedAtMs: number;
  aircraftId: AircraftId;
  paused: boolean;
  latDeg: number;
  lonDeg: number;
  altMeters: number;
  headingDeg: number;
  /** Height above the ground the simulator was given; null when that ground was unknown. */
  aboveGroundMeters: number | null;
  simulation: SimulationSnapshot;
}

/** The ground FOSS Earth prepared under the saved flight this session. */
export interface PreparedGround {
  groundHeightMeters: number;
  altitudeMeters: number;
}

export interface SavedFlightStore {
  read(): SavedFlight | null;
  /** False when the browser would not keep it. */
  write(flight: SavedFlight): boolean;
  clear(): void;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const numberRecord = (value: unknown): value is Record<string, number> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(finite);

/** The flight as it is now, or null when its state is not one to come back to. */
export function captureSavedFlight(
  sdk: JSBSimSdk,
  aircraftId: AircraftId,
  paused: boolean,
  savedAtMs = Date.now(),
): SavedFlight | null {
  const state = readFlightState(sdk);
  if (!validFlightState(state)) return null;
  const snapshot = captureSimulation(sdk);
  if (!Object.values(snapshot.initial).every(Number.isFinite) || !Number.isFinite(snapshot.simTimeS)) return null;
  // A property this aircraft lacks reads as no number; it has nothing to restore.
  const controls = Object.fromEntries(Object.entries(snapshot.controls).filter(([, value]) => Number.isFinite(value)));
  const groundMeters = snapshot.initial["ic/terrain-elevation-ft"] * METERS_PER_FOOT;
  return {
    version: 1,
    savedAtMs,
    aircraftId,
    paused,
    latDeg: state.latDeg,
    lonDeg: state.lonDeg,
    altMeters: state.altMeters,
    headingDeg: snapshot.initial["ic/psi-true-deg"],
    aboveGroundMeters: groundMeters > LOWEST_GROUND_METERS ? state.altMeters - groundMeters : null,
    simulation: { ...snapshot, controls },
  };
}

/** A stored flight, or null for anything that is not one this version wrote. */
export function parseSavedFlight(raw: string | null): SavedFlight | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  // A flight saved before its aircraft was renamed carries on under the new id.
  const flight = { ...value, aircraftId: currentAircraftId((value as Partial<SavedFlight>).aircraftId) } as Partial<SavedFlight>;
  const simulation = flight.simulation as Partial<SimulationSnapshot> | undefined;
  const valid = flight.version === 1
    && finite(flight.savedAtMs)
    && isAircraftId(flight.aircraftId)
    && typeof flight.paused === "boolean"
    && finite(flight.latDeg) && Math.abs(flight.latDeg) <= 90
    && finite(flight.lonDeg) && Math.abs(flight.lonDeg) <= 180
    && finite(flight.altMeters)
    && finite(flight.headingDeg)
    && (flight.aboveGroundMeters === null || finite(flight.aboveGroundMeters))
    && typeof simulation === "object" && simulation !== null
    && numberRecord(simulation.initial)
    && numberRecord(simulation.controls)
    && typeof simulation.running === "boolean"
    && finite(simulation.simTimeS);
  return valid ? flight as SavedFlight : null;
}

/** Browser storage that may refuse, or be missing, without stopping the flight. */
export function createSavedFlightStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
): SavedFlightStore {
  return {
    read() {
      try {
        return parseSavedFlight(storage?.getItem(SAVED_FLIGHT_STORAGE_KEY) ?? null);
      } catch {
        return null;
      }
    },
    write(flight) {
      if (!storage) return false;
      try {
        storage.setItem(SAVED_FLIGHT_STORAGE_KEY, JSON.stringify(flight));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage?.removeItem(SAVED_FLIGHT_STORAGE_KEY);
      } catch {
        // Nothing kept, or nothing that can be removed: either way it is not resumed.
      }
    },
  };
}

/**
 * Prepare geometry around the saved absolute pose. Changing maps or their
 * detail never grants permission to move the aircraft with the sampled ground.
 */
export function savedFlightTerrainRequest(flight: SavedFlight): {
  latDeg: number;
  lonDeg: number;
  altitudeAboveGroundMeters?: number;
  altitudeMeters?: number;
  clearanceMeters: number;
} {
  return {
    latDeg: flight.latDeg,
    lonDeg: flight.lonDeg,
    altitudeMeters: flight.altMeters,
    clearanceMeters: 0,
  };
}

/** The saved world pose and ground-relative motion, before native restoration is ready. */
export function savedFlightPreview(flight: SavedFlight, fallback: FlightState): FlightState {
  const initial = flight.simulation.initial;
  const chosen = (value: number | undefined, otherwise: number): number => Number.isFinite(value) ? value! : otherwise;
  const degrees = Math.PI / 180;
  return {
    ...fallback,
    latDeg: chosen(flight.latDeg, fallback.latDeg),
    lonDeg: chosen(flight.lonDeg, fallback.lonDeg),
    altMeters: chosen(flight.altMeters, fallback.altMeters),
    headingRad: chosen(Number.isFinite(flight.headingDeg) ? flight.headingDeg * degrees : undefined, fallback.headingRad),
    rollRad: chosen(Number.isFinite(initial["ic/phi-deg"]) ? initial["ic/phi-deg"] * degrees : undefined, fallback.rollRad),
    pitchRad: chosen(Number.isFinite(initial["ic/theta-deg"]) ? initial["ic/theta-deg"] * degrees : undefined, fallback.pitchRad),
    northVelocityFps: chosen(initial["ic/vn-fps"], fallback.northVelocityFps),
    eastVelocityFps: chosen(initial["ic/ve-fps"], fallback.eastVelocityFps),
    verticalSpeedFps: chosen(Number.isFinite(initial["ic/vd-fps"]) ? -initial["ic/vd-fps"] : undefined, fallback.verticalSpeedFps),
    throttleNorm: chosen(flight.simulation.controls["fcs/throttle-cmd-norm"], fallback.throttleNorm),
  };
}

/** The saved controls this aircraft has, in place of its current ones; its own for the rest. */
function savedControls(current: Record<string, number>, flight: SavedFlight): Record<string, number> {
  const controls: Record<string, number> = {};
  for (const [property, value] of Object.entries(current)) {
    // Before differential braking, saves recorded only equal wheel brakes.
    const saved = flight.simulation.controls[property] ?? (property === "fcs/brake-cmd-norm"
      ? Math.max(flight.simulation.controls["fcs/left-brake-cmd-norm"] ?? Number.NaN,
        flight.simulation.controls["fcs/right-brake-cmd-norm"] ?? Number.NaN)
      : undefined);
    const chosen = !SESSION_CONTROLS.test(property) && Number.isFinite(saved) ? saved : value;
    if (Number.isFinite(chosen)) controls[property] = chosen;
  }
  return controls;
}

/**
 * Writes the saved controls before the ground is ready, so the pilot's
 * throttle, gear, flaps and trim start where the saved flight left them.
 * Another aircraft keeps its own: the saved controls are not its controls.
 */
export function applySavedControls(sdk: JSBSimSdk, flight: SavedFlight, aircraftId: AircraftId): void {
  if (flight.aircraftId !== aircraftId) return;
  const controls = savedControls(captureSimulation(sdk).controls, flight);
  for (const [property, value] of Object.entries(controls)) sdk.setPropertyValue(property, value);
}

/**
 * Puts the aircraft back at its saved absolute pose, even when the map's
 * ground moved. Any proposed correction belongs to the host's consent flow.
 * Another aircraft takes the position, attitude and velocities, and keeps its
 * own controls and engine.
 */
export function restoreSavedFlight(
  sdk: JSBSimSdk,
  flight: SavedFlight,
  aircraftId: AircraftId,
  ground: PreparedGround,
  /** The restored aircraft's stance, which says how deep its contacts would start in that ground. */
  stance: AircraftClearanceStance,
): FlightState {
  const current = captureSimulation(sdk);
  const sameAircraft = flight.aircraftId === aircraftId;
  const initial: Record<string, number> = {};
  for (const property of Object.keys(current.initial)) {
    const value = flight.simulation.initial[property];
    if (!Number.isFinite(value)) throw new Error(`The saved flight has no ${property}.`);
    initial[property] = value;
  }
  // Ground that rose above the saved pose must not start the aircraft on
  // compressed contacts; the terrain contact asks about it before stepping.
  initial["ic/terrain-elevation-ft"] = initialTerrainElevationMeters(stance, flight.altMeters,
    ground.groundHeightMeters, initial["ic/phi-deg"] * Math.PI / 180, initial["ic/theta-deg"] * Math.PI / 180) / METERS_PER_FOOT;
  initial["ic/h-sl-ft"] = flight.altMeters / METERS_PER_FOOT;
  restoreSimulation(sdk, {
    initial,
    controls: sameAircraft
      ? savedControls(current.controls, flight)
      : Object.fromEntries(Object.entries(current.controls).filter(([, value]) => Number.isFinite(value))),
    running: sameAircraft ? flight.simulation.running : current.running,
    // A new session's clock: the saved one belongs to the session that ended.
    simTimeS: current.simTimeS,
  });
  return readFlightState(sdk);
}
