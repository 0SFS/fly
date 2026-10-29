// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LoadedModRecord } from "@0sfs/mods";
import type { UniversalCamera } from "@babylonjs/core";
import type { CameraProfile } from "@0sfs/drone-camera/profile";
import type { CameraPreviewOptions } from "@0sfs/mods/cameraPreview";
import { createDroneCameraPreview } from "./droneCameraPreview";
import { cameraPreviewProviders, installCameraPreview, uninstallCameraPreview } from "./cameraPreviewRegistry";
import type { DroneViewContext } from "./droneGate";

const sensor = vi.hoisted(() => ({ read: vi.fn(async () => ({ width: 2, height: 2, rgba: new Uint8Array(16) })), dispose: vi.fn() }));
vi.mock("@0sfs/drone-camera/sensorFrame", () => ({ createSensorPreviewRig: () => sensor }));
const profile = { exifModel: "FC7303", vfovRad: 1 } as CameraProfile;
const camera = {} as UniversalCamera;
const view = { rendererMode: "webgpu", scene: { getEngine: () => ({}) }, aircraftRoot: {}, requestRender: vi.fn() } as unknown as DroneViewContext;
let adapter: ReturnType<typeof createDroneCameraPreview> | undefined;
beforeEach(() => {
  window.localStorage?.clear(); vi.clearAllMocks();
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.isConnected ? [{}] : []) as unknown as DOMRectList;
  });
});
afterEach(() => {
  adapter?.destroy(); adapter = undefined;
  for (const provider of cameraPreviewProviders()) uninstallCameraPreview(provider.id);
  document.body.replaceChildren(); vi.restoreAllMocks();
});
function install(id = "preview") {
  installCameraPreview({ baseUrl: `/dev-mods/${id}/`, manifest: { id, name: id, cameraPreview: { apiVersion: 1 }, js: { path: "preview.js" } } } as LoadedModRecord);
}
function choose(value: string) {
  const input = [...adapter!.element.querySelectorAll<HTMLInputElement>("input")].find(item => item.value === value)!;
  input.checked = true; input.dispatchEvent(new Event("change", { bubbles: true }));
}
it("imports only a visible selected provider, stops detached views and removes a provider independently", async () => {
  install();
  const active = vi.fn(), destroy = vi.fn();
  let options: CameraPreviewOptions | undefined;
  const load = vi.fn(async () => ({ createCameraPreview(next: CameraPreviewOptions) {
    options = next; return { element: document.createElement("canvas"), setActive: active, destroy };
  } }));
  adapter = createDroneCameraPreview(document, null, load);
  adapter.update(view, camera, profile);
  expect(load).not.toHaveBeenCalled();
  document.body.append(adapter.element);
  await vi.waitFor(() => expect(active).toHaveBeenLastCalledWith(true));
  expect(load).toHaveBeenCalledTimes(1);
  expect(options!.label).toBe("FC7303");
  await options!.readFrame(); expect(sensor.read).toHaveBeenCalledWith(camera, profile, 640, 1);
  adapter.element.remove();
  await vi.waitFor(() => expect(active).toHaveBeenLastCalledWith(false));
  document.body.append(adapter.element);
  await vi.waitFor(() => expect(active).toHaveBeenLastCalledWith(true));
  expect(load).toHaveBeenCalledTimes(1);
  uninstallCameraPreview("preview");
  expect(destroy).toHaveBeenCalledOnce(); expect(sensor.dispose).toHaveBeenCalledOnce();
  expect(adapter.element.textContent).toContain("Preview mod not installed");
});
it("discards a late module when switched off, and permits another provider and camera profile", async () => {
  install(); install("replacement");
  let resolve!: (module: Awaited<ReturnType<typeof load>>) => void;
  const factory = vi.fn(() => ({ element: document.createElement("canvas"), setActive: vi.fn(), destroy: vi.fn() }));
  const load = vi.fn(() => new Promise<{ createCameraPreview: typeof factory }>(done => { resolve = done; }));
  adapter = createDroneCameraPreview(document, null, load); document.body.append(adapter.element);
  adapter.update(view, camera, profile);
  expect(load).toHaveBeenCalledOnce();
  choose("off"); resolve({ createCameraPreview: factory });
  await Promise.resolve(); await Promise.resolve();
  expect(factory).not.toHaveBeenCalled(); expect(adapter.element.querySelector("canvas")).toBeNull();
  choose("replacement");
  expect(load).toHaveBeenLastCalledWith("/dev-mods/replacement/preview.js");
  resolve({ createCameraPreview: factory });
  await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce());
  const next = { ...profile, exifModel: "FC3411" };
  adapter.update(view, camera, next);
  resolve({ createCameraPreview: factory });
  await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
  expect(factory.mock.calls[1]![0]).toMatchObject({ label: "FC3411" });
});
it("holds a module error until retry instead of refetching every frame", async () => {
  install();
  const load = vi.fn(async () => { throw new Error("Module not found"); });
  adapter = createDroneCameraPreview(document, null, load); document.body.append(adapter.element);
  adapter.update(view, camera, profile);
  await vi.waitFor(() => expect(adapter!.element.textContent).toContain("Module not found"));
  for (let i = 0; i < 10; i++) adapter.update(view, camera, profile);
  expect(load).toHaveBeenCalledOnce();
  adapter.element.querySelector<HTMLButtonElement>('[aria-label="Retry loading camera preview"]')!.click();
  expect(load).toHaveBeenCalledTimes(2);
});

it("keeps an uninstalled preview idle while its tab is visible", async () => {
  const load = vi.fn();
  adapter = createDroneCameraPreview(document, null, load);
  document.body.append(adapter.element); adapter.update(view, camera, profile);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(adapter.element.textContent).toContain("Preview mod not installed");
  expect(load).not.toHaveBeenCalled();
});

it.each(["missing methods", "activation throws"])("isolates a replacement provider when %s", async failure => {
  install();
  const destroy = vi.fn();
  const candidate = failure === "missing methods" ? { element: document.createElement("div"), destroy }
    : { element: document.createElement("div"), destroy, setActive: () => { throw new Error("Bad activation"); } };
  const load = vi.fn(async () => ({ createCameraPreview: () => candidate as never }));
  adapter = createDroneCameraPreview(document, null, load); document.body.append(adapter.element);
  adapter.update(view, camera, profile);
  await vi.waitFor(() => expect(adapter!.element.textContent).toContain("Preview unavailable"));
  for (let i = 0; i < 10; i++) expect(() => adapter!.update(view, camera, profile)).not.toThrow();
  expect(load).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce();
  expect(sensor.dispose).toHaveBeenCalledOnce();
  expect(() => adapter!.destroy()).not.toThrow();
});
