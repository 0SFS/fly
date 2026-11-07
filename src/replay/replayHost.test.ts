// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BabylonRuntime } from "foss-earth/runtime";
import { resetAppSettings } from "foss-earth/settings";
import { privateMapDetailController } from "../flight/mapDetailTesting";
import { replayHost } from "./replayHost";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); resetAppSettings(); });

const RUNTIME = {
  renderer: { mode: "webgpu" },
  status: { mode: "raster-basemap", terrainSource: { id: "mapterhorn", label: "Mapterhorn Terrain" } },
  getMapDownloadBytesPerSecond: () => 0, onMapDownloadRateChange: () => () => {},
  isStreamingTiles: () => false, onTilesStreamingChange: () => () => {},
  isRendering: () => false, onActiveRenderChange: () => () => {},
} as unknown as BabylonRuntime;
const READING = { latDeg: 26.5, lonDeg: -80.1, altMeters: 10668, headingRad: 0, pitchRad: 0 };

it("lends the replay the flight's toolbar, which plays and pauses the replay and opens its tabs", () => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const toggle = { fps: vi.fn(), renderer: vi.fn(), basemap: vi.fn(), position: vi.fn(), inputMethod: vi.fn() };
  const onPlayingChange = vi.fn();
  const toolbar = replayHost.createToolbar(parent, {
    runtime: RUNTIME, mapDetail: privateMapDetailController(null), seaLevel: { read: () => ({ baseMeters: null }) },
    onPlayingChange, toggle, tabNames: { fps: "Renderer", position: "Map" },
  });
  const button = (selector: string) => parent.querySelector<HTMLButtonElement>(selector)!;
  expect(parent.querySelector(".flight-shell-root .hud-bar")?.getAttribute("aria-label")).toBe("Replay controls");

  // With no flight open the position keeps its dash.
  toolbar.update(null, 60, false, null);
  expect(button("#flightShellStatus").textContent).not.toContain("°N");
  toolbar.update(READING, 60, false, null);
  expect(button("#flightShellStatus").textContent).toContain("26.5000°N 80.1000°W");
  expect(button("#flightPauseButton").title).toBe("Play the replay");
  button("#flightPauseButton").click();
  expect(onPlayingChange).toHaveBeenLastCalledWith(true);
  toolbar.update(READING, 60, true, null);
  expect(button("#flightPauseButton").title).toBe("Pause the replay");
  button("#flightPauseButton").click();
  expect(onPlayingChange).toHaveBeenLastCalledWith(false);

  button("#flightFps").click();
  button("#flightRendererButton").click();
  button(".map-source-hud__provider").click();
  button("#flightShellStatus").click();
  button("#inputModeButton").click();
  expect(Object.values(toggle).map(open => open.mock.calls.length)).toEqual([1, 1, 1, 1, 1]);
  // The replay has neither a Settings nor a Bug report tab.
  expect(button("#flightSettingsButton").hidden).toBe(true);
  expect(button("#flightBugReportButton").hidden).toBe(true);
  // jsdom lays nothing out, so the bar has no top yet.
  expect(toolbar.top()).toBeNull();

  toolbar.destroy();
  expect(parent.childElementCount).toBe(0);
});
