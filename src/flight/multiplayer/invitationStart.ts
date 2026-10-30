import { isAircraftId, type AircraftId } from "@0sfs/aircraft/aircraftIds";
import type { FlightLocation } from "../location/flightLocation";
import { AIRCRAFT_URL_NAME, currentAircraftId } from "../aircraft/aircraftAddress";

export interface InvitationStart { aircraftId?: AircraftId; location?: FlightLocation }
// Older invitations wrote the aircraft's full setting name.
const LONG_AIRCRAFT_PARAM = "set.osfs.aircraft.id";
const bounded = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

/** Copy only the finite location fields the flight's normal destination path accepts. */
export function invitationLocation(value: unknown): FlightLocation | undefined {
  if (!value || typeof value !== "object") return;
  const data = value as Record<string, unknown>;
  if (!bounded(data.latDeg, -90, 90) || !bounded(data.lonDeg, -180, 180)) return;
  const location: FlightLocation = { latDeg: data.latDeg, lonDeg: data.lonDeg };
  for (const [name, min, max] of [["altMeters", -1000, 100_000], ["headingDeg", 0, 360], ["airspeedKts", 0, 400]] as const) {
    if (data[name] !== undefined) {
      if (!bounded(data[name], min, max)) return;
      location[name] = data[name];
    }
  }
  if (data.flightPreset !== undefined) {
    if (!data.flightPreset || typeof data.flightPreset !== "object") return;
    const preset = data.flightPreset as Record<string, unknown>;
    if ((preset.mode !== "departure" && preset.mode !== "arrival") || !bounded(preset.headingDeg, 0, 360)
      || !bounded(preset.groundElevationMeters, -1000, 10_000) || !bounded(preset.flightPathDeg, -90, 90)) return;
    location.flightPreset = { mode: preset.mode, headingDeg: preset.headingDeg, groundElevationMeters: preset.groundElevationMeters, flightPathDeg: preset.flightPathDeg };
  }
  return location;
}

export function readInvitationStart(href: string): InvitationStart {
  try {
    const url = new URL(href);
    const aircraft = currentAircraftId(url.searchParams.get(LONG_AIRCRAFT_PARAM) ?? url.searchParams.get(AIRCRAFT_URL_NAME));
    const spawn = new URLSearchParams(url.hash.slice(1)).get("spawn");
    return { ...(isAircraftId(aircraft) ? { aircraftId: aircraft } : {}),
      ...(spawn && spawn.length <= 2000 ? { location: invitationLocation(JSON.parse(spawn)) } : {}) };
  } catch { return {}; }
}

export function withInvitationStart(href: string, start: InvitationStart): string {
  const url = new URL(href);
  url.searchParams.delete(LONG_AIRCRAFT_PARAM);
  url.searchParams.delete(AIRCRAFT_URL_NAME);
  if (start.aircraftId) url.searchParams.set(AIRCRAFT_URL_NAME, start.aircraftId);
  const fragment = new URLSearchParams(url.hash.slice(1));
  fragment.delete("spawn");
  const location = invitationLocation(start.location);
  if (location) fragment.set("spawn", JSON.stringify(location));
  url.hash = fragment.toString();
  return url.href;
}
