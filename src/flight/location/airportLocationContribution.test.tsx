// @vitest-environment jsdom
import { act, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocationPanel, type LocationPanelContribution, type LocationSearchResult } from "foss-earth/windowing";
import { airportSpawn } from "./airportGeometry";
import { createAirportLocationContribution } from "./airportLocationContribution";
import { createFlightLocationDraft, FLIGHT_LOCATION_DRAFT_KEY, flightLocationCodec } from "./flightLocationData";
import type { Airport, FlightLocation } from "./airportTypes";

let values: Map<string, string>;
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
const observeLocation = (listener: () => void) => { const timer = setInterval(listener, 100); return () => clearInterval(timer); };

/** The Location tab as the flight composes it: FOSS Earth's panel with the flight's airport choice and saved form. */
function Panel(props: { onApply(location: FlightLocation): void; searchProvider?(query: string, signal: AbortSignal): Promise<readonly LocationSearchResult<AbortSignal>[]>; contribution: LocationPanelContribution }) {
  const draft = useMemo(() => createFlightLocationDraft(storage), []);
  return <LocationPanel initialLocation={{ latDeg: 0, lonDeg: 0 }} observeLocation={observeLocation} createAbortController={() => new AbortController()}
    searchAttribution="Search attribution" draft={draft} hostDataCodec={flightLocationCodec} contribution={props.contribution}
    onApply={props.onApply} searchProvider={props.searchProvider} />;
}

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function edit(input: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function click(host: HTMLElement, text: string) {
  const button = Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes(text));
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
const search = (host: HTMLElement) => act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const go = (host: HTMLElement) => act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Go to location"]')!.click());
const status = (host: HTMLElement) => host.querySelector('[role="status"]')!.textContent;
function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

const msp: Airport = { code: "KMSP", name: "Minneapolis-Saint Paul International Airport", latDeg: 44.88, lonDeg: -93.22, elevationMeters: 256,
  runways: [
    { id: "12L", label: "12L", start: { latDeg: 44.89, lonDeg: -93.23 }, end: { latDeg: 44.87, lonDeg: -93.19 }, headingDeg: 120, lengthMeters: 3000, elevationMeters: 256 },
    { id: "35", label: "35", start: { latDeg: 44.86, lonDeg: -93.22 }, end: { latDeg: 44.89, lonDeg: -93.23 }, headingDeg: 350, lengthMeters: 2500, elevationMeters: 256 },
  ] };

it("selects an airport without teleporting, then applies the chosen arrival runway", async () => {
  const host = mount();
  const root = createRoot(host);
  const apply = vi.fn();
  const airport = { code: "KTST", name: "Test Airport", latDeg: 45, lonDeg: -93, elevationMeters: 300,
    runways: [{ id: "09", label: "09", start: { latDeg: 45, lonDeg: -93 }, end: { latDeg: 45, lonDeg: -92.98 }, headingDeg: 90, lengthMeters: 1500, elevationMeters: 300 }] };
  await act(async () => root.render(<Panel onApply={apply} contribution={createAirportLocationContribution()}
    searchProvider={async () => [{ id: "KTST", label: "KTST · Test Airport", latDeg: 45, lonDeg: -93, hostData: { airport } }]} />));
  try {
    await edit(host.querySelector("input")!, "KTST");
    await search(host);
    await click(host, "KTST · Test Airport");
    expect(apply).not.toHaveBeenCalled();
    expect(status(host)).toBe("Choose departure or arrival and a runway, then Go.");
    expect(host.querySelector('[aria-label="Latitude"]')).toBeNull();
    expect(host.querySelector(".foss-earth-airport-controls")!.textContent).toContain("On runway, paused. Resume when ready for takeoff.");
    await edit(host.querySelector<HTMLSelectElement>('[aria-label="Airport position"]')!, "arrival");
    expect(host.querySelector(".foss-earth-airport-controls")!.textContent).toContain("5 NM final · 3° approach.");
    await go(host);
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0]).toMatchObject({ flightPreset: { mode: "arrival", headingDeg: 90, groundElevationMeters: 300 } });
    expect(apply.mock.calls[0][0].lonDeg).toBeLessThan(-93);
    expect(status(host)).toBe("Moved to KTST, runway 09 arrival.");
  } finally { await act(async () => root.unmount()); }
});

