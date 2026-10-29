// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookState, PanoramaLookOptions } from "foss-earth/input";
import type { SettingsRegistry } from "foss-earth/settings";
import { createDronePreviewLook, type DronePreviewAim } from "./dronePreviewLook";

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const cleanups: (() => void)[] = [];
beforeEach(() => {
  frames.clear(); nextFrame = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  vi.spyOn(window.performance, "now").mockReturnValue(1000);
});
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); });

function setup(nativeFov = 60, configuredMin = 10) {
  const aim: DronePreviewAim = { yawDeg: 0, pitchDeg: -20, yawMinDeg: -20, yawMaxDeg: 20,
    pitchMinDeg: -90, pitchMaxDeg: 20, enabled: true };
  const preferences: Record<string, unknown> = {
    "scene.panorama.verticalFovRange": { min: configuredMin, max: 150 },
    "scene.panorama.inertiaHalfLife": 150,
    "input.mode": "trackpad",
  };
  const settings = { get: <T,>(id: string) => preferences[id] as T, watch: vi.fn(() => vi.fn()) } satisfies Pick<SettingsRegistry, "get" | "watch">;
  const attached: { options: PanoramaLookOptions; state: LookState; moving: boolean; set: ReturnType<typeof vi.fn>;
    step: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn>; emit(state: LookState): void }[] = [];
  const attach = vi.fn((options: PanoramaLookOptions) => {
    const entry = { options, state: options.initial, moving: false,
      set: vi.fn((state: LookState) => { entry.state = state; entry.moving = false; options.onChange(state); }),
      step: vi.fn(() => entry.moving), detach: vi.fn(),
      emit(state: LookState) { entry.state = state; options.onChange(state); },
    };
    attached.push(entry);
    // A binding may report its initial state; this is never a pilot gesture.
    options.onChange(options.initial);
    return { get: () => entry.state, set: entry.set, step: entry.step, moving: () => entry.moving,
      detach: entry.detach, setRates: vi.fn() };
  });
  const onAim = vi.fn((yaw: number, pitch: number) => { aim.yawDeg = yaw; aim.pitchDeg = pitch; });
  const onFov = vi.fn(), requestRender = vi.fn();
  const canvas = document.createElement("canvas");
  const look = createDronePreviewLook({ canvas, verticalFovDeg: nativeFov,
    readAim: () => aim, onAim, onFov, requestRender, settings, attach });
  cleanups.push(() => look.destroy());
  return { look, canvas, aim, preferences, settings, attach, attached, onAim, onFov, requestRender };
}

