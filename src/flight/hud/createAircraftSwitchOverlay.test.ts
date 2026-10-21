// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createAircraftSwitchOverlay } from "./createAircraftSwitchOverlay";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

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
  expect(dialog.querySelector("pre")?.textContent).toContain("HTTP 404 /aircraft/f35b.glb");
  expect(dialog.querySelector("script")).toBeNull();
  expect(document.querySelector<HTMLElement>(".flight-aircraft-switch")?.hidden).toBe(true);
  (dialog.querySelector("button") as HTMLButtonElement).click();
  expect(dialog.open).toBe(false);
  overlay.dispose();
});
