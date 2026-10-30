// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AircraftSelectionPanel } from "@0sfs/aircraft/AircraftSelectionPanel";
import { createBrowserInputSource } from "@felipegalind0/gamepad-tools/browser";
import type { FlightControlPanelSnapshot } from "./FlightControlPanel";
import {
  normalizeAircraftSelection, registerAircraftMod, unregisterAircraftMod,
  type AircraftDefinition, type AircraftFamilyDefinition, type AircraftSelection,
} from "@0sfs/aircraft/aircraftCatalog";

const roots: Root[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function activeSnapshot(overrides: Partial<FlightControlPanelSnapshot> = {}): FlightControlPanelSnapshot {
  return {
    aircraftId: "cirrus-vision-jet-g2", generationId: "g2", lodId: "auto",
    modelStatus: "ready", modelActiveLodId: "lod3",
    modelTriangles: 1654, modelError: null, ...overrides,
  } as FlightControlPanelSnapshot;
}

async function mount(snapshot = activeSnapshot(), selection = normalizeAircraftSelection(snapshot), switching = false) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const onSelectionChange = vi.fn<(selection: AircraftSelection) => void>();
  const onFamilyChange = vi.fn();
  const onSwitchModeChange = vi.fn();
  const onApply = vi.fn<(selection: AircraftSelection) => string | null | Promise<string | null>>(() => null);
  const render = async (nextSnapshot = snapshot, nextSwitching = switching) => {
    await act(async () => root.render(<AircraftSelectionPanel
      snapshot={nextSnapshot} selection={selection} switching={nextSwitching}
      onSelectionChange={onSelectionChange} onFamilyChange={onFamilyChange}
      onApply={onApply} onSwitchModeChange={onSwitchModeChange}
    />));
  };
  await render();
  return { host, onSelectionChange, onFamilyChange, onApply, onSwitchModeChange, render };
}