describe("camera preview's shared 360 input", () => {
  it("binds only while visible and enabled, with aircraft stops and the shared preferences", () => {
    const h = setup();
    h.look.sync(); expect(h.attach).not.toHaveBeenCalled();
    h.look.setActive(true); h.look.sync();
    expect(h.attach).toHaveBeenCalledOnce();
    const binding = h.attached[0]!;
    expect(binding.options.initial).toEqual({ headingDeg: 0, pitchDeg: -20, verticalFovDeg: 60 });
    expect(binding.options.ownsKeys?.()).toBe(false);
    expect(binding.options.inputMode()).toBe("trackpad");
    expect(binding.options.settings!.get("scene.panorama.pitchRange")).toEqual({ min: -90, max: 20 });
    expect(binding.options.settings!.get("scene.panorama.verticalFovRange")).toEqual({ min: 10, max: 60 });
    expect(binding.options.settings!.get("scene.panorama.inertiaHalfLife")).toBe(150);
    const listener = vi.fn(); binding.options.settings!.watch("some.preference", listener);
    expect(h.settings.watch).toHaveBeenCalledWith("some.preference", listener);
    expect(h.onAim).not.toHaveBeenCalled(); expect(h.onFov).not.toHaveBeenCalled();
    h.aim.enabled = false; h.look.sync();
    expect(binding.detach).toHaveBeenCalledOnce();
    h.aim.enabled = true; h.look.sync();
    expect(h.attach).toHaveBeenCalledTimes(2);
    h.look.setActive(false); expect(h.attached[1]!.detach).toHaveBeenCalledOnce();
  });

  it("converts wrapped headings to signed yaw and clamps against gimbal stops without callback recursion", () => {
    const h = setup(); h.look.setActive(true);
    const binding = h.attached[0]!;
    binding.emit({ headingDeg: 359, pitchDeg: -30, verticalFovDeg: 60 });
    expect(h.onAim).toHaveBeenLastCalledWith(-1, -30);
    binding.emit({ headingDeg: 330, pitchDeg: 50, verticalFovDeg: 60 });
    expect(h.onAim).toHaveBeenLastCalledWith(-20, 20);
    expect(binding.set).toHaveBeenCalledOnce();
    expect(binding.state).toEqual({ headingDeg: -20, pitchDeg: 20, verticalFovDeg: 60 });
    expect(h.onAim).toHaveBeenCalledTimes(2);
    expect(h.onFov).not.toHaveBeenCalled();
  });

  it("syncs external sliders and changed stops without emitting another pilot command", () => {
    const h = setup(); h.look.setActive(true);
    const binding = h.attached[0]!;
    h.aim.yawDeg = 15; h.aim.pitchDeg = -70;
    h.look.sync();
    expect(binding.state).toEqual({ headingDeg: 15, pitchDeg: -70, verticalFovDeg: 60 });
    expect(h.onAim).not.toHaveBeenCalled();
    h.aim.yawMaxDeg = 10; h.aim.pitchMinDeg = -60;
    h.look.sync(); h.look.sync();
    expect(binding.state).toEqual({ headingDeg: 10, pitchDeg: -60, verticalFovDeg: 60 });
    expect(binding.set).toHaveBeenCalledTimes(2);
    expect(binding.options.settings!.get("scene.panorama.pitchRange")).toEqual({ min: -60, max: 20 });
    expect(h.onAim).not.toHaveBeenCalled();
  });

  it("changes only preview FOV for centered zoom and retains it through hide/reopen", () => {
    const h = setup(); h.look.setActive(true);
    const binding = h.attached[0]!;
    binding.emit({ headingDeg: 0, pitchDeg: -20, verticalFovDeg: 30 });
    expect(h.onFov).toHaveBeenLastCalledWith(30);
    expect(h.onAim).not.toHaveBeenCalled();
    h.look.setActive(false); h.look.setActive(true);
    expect(h.attached[1]!.options.initial.verticalFovDeg).toBe(30);
    h.attached[1]!.emit({ headingDeg: 0, pitchDeg: -20, verticalFovDeg: 120 });
    expect(h.onFov).toHaveBeenLastCalledWith(60);
    expect(h.attached[1]!.state.verticalFovDeg).toBe(60);
    h.attached[1]!.emit({ headingDeg: 0, pitchDeg: -20, verticalFovDeg: 2 });
    expect(h.onFov).toHaveBeenLastCalledWith(10);
    expect(h.onAim).not.toHaveBeenCalled();
    const narrow = setup(8, 10); narrow.look.setActive(true);
    expect(narrow.attached[0]!.options.settings!.get("scene.panorama.verticalFovRange")).toEqual({ min: 8, max: 8 });
  });

  it("steps only an active glide and cancels animation, late input and gestures when hidden or locked", () => {
    const h = setup(); h.look.setActive(true);
    const binding = h.attached[0]!;
    binding.options.requestFrame(); expect(frames.size).toBe(0);
    binding.moving = true; binding.options.requestFrame(); binding.options.requestFrame();
    expect(frames.size).toBe(1);
    const [id, tick] = frames.entries().next().value!;
    frames.delete(id); tick(1016);
    expect(binding.step).toHaveBeenLastCalledWith(16);
    expect(frames.size).toBe(1);
    h.look.setActive(false);
    expect(frames.size).toBe(0); expect(binding.detach).toHaveBeenCalledOnce();
    binding.emit({ headingDeg: 10, pitchDeg: -30, verticalFovDeg: 40 });
    expect(h.onAim).not.toHaveBeenCalled(); expect(h.onFov).not.toHaveBeenCalled();
    h.look.setActive(true);
    const rebound = h.attached[1]!;
    binding.emit({ headingDeg: 15, pitchDeg: -40, verticalFovDeg: 20 });
    binding.moving = true; binding.options.requestFrame();
    expect(h.onAim).not.toHaveBeenCalled(); expect(h.onFov).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    rebound.moving = true; rebound.options.requestFrame(); expect(frames.size).toBe(1);
    h.aim.enabled = false; h.look.sync();
    expect(frames.size).toBe(0); expect(rebound.detach).toHaveBeenCalledOnce();
    h.look.destroy(); h.aim.enabled = true; h.look.setActive(true); h.look.sync();
    expect(h.attach).toHaveBeenCalledTimes(2);
  });

  it("keeps locked preview gestures from reaching world input and removes its guards on destruction", () => {
    const h = setup(); document.body.append(h.canvas);
    const world = vi.fn();
    document.addEventListener("wheel", world);
    document.addEventListener("pointerdown", world);
    try {
      h.look.setActive(true);
      expect(h.canvas.getAttribute("aria-disabled")).toBe("false");
      h.aim.enabled = false; h.look.sync();
      expect(h.canvas.getAttribute("aria-disabled")).toBe("true");
      const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 20 });
      const drag = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
      h.canvas.dispatchEvent(wheel); h.canvas.dispatchEvent(drag);
      expect(wheel.defaultPrevented).toBe(true); expect(drag.defaultPrevented).toBe(true);
      expect(world).not.toHaveBeenCalled();
      h.look.destroy();
      h.canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 20 }));
      expect(world).toHaveBeenCalledOnce();
      expect(h.canvas.hasAttribute("aria-disabled")).toBe(false);
    } finally {
      document.removeEventListener("wheel", world); document.removeEventListener("pointerdown", world);
      h.canvas.remove();
    }
  });
});
