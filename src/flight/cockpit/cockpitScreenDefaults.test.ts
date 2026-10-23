import { describe, expect, it, vi } from "vitest";
import type { SettingsRegistry } from "foss-earth/settings";
import { applyFastestComputerCockpitDefaults, notFastestComputerReason } from "./cockpitScreenDefaults";

const fastest = { rendererMode: "webgpu", hardwareConcurrency: 16, deviceMemoryGiB: 8, touch: false } as const;

describe("the cockpit screen's chase view by default", () => {
  it("is for the fastest computers", () => {
    expect(notFastestComputerReason(fastest)).toBeNull();
    expect(notFastestComputerReason({ ...fastest, hardwareConcurrency: 24 })).toBeNull();
  });

  it("is not for any other, and says why", () => {
    expect(notFastestComputerReason({ ...fastest, rendererMode: "webgl2" })).toBe("it draws with WebGL");
    expect(notFastestComputerReason({ ...fastest, touch: true })).toBe("it has a touch screen");
    // A fanless M5 MacBook Air reports 10 threads.
    expect(notFastestComputerReason({ ...fastest, hardwareConcurrency: 10 })).toBe("it reports 10 processor threads, under 16");
    expect(notFastestComputerReason({ ...fastest, hardwareConcurrency: null })).toBe("it does not say how many processor threads it has");
    // Safari reports no memory.
    expect(notFastestComputerReason({ ...fastest, deviceMemoryGiB: null })).toBe("it does not say how much memory it has");
    expect(notFastestComputerReason({ ...fastest, deviceMemoryGiB: 4 })).toBe("it reports 4 GiB of memory, under 8 GiB");
  });

  it("becomes the host's default only on one of them", () => {
    const settings = (context: object) => ({ getDeviceContext: () => context, setHostDefault: vi.fn() });
    const fast = settings(fastest);
    applyFastestComputerCockpitDefaults(fast as unknown as SettingsRegistry);
    expect(fast.setHostDefault).toHaveBeenCalledWith("osfs.cockpit.screen.background", "chase", expect.stringContaining("16 processor threads and 8 GiB"));
    const slow = settings({ ...fastest, hardwareConcurrency: 10 });
    applyFastestComputerCockpitDefaults(slow as unknown as SettingsRegistry);
    expect(slow.setHostDefault).not.toHaveBeenCalled();
  });
});
