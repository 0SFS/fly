// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFlightPlacementCoordinator, type FlightPlacementCoordinator } from "./createFlightPlacementCoordinator";

let coordinator: FlightPlacementCoordinator;
const dialog = () => document.querySelector<HTMLDialogElement>('[aria-label="Confirm teleport"]')!;
const button = (text: string) => [...dialog().querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!;
beforeEach(() => {
  document.body.innerHTML = '<button id="origin">Change location</button>';
  coordinator = createFlightPlacementCoordinator(document);
  dialog().showModal = function () { this.open = true; };
  dialog().close = function () { this.open = false; this.dispatchEvent(new Event("close")); };
});
afterEach(() => { coordinator?.dispose(); vi.restoreAllMocks(); document.body.replaceChildren(); });

it("describes the destination and reason, defaults to No and restores focus", async () => {
  const origin = document.getElementById("origin")!;
  origin.focus();
  const request = coordinator.request({ destination: "300 m above this location", reason: "Terrain now overlaps the aircraft." });
  expect(dialog().open).toBe(true);
  expect(dialog().textContent).toContain("Teleport to 300 m above this location?");
  expect(dialog().textContent).toContain("Terrain now overlaps the aircraft.");
  expect(document.activeElement).toBe(button("No"));
  button("No").click();
  expect(await request).toBe(false);
  expect(document.activeElement).toBe(origin);
  expect(dialog().open).toBe(false);
});

it("asks for each relocation, including after a Yes", async () => {
  const first = coordinator.request({ destination: "A", reason: "Chosen destination" });
  button("Yes").click();
  expect(await first).toBe(true);
  const second = coordinator.request({ destination: "B", reason: "Another destination" });
  expect(dialog().open).toBe(true);
  button("No").click();
  expect(await second).toBe(false);
});

it("cancels stale proposals and ignores an old abort after replacement", async () => {
  const abort = new AbortController();
  const first = coordinator.request({ destination: "A", reason: "First", signal: abort.signal });
  const second = coordinator.request({ destination: "B", reason: "Second" });
  expect(await first).toBe(false);
  abort.abort();
  expect(dialog().open).toBe(true);
  button("Yes").click();
  expect(await second).toBe(true);
});

it("settles cancellation, Escape and disposal as No", async () => {
  const abort = new AbortController();
  const first = coordinator.request({ destination: "A", reason: "First", signal: abort.signal });
  abort.abort();
  expect(await first).toBe(false);
  const second = coordinator.request({ destination: "B", reason: "Second" });
  button("No").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(await second).toBe(false);
  const third = coordinator.request({ destination: "C", reason: "Third" });
  coordinator.dispose();
  expect(await third).toBe(false);
  expect(await coordinator.request({ destination: "D", reason: "Disposed" })).toBe(false);
});

it("isolates modal key presses but lets key releases clear held flight input", async () => {
  const down = vi.fn(), up = vi.fn();
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  try {
    const request = coordinator.request({ destination: "A", reason: "First" });
    button("No").dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    button("No").dispatchEvent(new KeyboardEvent("keyup", { key: "p", bubbles: true }));
    expect(down).not.toHaveBeenCalled();
    expect(up).toHaveBeenCalledOnce();
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(await request).toBe(false);
  } finally { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); }
});

it("does not grant consent when the modal cannot open", async () => {
  dialog().showModal = () => { throw new DOMException("Document detached", "InvalidStateError"); };
  expect(await coordinator.request({ destination: "A", reason: "First" })).toBe(false);
  expect(dialog().open).toBe(false);
});
