import { checkChoice, createChoiceGroup, createHelpTooltip, createIconButton } from "@foss-earth/ui/browser";
import { createSensorPreviewRig, type SensorPreviewRig } from "@0sfs/drone-camera/sensorFrame";
import type { CameraPreview, CameraPreviewOptions } from "@0sfs/mods/cameraPreview";
import type { UniversalCamera } from "@babylonjs/core";
import type { CameraProfile } from "@0sfs/drone-camera/profile";
import type { DroneViewContext } from "./droneGate";
import { cameraPreviewProviders, subscribeCameraPreviewProviders } from "./cameraPreviewRegistry";
import { createDronePreviewLook, type DronePreviewLookOptions } from "./dronePreviewLook";

interface PreviewContext {
  view: DroneViewContext;
  camera: UniversalCamera;
  profile: CameraProfile;
}
type PreviewModule = { createCameraPreview(options: CameraPreviewOptions): CameraPreview };
const PREFERENCE = "osfs.camera.previewProvider";
type PreviewControls = Pick<DronePreviewLookOptions, "readAim" | "onAim">;

/** Host adapter only. Optional mods supply presentation; the active camera supplies pixels. */
export function createDroneCameraPreview(document: Document,
  controls: PreviewControls | null = null,
  loadProvider: (url: string) => Promise<PreviewModule> = url => import(/* @vite-ignore */ url)) {
  const element = document.createElement("div");
  element.style.cssText = "flex:1 1 100%;min-width:0;display:flex;flex-wrap:wrap;gap:8px";
  const choices = document.createElement("div");
  choices.style.cssText = "display:contents";
  const slot = document.createElement("div");
  slot.style.cssText = "width:100%;min-width:0";
  const status = document.createElement("p");
  status.style.cssText = "margin:0;overflow-wrap:anywhere";
  status.setAttribute("role", "status");
  const retry = createIconButton(document, { icon: "reset", label: "Retry loading camera preview" });
  retry.hidden = true;
  const explanation = document.createElement("p");
  explanation.textContent = "Add 0SFS/camera-preview in Mods → This computer, then select it here. Preview mods are optional and interchangeable; the aircraft's camera mod supplies the sensor and lens. Off or closing this tab stops preview rendering. Still capture works without a preview mod.";
  const help = createHelpTooltip({ label: "Explain preview mods", content: explanation });
  element.append(choices, slot, status, retry);
  let selected: string | null = null;
  try { selected = document.defaultView?.localStorage.getItem(PREFERENCE) ?? null; } catch { /* Storage can be unavailable. */ }
  let context: PreviewContext | null = null;
  let bound: PreviewContext | null = null;
  let component: CameraPreview | null = null;
  let rig: SensorPreviewRig | null = null;
  let look: ReturnType<typeof createDronePreviewLook> | null = null;
  let key = "";
  let generation = 0;
  let destroyed = false;
  let loadFailed = false;
  const setStatus = (text: string) => { if (status.textContent !== text) status.textContent = text; };
  const visible = () => element.isConnected && element.getClientRects().length > 0 && document.visibilityState !== "hidden";
  const release = () => {
    if (!key && !bound && !component && !rig && !slot.hasChildNodes() && !slot.hasAttribute("aria-busy")) return;
    generation++;
    const previous = component; component = null;
    try { previous?.destroy(); } catch { /* A faulty optional provider cannot break aircraft cleanup. */ }
    look?.destroy(); look = null;
    rig?.dispose(); rig = null;
    bound = null; key = "";
    loadFailed = false;
    slot.removeAttribute("aria-busy");
    if (slot.hasChildNodes()) slot.replaceChildren();
  };
  const fail = (error: unknown) => {
    const previous = component; component = null;
    try { previous?.destroy(); } catch { /* Discard a partially initialized provider. */ }
    look?.destroy(); look = null;
    rig?.dispose(); rig = null;
    if (slot.hasChildNodes()) slot.replaceChildren();
    loadFailed = true;
    setStatus(`Preview unavailable: ${error instanceof Error ? error.message : String(error)}`);
    retry.hidden = false;
  };
  const activate = (on: boolean) => {
    try { component?.setActive(on); } catch (error) { fail(error); }
  };
  const reconcile = () => {
    if (destroyed) return;
    const providers = cameraPreviewProviders();
    const provider = selected === "off" ? null : providers.find(item => item.id === selected) ?? (selected === null ? providers[0] : null);
    if (!provider || !context || context.view.rendererMode !== "webgpu") {
      release(); if (!retry.hidden) retry.hidden = true;
      setStatus(!providers.length ? "Preview mod not installed" : !provider ? "Preview off"
        : context?.view.rendererMode !== "webgpu" ? "Camera preview requires WebGPU." : "");
      return;
    }
    const nextKey = `${provider.id}:${provider.moduleUrl}`;
    if (key !== nextKey || bound?.profile !== context.profile || bound.camera !== context.camera
      || bound.view.scene !== context.view.scene || bound.view.aircraftRoot !== context.view.aircraftRoot) {
      release();
      key = nextKey; bound = context;
    }
    if (!visible()) { activate(false); return; }
    if (component) { activate(true); return; }
    if (loadFailed) return;
    // The module is fetched only when a provider is installed, selected and visible.
    if (slot.getAttribute("aria-busy") === "true") return;
    slot.setAttribute("aria-busy", "true");
    setStatus("Loading preview");
    const token = generation;
    const source = bound;
    void loadProvider(provider.moduleUrl).then(module => {
      if (destroyed || token !== generation || !source) return;
      if (typeof module.createCameraPreview !== "function") throw new Error("Preview mod needs createCameraPreview().");
      const { view, camera, profile } = source;
      const sensor = createSensorPreviewRig(view.scene, view.rendererMode,
        view.scene.getEngine() as { _device?: GPUDevice; flushFramebuffer(): void },
        mesh => !mesh.isDescendantOf(view.aircraftRoot) && !mesh.name.startsWith("orbit-compass-"));
      rig = sensor;
      let verticalFovDeg = profile.vfovRad * 180 / Math.PI;
      const candidate = module.createCameraPreview({ document, label: profile.exifModel, maxFps: 15,
        readFrame: () => sensor.read(camera, profile, 640, verticalFovDeg * Math.PI / 180),
        attachInteraction: controls ? canvas => {
          look?.destroy();
          const interaction = createDronePreviewLook({ canvas, verticalFovDeg: profile.vfovRad * 180 / Math.PI,
            ...controls, onFov: value => { verticalFovDeg = value; }, requestRender: () => view.requestRender() });
          look = interaction;
          return interaction;
        } : undefined });
      if (!candidate || candidate.element?.ownerDocument !== document || candidate.element.nodeType !== 1
        || typeof candidate.setActive !== "function" || typeof candidate.destroy !== "function") {
        try { candidate?.destroy?.(); } catch { /* Incomplete providers may have partial resources. */ }
        throw new Error("Preview mod must return an element, setActive() and destroy().");
      }
      component = candidate;
      slot.replaceChildren(component.element);
      setStatus(""); retry.hidden = true;
      activate(visible());
    }).catch(error => {
      if (destroyed || token !== generation) return;
      fail(error);
    }).finally(() => {
      if (token === generation) slot.removeAttribute("aria-busy");
    });
  };
  const rebuildChoices = () => {
    const providers = cameraPreviewProviders();
    const group = createChoiceGroup("camera-preview-provider", "Preview", [
      { id: "off", label: "Off" }, ...providers.map(item => ({ id: item.id, label: item.label })),
    ], document);
    group.style.maxWidth = "100%";
    group.append(help.element);
    choices.replaceChildren(group);
    checkChoice(group, "camera-preview-provider", providers.some(item => item.id === selected) ? selected
      : selected === null && providers[0] ? providers[0].id : "off");
    group.addEventListener("change", event => {
      const input = event.target as HTMLInputElement;
      if (input.name !== "camera-preview-provider" || !input.checked) return;
      selected = input.value;
      try { document.defaultView?.localStorage.setItem(PREFERENCE, selected); } catch { /* Optional preference. */ }
      release(); reconcile();
      context?.view.requestRender();
    });
    reconcile();
  };
  const retryLoad = () => { release(); reconcile(); };
  retry.addEventListener("click", retryLoad);
  const unsubscribe = subscribeCameraPreviewProviders(rebuildChoices);
  const observer = new MutationObserver(() => {
    if (!visible()) activate(false);
    else if (context) reconcile();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "style"] });
  document.addEventListener("visibilitychange", reconcile);
  rebuildChoices();
  return {
    element,
    update(view: DroneViewContext, camera: UniversalCamera, profile: CameraProfile) {
      context = { view, camera, profile };
      reconcile();
      look?.sync();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; release();
      observer.disconnect(); unsubscribe();
      document.removeEventListener("visibilitychange", reconcile);
      retry.removeEventListener("click", retryLoad);
      help.destroy(); element.remove(); context = null;
    },
  };
}
