// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModsSessionSnapshot } from "./modSession";
import { ModsTab } from "./ModsTab";

const session = vi.hoisted(() => ({
  snapshot: {} as ModsSessionSnapshot,
  listeners: new Set<() => void>(),
  browse: vi.fn(), cancel: vi.fn(), ensure: vi.fn(async () => []),
}));

vi.mock("@0sfs/mods/ModsPanel", () => ({ ModsPanel: () => null }));
vi.mock("./modSession", () => ({
  getModsSession: () => session.snapshot,
  subscribeModsSession: (listener: () => void) => { session.listeners.add(listener); return () => session.listeners.delete(listener); },
  ensureModsSession: session.ensure, browseMods: session.browse, cancelModSearch: session.cancel,
  addMod: vi.fn(), removeMod: vi.fn(), confirmPendingMod: vi.fn(), dismissPendingMod: vi.fn(),
  setBrowseKind: vi.fn(), setDeveloperUsername: vi.fn(), setModSource: vi.fn(), setModPlace: vi.fn(),
}));

let root: Root;
let host: HTMLDivElement;

async function update(patch: Partial<ModsSessionSnapshot>) {
  await act(async () => {
    session.snapshot = { ...session.snapshot, ...patch };
    for (const listener of session.listeners) listener();
  });
}

async function advance(milliseconds: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  session.browse.mockClear(); session.cancel.mockClear(); session.ensure.mockClear();
  session.snapshot = {
    installed: [], records: [], developerUsername: "", notice: null, pendingWarning: null,
    pendingSource: null, source: "", place: "github", browseKind: "all", browseResults: [],
    browseError: null, browseStatus: "idle", browseRetryAt: null, shareUrl: "",
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Mods tab live search", () => {
  it("browses initially and waits 400 ms after the latest text change", async () => {
    await act(async () => root.render(<ModsTab />));
    await advance(0);
    expect(session.browse).toHaveBeenCalledOnce();
    session.browse.mockClear();
    await update({ source: "ca" });
    await advance(250);
    await update({ source: "camera" });
    await advance(399);
    expect(session.browse).not.toHaveBeenCalled();
    await advance(1);
    expect(session.browse).toHaveBeenCalledOnce();
  });

  it("skips one-character and local inputs and cancels a pending search when changing location", async () => {
    session.snapshot = { ...session.snapshot, source: "c" };
    await act(async () => root.render(<ModsTab />));
    await advance(1000);
    expect(session.browse).not.toHaveBeenCalled();
    await update({ source: "camera" });
    await advance(200);
    await update({ place: "local" });
    await advance(1000);
    expect(session.browse).not.toHaveBeenCalled();
    expect(session.cancel).toHaveBeenCalled();
    await update({ place: "github" });
    await advance(400);
    expect(session.browse).toHaveBeenCalledOnce();
  });

  it("searches the latest category and cancels work when the tab unmounts", async () => {
    session.snapshot = { ...session.snapshot, source: "camera" };
    await act(async () => root.render(<ModsTab />));
    await advance(200);
    await update({ browseKind: "component" });
    await advance(399);
    expect(session.browse).not.toHaveBeenCalled();
    await advance(1);
    expect(session.browse).toHaveBeenCalledOnce();
    session.cancel.mockClear();
    await act(async () => root.unmount());
    expect(session.cancel).toHaveBeenCalledOnce();
    root = createRoot(host);
  });
});
