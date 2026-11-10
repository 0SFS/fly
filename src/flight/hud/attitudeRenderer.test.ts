// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTITUDE_HALF_SHARE, createAttitudeRenderer, describeAttitudeRendererStatus } from "./attitudeRenderer";
import type { AttitudeState } from "./attitudeIndicator";
import * as attitude from "./attitudeIndicator";
import * as webGpu from "./attitudeWebGpu";
import * as webGl2 from "./attitudeWebGl2";

const LEVEL: AttitudeState = {
  rollRad: 0, pitchRad: 0, headingRad: 0, northVelocityFps: 200, eastVelocityFps: 0, verticalSpeedFps: 0,
};
const CENTRED = { x: 0, y: 0, active: false };

/** jsdom has no canvas; this one counts what is asked of it. */
function stubCanvas() {
  const calls: string[] = [];
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) => {
    if (kind !== "2d") return null;
    return new Proxy({}, {
      get: (_, name) => (...args: unknown[]) => {
        calls.push(String(name));
        if (name === "createImageData") return { data: new Uint8ClampedArray(Number(args[0]) * Number(args[1]) * 4) };
        if (name === "measureText") return { width: 10 };
        return undefined;
      },
    });
  }) as never);
  const host = document.createElement("div");
  document.body.append(host);
  return {
    host, calls, getContext,
    canvas: () => host.querySelector("canvas")!,
    frames: () => calls.filter(name => name === "clearRect").length,
  };
}

/** A device that gets as far as building pipelines, and fails there. */
function failingDevice(): GPUDevice {
  vi.stubGlobal("GPUShaderStage", { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
  Object.defineProperty(navigator, "gpu", { configurable: true, value: { getPreferredCanvasFormat: () => "bgra8unorm" } });
  return {
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipelineAsync: () => Promise.reject(new Error("pipeline rejected")),
  } as unknown as GPUDevice;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "gpu");
});

