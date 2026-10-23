import { describe, expect, it, vi } from "vitest";
import type { LookState, PanoramaLookOptions } from "foss-earth/input";
import { createCockpitLook } from "./cockpitLook";

function fakeLook() {
  const attached: { options: PanoramaLookOptions; state: LookState; moving: boolean; detach: ReturnType<typeof vi.fn>;
    step: ReturnType<typeof vi.fn>; setRates: ReturnType<typeof vi.fn> }[] = [];
  const attach = vi.fn((options: PanoramaLookOptions) => {
    const entry = { options, state: options.initial, moving: false, detach: vi.fn(), step: vi.fn(() => entry.moving), setRates: vi.fn() };
    attached.push(entry);
    return {
      get: () => entry.state,
      set(state: LookState) { entry.state = state; entry.moving = false; options.onChange(state); },
      step: entry.step, moving: () => entry.moving, setRates: entry.setRates, detach: entry.detach,
    };
  });
  return { attach, attached };
}

function aircraftIn(mode: "first" | "third") {
  const aircraft = { mode, getViewMode: () => aircraft.mode, lookFromCockpit: vi.fn() };
  return aircraft;
}

describe("the cockpit's 360 look", () => {
  it("holds the canvas only while the cockpit is shown, and opens looking ahead each time", () => {
    const { attach, attached } = fakeLook();
    let current = aircraftIn("third");
    const requestRender = vi.fn();
    const look = createCockpitLook({ canvas: {} as HTMLCanvasElement, aircraft: () => current, fieldOfViewDeg: () => 70,
      inputMode: () => "trackpad", requestRender, now: () => 0, attach });
    look.sync();
    expect(attach).not.toHaveBeenCalled();

    current.mode = "first";
    look.sync();
    look.sync();
    expect(attach).toHaveBeenCalledOnce();
    expect(attached[0]!.options.initial).toEqual({ headingDeg: 0, pitchDeg: 0, verticalFovDeg: 70 });
    expect(attached[0]!.options.inputMode()).toBe("trackpad");
    expect(current.lookFromCockpit).toHaveBeenLastCalledWith({ headingDeg: 0, pitchDeg: 0, verticalFovDeg: 70 });
    attached[0]!.options.onChange({ headingDeg: 40, pitchDeg: 10, verticalFovDeg: 70 });
    expect(current.lookFromCockpit).toHaveBeenLastCalledWith({ headingDeg: 40, pitchDeg: 10, verticalFovDeg: 70 });
    expect(requestRender).toHaveBeenCalled();

    // The setting's field of view keeps where it looks.
    attached[0]!.state = { headingDeg: 40, pitchDeg: 10, verticalFovDeg: 50 };
    look.setFieldOfView(80);
    expect(current.lookFromCockpit).toHaveBeenLastCalledWith({ headingDeg: 40, pitchDeg: 10, verticalFovDeg: 80 });

    current.mode = "third";
    look.sync();
    expect(attached[0]!.detach).toHaveBeenCalledOnce();
    current.mode = "first";
    look.sync();
    expect(attach).toHaveBeenCalledTimes(2);
    expect(attached[1]!.options.initial.headingDeg).toBe(0);

    // Another aircraft opens its own cockpit looking ahead.
    const previous = current;
    current = aircraftIn("first");
    look.sync();
    expect(attached[1]!.detach).toHaveBeenCalledOnce();
    expect(attach).toHaveBeenCalledTimes(3);
    attached[2]!.options.onChange({ headingDeg: 5, pitchDeg: 0, verticalFovDeg: 70 });
    expect(current.lookFromCockpit).toHaveBeenLastCalledWith({ headingDeg: 5, pitchDeg: 0, verticalFovDeg: 70 });
    expect(previous.lookFromCockpit).not.toHaveBeenCalledWith({ headingDeg: 5, pitchDeg: 0, verticalFovDeg: 70 });

    look.dispose();
    expect(attached[2]!.detach).toHaveBeenCalledOnce();
  });

  it("steps a glide by the time since it began, and passes on a stick only when it changes", () => {
    const { attach, attached } = fakeLook();
    const aircraft = aircraftIn("first");
    let now = 1_000;
    const requestRender = vi.fn();
    const look = createCockpitLook({ canvas: {} as HTMLCanvasElement, aircraft: () => aircraft, fieldOfViewDeg: () => 60,
      inputMode: () => "mouse", requestRender, now: () => now, attach });
    look.sync();
    const binding = attached[0]!;
    look.step();
    expect(binding.step).not.toHaveBeenCalled();

    binding.moving = true;
    binding.options.requestFrame();
    now = 1_016;
    requestRender.mockClear();
    look.step();
    expect(binding.step).toHaveBeenLastCalledWith(16);
    expect(requestRender).toHaveBeenCalledOnce();
    now = 1_050;
    binding.moving = false;
    look.step();
    expect(binding.step).toHaveBeenLastCalledWith(34);
    look.step();
    expect(binding.step).toHaveBeenCalledTimes(2);

    look.setStick(1, 0);
    look.setStick(1, 0);
    look.setStick(0, 0);
    expect(binding.setRates.mock.calls).toEqual([[{ lookX: 1, lookY: 0, zoom: 0 }], [{ lookX: 0, lookY: 0, zoom: 0 }]]);
  });
});
