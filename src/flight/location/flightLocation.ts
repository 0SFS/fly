/** The flight's part of FOSS Earth's Location tab: its lookup, airport choice and saved form. */
import type { LocationSearchProvider } from "foss-earth/windowing";
import type { SettingsRegistry } from "foss-earth/settings";
import { createAirportLocationContribution } from "./airportLocationContribution";
import { createFlightLocationDraft, flightLocationCodec, type FlightLocationDraftStorage } from "./flightLocationData";
import { createFlightLocationServices, type FlightLocationServicesPorts } from "./flightLocationServices";

export type { AirportFlightPreset, FlightLocation } from "./airportTypes";

/** What WindowOverlay's Location tab takes from the flight. */
export function createFlightLocation(settings: Pick<SettingsRegistry, "get" | "has">, ports: FlightLocationServicesPorts & { storage: FlightLocationDraftStorage | null }, searchProvider?: LocationSearchProvider) {
  const services = searchProvider ? null : createFlightLocationServices(settings, ports);
  return {
    // WindowOverlay's prop names FOSS Earth's narrower `LocationSignal`, but its
    // Location tab always searches with an AbortController's signal, which is
    // what this lookup (FOSS Earth's own, copied) takes.
    searchProvider: searchProvider ?? services?.searchLocations as LocationSearchProvider | undefined,
    contribution: createAirportLocationContribution(),
    hostDataCodec: flightLocationCodec,
    draft: createFlightLocationDraft(ports.storage),
    dispose: () => services?.dispose(),
  };
}
export type FlightLocationPanel = Omit<ReturnType<typeof createFlightLocation>, "dispose">;
