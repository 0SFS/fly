import type { AircraftSelection } from "@0sfs/aircraft/aircraftCatalog";
import { aircraftSelectionValues } from "@0sfs/aircraft/aircraftSelectionSetting";
import type { FlightState } from "@0sfs/ground-contact/flightState";
import { URL_PARAMETER_PREFIX, type SettingsRegistry } from "foss-earth/settings";
import { AIRCRAFT_URL_NAME } from "../aircraft/aircraftAddress";

const DEGREES_PER_RADIAN = 180 / Math.PI;
const METERS_PER_FOOT = 0.3048;
/** About 1 kt: slower than this an aircraft has no path to climb along. */
const STILL_FPS = 1.7;

/**
 * The start settings a shared flight gives the next one, in link order, with
 * the decimals each keeps: about 0.1 m of position and height, 0.1° and 1 kt.
 */
const SHARED_START = {
  "osfs.start.latitude": 6,
  "osfs.start.longitude": 6,
  "osfs.start.heightAboveGround": 1,
  "osfs.start.heading": 1,
  "osfs.start.pitch": 1,
  "osfs.start.climbAngle": 1,
  "osfs.start.airspeed": 0,
} as const;

export type SharedStartId = keyof typeof SHARED_START;

/** What a share reads from the flight in progress. */
export interface FlightShareSource {
  state: FlightState;
  /** The ground under the aircraft, or null while it is unknown. */
  groundHeightMeters: number | null;
  selection: AircraftSelection;
  /** The aircraft's name, such as "F-35B". */
  aircraftLabel: string;
}

/** A flight as the settings that start another one like it. */
export interface SharedFlight {
  aircraftLabel: string;
  /** osfs.aircraft.id and, in a family with variants, osfs.aircraft.generation. */
  aircraft: Record<string, string>;
  start: Record<SharedStartId, number>;
}

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  // No negative zero in a link.
  return Math.round(value * scale) / scale + 0;
};

/**
 * The flight in progress as start settings, each inside its setting's bounds:
 * a link value outside them would be ignored. The height is above the ground,
 * not above sea level, so a flight shared over one map's ground starts at the
 * same height over another's. Null while the ground under the aircraft is unknown.
 */
export function captureSharedFlight(
  source: FlightShareSource,
  settings: Pick<SettingsRegistry, "inspect">,
): SharedFlight | null {
  const { state, groundHeightMeters } = source;
  if (groundHeightMeters === null || !Number.isFinite(groundHeightMeters)) return null;
  const groundSpeedFps = Math.hypot(state.northVelocityFps, state.eastVelocityFps);
  const moving = Math.hypot(groundSpeedFps, state.verticalSpeedFps) >= STILL_FPS;
  const values: Record<SharedStartId, number> = {
    "osfs.start.latitude": state.latDeg,
    "osfs.start.longitude": state.lonDeg,
    "osfs.start.heightAboveGround": state.altMeters - groundHeightMeters,
    "osfs.start.heading": ((state.headingRad * DEGREES_PER_RADIAN) % 360 + 360) % 360,
    "osfs.start.pitch": state.pitchRad * DEGREES_PER_RADIAN,
    "osfs.start.climbAngle": moving ? Math.atan2(state.verticalSpeedFps, groundSpeedFps) * DEGREES_PER_RADIAN : 0,
    "osfs.start.airspeed": state.airspeedKts,
  };
  const start = {} as Record<SharedStartId, number>;
  for (const id of Object.keys(SHARED_START) as SharedStartId[]) {
    if (!Number.isFinite(values[id])) return null;
    const bounds = settings.inspect(id).bounds;
    const value = bounds ? Math.min(bounds.max, Math.max(bounds.min, values[id])) : values[id];
    start[id] = round(value, SHARED_START[id]);
  }
  const selection = aircraftSelectionValues(source.selection);
  // The level of detail is the receiving device's own choice.
  const aircraft: Record<string, string> = { "osfs.aircraft.id": selection["osfs.aircraft.id"]! };
  if (selection["osfs.aircraft.generation"] !== undefined) aircraft["osfs.aircraft.generation"] = selection["osfs.aircraft.generation"];
  return { aircraftLabel: source.aircraftLabel, aircraft, start };
}

/** A link to `baseUrl` that starts a new flight as `flight`, for that visit. */
export function sharedFlightUrl(baseUrl: string, flight: SharedFlight): string {
  const url = new URL(baseUrl);
  for (const [id, value] of [...Object.entries(flight.aircraft), ...Object.entries(flight.start)]) {
    // The aircraft goes by its short name, ?aircraft=.
    if (id === "osfs.aircraft.id") {
      url.searchParams.delete(`${URL_PARAMETER_PREFIX}${id}`);
      url.searchParams.set(AIRCRAFT_URL_NAME, String(value));
    } else url.searchParams.set(`${URL_PARAMETER_PREFIX}${id}`, String(value));
  }
  return url.href;
}

const signed = (value: number): string => value < 0 ? `\u2212${-value}` : String(value);

/** The shared state in a line: aircraft, place, height, heading, pitch, climb and speed. */
export function describeSharedFlight(flight: SharedFlight, heightUnit: "m" | "ft" = "m"): string {
  const start = flight.start;
  const height = Math.round(start["osfs.start.heightAboveGround"] / (heightUnit === "ft" ? METERS_PER_FOOT : 1));
  return [
    flight.aircraftLabel,
    `${signed(start["osfs.start.latitude"])}, ${signed(start["osfs.start.longitude"])}`,
    `${height.toLocaleString("en-US")} ${heightUnit} AGL`,
    `heading ${start["osfs.start.heading"]}°`,
    `pitch ${signed(start["osfs.start.pitch"])}°`,
    `climb ${signed(start["osfs.start.climbAngle"])}°`,
    `${start["osfs.start.airspeed"]} kt`,
  ].join(" · ");
}