function button(host: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
    .find(entry => entry.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

async function openGallery(host: HTMLElement) {
  await act(async () => button(host, "Switch").click());
}

async function choose(host: HTMLElement, name = "Cessna 172 Skyhawk") {
  await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="Switch to ${name}"]`)!.click());
}

describe("aircraft selection panel", () => {
  it("keeps the aircraft identity in one edit group and moves Edit into the selected gallery card", async () => {
    const t = await mount();
    const current = t.host.querySelector(".flight-panel__aircraft-current")!;
    expect(current.querySelector("img")?.getAttribute("src")).toContain("aircraft/thumbnails/cirrus-vision-jet.png");
    expect(current.querySelector("svg")).toBeNull();
    expect(current.textContent).toBe("Cirrus Vision Jet G2Switch");
    expect(t.host.querySelector(".flight-panel__aircraft-gallery")).toBeNull();
    expect(t.host.querySelectorAll(".flight-panel__aircraft-controls select")).toHaveLength(2);
    expect(t.host.textContent).not.toContain("Apply");
    await openGallery(t.host);
    expect(t.host.querySelector(".flight-panel__aircraft-controls")).toBeNull();
    expect(t.host.querySelector(".flight-panel__aircraft-current")).toBeNull();
    expect(t.onSwitchModeChange).toHaveBeenLastCalledWith(true);
    const gallery = t.host.querySelector(".flight-panel__aircraft-gallery")!;
    expect(gallery.querySelectorAll("input")).toHaveLength(0);
    expect(Array.from(gallery.querySelectorAll(".flight-panel__aircraft-card strong")).map(entry => entry.textContent))
      .toEqual(["Cessna 172 Skyhawk", "Cirrus Vision Jet G2", "Lockheed Martin F-35B Lightning II"]);
    const selected = gallery.querySelector<HTMLButtonElement>("button.flight-panel__aircraft-card.is-selected")!;
    expect(selected.getAttribute("aria-label")).toBe("Edit Cirrus Vision Jet G2");
    expect(selected.getAttribute("aria-current")).toBe("true");
    expect(selected.querySelector(".flight-panel__command")?.textContent).toBe("Edit");
    expect(selected.disabled).toBe(false);
    expect(selected.querySelector("button")).toBeNull();
    expect(gallery.querySelectorAll('[aria-label^="Switch to "]')).toHaveLength(2);
    await act(async () => selected.click());
    expect(t.host.querySelector(".flight-panel__aircraft-controls")).not.toBeNull();
    expect(t.onSwitchModeChange).toHaveBeenLastCalledWith(false);
    expect(t.onApply).not.toHaveBeenCalled();
    expect(t.host.querySelector("dialog")).toBeNull();
    expect(t.host.querySelector(".flight-panel__aircraft-current")?.textContent).toBe("Cirrus Vision Jet G2Switch");
  });

  it.each([
    ["card background", null],
    ["aircraft image", "img"],
    ["aircraft name", "strong"],
    ["current status", ".flight-panel__aircraft-card-footer > span:first-child"],
    ["Edit label", ".flight-panel__command"],
  ])("opens the loaded aircraft settings from its %s", async (_part, selector) => {
    const t = await mount();
    await openGallery(t.host);
    const selected = t.host.querySelector<HTMLButtonElement>(".flight-panel__aircraft-card.is-selected")!;
    const target = selector ? selected.querySelector<HTMLElement>(selector)! : selected;
    await act(async () => target.click());
    expect(t.host.querySelector(".flight-panel__aircraft-gallery")).toBeNull();
    expect(t.host.querySelector(".flight-panel__aircraft-controls")).not.toBeNull();
    expect(t.host.querySelector(".flight-panel__aircraft-current strong")?.textContent).toBe("Cirrus Vision Jet G2");
    expect(t.onSwitchModeChange).toHaveBeenLastCalledWith(false);
    expect(t.onApply).not.toHaveBeenCalled();
    expect(t.host.querySelector("dialog")).toBeNull();
  });

  it.each([
    ["cessna-172", "cessna-172", "cessna-172.png"],
    ["cirrus-vision-jet-g2", "g2", "cirrus-vision-jet.png"],
    ["f-35b", "f-35b", "f-35b.png"],
  ] as const)("uses the %s aircraft thumbnail in the edit group", async (aircraftId, generationId, image) => {
    const t = await mount(activeSnapshot({ aircraftId, generationId }));
    const current = t.host.querySelector(".flight-panel__aircraft-current")!;
    expect(current.querySelector("img")?.getAttribute("src")).toContain(`aircraft/thumbnails/${image}`);
    expect(current.querySelector("svg")).toBeNull();
    expect(button(current, "Switch").parentElement).toBe(current);
    expect(current.querySelector("strong")?.parentElement).toBe(current);
  });

  it("requires one confirmation to immediately switch the complete aircraft, with no Apply step", async () => {
    const t = await mount();
    await openGallery(t.host);
    await choose(t.host, "Lockheed Martin F-35B Lightning II");
    expect(t.onApply).not.toHaveBeenCalled();
    const dialog = t.host.querySelector<HTMLDialogElement>("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("h2")?.textContent).toBe("Switch to Lockheed Martin F-35B Lightning II?");
    expect(dialog.querySelector("img")?.getAttribute("src")).toContain("aircraft/thumbnails/f-35b.png");
    expect(dialog.textContent).toContain("flight will stay paused");
    await act(async () => button(dialog, "Confirm").click());
    expect(t.onApply).toHaveBeenCalledExactlyOnceWith({ aircraftId: "f-35b", generationId: "f-35b", lodId: "auto" });
    expect(t.onSelectionChange).toHaveBeenCalledWith({ aircraftId: "f-35b", generationId: "f-35b", lodId: "auto" });
    expect(t.host.querySelector("dialog")).toBeNull();
    expect(t.host.querySelector(".flight-panel__aircraft-gallery")).toBeNull();
    expect(t.host.textContent).not.toContain("Apply");
  });

  it.each(["Cancel", "Escape"])("%s leaves the current aircraft loaded", async action => {
    const t = await mount();
    await openGallery(t.host);
    await choose(t.host);
    const dialog = t.host.querySelector("dialog")!;
    await act(async () => {
      if (action === "Cancel") button(dialog, "Cancel").click();
      else dialog.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true }));
    });
    expect(t.host.querySelector("dialog")).toBeNull();
    expect(t.onApply).not.toHaveBeenCalled();
    expect(t.onSelectionChange).toHaveBeenLastCalledWith(normalizeAircraftSelection(activeSnapshot()));
    expect(t.host.querySelector(".flight-panel__aircraft-current")).toBeNull();
    expect(t.host.querySelector(".flight-panel__aircraft-card.is-selected strong")?.textContent).toBe("Cirrus Vision Jet G2");
  });

  it("persists Don't show again only after confirmation and bypasses later warnings", async () => {
    const t = await mount();
    await openGallery(t.host);
    await choose(t.host);
    await act(async () => t.host.querySelector<HTMLInputElement>('dialog input[type="checkbox"]')!.click());
    await act(async () => button(t.host, "Confirm").click());
    const next = await mount();
    await openGallery(next.host);
    await choose(next.host, "Lockheed Martin F-35B Lightning II");
    expect(next.host.querySelector("dialog")).toBeNull();
    expect(next.onApply).toHaveBeenCalledExactlyOnceWith({ aircraftId: "f-35b", generationId: "f-35b", lodId: "auto" });
  });

  it("keeps warnings enabled when a checked confirmation is cancelled", async () => {
    const t = await mount();
    await openGallery(t.host);
    await choose(t.host);
    await act(async () => t.host.querySelector<HTMLInputElement>('dialog input[type="checkbox"]')!.click());
    await act(async () => button(t.host, "Cancel").click());
    await choose(t.host);
    expect(t.host.querySelector("dialog")).not.toBeNull();
    expect(t.host.querySelector<HTMLInputElement>('dialog input[type="checkbox"]')!.checked).toBe(false);
  });

  it("disables aircraft editing until the switch promise reports readiness", async () => {
    const t = await mount();
    let finish!: (error: string | null) => void;
    t.onApply.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await openGallery(t.host);
    await choose(t.host);
    await act(async () => button(t.host, "Confirm").click());
    expect(t.host.querySelector(".flight-panel__aircraft-picker")?.getAttribute("aria-busy")).toBe("true");
    expect(button(t.host, "Switch").disabled).toBe(true);
    expect(Array.from(t.host.querySelectorAll("select")).every(select => select.disabled)).toBe(true);
    await act(async () => finish(null));
    expect(button(t.host, "Switch").disabled).toBe(false);
  });

  it.each(["returned", "thrown"])("shows a fullscreen error report for %s switch failures", async failure => {
    const t = await mount();
    if (failure === "returned") t.onApply.mockResolvedValue("Aircraft: cessna-172\nModel request failed: HTTP 404");
    else t.onApply.mockRejectedValue(new Error("Physics package could not initialize"));
    await openGallery(t.host);
    await choose(t.host);
    await act(async () => button(t.host, "Confirm").click());
    const dialog = t.host.querySelector<HTMLDialogElement>("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("h2")?.textContent).toBe("Could not change aircraft");
    expect(dialog.querySelector("pre")?.textContent).toContain(failure === "returned" ? "HTTP 404" : "Physics package could not initialize");
    expect(t.onSelectionChange).toHaveBeenLastCalledWith(normalizeAircraftSelection(activeSnapshot()));
    await act(async () => button(dialog, "Close").click());
    expect(t.host.querySelector("dialog")).toBeNull();
  });

  it.each([
    ["placeholder", "Placeholder blocks"], ["loading", "Loading mesh…"],
    ["ready", "Mesh loaded"], ["error", "Load failed"],
  ] as const)("associates the %s model state and licence with the loaded aircraft", async (modelStatus, label) => {
    const t = await mount(activeSnapshot({ modelStatus, modelError: modelStatus === "error" ? "Active package error" : null }));
    const status = t.host.querySelector('[aria-label="Current model for Cirrus Vision Jet G2"]')!;
    expect(status.textContent).toContain(label);
    expect(t.host.textContent).toContain("hilos run");
    expect(t.host.textContent).toContain("CC Attribution");
    if (modelStatus === "error") expect(status.textContent).toContain("Active package error");
  });

  it("keeps settings attached to the loaded aircraft when another family has a draft", async () => {
    const t = await mount(activeSnapshot(), normalizeAircraftSelection({ aircraftId: "f-35b", lodId: "auto" }));
    expect(t.host.querySelector(".flight-panel__generation-field")).not.toBeNull();
    expect(t.host.querySelector('[aria-label="Current model for Cirrus Vision Jet G2"]')).not.toBeNull();
    expect(t.host.textContent).not.toContain("Experimental F-16/Aeromatic-derived");
  });

  it("reflects live snapshot edits even when the parent's previous selection is stale", async () => {
    const t = await mount();
    await t.render(activeSnapshot({ generationId: "g2+", lodId: "hd", modelActiveLodId: "hd" }));
    expect(t.host.querySelector<HTMLSelectElement>(".flight-panel__generation-field select")!.value).toBe("g2+");
    expect(t.host.querySelector<HTMLSelectElement>(".flight-panel__model-controls select")!.value).toBe("hd");
    expect(t.onApply).not.toHaveBeenCalled();
  });

  it("keeps dialog key presses out of flight bindings while letting held keys release", async () => {
    const source = createBrowserInputSource({ target: window });
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", key: "d" }));
      expect([...source.getFrame().keyboard.pressedCodes]).toEqual(["KeyD"]);
      const t = await mount();
      await openGallery(t.host);
      await choose(t.host);
      const cancel = button(t.host.querySelector("dialog")!, "Cancel");
      for (const [code, key] of [["KeyP", "p"], ["KeyW", "w"], ["KeyG", "g"]]) {
        cancel.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
      }
      expect([...source.getFrame().keyboard.pressedCodes]).toEqual(["KeyD"]);
      cancel.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD", key: "d", bubbles: true }));
      expect([...source.getFrame().keyboard.pressedCodes]).toEqual([]);
      expect(t.onApply).not.toHaveBeenCalled();
    } finally { source.dispose(); }
  });

  it("keeps gallery cards selectable when a thumbnail fails", async () => {
    const t = await mount();
    await openGallery(t.host);
    const card = t.host.querySelector<HTMLButtonElement>('[aria-label="Switch to Cessna 172 Skyhawk"]')!;
    await act(async () => card.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(card.querySelector("img")).toBeNull();
    expect(card.textContent).toContain("Image unavailable");
    await act(async () => card.click());
    expect(t.host.querySelector("dialog h2")?.textContent).toBe("Switch to Cessna 172 Skyhawk?");
  });

  it("shows a mod family's thumbnail at the path the mod resolved", async () => {
    const credit = { artist: "DJI", note: "test" };
    const family = {
      id: "dji-mini2", label: "DJI Mini 2", summary: "test",
      thumbnail: { path: "/aircraft/thumbnails/dji-mini2.png", credit }, defaultAircraftId: "dji-mini2",
      variants: [{ id: "dji-mini2", aircraftId: "dji-mini2", label: "DJI Mini 2" }],
    } as unknown as AircraftFamilyDefinition;
    const definition = {
      id: "dji-mini2", familyId: "dji-mini2", label: "DJI Mini 2", summary: "test",
      modelYawRad: 0, modelOffset: { x: 0, y: 0, z: 0 }, propellerBlades: 0,
      lods: [{ id: "lod0", label: "Procedural", triangles: 12, path: "", autoFromMeters: 0, credit }],
    } as unknown as AircraftDefinition;
    registerAircraftMod(family, [definition]);
    try {
      const t = await mount();
      await openGallery(t.host);
      const card = t.host.querySelector('[aria-label="Switch to DJI Mini 2"]')!;
      expect(card.querySelector("img")?.getAttribute("src")).toBe("/aircraft/thumbnails/dji-mini2.png");
    } finally {
      unregisterAircraftMod("dji-mini2", ["dji-mini2"]);
    }
  });

  it("applies model detail directly, with HD offered and credited in the level list", async () => {
    const t = await mount();
    const select = t.host.querySelector<HTMLSelectElement>(".flight-panel__model-controls select")!;
    expect(Array.from(select.options).map(option => option.value)).toEqual(["auto", "hd", "lod3", "lod2", "lod1"]);
    expect(t.host.textContent).toContain("hilos run");
    await act(async () => {
      select.value = "hd";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(t.onApply).toHaveBeenCalledExactlyOnceWith({ aircraftId: "cirrus-vision-jet-g2", generationId: "g2", lodId: "hd" });
    expect(t.host.querySelector("dialog")).toBeNull();
  });

  it("confirms generation changes that replace the aircraft package", async () => {
    const t = await mount();
    const select = t.host.querySelector<HTMLSelectElement>(".flight-panel__generation-field select")!;
    await act(async () => {
      select.value = "g3";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(t.onApply).not.toHaveBeenCalled();
    expect(t.host.querySelector("dialog h2")?.textContent).toBe("Switch to Cirrus Vision Jet G3?");
    await act(async () => button(t.host, "Confirm").click());
    expect(t.onApply).toHaveBeenCalledWith({ aircraftId: "cirrus-vision-jet-g3", generationId: "g3", lodId: "auto" });
  });

  it("shows the active F-35B mesh state, detail choice and required credit", async () => {
    const t = await mount(activeSnapshot({ aircraftId: "f-35b", generationId: "f-35b", modelActiveLodId: "hd", modelTriangles: 12259 }));
    expect(t.host.querySelector(".flight-panel__generation-field")).toBeNull();
    expect(t.host.querySelector('[aria-label="Current model for Lockheed Martin F-35B Lightning II"]')?.textContent).toContain("Mesh loaded");
    expect(t.host.textContent).toContain("Auto selected HD — reconstructed engine");
    expect(t.host.textContent).toContain("AF267");
    expect(t.host.textContent).toContain("CC BY 4.0");
    expect(t.host.querySelector<HTMLAnchorElement>('a[href*="5d54a6af45974ad386ae74d42b33374a"]')?.textContent).toBe("Source");
    expect(Array.from(t.host.querySelectorAll(".flight-panel__model-controls option")).map(option => option.getAttribute("value")))
      .toEqual(["auto", "hd"]);
  });

  it("honours runtime switching state independently of a local pending action", async () => {
    const t = await mount(activeSnapshot(), undefined, true);
    expect(button(t.host, "Switch").disabled).toBe(true);
    await t.render(activeSnapshot(), false);
    expect(button(t.host, "Switch").disabled).toBe(false);
  });
});
