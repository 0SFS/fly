// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGameLog } from "foss-earth/shell";
import { createFlightLoadingScreen, LOADING_LIVE_ATTRIBUTE, type FlightLoadingScreen } from "./createFlightLoadingScreen";

let screen: FlightLoadingScreen;
const lines = () => [...document.querySelectorAll<HTMLElement>("#app-log .game-log__line")];
const newestLine = () => lines()[0];

beforeEach(() => {
  document.body.innerHTML = '<main id="root"><button id="previous-focus">Controls</button></main><div id="app-log"></div>';
});

afterEach(() => {
  screen?.destroy();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("flight loading log", () => {
  it("keeps map recovery choices usable while flight input is held and disables repeat activation", () => {
    const useMap = vi.fn();
    screen = createFlightLoadingScreen();
    screen.fail("Both map providers are unavailable.", { actions: [{ label: "Use OpenStreetMap", onClick: useMap }] });
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(true);
    const recovery = [...newestLine().querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Use OpenStreetMap")!;
    expect(recovery.disabled).toBe(false);
    recovery.click();
    expect(useMap).toHaveBeenCalledOnce();
    const buttons = [...newestLine().querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.find(button => button.textContent === "Use OpenStreetMap")!.disabled).toBe(true);
    expect(buttons.find(button => button.textContent === "View report")!.disabled).toBe(false);
    screen.show({ reset: true });
    expect(document.querySelectorAll("button")).not.toContain(recovery);
  });

  it("prints beside the renderer root without covering it and holds flight input until hidden", () => {
    const root = document.getElementById("root")!;
    screen = createFlightLoadingScreen();
    const log = document.getElementById("app-log")!;

    expect(root.contains(log)).toBe(false);
    expect(newestLine().textContent).toContain("Preparing your flight");
    expect(root.hasAttribute("inert")).toBe(true);
    expect(root.getAttribute("aria-busy")).toBe("true");

    screen.hide();

    expect(root.hasAttribute("inert")).toBe(false);
    expect(root.hasAttribute("aria-busy")).toBe(false);
    expect(log.hidden).toBe(false);
  });

  it("leaves a live control usable, including one the app builds while loading shows", async () => {
    const root = document.getElementById("root")!;
    screen = createFlightLoadingScreen();
    expect(root.hasAttribute("inert")).toBe(true);

    // The app's HUD arrives during loading, with its pause button marked live.
    root.insertAdjacentHTML("beforeend", `
      <div id="app"><canvas id="canvas"></canvas>
        <div id="bar"><button id="pause" ${LOADING_LIVE_ATTRIBUTE}>Pause</button><button id="settings">Settings</button></div>
        <div id="panel"><button>Teleport</button></div>
      </div>`);
    await Promise.resolve();

    const byId = (id: string) => document.getElementById(id)!;
    const inert = (element: Element): boolean => element.closest("[inert]") !== null;
    expect(inert(byId("pause"))).toBe(false);
    for (const id of ["previous-focus", "canvas", "settings", "panel"]) expect(inert(byId(id))).toBe(true);
    expect(root.getAttribute("aria-busy")).toBe("true");

    screen.hide();
    expect(document.querySelector("[inert]")).toBeNull();

    // A teleport holds the app again around the same live control.
    screen.show({ title: "Preparing your destination", reset: true });
    expect(inert(byId("pause"))).toBe(false);
    expect(inert(byId("panel"))).toBe(true);
    screen.hide();
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("reports measured progress in place and finishes with the elapsed time", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    screen = createFlightLoadingScreen();
    screen.setPhase("assets", { state: "loading", detail: "Downloading the model" });
    const aircraft = newestLine();
    const bar = aircraft.querySelector('[role="progressbar"]')!;
    expect(aircraft.textContent).toContain("Aircraft: Downloading the model");
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);

    screen.setPhase("assets", { state: "loading", progress: 0.42 });
    expect(newestLine()).toBe(aircraft);
    expect(bar.getAttribute("aria-valuenow")).toBe("42");

    screen.setPhase("assets", { state: "loading", progress: Number.NaN });
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);

    now = 4200;
    screen.setPhase("assets", { state: "ready" });
    expect(aircraft.dataset.tone).toBe("success");
    expect(aircraft.textContent).toContain("Aircraft ready · 3.2 s");
  });

  it("describes terrain work without a coverage percentage", () => {
    screen = createFlightLoadingScreen();
    screen.setPhase("terrain", { state: "loading", detail: "Refining the ground", progress: 0.42 });
    const terrain = newestLine();
    expect(terrain.textContent).toContain("Terrain: Refining the ground");
    expect(terrain.querySelector('[role="progressbar"]')).toBeNull();
    expect(terrain.textContent).not.toContain("42%");
  });

  it("stays quiet about phases a teleport never loads and starts fresh lines", () => {
    screen = createFlightLoadingScreen();
    screen.setPhase("terrain", { state: "loading" });
    screen.setPhase("terrain", { state: "ready" });
    screen.hide();
    const before = lines().length;

    screen.show({ title: "Preparing your destination", detail: "Minneapolis", reset: true });
    for (const phase of ["app", "world", "flight", "assets"] as const) screen.setPhase(phase, { state: "ready" });
    expect(lines()).toHaveLength(before + 1);
    expect(newestLine().textContent).toContain("Preparing your destination: Minneapolis");

    screen.setPhase("terrain", { state: "loading", progress: 0 });
    expect(lines()).toHaveLength(before + 2);
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(true);
  });

  it("keeps errors visible, renders untrusted messages as text, and retries in place", () => {
    screen = createFlightLoadingScreen();
    const retry = vi.fn(() => screen.show({ title: "Trying again" }));
    screen.fail("Terrain failed <img src=x>", { retry });
    const error = newestLine();

    expect(error.dataset.tone).toBe("error");
    expect(document.querySelector("#app-log img")).toBeNull();
    expect(error.textContent).toContain("Terrain failed <img src=x>");
    const button = error.querySelector(".game-log__actions button")!;
    expect(button.textContent).toBe("Try again");
    expect(document.activeElement).toBe(button);

    button.click();
    expect(retry).toHaveBeenCalledOnce();
    expect(error.querySelector(".game-log__actions button")).toBeNull();
    expect(newestLine().textContent).toContain("Trying again");
  });

  it("reports a failure once, with what was thrown, however many catches hear of it", () => {
    screen = createFlightLoadingScreen();
    const report = () => window.osfsLoadingDiagnostics?.() as { outcome: string; failure: string | null; cause: { message: string; stack: string | null } | null };
    const errorLines = () => lines().filter(line => line.dataset.tone === "error");
    const aborted = new DOMException("Terrain preparation was replaced by another destination.", "AbortError");

    screen.fail("Flight could not start safely.", { cause: aborted });
    // The boot's own catch hears of the same failure.
    screen.fail("The application could not initialize.", { cause: new Error("Rethrown") });

    expect(errorLines()).toHaveLength(1);
    expect(errorLines()[0].textContent).toContain("Flight paused. Flight could not start safely.\nAbortError: Terrain preparation was replaced by another destination.");
    expect(errorLines()[0].textContent).not.toContain("could not initialize");
    expect(report()).toMatchObject({
      outcome: "failed", failure: "Flight could not start safely.",
      cause: { message: "AbortError: Terrain preparation was replaced by another destination." },
    });

    // A new attempt clears it, and its own failure gets its own line.
    screen.show({ title: "Preparing your destination", reset: true });
    expect(report()).toMatchObject({ outcome: "loading", failure: null, cause: null });
    screen.fail("The destination terrain is not ready.");
    expect(errorLines()).toHaveLength(2);
    expect(report().cause).toBeNull();
    // A later call that knows the cause gives it to the line already shown.
    screen.fail("The application could not initialize.", { cause: new TypeError("Failed to fetch") });
    expect(errorLines()).toHaveLength(2);
    expect(newestLine().textContent).toContain("The destination terrain is not ready.\nTypeError: Failed to fetch");
    expect(report()).toMatchObject({ failure: "The destination terrain is not ready.", cause: { message: "TypeError: Failed to fetch" } });
  });

  it("removes keys and queries from the cause it shows and reports", () => {
    screen = createFlightLoadingScreen();
    const key = "AIzaSyD-0123456789abcdefghijklmnopqrstu";
    const cause = new Error(`Tiles failed: https://tile.googleapis.com/v1/3dtiles/root.json?key=${key}`);
    cause.stack = `Error: Tiles failed\n    at load (https://0sfs.test/assets/app.js?key=${key}:1:2)`;
    screen.fail("Flight could not start safely.", { cause });

    const reported = JSON.stringify(window.osfsLoadingDiagnostics?.());
    for (const text of [newestLine().textContent ?? "", reported]) {
      expect(text).toContain("https://tile.googleapis.com/v1/3dtiles/root.json");
      expect(text).not.toContain(key);
    }
    expect(reported).toContain("https://0sfs.test/assets/app.js");
  });

  it("copies the shared report with loading state and the complete traceback", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    screen = createFlightLoadingScreen(undefined, async () => `0SFS report, 2026-10-28T00:00:00.000Z\nContact: reporter@example.com\nLoading diagnostics:\n${JSON.stringify(window.osfsLoadingDiagnostics?.())}\nSettings: all at their defaults.\n`);
    screen.setPhase("app", { state: "loading", detail: "Importing https://app.test/app.js?token=phase-secret" });
    const error = new SyntaxError("The requested module '/src/fixedStepLoop.ts?t=123' doesn't provide an export named: 'FIXED_DT'");
    error.stack = "";
    await expect(screen.trace!("Import flight application", async () => { throw error; })).rejects.toBe(error);
    screen.fail("Application failed", { cause: error });
    const copy = [...newestLine().querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Copy report")!;
    copy.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const text = writeText.mock.calls[0][0];
    expect(text).toContain("0SFS report, ");
    expect(text).toContain("Settings: all at their defaults.");
    expect(text).not.toContain("reporter@example.com");
    expect(text).toContain("SyntaxError: The requested module");
    const report = window.osfsLoadingDiagnostics?.();
    expect(report).toMatchObject({ version: 2, outcome: "failed", phases: { app: { state: "failed" } },
      cause: { stack: null, module: { exportName: "FIXED_DT" } },
      operations: [{ state: "failed", callerStack: expect.stringContaining("createFlightLoadingScreen.test.ts:") }],
    });
    expect(writeText.mock.calls[0][0]).not.toContain("phase-secret");
    screen.show({ reset: true });
    expect(window.osfsLoadingDiagnostics?.()).toMatchObject({ outcome: "loading", operations: [], browserEvents: [], history: [], cause: null });
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("preserves existing root state and leaves a shared log to its owner", () => {
    const root = document.getElementById("root")!;
    root.setAttribute("inert", "");
    root.setAttribute("aria-busy", "false");
    const log = createGameLog();
    screen = createFlightLoadingScreen(log);
    screen.destroy();

    expect(root.hasAttribute("inert")).toBe(true);
    expect(root.getAttribute("aria-busy")).toBe("false");
    expect(document.getElementById("app-log")).toBe(log.element);
    const count = lines().length;
    screen.show();
    expect(lines()).toHaveLength(count);
    log.destroy();
  });

  it("removes a log it created when destroyed", () => {
    screen = createFlightLoadingScreen();
    screen.destroy();

    expect(document.getElementById("app-log")).toBeNull();
  });
});
