import type { AircraftDefinition } from "@0sfs/aircraft/aircraftCatalog";
import type { SettingsRegistry } from "foss-earth/settings";
import { flightParameterSpec } from "./flightParameters";

/** The start settings whose defaults come from the aircraft's own start. */
export const AIRCRAFT_START_PARAMETER_IDS = [
  "osfs.start.latitude",
  "osfs.start.longitude",
  "osfs.start.heading",
  "osfs.start.heightAboveGround",
] as const;

type StartParameterId = (typeof AIRCRAFT_START_PARAMETER_IDS)[number];
type StartDefault = readonly [id: StartParameterId, value: number, derivedFrom: string];

/** A drone without a start height of its own begins just above the ground. */
export const DRONE_START_HEIGHT_METERS = 2;

/**
 * Makes an aircraft's own start (`start` in its mod's definition) the default
 * of a fresh flight's start: where it is, which way it faces and how high
 * above the ground. A saved flight, a link's start and the pilot's own
 * settings still win, and an aircraft without a start begins where every
 * flight did. Returns why any part of the aircraft's start was refused; a
 * refused part keeps the flight's own default.
 */
export function applyAircraftStartDefaults(settings: SettingsRegistry, aircraft: { id: string; start?: AircraftDefinition["start"] }, drone: boolean): string[] {
  const start = aircraft.start;
  const fromAircraft = `the ${aircraft.id} start`;
  const own = (id: StartParameterId): StartDefault => [id, flightParameterSpec(id).default, "the flight's own start"];
  const problems: string[] = [];
  const apply = (...entries: StartDefault[]): void => {
    try {
      for (const [id, value, derivedFrom] of entries) settings.setHostDefault(id, value, derivedFrom);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      // A latitude without its longitude is not a place: refuse both.
      for (const [id] of entries) settings.setHostDefault(...own(id));
    }
  };
  // A mod's manifest is not type-checked: a missing coordinate is refused, not filled in.
  if (start) apply(["osfs.start.latitude", start.latDeg, fromAircraft], ["osfs.start.longitude", start.lonDeg, fromAircraft]);
  else apply(own("osfs.start.latitude"), own("osfs.start.longitude"));
  apply(start?.headingDeg !== undefined ? ["osfs.start.heading", start.headingDeg, fromAircraft] : own("osfs.start.heading"));
  apply(start?.heightAboveGroundMeters !== undefined ? ["osfs.start.heightAboveGround", start.heightAboveGroundMeters, fromAircraft]
    : drone ? ["osfs.start.heightAboveGround", DRONE_START_HEIGHT_METERS, "a drone's start just above the ground"]
    : own("osfs.start.heightAboveGround"));
  return problems;
}
