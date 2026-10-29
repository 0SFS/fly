import { attachPanoramaLook, type LookState, type PanoramaLookBinding } from "foss-earth/input";
import { getAppSettings, type ParameterValue, type SettingsRegistry } from "foss-earth/settings";

export interface DronePreviewAim {
  yawDeg: number;
  pitchDeg: number;
  yawMinDeg: number;
  yawMaxDeg: number;
  pitchMinDeg: number;
  pitchMaxDeg: number;
  enabled: boolean;
}

export interface DronePreviewLookOptions {
  canvas: HTMLCanvasElement;
  verticalFovDeg: number;
  readAim(): DronePreviewAim;
  onAim(yawDeg: number, pitchDeg: number): void;
  /** Preview magnification only; the capture camera keeps its native lens. */
  onFov(verticalFovDeg: number): void;
  requestRender(): void;
  attach?: typeof attachPanoramaLook;
  settings?: Pick<SettingsRegistry, "get" | "watch">;
}

const signedHeading = (heading: number): number => ((heading + 180) % 360 + 360) % 360 - 180;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const different = (a: number, b: number): boolean => Math.abs(a - b) > 1e-7;

/** The shared 360 viewer controls, with airframe stops and preview-only magnification. */
export function createDronePreviewLook(options: DronePreviewLookOptions) {
  const view = options.canvas.ownerDocument.defaultView;
  if (!view) throw new Error("Camera preview controls require a browser window.");
  const source = options.settings ?? getAppSettings();
  const nativeFov = clamp(options.verticalFovDeg, 1, 179);
  const minFov = () => {
    const range = source.get<{ min: number; max: number }>("scene.panorama.verticalFovRange");
    return Math.min(nativeFov, Math.max(1, Number.isFinite(range?.min) ? range.min : 10));
  };
  const settings: Pick<SettingsRegistry, "get" | "watch"> = {
    get<T extends ParameterValue>(id: string): T {
      if (id === "scene.panorama.pitchRange") {
        const aim = options.readAim();
        return { min: aim.pitchMinDeg, max: aim.pitchMaxDeg } as T;
      }
      if (id === "scene.panorama.verticalFovRange") return { min: minFov(), max: nativeFov } as T;
      return source.get<T>(id);
    },
    watch: (id, listener) => source.watch(id, listener),
  };
  let active = false;
  let destroyed = false;
  let look: PanoramaLookBinding | null = null;
  let frame: number | null = null;
  let steppedAt = 0;
  let suppressed = false;
  let fov = nativeFov;
  let lastYaw = 0;
  let lastPitch = 0;
  let bounds = "";
  let bindingGeneration = 0;
  const updateDisabled = (disabled: boolean) => {
    const value = String(disabled);
    if (options.canvas.getAttribute("aria-disabled") !== value) options.canvas.setAttribute("aria-disabled", value);
  };
  const blockLocked = (event: Event) => {
    if (!destroyed && active && !options.readAim().enabled) {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    }
  };
  const blockedEvents = ["wheel", "pointerdown", "gesturestart", "gesturechange", "gestureend"];
  for (const name of blockedEvents) options.canvas.addEventListener(name, blockLocked, { capture: true, passive: false });
  updateDisabled(true);
  const cancelFrame = () => {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
  };
  const release = () => {
    cancelFrame();
    bindingGeneration++;
    const previous = look; look = null;
    previous?.detach();
  };
  const setModel = (state: LookState) => {
    suppressed = true;
    try { look?.set(state); }
    finally { suppressed = false; }
  };
  const requestFrame = () => {
    if (destroyed || !active || !look || frame !== null || !look.moving()) return;
    steppedAt = view.performance.now();
    frame = view.requestAnimationFrame(tick);
  };
  const tick = (at: number) => {
    frame = null;
    if (destroyed || !active) return;
    sync();
    if (!look) return;
    look.step(at - steppedAt);
    steppedAt = at;
    options.requestRender();
    if (look?.moving() && frame === null) frame = view.requestAnimationFrame(tick);
  };
  const onChange = (next: LookState) => {
    if (suppressed || destroyed || !active || !look) return;
    const aim = options.readAim();
    if (!aim.enabled) { release(); return; }
    const yaw = clamp(signedHeading(next.headingDeg), aim.yawMinDeg, aim.yawMaxDeg);
    const pitch = clamp(next.pitchDeg, aim.pitchMinDeg, aim.pitchMaxDeg);
    const nextFov = clamp(next.verticalFovDeg, minFov(), nativeFov);
    // A stop also cancels any glide pushing farther past the mechanical limit.
    if (different(yaw, signedHeading(next.headingDeg)) || different(pitch, next.pitchDeg)
      || different(nextFov, next.verticalFovDeg)) {
      setModel({ headingDeg: yaw, pitchDeg: pitch, verticalFovDeg: nextFov });
    }
    if (different(yaw, lastYaw) || different(pitch, lastPitch)) {
      lastYaw = yaw; lastPitch = pitch;
      options.onAim(yaw, pitch);
    }
    if (different(nextFov, fov)) { fov = nextFov; options.onFov(fov); }
    options.requestRender();
  };
  const sync = () => {
    if (destroyed) return;
    const aim = options.readAim();
    updateDisabled(!active || !aim.enabled);
    if (!active || !aim.enabled) { release(); return; }
    const yaw = clamp(aim.yawDeg, aim.yawMinDeg, aim.yawMaxDeg);
    const pitch = clamp(aim.pitchDeg, aim.pitchMinDeg, aim.pitchMaxDeg);
    const nextBounds = `${aim.yawMinDeg}:${aim.yawMaxDeg}:${aim.pitchMinDeg}:${aim.pitchMaxDeg}`;
    const nextFov = clamp(fov, minFov(), nativeFov);
    if (!look) {
      lastYaw = yaw; lastPitch = pitch; bounds = nextBounds;
      if (different(nextFov, fov)) { fov = nextFov; options.onFov(fov); }
      suppressed = true;
      try {
        const token = ++bindingGeneration;
        look = (options.attach ?? attachPanoramaLook)({
          canvas: options.canvas,
          initial: { headingDeg: yaw, pitchDeg: pitch, verticalFovDeg: fov },
          onChange: state => { if (token === bindingGeneration) onChange(state); },
          requestFrame: () => { if (token === bindingGeneration) requestFrame(); },
          settings,
          ownsKeys: () => false,
          inputMode: () => {
            const mode = source.get<string>("input.mode");
            return mode === "mouse" || mode === "trackpad" ? mode : "auto";
          },
        });
      } finally { suppressed = false; }
      return;
    }
    if (different(yaw, lastYaw) || different(pitch, lastPitch) || nextBounds !== bounds || different(nextFov, fov)) {
      lastYaw = yaw; lastPitch = pitch; bounds = nextBounds;
      setModel({ headingDeg: yaw, pitchDeg: pitch, verticalFovDeg: nextFov });
      cancelFrame();
      if (different(nextFov, fov)) { fov = nextFov; options.onFov(fov); }
    }
  };
  return {
    sync,
    setActive(on: boolean) {
      if (destroyed || active === on) return;
      active = on;
      sync();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; active = false; release();
      for (const name of blockedEvents) options.canvas.removeEventListener(name, blockLocked, { capture: true });
      options.canvas.removeAttribute("aria-disabled");
    },
  };
}
