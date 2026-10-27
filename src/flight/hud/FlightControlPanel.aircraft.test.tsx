// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowOverlayProps } from "foss-earth/shell";
import { createSettingsRegistry, FOSS_EARTH_PARAMETERS } from "foss-earth/settings";
import { DEFAULT_GROUND_INTERACTION_SETTINGS, resolveGroundInteraction } from "@0sfs/ground-contact/groundInteractionSettings";
import { registerFlightSettings } from "../settings/registerFlightSettings";
import { FlightControlPanel, type FlightControlPanelSnapshot, type FlightPanelTab } from "./FlightControlPanel";

vi.mock("foss-earth/shell", async importOriginal => {
  const actual = await importOriginal<typeof import("foss-earth/shell")>();
  return {
    ...actual,
    WindowOverlay: ({ renderAdditionalTab }: WindowOverlayProps<FlightPanelTab>) => <section>{renderAdditionalTab?.("aircraft")}</section>,
  };
});

let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function mount(aircraftSwitching = false) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const settings = createSettingsRegistry({ storage: null });
  settings.register(FOSS_EARTH_PARAMETERS);
  const parameters = registerFlightSettings(settings);
  const capabilities = { contactBridgeUnavailable: "No SDK in this panel test", audioUnavailable: null };
  const snapshot = {
    aircraftId: "cessna-172", generationId: "cessna-172", lodId: "auto",
    modelStatus: "ready", modelActiveLodId: "lod3", modelTriangles: 1000, modelError: null,
    paused: true, aircraftSwitching, savedFlight: null, viewMode: "third",
    groundInteraction: {
      settings: DEFAULT_GROUND_INTERACTION_SETTINGS,
      resolution: resolveGroundInteraction(DEFAULT_GROUND_INTERACTION_SETTINGS, capabilities, DEFAULT_GROUND_INTERACTION_SETTINGS),
      capabilities, readOnlyReason: null, message: null, experimentOverride: null,
      hapticDevices: { gamepad: "none", phone: "Not paired" },
    },
  } as FlightControlPanelSnapshot;
  const onPausedChange = vi.fn();
  const props = {
    settings, parameters, snapshot, onPausedChange,
    onAircraftApply: vi.fn(() => null), onNewFlight: vi.fn(),
    overlayApiRef: { current: null },
  } as unknown as Parameters<typeof FlightControlPanel>[0];
  await act(async () => root.render(<FlightControlPanel {...props} />));
  return { host, onPausedChange, settings };
}

it("starts with the loaded aircraft, omits flight metrics and separates switching from editing", async () => {
  const { host } = await mount();
  const content = host.querySelector(".flight-panel__content")!;
  expect(content.firstElementChild?.className).toBe("flight-panel__aircraft-picker");
  for (const metric of ["Airspeed", "Altitude", "Heading", "Throttle"]) {
    expect(host.querySelector(".flight-panel__metrics")?.textContent ?? "").not.toContain(metric);
  }
  const edit = host.querySelector<HTMLElement>(".flight-panel__aircraft-edit")!;
  expect(edit.hidden).toBe(false);
  expect(edit.querySelector<HTMLDetailsElement>(".flight-panel__aircraft-inspector")?.open).toBe(false);
  const switchButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Switch")!;
  await act(async () => switchButton.click());
  expect(edit.hidden).toBe(true);
  expect(host.querySelector(".flight-panel__aircraft-gallery")).not.toBeNull();
  expect(host.querySelector(".flight-panel__aircraft-current")).toBeNull();
  const selected = host.querySelector<HTMLButtonElement>('button.flight-panel__aircraft-card.is-selected[aria-label="Edit Cessna 172 Skyhawk"]')!;
  expect(selected.querySelector(".flight-panel__command")?.textContent).toBe("Edit");
  await act(async () => selected.querySelector<HTMLImageElement>("img")!.click());
  expect(edit.hidden).toBe(false);
  expect(host.querySelector(".flight-panel__aircraft-gallery")).toBeNull();
  expect(host.querySelector(".flight-panel__aircraft-current strong")?.textContent).toBe("Cessna 172 Skyhawk");
});

it("draws FOSS Earth's Glide beside the view, as the chase camera glides with it", async () => {
  const { host, settings } = await mount();
  const glide = host.querySelector<HTMLElement>('.flight-panel__aircraft-edit [data-parameter="camera.inertiaDecay"]')!;
  expect(glide.querySelector(".foss-earth-parameter__label")?.textContent).toBe("Glide");
  const face = () => glide.querySelector(".foss-earth-parameter__face")?.textContent;
  const reset = () => glide.querySelector<HTMLButtonElement>(".foss-earth-parameter__reset")!;
  expect(face()).toBe("0.82");
  expect(reset().hidden).toBe(true);
  // It follows the registry, and offers its reset once changed.
  await act(async () => settings.set("camera.inertiaDecay", 0));
  expect(face()).toBe("0.00");
  expect(reset().hidden).toBe(false);
});

it("disables Resume while the replacement aircraft is loading", async () => {
  const { host, onPausedChange } = await mount(true);
  const resume = host.querySelector<HTMLButtonElement>('[aria-label="Resume simulation"]')!;
  expect(resume.disabled).toBe(true);
  await act(async () => resume.click());
  expect(onPausedChange).not.toHaveBeenCalled();
});
