/** The flight's Location lookup: FOSS Earth's places and airports, with the flight's airport metadata. */
import type { SettingsRegistry } from "foss-earth/settings";
import type { Airport, AirportMode, FlightLocationHostData } from "./airportTypes";
import { createLocationLookupCache, type LocationLookupStorage } from "./lookup/lookupCache";
import { createLocationLookupTransport } from "./lookup/transport";
import { createAirportLookup } from "./lookup/searchAirports";
import { createLocationSearch } from "./lookup/locationSearch";
import { readLocationSearchTuning } from "./lookup/searchTuning";

export interface FlightLocationServicesPorts {
  storage: LocationLookupStorage | null;
  fetch: typeof fetch;
  nowMs(): number;
  createAbortController(): AbortController;
  timers: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

/** `KMSP arrival` searches for KMSP and starts its airport in Arrival. */
export function airportQuery(text: string): { query: string; contribution?: AirportMode } {
  const suffix = text.trim().match(/^(.+?)\s+(departure|arrival)$/i);
  return suffix ? { query: suffix[1], contribution: suffix[2].toLowerCase() as AirportMode } : { query: text.trim() };
}

/** A result's runway data and requested position; nothing when it carries neither. */
export function airportResultData({ airport, contribution }: { airport?: Airport; contribution?: unknown }): FlightLocationHostData | undefined {
  const airportMode = contribution === "departure" || contribution === "arrival" ? contribution : undefined;
  if (!airport && !airportMode) return undefined;
  return { ...(airport ? { airport } : {}), ...(airportMode ? { airportMode } : {}) };
}

const copyAirports = (airports: readonly Airport[]): Airport[] => airports.map(airport => ({ ...airport, runways: airport.runways.map(runway => ({
  ...runway, start: { ...runway.start }, end: { ...runway.end },
})) }));

/**
 * One cache and transport for this flight session, as FOSS Earth composes its
 * own: the same `foss-earth.location-lookups.v1` answers and `search.*`
 * settings. No lookup or timer starts here.
 */
export function createFlightLocationServices(settings: Pick<SettingsRegistry, "get" | "has">, ports: FlightLocationServicesPorts) {
  const tuning = () => readLocationSearchTuning(settings);
  const cache = createLocationLookupCache({
    storage: ports.storage,
    tuning,
    nowMs: () => ports.nowMs(),
    createAbortController: () => ports.createAbortController(),
    abortError: message => new DOMException(message, "AbortError"),
  });
  const transport = createLocationLookupTransport({
    fetch: (url, options) => ports.fetch(url, options),
    createAbortController: () => ports.createAbortController(),
    nowMs: () => ports.nowMs(),
    tuning,
    timers: {
      setTimeout: (callback, delay) => ports.timers.setTimeout(callback, delay),
      clearTimeout: handle => ports.timers.clearTimeout(handle),
    },
    timeoutError: () => new DOMException("Location lookup timed out.", "TimeoutError"),
    combineSignals(signals) {
      const controller = ports.createAbortController();
      const removals: (() => void)[] = [];
      const dispose = (): void => { for (const remove of removals.splice(0)) remove(); };
      try {
        for (const signal of signals) {
          if (signal.aborted) { controller.abort(signal.reason); break; }
          const abort = (): void => controller.abort(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          removals.push(() => signal.removeEventListener("abort", abort));
          if (signal.aborted) { abort(); break; }
        }
      } catch (error) { dispose(); throw error; }
      return { signal: controller.signal, dispose };
    },
  });
  const airports = createAirportLookup({ cache, transport, copyAirports });
  const search = createLocationSearch({
    cache, transport, airports,
    queryContribution: airportQuery,
    airportContribution: airportResultData,
  });
  return { ...search, searchAirports: airports.searchAirports, dispose: () => cache.dispose() };
}
export type FlightLocationServices = ReturnType<typeof createFlightLocationServices>;