it.each(["departure", "arrival"] as const)("restores MSP %s runway 35 from device storage with no lookup or automatic move", async mode => {
  const host = mount();
  let root = createRoot(host);
  const apply = vi.fn();
  const resolve = vi.fn(async () => ({ id: "msp", label: "MSP", latDeg: msp.latDeg, lonDeg: msp.lonDeg, hostData: { airport: msp, airportMode: mode } }));
  const provider = vi.fn(async () => [{ id: "msp", label: "MSP", latDeg: msp.latDeg, lonDeg: msp.lonDeg, resolve }]);
  const contribution = createAirportLocationContribution();
  const panel = <Panel onApply={apply} searchProvider={provider} contribution={contribution} />;
  await act(async () => root.render(panel));
  try {
    await edit(host.querySelector<HTMLInputElement>('[aria-label="Location search"]')!, `msp ${mode}`);
    await search(host);
    await click(host, "MSP");
    await edit(host.querySelector<HTMLSelectElement>('[aria-label="Airport position"]')!, mode);
    await edit(host.querySelector<HTMLSelectElement>('[aria-label="Runway"]')!, "35");
    await go(host);
    expect(apply).toHaveBeenLastCalledWith(airportSpawn(msp.runways[1], mode));
    await act(async () => root.unmount());
    expect(createFlightLocationDraft(storage).read()).toMatchObject({ query: `msp ${mode}`, hostData: { airport: msp, airportMode: mode, runwayId: "35" } });
    provider.mockClear(); resolve.mockClear(); apply.mockClear();
    root = createRoot(host);
    await act(async () => root.render(panel));
    expect(host.querySelector<HTMLInputElement>('[aria-label="Location search"]')!.value).toBe(`msp ${mode}`);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Airport position"]')!.value).toBe(mode);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Runway"]')!.value).toBe("35");
    expect(provider).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    // Searching again for this airport must not reset its chosen direction.
    await search(host);
    await click(host, "MSP");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Runway"]')!.value).toBe("35");
    await go(host);
    expect(apply).toHaveBeenCalledExactlyOnceWith(airportSpawn(msp.runways[1], mode));
  } finally { await act(async () => root.unmount()); }
});

