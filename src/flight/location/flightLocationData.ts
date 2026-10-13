/** What the flight's Location contribution saves, and how earlier saved forms are read. */
// The draft store lives in FOSS Earth's engine root, which `foss-earth/cameraMath`
// re-exports whole. `foss-earth/runtime` re-exports it too, but tests replace that
// module with a stand-in.
import { createLocationDraftStore, type LocationDraftStore, type LocationHostDataCodec } from "foss-earth/cameraMath";
import type { Airport, FlightLocationHostData } from "./airportTypes";
import { isAirport, isAirportMode } from "./validateAirport";

/** The flight's form keeps its own namespace, separate from the plain globe's place form. */
export const FLIGHT_LOCATION_DRAFT_KEY = "foss-earth.location-draft.v1.airport";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function airportData(airport: Airport): Airport {
  return {
    code: airport.code, name: airport.name, latDeg: airport.latDeg, lonDeg: airport.lonDeg,
    elevationMeters: airport.elevationMeters,
    runways: airport.runways.map(runway => ({
      id: runway.id, label: runway.label,
      start: { latDeg: runway.start.latDeg, lonDeg: runway.start.lonDeg },
      end: { latDeg: runway.end.latDeg, lonDeg: runway.end.lonDeg },
      headingDeg: runway.headingDeg, lengthMeters: runway.lengthMeters, elevationMeters: runway.elevationMeters,
    })),
  };
}

export function isFlightLocationHostData(value: unknown): value is FlightLocationHostData {
  if (!record(value)) return false;
  const { airport, airportMode, runwayId } = value;
  if (airport !== undefined && !isAirport(airport)) return false;
  if (airportMode !== undefined && !isAirportMode(airportMode)) return false;
  if (runwayId !== undefined && typeof runwayId !== "string") return false;
  // A saved runway must still belong to its airport.
  return !(airport && runwayId !== undefined && airport.runways.length && !airport.runways.some(runway => runway.id === runwayId));
}

/** Copies only the airport data, never provider functions or extra properties. */
export const flightLocationCodec: LocationHostDataCodec = {
  valid: isFlightLocationHostData,
  copy(value) {
    if (!isFlightLocationHostData(value)) throw new Error("Invalid airport location data.");
    return {
      ...(value.airport ? { airport: airportData(value.airport) } : {}),
      ...(value.airportMode ? { airportMode: value.airportMode } : {}),
      ...(value.runwayId !== undefined ? { runwayId: value.runwayId } : {}),
    } satisfies FlightLocationHostData;
  },
};

export function flightLocationHostData(value: unknown): FlightLocationHostData | undefined {
  return isFlightLocationHostData(value) ? value : undefined;
}

/**
 * Before FOSS Earth handed airports to the flight, a search result kept them in
 * its own `airport` and `airportMode` fields (and could carry `flightPreset`).
 * They become the result's host data; an invalid airport stays invalid there, so
 * the saved list is discarded as it was before.
 */
function migrateResult(value: unknown): unknown {
  if (!record(value) || value.hostData !== undefined
    || (value.airport === undefined && value.airportMode === undefined && value.flightPreset === undefined)) return value;
  const { airport, airportMode, flightPreset, ...rest } = value;
  void flightPreset; // A preset is chosen in the editor, never kept on a result.
  const hostData = {
    ...(airport === undefined || airport === null ? {} : { airport }),
    ...(airportMode === undefined ? {} : { airportMode }),
  };
  return Object.keys(hostData).length ? { ...rest, hostData } : rest;
}
function migrateSnapshots(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map(item => record(item) ? {
    ...item,
    result: migrateResult(item.result),
    ...(item.resolved === undefined ? {} : { resolved: migrateResult(item.resolved) }),
    ...(Array.isArray(item.children) ? { children: migrateSnapshots(item.children) } : {}),
  } : item);
}

export interface FlightLocationDraftStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** Reads saved results in their earlier shape; writes go through unchanged. */
function migratingStorage(storage: FlightLocationDraftStorage): FlightLocationDraftStorage {
  return {
    getItem(key) {
      const text = storage.getItem(key);
      if (key !== FLIGHT_LOCATION_DRAFT_KEY || text === null) return text;
      try {
        const value: unknown = JSON.parse(text);
        return record(value) && Array.isArray(value.results) ? JSON.stringify({ ...value, results: migrateSnapshots(value.results) }) : text;
      } catch { return text; }
    },
    setItem: (key, value) => storage.setItem(key, value),
  };
}

/**
 * The editor saved the selected airport beside the form as `airport`,
 * `airportMode` and `runwayId`. A record that only has those keeps its airport,
 * Departure/Arrival and runway direction. FOSS Earth still writes the empty
 * fields, so the current form passes the same check.
 */
const legacyDraft = {
  valid: (value: Record<string, unknown>) => typeof value.runwayId === "string" && isAirportMode(value.airportMode)
    && (value.airport === null || isAirport(value.airport)),
  hostData(value: Record<string, unknown>): FlightLocationHostData | undefined {
    if (isAirport(value.airport)) return { airport: value.airport, airportMode: value.airportMode as FlightLocationHostData["airportMode"], runwayId: value.runwayId as string };
    // Coordinates entry still remembers an Arrival choice; Departure is the default.
    return value.airportMode === "arrival" ? { airportMode: "arrival" } : undefined;
  },
};

export function createFlightLocationDraft(storage: FlightLocationDraftStorage | null): LocationDraftStore {
  return createLocationDraftStore({
    storage: storage && migratingStorage(storage),
    key: FLIGHT_LOCATION_DRAFT_KEY,
    hostDataCodec: flightLocationCodec,
    legacy: legacyDraft,
  });
}
