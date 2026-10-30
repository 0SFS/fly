// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsRegistry, FOSS_EARTH_PARAMETERS } from "foss-earth/settings";
import { EMPTY_FLIGHT_STATE } from "@0sfs/ground-contact/flightState";
import { OSFS_PARAMETERS } from "../settings/flightParameters";
import { createFlightShare } from "./createFlightShare";
import type { FlightShareSource } from "./flightShare";

const qr = vi.hoisted(() => ({ toCanvas: vi.fn() }));
vi.mock("qrcode", () => ({ default: qr }));
afterEach(() => { qr.toCanvas.mockReset(); document.body.replaceChildren(); });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function setup(source: FlightShareSource | null, key: string | null = null) {
  const settings = createSettingsRegistry({ storage: null });
  settings.register(FOSS_EARTH_PARAMETERS);
  settings.register(OSFS_PARAMETERS);
  settings.set("interface.position.altitudeUnit", "ft");
  qr.toCanvas.mockResolvedValue(undefined);
  let current = source;
  const view = createFlightShare({ settings, baseUrl: "https://example.test/fly/", getSource: () => current, getGoogleKey: () => key });
  document.body.append(view.element);
  const capture = view.element.querySelector<HTMLButtonElement>(".flight-panel__actions > button")!;
  return { view, capture, set: (next: FlightShareSource | null) => { current = next; } };
}

const flying: FlightShareSource = {
  state: { ...EMPTY_FLIGHT_STATE, latDeg: 45, lonDeg: -93, altMeters: 1_800, headingRad: Math.PI / 2, airspeedKts: 120, northVelocityFps: 200 },
  groundHeightMeters: 300,
  selection: { aircraftId: "cessna-172", lodId: "auto" },
  aircraftLabel: "Cessna 172",
};

describe("share flight", () => {
  it("links the flight as it is when pressed, with gkey only after opting in", async () => {
    const { view, capture, set } = setup(flying, "synthetic+/&=?key");
    const link = view.element.querySelector<HTMLAnchorElement>(".multiplayer-invitation__link")!;
    expect(link.closest<HTMLElement>(".multiplayer-invitation")!.hidden).toBe(true);
    capture.click(); await settle();
    expect(view.element.querySelector('p[role="status"]')!.textContent).toBe("Cessna 172 · 45, −93 · 4,921 ft AGL · heading 90° · pitch 0° · climb 0° · 120 kt");
    const shared = new URL(link.href);
    expect(shared.searchParams.get("set.osfs.start.heightAboveGround")).toBe("1500");
    expect(shared.searchParams.get("aircraft")).toBe("cessna-172");
    expect(shared.searchParams.has("set.osfs.aircraft.id")).toBe(false);
    expect(shared.searchParams.has("gkey")).toBe(false);
    expect(qr.toCanvas.mock.calls.at(-1)![1]).toBe(link.href);
    view.element.querySelector<HTMLButtonElement>("[aria-pressed]")!.click(); await settle();
    expect(new URL(link.href).searchParams.get("gkey")).toBe("synthetic+/&=?key");
    // The link does not follow the aircraft: the next press links it again.
    set({ ...flying, state: { ...flying.state, latDeg: 46 } });
    expect(new URL(link.href).searchParams.get("set.osfs.start.latitude")).toBe("45");
    capture.click(); await settle();
    expect(new URL(link.href).searchParams.get("set.osfs.start.latitude")).toBe("46");
    expect(new URL(link.href).searchParams.get("gkey")).toBe("synthetic+/&=?key");
    view.dispose();
    expect(view.element.isConnected).toBe(false);
  });

  it("says why there is no link while the ground under the aircraft is unknown", async () => {
    const { view, capture, set } = setup({ ...flying, groundHeightMeters: null });
    capture.click(); await settle();
    const status = view.element.querySelector('p[role="status"]')!;
    expect(status.textContent).toContain("has not loaded yet");
    expect(status.classList.contains("is-error")).toBe(true);
    expect(view.element.querySelector<HTMLElement>(".multiplayer-invitation")!.hidden).toBe(true);
    set(flying);
    capture.click(); await settle();
    expect(status.classList.contains("is-error")).toBe(false);
    expect(view.element.querySelector<HTMLElement>(".multiplayer-invitation")!.hidden).toBe(false);
    view.dispose();
  });

  it("keeps the help last and named", () => {
    const { view } = setup(flying);
    const actions = view.element.querySelector(".flight-panel__actions")!;
    expect(actions.lastElementChild!.querySelector("button")!.getAttribute("aria-label")).toBe("About shared flight links");
    view.dispose();
  });
});