describe("attitude renderer", () => {
  it("uses WebGL2 only when asked, mirrors each draw, and falls back on a fresh canvas after context loss", async () => {
    const gl = { render: vi.fn<webGl2.WebGl2Attitude["render"]>(), destroy: vi.fn() };
    const create = vi.spyOn(webGl2, "createWebGl2Attitude").mockReturnValue(gl);
    const t = stubCanvas();
    const renderer = createAttitudeRenderer(t.host, { preference: "webgl2" });
    await expect(renderer.ready).resolves.toBe("webgl2");
    expect(t.canvas().dataset.attitudeBackend).toBe("webgl2");
    const original = t.canvas(), copied = vi.fn();
    original.addEventListener("foss-earth:canvas-drawn", copied);
    renderer.draw(LEVEL, CENTRED);
    renderer.draw(LEVEL, { x: 0.1, y: 0, active: true });
    expect(gl.render).toHaveBeenCalledTimes(2);
    expect(gl.render.mock.calls[0]![0].horizon).toEqual([]);
    expect(copied).toHaveBeenCalledTimes(2);
    create.mock.calls[0]![1]!.onContextLost!();
    await expect(renderer.ready).resolves.toBe("canvas2d");
    expect(t.canvas()).not.toBe(original);
    expect(t.canvas().dataset.attitudeBackend).toBe("canvas2d");
    expect(renderer.status.preference).toBe("webgl2");
    expect(renderer.status.reason).toContain("lost");
    expect(t.frames()).toBe(1);
    expect(gl.destroy).toHaveBeenCalledOnce();
    renderer.destroy();
  });

  it("replaces a WebGL2 canvas after setup or first-draw failure", async () => {
    for (const setupFails of [true, false]) {
      const gl = { render: vi.fn(() => { throw new Error("draw failed"); }), destroy: vi.fn() };
      const create = vi.spyOn(webGl2, "createWebGl2Attitude").mockImplementation(() => {
        if (setupFails) throw new Error("compile failed");
        return gl;
      });
      const t = stubCanvas();
      const renderer = createAttitudeRenderer(t.host, { preference: "webgl2" });
      await renderer.ready;
      renderer.draw(LEVEL, CENTRED);
      await expect(renderer.ready).resolves.toBe("canvas2d");
      expect(t.canvas()).not.toBe(create.mock.calls[0]![0]);
      expect(t.host.querySelectorAll("canvas")).toHaveLength(1);
      expect(renderer.status.reason).toContain(setupFails ? "compile failed" : "draw failed");
      expect(t.frames()).toBe(1);
      renderer.destroy();
      vi.restoreAllMocks();
    }
  });

  it("settles on Canvas 2D when WebGL2, chosen in flight, cannot redraw the frame already shown", async () => {
    const gl = { render: vi.fn(() => { throw new Error("draw failed"); }), destroy: vi.fn() };
    vi.spyOn(webGl2, "createWebGl2Attitude").mockReturnValue(gl);
    const t = stubCanvas();
    const renderer = createAttitudeRenderer(t.host, { preference: "canvas2d" });
    await renderer.ready;
    renderer.draw(LEVEL, CENTRED);
    renderer.setPreference("webgl2");
    await expect(renderer.ready).resolves.toBe("canvas2d");
    expect(renderer.status).toEqual({ preference: "webgl2", backend: "canvas2d", reason: expect.stringContaining("draw failed") });
    expect(t.canvas().dataset.attitudeBackend).toBe("canvas2d");
    expect(t.host.querySelectorAll("canvas")).toHaveLength(1);
    expect(gl.render).toHaveBeenCalledOnce();
    expect(gl.destroy).toHaveBeenCalledOnce();
    expect(t.frames()).toBe(2);
    renderer.destroy();
  });

  it("ignores a lost-context callback after switching away from WebGL2", async () => {
    const gl = { render: vi.fn(), destroy: vi.fn() }, gpu = { render: vi.fn(), destroy: vi.fn() };
    const create = vi.spyOn(webGl2, "createWebGl2Attitude").mockReturnValue(gl);
    vi.spyOn(webGpu, "createWebGpuAttitude").mockResolvedValue(gpu);
    const t = stubCanvas();
    const renderer = createAttitudeRenderer(t.host, { preference: "webgl2", device: {} as GPUDevice });
    await renderer.ready;
    renderer.draw(LEVEL, CENTRED);
    renderer.setPreference("webgpu");
    await expect(renderer.ready).resolves.toBe("webgpu");
    create.mock.calls[0]![1]!.onContextLost!();
    expect(renderer.status.backend).toBe("webgpu");
    expect(gl.destroy).toHaveBeenCalledOnce();
    renderer.destroy();
    expect(gpu.destroy).toHaveBeenCalledOnce();
  });

  it("draws with Canvas 2D when the globe has no WebGPU device", async () => {
    const t = stubCanvas();
    const renderer = createAttitudeRenderer(t.host);
    await expect(renderer.ready).resolves.toBe("canvas2d");
    renderer.draw(LEVEL, CENTRED);
    expect(t.frames()).toBe(1);
    renderer.destroy();
  });

  it("skips a frame that would draw the same picture", async () => {
    const t = stubCanvas();
    const renderer = createAttitudeRenderer(t.host);
    await renderer.ready;
    renderer.draw(LEVEL, CENTRED);
    renderer.draw({ ...LEVEL }, { ...CENTRED });
    expect(t.frames()).toBe(1);
    renderer.draw({ ...LEVEL, rollRad: 0.1 }, CENTRED);
    renderer.draw({ ...LEVEL, rollRad: 0.1 }, { x: 0.2, y: 0, active: true });
    expect(t.frames()).toBe(3);
    renderer.destroy();
  });

  it("keeps the scene for stick-only changes, and the exact grid while velocity markers move", async () => {
    const t = stubCanvas();
    const compute = attitude.computeAttitudeScene;
    const sampled = vi.spyOn(attitude, "computeAttitudeScene");
    const renderer = createAttitudeRenderer(t.host);
    await renderer.ready;
    const state = { ...LEVEL };
    const stick = { ...CENTRED };
    renderer.draw(state, stick);
    const first = sampled.mock.results.at(-1)!.value;
    stick.x = 0.2;
    renderer.draw(state, stick);
    expect(sampled).toHaveBeenCalledOnce();
    expect(t.frames()).toBe(2);
    const projection = attitude.createAttitudeProjection(220, 220 * ATTITUDE_HALF_SHARE);
    for (const velocity of [0, -200, 3, 300]) {
      state.northVelocityFps = velocity;
      state.eastVelocityFps = velocity * 0.3;
      renderer.draw(state, stick);
      const scene = sampled.mock.results.at(-1)!.value;
      expect(sampled.mock.calls.at(-1)![2]!.lines).toBe(false);
      expect(scene.horizon).toBe(first.horizon);
      expect(scene).toEqual(compute(state, projection));
    }
    // Rotations and resizes must not keep the old grid.
    for (const axis of ["rollRad", "pitchRad", "headingRad"] as const) {
      state[axis] = 0.3;
      renderer.draw(state, stick);
      expect(sampled.mock.calls.at(-1)![2]!.lines).toBe(true);
      expect(sampled.mock.results.at(-1)!.value.horizon).not.toBe(first.horizon);
      expect(sampled.mock.results.at(-1)!.value).toEqual(compute(state, projection));
    }
    vi.stubGlobal("devicePixelRatio", 2);
    renderer.draw(state, stick);
    expect(sampled.mock.calls.at(-1)![2]!.lines).toBe(true);
    renderer.destroy();
  });

  it("draws again when the camera it is drawn from turns, though the aircraft holds still", async () => {
    const t = stubCanvas();
    const renderer = createAttitudeRenderer(t.host);
    await renderer.ready;
    const ahead = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const east = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    renderer.draw(LEVEL, CENTRED, ahead);
    renderer.draw(LEVEL, CENTRED, [...ahead]);
    expect(t.frames()).toBe(1);
    renderer.draw(LEVEL, CENTRED, east);
    expect(t.frames()).toBe(2);
    // Back to the aircraft's own frame.
    renderer.draw(LEVEL, CENTRED, null);
    expect(t.frames()).toBe(3);
    renderer.destroy();
  });

  it("redraws WebGPU and notifies the cockpit mirror even when it reuses a stick-only scene", async () => {
    const gpu = { render: vi.fn<webGpu.WebGpuAttitude["render"]>(), destroy: vi.fn() };
    vi.spyOn(webGpu, "createWebGpuAttitude").mockResolvedValue(gpu);
    const t = stubCanvas();
    const renderer = createAttitudeRenderer(t.host, { device: {} as GPUDevice });
    await expect(renderer.ready).resolves.toBe("webgpu");
    const copied = vi.fn();
    t.canvas().addEventListener("foss-earth:canvas-drawn", copied);
    renderer.draw(LEVEL, CENTRED);
    const first = gpu.render.mock.calls[0]![0];
    renderer.draw(LEVEL, { x: 0.2, y: 0, active: true });
    expect(gpu.render).toHaveBeenCalledTimes(2);
    expect(gpu.render.mock.calls[1]![0]).toBe(first);
    expect(gpu.render.mock.calls[1]![1]).toEqual({ x: 0.2, y: 0, active: true });
    renderer.draw({ ...LEVEL, eastVelocityFps: 150 }, CENTRED);
    const next = gpu.render.mock.calls[2]![0];
    expect(next).not.toBe(first);
    expect(next.markers).not.toEqual(first.markers);
    expect(next.horizon).toEqual([]);
    expect(copied).toHaveBeenCalledTimes(3);
    renderer.destroy();
    expect(gpu.destroy).toHaveBeenCalledOnce();
  });

  it("falls back to Canvas 2D, and draws the frame it was holding, when WebGPU cannot build", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = stubCanvas();
    const renderer = createAttitudeRenderer(t.host, { device: failingDevice() });
    // Asked to draw before the backend is known: held, not dropped.
    renderer.draw(LEVEL, CENTRED);
    expect(t.frames()).toBe(0);
    await expect(renderer.ready).resolves.toBe("canvas2d");
    expect(t.frames()).toBe(1);
    // The canvas was never claimed for WebGPU, or 2D could not have it.
    expect(t.getContext.mock.calls.map(([kind]) => kind)).not.toContain("webgpu");
    renderer.destroy();
  });

  it("sizes the backing store to the screen's pixel density", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const t = stubCanvas();
    const renderer = createAttitudeRenderer(t.host);
    await renderer.ready;
    renderer.draw(LEVEL, CENTRED);
    expect([t.canvas().width, t.canvas().height]).toEqual([440, 440]);
    renderer.destroy();
  });

  it("draws into a canvas of its own, which the host keeps the pointer for", async () => {
    const t = stubCanvas();
    const renderer = createAttitudeRenderer(t.host);
    await renderer.ready;
    expect(t.host.children).toHaveLength(1);
    expect(t.canvas().style.pointerEvents).toBe("none");
    renderer.destroy();
    expect(t.host.children).toHaveLength(0);
  });

  it("switches backend on a fresh canvas and redraws the last frame, even while paused", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = stubCanvas();
    const statuses: unknown[] = [];
    const renderer = createAttitudeRenderer(t.host, { device: failingDevice(), preference: "canvas2d", onStatusChange: status => statuses.push(status) });
    await renderer.ready;
    renderer.draw(LEVEL, CENTRED);
    const first = t.canvas();
    renderer.setPreference("webgpu");
    await expect(renderer.ready).resolves.toBe("canvas2d");
    expect(t.canvas()).not.toBe(first);
    expect(t.host.querySelectorAll("canvas")).toHaveLength(1);
    // No new draw call came in, yet the new canvas shows the aircraft.
    expect(t.frames()).toBe(2);
    expect(renderer.status).toEqual({
      preference: "webgpu", backend: "canvas2d", reason: "WebGPU could not build the instrument's pipelines here.",
    });
    expect(statuses.at(-1)).toEqual(renderer.status);
    renderer.destroy();
  });

  it("says why when WebGPU is asked for and the globe runs on WebGL", async () => {
    const t = stubCanvas();
    const renderer = createAttitudeRenderer(t.host, { preference: "webgpu" });
    await expect(renderer.ready).resolves.toBe("canvas2d");
    expect(renderer.status.reason).toMatch(/WebGL/);
    renderer.destroy();
  });

  it("draws nothing once destroyed", async () => {
    const t = stubCanvas();
    const renderer = createAttitudeRenderer(t.host);
    await renderer.ready;
    renderer.destroy();
    renderer.draw(LEVEL, CENTRED);
    expect(t.frames()).toBe(0);
  });
});

describe("attitude renderer status note", () => {
  it("says what draws, and why it is not what was asked for", () => {
    expect(describeAttitudeRendererStatus({ preference: "auto", backend: null, reason: null })).toBeNull();
    expect(describeAttitudeRendererStatus({ preference: "auto", backend: "webgpu", reason: null }))
      .toBe("Drawing with WebGPU, on the globe's GPU device.");
    expect(describeAttitudeRendererStatus({ preference: "webgpu", backend: "canvas2d", reason: "WebGPU is unavailable." }))
      .toBe("Drawing with Canvas 2D. WebGPU is unavailable.");
  });
});