it("does not let a late airport lookup overwrite a switch to coordinates", async () => {
  // Saved by the editor before FOSS Earth handed airports to the flight.
  values.set(FLIGHT_LOCATION_DRAFT_KEY, JSON.stringify({ query: "msp", lat: "45", lon: "-93", altitude: "", airport: msp, airportMode: "departure", runwayId: "35" }));
  const host = mount();
  let root = createRoot(host);
  let finish!: (result: LocationSearchResult<AbortSignal>) => void;
  const resolve = vi.fn<(signal: AbortSignal) => Promise<LocationSearchResult<AbortSignal>>>(() => new Promise(done => { finish = done; }));
  const provider = async () => [{ id: "msp", label: "MSP", latDeg: msp.latDeg, lonDeg: msp.lonDeg, resolve }];
  const apply = vi.fn();
  const panel = <Panel onApply={apply} searchProvider={provider} contribution={createAirportLocationContribution()} />;
  await act(async () => root.render(panel));
  try {
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Runway"]')!.value).toBe("35");
    await search(host);
    await click(host, "MSP");
    expect(status(host)).toBe("Loading runway details…");
    await click(host, "Enter coordinates instead");
    expect(resolve.mock.calls[0][0].aborted).toBe(true);
    await act(async () => finish({ id: "msp", label: "MSP", latDeg: msp.latDeg, lonDeg: msp.lonDeg, hostData: { airport: msp } }));
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(panel));
    expect(host.querySelector('[aria-label="Runway"]')).toBeNull();
    expect(["Latitude", "Latitude hemisphere", "Longitude", "Longitude hemisphere", "Altitude in meters"]
      .map(label => host.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!.value)).toEqual(["45", "N", "93", "W", ""]);
    expect(apply).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it("restores nearby results and keeps resolved runway details for offline reuse", async () => {
  const host = mount();
  let root = createRoot(host);
  const airport = { code: "KMSP", name: "Minneapolis-Saint Paul", latDeg: 44.88, lonDeg: -93.22, elevationMeters: 256,
    runways: [{ id: "runway-35", label: "35", start: { latDeg: 44.86, lonDeg: -93.22 }, end: { latDeg: 44.89, lonDeg: -93.23 }, headingDeg: 350, lengthMeters: 2500, elevationMeters: 256 }] };
  const resolve = vi.fn(async () => ({ id: "resolved-id", label: "KMSP", latDeg: airport.latDeg, lonDeg: airport.lonDeg, hostData: { airport, airportMode: "departure" } }));
  const loadChildren = vi.fn(async () => [{ id: "opaque-child-id", label: "MSP", subtitle: "Minneapolis-Saint Paul", latDeg: airport.latDeg, lonDeg: airport.lonDeg, resolve }]);
  const provider = vi.fn(async () => [{ id: "opaque-city-id", label: "Minneapolis", kind: "city" as const, latDeg: 44.98, lonDeg: -93.26, childrenLabel: "Airports nearby", loadChildren }]);
  const apply = vi.fn();
  const panel = <Panel onApply={apply} searchProvider={provider} contribution={createAirportLocationContribution()} />;
  await act(async () => root.render(panel));
  try {
    await edit(host.querySelector<HTMLInputElement>('[aria-label="Location search"]')!, "msp departure");
    await search(host);
    expect(loadChildren).toHaveBeenCalledOnce();
    await click(host, "MSP");
    expect(resolve).toHaveBeenCalledOnce();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Runway"]')!.value).toBe("runway-35");
    expect(apply).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    provider.mockClear(); loadChildren.mockClear(); resolve.mockClear();
    provider.mockRejectedValue(new Error("Offline"));
    root = createRoot(host);
    await act(async () => root.render(panel));
    await click(host, "MSP");
    expect(provider).not.toHaveBeenCalled();
    expect(loadChildren).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    await go(host);
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0]).toMatchObject({ flightPreset: { mode: "departure", headingDeg: 350, groundElevationMeters: 256 } });
  } finally { await act(async () => root.unmount()); }
});

it("blocks Go without runway elevation and moves to other places as the globe does", async () => {
  const host = mount();
  const root = createRoot(host);
  const apply = vi.fn();
  const noElevation = { ...msp, elevationMeters: undefined, runways: msp.runways.map(runway => ({ ...runway, elevationMeters: undefined })) };
  const noRunways = { ...msp, runways: [] };
  await act(async () => root.render(<Panel onApply={apply} contribution={createAirportLocationContribution()} searchProvider={async () => [
    { id: "a", label: "No elevation", latDeg: 44.88, lonDeg: -93.22, hostData: { airport: noElevation, airportMode: "arrival" } },
    { id: "b", label: "No runways", latDeg: 44.88, lonDeg: -93.22, hostData: { airport: noRunways } },
    { id: "c", label: "Duluth", latDeg: 46.7867, lonDeg: -92.1005 },
  ]} />));
  try {
    await edit(host.querySelector("input")!, "msp");
    await search(host);
    await click(host, "No elevation");
    expect(host.querySelector(".foss-earth-airport-controls")!.textContent).toContain("Runway elevation unavailable.");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Go to location"]')!.disabled).toBe(true);
    await click(host, "No runways");
    expect(status(host)).toBe("No usable runway data found. Enter coordinates manually instead.");
    // An airport with no Departure/Arrival of its own opens in the last one chosen.
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Airport position"]')!.value).toBe("arrival");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Go to location"]')!.disabled).toBe(true);
    await click(host, "Duluth");
    expect(apply).toHaveBeenCalledExactlyOnceWith({ latDeg: 46.7867, lonDeg: -92.1005 });
    expect(status(host)).toBe("Moved to Duluth.");
    expect(host.querySelector(".foss-earth-airport-controls")).toBeNull();
    await click(host, "No runways");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Airport position"]')!.value).toBe("arrival");
  } finally { await act(async () => root.unmount()); }
});
