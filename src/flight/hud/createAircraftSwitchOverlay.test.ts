// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createAircraftSwitchOverlay } from "./createAircraftSwitchOverlay";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("shows loading in the former aircraft position and updates accessible progress", () => {
  const overlay = createAircraftSwitchOverlay(document.body);
  overlay.show("Vision Jet", { x: 340, y: 250 });
  const host = document.querySelector<HTMLElement>(".flight-aircraft-switch")!;
  const indicator = host.firstElementChild as HTMLElement;
  expect(host.hidden).toBe(false);
  expect(indicator.style.left).toBe("340px");
  expect(indicator.style.top).toBe("250px");
  expect(host.textContent).toContain("Loading Vision Jet");
  const bar = host.querySelector('[role="progressbar"]')!;
  expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  overlay.progress(50, "Loading flight physics…");
  expect(bar.getAttribute("aria-valuenow")).toBe("50");
  expect(host.textContent).toBe("Loading flight physics…");
  overlay.hide();
  expect(host.hidden).toBe(true);
  overlay.dispose();
  expect(document.body.children).toHaveLength(0);
});

it("keeps a readable failure report outside the replaced flight UI", () => {
  const session = document.createElement("main");
  document.body.append(session);
  const overlay = createAircraftSwitchOverlay(document.body);
  const dialog = document.querySelector("dialog")!;
  dialog.showModal = function () { this.open = true; };
  dialog.close = function () { this.open = false; };
  overlay.show("F-35B");
  session.remove();
  overlay.fail("Model request failed: <script>unsafe</script>\nHTTP 404 /aircraft/f35b.glb");
  expect(dialog.open).toBe(true);
  const failureTab = [...dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === "failure.txt")!;
  failureTab.click();
  expect(dialog.querySelector("pre")?.textContent).toContain("HTTP 404 /aircraft/f35b.glb");
  expect(dialog.querySelector("script")).toBeNull();
  expect(document.querySelector<HTMLElement>(".flight-aircraft-switch")?.hidden).toBe(true);
  ([...dialog.querySelectorAll("button")].find(button => button.textContent === "Close") as HTMLButtonElement).click();
  expect(dialog.open).toBe(false);
  overlay.dispose();
});


it("offers shared file tabs, opens one search hit and downloads one file or the zip", async () => {
  const createUrl = vi.fn<(blob: Blob) => string>(() => "blob:shared-report");
  const revokeUrl = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl; });
  const overlay = createAircraftSwitchOverlay(document.body);
  const dialog = document.querySelector("dialog")!;
  dialog.showModal = function () { this.open = true; };
  dialog.close = function () { this.open = false; };
  overlay.fail([
    "Error: Aircraft download failed",
    "0SFS report, 2026-10-28T00:00:00.000Z",
    "Settings (all effective values):",
    ...Array.from({ length: 50 }, (_, index) => `  osfs.example.${index} = ${index}`),
    "Errors nothing handled: none.",
    "This visit, oldest first:",
    "The visit before: no trail of one on this device.",
  ].join("\n"));
  const settings = dialog.querySelector<HTMLButtonElement>('[role="tab"][data-file="settings.txt"]')!;
  settings.click();
  expect(dialog.querySelector("pre")).toBeNull();
  const search = dialog.querySelector<HTMLInputElement>('[aria-label="Find a line in the error report"]')!;
  search.value = "osfs.example.49";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const hit = dialog.querySelector<HTMLButtonElement>('.foss-earth-issue-report__hits button')!;
  expect(hit.textContent).toContain("settings.txt:51");
  hit.click();
  expect(dialog.querySelector("pre")?.textContent).toBe("51>   osfs.example.49 = 49");
  const single = dialog.querySelector<HTMLAnchorElement>('[aria-label="Download this file"]')!;
  single.addEventListener("click", event => event.preventDefault());
  single.click();
  expect(single.download).toBe("settings.txt");
  expect(single.href).toBe("blob:shared-report");
  expect(createUrl.mock.calls[0][0].type).toBe("text/plain;charset=utf-8");
  const all = dialog.querySelector<HTMLAnchorElement>('[download="error-report.zip"]')!;
  all.addEventListener("click", event => event.preventDefault());
  all.click();
  expect(all.href).toBe("blob:shared-report");
  expect(createUrl.mock.calls[1][0].type).toBe("application/zip");
  overlay.dispose();
  expect(revokeUrl).toHaveBeenCalledTimes(2);
});
