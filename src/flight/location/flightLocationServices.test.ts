import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { airportQuery, createFlightLocationServices } from "./flightLocationServices";

const signal = () => new AbortController().signal;
const city = { place_id: 1, display_name: "Minneapolis, Minnesota", lat: "44.97", lon: "-93.26", addresstype: "city" };
const elements = [
  { type: "way", id: 1, center: { lat: 45, lon: -93 }, tags: { aeroway: "aerodrome", icao: "KMSP", iata: "MSP", name: "Minneapolis-Saint Paul" } },
  { type: "way", id: 2, tags: { aeroway: "runway", ref: "35/17" }, geometry: [{ lat: 45, lon: -93 }, { lat: 45.02, lon: -93 }] },
];
const response = (value: unknown) => ({ ok: true, json: async () => value });
const noSettings = { get: () => undefined, has: () => false } as never;
let stored: Map<string, string>;

function services(fetcher: (url: string) => Promise<unknown>) {
  return createFlightLocationServices(noSettings, {
    storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); } },
    fetch: fetcher as unknown as typeof fetch, nowMs: Date.now,
    createAbortController: () => new AbortController(),
    timers: { setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: handle => clearTimeout(handle as number) },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
  stored = new Map();
});
afterEach(() => { vi.useRealTimers(); });

it("reads a trailing departure or arrival as the airport position", () => {
  expect(airportQuery(" KMSP Arrival ")).toEqual({ query: "KMSP", contribution: "arrival" });
  expect(airportQuery("Minneapolis departure")).toEqual({ query: "Minneapolis", contribution: "departure" });
  expect(airportQuery("arrival")).toEqual({ query: "arrival" });
});

it("restores geocoding, nearby airports, runways and elevation without network requests", async () => {
  const fetcher = vi.fn(async (url: string) => response(url.includes("nominatim") ? [city]
    : url.includes("nearby") ? { data: [{ code: "KMSP", iata: "MSP", name: "Minneapolis-Saint Paul", latitude: 45, longitude: -93, type: "large_airport" }] }
      : url.includes("overpass") ? { elements } : { data: { elevation: 256 } }));
  const first = services(fetcher);
  const locations = await first.searchLocations("Minneapolis departure", signal());
  const airports = await locations[0].loadChildren!(signal());
  const selected = await airports[0].resolve!(signal());
  expect(selected.hostData).toMatchObject({ airportMode: "departure", airport: { code: "KMSP", elevationMeters: 256 } });
  const { airport } = selected.hostData as { airport: { runways: { label: string; elevationMeters?: number }[] } };
  expect(airport.runways.find(runway => runway.label === "35")?.elevationMeters).toBe(256);
  expect(fetcher).toHaveBeenCalledTimes(4);
  first.dispose();
  const reloaded = services(fetcher);
  const restored = await reloaded.searchLocations("Minneapolis departure", signal());
  const nearby = await restored[0].loadChildren!(signal());
  expect((await nearby[0].resolve!(signal())).hostData).toEqual(selected.hostData);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
