import { beforeEach, expect, it } from "vitest";
import { createLocationDraftStore, LOCATION_PLACE_DRAFT_KEY } from "foss-earth/cameraMath";
import { createFlightLocationDraft, FLIGHT_LOCATION_DRAFT_KEY, flightLocationCodec } from "./flightLocationData";

const msp = { code: "KMSP", name: "Minneapolis-Saint Paul International Airport", latDeg: 44.88, lonDeg: -93.22, elevationMeters: 256,
  runways: [
    { id: "12L", label: "12L", start: { latDeg: 44.89, lonDeg: -93.23 }, end: { latDeg: 44.87, lonDeg: -93.19 }, headingDeg: 120, lengthMeters: 3000, elevationMeters: 256 },
    { id: "35", label: "35", start: { latDeg: 44.86, lonDeg: -93.22 }, end: { latDeg: 44.89, lonDeg: -93.23 }, headingDeg: 350, lengthMeters: 2500, elevationMeters: 256 },
  ] };
let values: Map<string, string>;
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
/** What the editor saved before FOSS Earth handed airports to the flight. */
const legacy = (draft: Record<string, unknown>) => values.set(FLIGHT_LOCATION_DRAFT_KEY, JSON.stringify(draft));

beforeEach(() => { values = new Map(); });

it("keeps flight selections separate from ordinary globe location drafts", () => {
  const flight = createFlightLocationDraft(storage);
  const place = createLocationDraftStore({ storage, key: LOCATION_PLACE_DRAFT_KEY });
  flight.write({ query: "msp", lat: "", lon: "", altitude: "", hostData: { airport: msp, airportMode: "departure", runwayId: "35" } });
  expect(place.read()).toMatchObject({ query: "" });
  expect(place.read().hostData).toBeUndefined();
  place.write({ ...place.read(), query: "Minneapolis" });
  expect(flight.read()).toMatchObject({ query: "msp", hostData: { airport: msp, runwayId: "35" } });
});

it.each(["{broken", "[]", '{"airport":{"runways":null}}'])("ignores malformed stored drafts: %s", value => {
  values.set(FLIGHT_LOCATION_DRAFT_KEY, value);
  const draft = createFlightLocationDraft(storage).read();
  expect(draft).toMatchObject({ query: "" });
  expect(draft.hostData).toBeUndefined();
});

it("rejects a saved runway that is absent from its airport", () => {
  legacy({ query: "msp", lat: "", lon: "", altitude: "", airport: msp, airportMode: "departure", runwayId: "missing" });
  expect(createFlightLocationDraft(storage).read().hostData).toBeUndefined();
  createFlightLocationDraft(storage).write({ query: "msp", lat: "", lon: "", altitude: "", hostData: { airport: msp, runwayId: "missing" } });
  expect(createFlightLocationDraft(storage).read().hostData).toBeUndefined();
});

it("reads the airport, position and runway the editor saved before", () => {
  legacy({ query: "msp arrival", lat: "45", lon: "-93", altitude: "", airport: msp, airportMode: "arrival", runwayId: "35" });
  expect(createFlightLocationDraft(storage).read()).toMatchObject({
    query: "msp arrival", lat: "45", lon: "-93", hostData: { airport: msp, airportMode: "arrival", runwayId: "35" },
  });
  // Coordinates entry kept an Arrival choice for the next airport.
  legacy({ query: "", lat: "45", lon: "-93", altitude: "", airport: null, airportMode: "arrival", runwayId: "" });
  expect(createFlightLocationDraft(storage).read().hostData).toEqual({ airportMode: "arrival" });
  legacy({ query: "", lat: "45", lon: "-93", altitude: "", airport: null, airportMode: "departure", runwayId: "" });
  expect(createFlightLocationDraft(storage).read().hostData).toBeUndefined();
});

it("moves saved results' airports into their host data and drops presets", () => {
  const nearby = { id: "airport:KMSP", label: "MSP", latDeg: msp.latDeg, lonDeg: msp.lonDeg };
  legacy({
    query: "msp departure", lat: "", lon: "", altitude: "", airport: null, airportMode: "departure", runwayId: "",
    results: [{
      result: { id: "city", label: "Minneapolis", kind: "city", latDeg: 44.98, lonDeg: -93.26, childrenLabel: "Airports nearby" },
      canLoadChildren: true, canResolve: false, expanded: true,
      children: [{
        result: { ...nearby, airportMode: "departure" },
        canLoadChildren: false, canResolve: true, expanded: false, children: null,
        resolved: { ...nearby, airport: msp, airportMode: "departure", flightPreset: { mode: "departure", headingDeg: 350, groundElevationMeters: 256, flightPathDeg: 0 } },
      }],
    }],
  });
  const [city] = createFlightLocationDraft(storage).read().results!;
  expect(city.result).toEqual({ id: "city", label: "Minneapolis", kind: "city", latDeg: 44.98, lonDeg: -93.26, childrenLabel: "Airports nearby" });
  expect(city.children![0].result).toEqual({ ...nearby, hostData: { airportMode: "departure" } });
  expect(city.children![0].resolved).toEqual({ ...nearby, hostData: { airport: msp, airportMode: "departure" } });
});

it("copies only the airport data it knows", () => {
  const copied = flightLocationCodec.copy({ airport: { ...msp, extra: true, runways: [{ ...msp.runways[0], resolve() {} }] }, runwayId: "12L", other: 1 });
  expect(copied).toEqual({ airport: { ...msp, runways: [msp.runways[0]] }, runwayId: "12L" });
  expect(() => flightLocationCodec.copy({ airportMode: "cruise" })).toThrow("Invalid airport location data.");
});
