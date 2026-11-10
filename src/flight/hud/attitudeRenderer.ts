import { noteCanvasDrawn } from "@foss-earth/ui/browser";
import { INSTRUMENT_STICK_HALF_SHARE } from "@0sfs/controls/centeredStick";
import type { FrameProfiler } from "foss-earth/perf";
import {
  computeAttitudeScene,
  createAttitudeProjection,
  type AttitudeProjection,
  type AttitudeScene,
  type AttitudeState,
  type AttitudeView,
} from "./attitudeIndicator";
import { createCanvasAttitudePainter, type AttitudeStick } from "./attitudeCanvas";
import { createWebGpuAttitude, type WebGpuAttitude } from "./attitudeWebGpu";
import { createWebGl2Attitude, type WebGl2Attitude } from "./attitudeWebGl2";

/** The instrument's half side as a share of its canvas's side; the rest is the gap to the levers beside it. */
export const ATTITUDE_HALF_SHARE = INSTRUMENT_STICK_HALF_SHARE;

export type AttitudeBackend = "webgpu" | "webgl2" | "canvas2d";
export const ATTITUDE_BACKEND_LABELS: Readonly<Record<AttitudeBackend, string>> = {
  webgpu: "WebGPU", webgl2: "WebGL2", canvas2d: "Canvas 2D",
};
/** What the pilot asked for in Settings. Auto is WebGPU wherever the globe has it. */
export type AttitudeRendererPreference = "auto" | AttitudeBackend;
export const ATTITUDE_RENDERER_PREFERENCES: readonly AttitudeRendererPreference[] = ["auto", "webgpu", "webgl2", "canvas2d"];

export function isAttitudeRendererPreference(value: unknown): value is AttitudeRendererPreference {
  return ATTITUDE_RENDERER_PREFERENCES.includes(value as AttitudeRendererPreference);
}

export interface AttitudeRendererStatus {
  preference: AttitudeRendererPreference;
  /** What draws now; null while it is being set up. */
  backend: AttitudeBackend | null;
  /** Why the backend is not the one asked for, when it is not. */
  reason: string | null;
}

/**
 * What the instrument draws with, for the note under Renderer → Instruments →
 * Attitude indicator; null while it is being set up.
 */
export function describeAttitudeRendererStatus(status: AttitudeRendererStatus): string | null {
  if (!status.backend) return null;
  const drawing = status.backend === "webgpu" ? "WebGPU, on the globe's GPU device"
    : status.backend === "webgl2" ? "WebGL2 (experimental), on the indicator's canvas" : "Canvas 2D";
  return status.reason ? `Drawing with ${drawing}. ${status.reason}` : `Drawing with ${drawing}.`;
}

export interface AttitudeRenderer {
  /** Which backend draws, once the current choice is settled. */
  readonly ready: Promise<AttitudeBackend>;
  readonly status: AttitudeRendererStatus;
  /** Draws the instrument from `view`, such as the 3D camera's, or from the aircraft's when it is null. */
  draw(state: AttitudeState, stick: AttitudeStick, view?: AttitudeView | null): void;
  setPreference(preference: AttitudeRendererPreference): void;
  destroy(): void;
}

export interface AttitudeRendererOptions {
  /**
   * The globe's WebGPU device, when it has one. Shared, not a second device:
   * the instrument's work joins the globe's queue instead of competing with it.
   */
  device?: GPUDevice | null;
  preference?: AttitudeRendererPreference;
  onStatusChange?(status: AttitudeRendererStatus): void;
  /** Where the instrument's CPU time goes, as `flight/hud/attitude`, and its GPU time, as `gpu/attitude indicator`. */
  profiler?: FrameProfiler | null;
}

const PROFILE_SECTION = "flight/hud/attitude";

type Backend =
  | { kind: "webgpu" | "webgl2"; gpu: WebGpuAttitude | WebGl2Attitude }
  | { kind: "canvas2d"; ctx: CanvasRenderingContext2D; paint: ReturnType<typeof createCanvasAttitudePainter> };

/**
 * Draws the attitude indicator into a canvas of its own inside `host`, on the
 * GPU when the globe runs on WebGPU and in Canvas 2D otherwise, at the
 * screen's pixel density. Changing the preference replaces the canvas: one
 * that has had a WebGPU context can never have a 2D one.
 *
 * A frame whose inputs match the last one drawn is skipped: both kinds of
 * canvas keep showing their last image, so a paused or parked aircraft costs
 * nothing.
 */
export function createAttitudeRenderer(host: HTMLElement, options: AttitudeRendererOptions = {}): AttitudeRenderer {
  const device = options.device ?? null;
  const profiler = options.profiler ?? null;
  let cssSize = host.clientWidth || 220;
  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) cssSize = entry.contentRect.width;
    })
    : null;
  resizeObserver?.observe(host);

  let status: AttitudeRendererStatus = { preference: options.preference ?? "auto", backend: null, reason: null };
  let canvas: HTMLCanvasElement | null = null;
  let backend: Backend | null = null;
  let projection: AttitudeProjection | null = null;
  let scene: AttitudeScene | null = null;
  /** The last frame asked for, redrawn when a new backend takes over, even while the sim is paused. */
  let last: [AttitudeState, AttitudeStick, AttitudeView | null] | null = null;
  let destroyed = false;
  /** Bumped on every change of backend, so a setup that finishes late knows it was superseded. */
  let generation = 0;
  /** What the last frame drew from: size, attitude, velocity, stick, then whether a view was given and its nine numbers. */
  const drawn = new Float64Array(21).fill(Number.NaN);

  const publish = (next: AttitudeRendererStatus): void => {
    status = next;
    options.onStatusChange?.({ ...status });
  };

  const freshCanvas = (): HTMLCanvasElement => {
    canvas?.remove();
    const next = host.ownerDocument.createElement("canvas");
    next.className = "flight-hud__attitude-canvas";
    // The host takes the pointer and the focus; the canvas only shows the picture.
    next.style.cssText = "display:block;width:100%;height:100%;pointer-events:none";
    next.width = next.height = Math.max(1, Math.round(cssSize));
    host.append(next);
    canvas = next;
    scene = null;
    drawn.fill(Number.NaN);
    return next;
  };

  const startCanvas2d = (target: HTMLCanvasElement): Backend => {
    const ctx = target.getContext("2d");
    if (!ctx) throw new Error("Flight HUD canvas context unavailable.");
    return { kind: "canvas2d", ctx, paint: createCanvasAttitudePainter(target.ownerDocument) };
  };

  const draw = (state: AttitudeState, stick: AttitudeStick, view: AttitudeView | null = null): void => {
    if (destroyed) return;
    last = [state, stick, view];
    if (!backend || !canvas) return;
    // The UI scale zooms the HUD, so a CSS pixel here covers fewer device pixels.
    const pixelRatio = Math.min(3, Math.max(1, (globalThis.devicePixelRatio || 1) * (host.currentCSSZoom || 1)));
    const backing = Math.max(1, Math.round(cssSize * pixelRatio));
    let changed = false, sceneChanged = false, gridChanged = false;
    const note = (index: number, value: number): void => {
      if (Object.is(drawn[index], value)) return;
      drawn[index] = value;
      changed = true;
      // The stick is drawn over the scene; velocity affects only its markers.
      if (index < 8 || index > 10) sceneChanged = true;
      if (index < 5 || index > 10) gridChanged = true;
    };
    note(0, backing);
    note(1, cssSize);
    note(2, state.rollRad);
    note(3, state.pitchRad);
    note(4, state.headingRad);
    note(5, state.northVelocityFps);
    note(6, state.eastVelocityFps);
    note(7, state.verticalSpeedFps);
    note(8, stick.x);
    note(9, stick.y);
    note(10, stick.active ? 1 : 0);
    // A camera that orbits turns the ball while the aircraft holds still.
    note(11, view ? 1 : 0);
    for (let index = 0; index < 9; index++) note(12 + index, view?.[index] ?? 0);
    if (!changed) return;

    const started = profiler?.clock() ?? 0;
    if (canvas.width !== backing || canvas.height !== backing) {
      canvas.width = backing;
      canvas.height = backing;
    }
    if (projection?.size !== cssSize) projection = createAttitudeProjection(cssSize, cssSize * ATTITUDE_HALF_SHARE);
    if (sceneChanged || !scene) {
      const previous = scene;
      scene = computeAttitudeScene(state, projection, { lines: backend.kind === "canvas2d" && (gridChanged || !previous), view });
      // A new velocity moves the markers, but every grid point still has the
      // same view and projection. These arrays stay private to this renderer.
      if (backend.kind === "canvas2d" && !gridChanged && previous) {
        scene.horizon = previous.horizon;
        scene.skyRings = previous.skyRings;
        scene.groundRings = previous.groundRings;
        scene.meridians = previous.meridians;
        scene.cardinalMeridians = previous.cardinalMeridians;
        scene.ticks = previous.ticks;
      }
    }
    if (backend.kind !== "canvas2d") {
      try { backend.gpu.render(scene, stick, backing / cssSize); }
      catch (error) {
        if (backend.kind !== "webgl2") throw error;
        ready = Promise.resolve(fallback(`WebGL2 could not draw here: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      // Its picture lasts only this task: a copy of the page, such as the cockpit screen's, takes it now.
      noteCanvasDrawn(canvas);
    } else {
      backend.ctx.setTransform(backing / cssSize, 0, 0, backing / cssSize, 0, 0);
      backend.ctx.clearRect(0, 0, cssSize, cssSize);
      backend.paint(backend.ctx, scene, stick);
    }
    profiler?.add(PROFILE_SECTION, started);
  };

  const settle = (next: Backend, reason: string | null): AttitudeBackend => {
    backend = next;
    if (canvas) canvas.dataset.attitudeBackend = next.kind;
    publish({ preference: status.preference, backend: next.kind, reason });
    if (last) draw(...last);
    // That first draw may already have replaced a WebGL2 backend that could not draw.
    return backend?.kind ?? next.kind;
  };

  const fallback = (reason: string): AttitudeBackend => {
    if (backend && backend.kind !== "canvas2d") backend.gpu.destroy();
    backend = null;
    return settle(startCanvas2d(freshCanvas()), reason);
  };

  const choose = (preference: AttitudeRendererPreference): Promise<AttitudeBackend> => {
    const mine = ++generation;
    if (backend && backend.kind !== "canvas2d") backend.gpu.destroy();
    backend = null;
    publish({ preference, backend: null, reason: null });
    const target = freshCanvas();
    if (preference === "canvas2d") return Promise.resolve(settle(startCanvas2d(target), null));
    if (preference === "webgl2") {
      try {
        const gl = createWebGl2Attitude(target, {
          profiler,
          onContextLost() {
            if (destroyed || mine !== generation || backend?.kind !== "webgl2") return;
            ready = Promise.resolve(fallback("WebGL2 lost its drawing context."));
          },
        });
        if (gl) return Promise.resolve(settle({ kind: "webgl2", gpu: gl }, null));
      } catch (error) {
        return Promise.resolve(fallback(`WebGL2 could not start here: ${error instanceof Error ? error.message : String(error)}`));
      }
      return Promise.resolve(fallback("WebGL2 is not available to the indicator."));
    }
    if (!device) {
      const reason = preference === "webgpu" ? "The globe is running on WebGL, so WebGPU is not available to the instrument." : null;
      return Promise.resolve(settle(startCanvas2d(target), reason));
    }
    return createWebGpuAttitude(target, device, { profiler, section: "gpu/attitude indicator" })
      .catch((error: unknown) => {
        console.warn("Attitude indicator: WebGPU unavailable; drawing with Canvas 2D instead.", error);
        return null;
      })
      .then(created => {
        if (destroyed || mine !== generation) {
          created?.destroy();
          return created ? "webgpu" : "canvas2d";
        }
        return created
          ? settle({ kind: "webgpu", gpu: created }, null)
          : settle(startCanvas2d(target), "WebGPU could not build the instrument's pipelines here.");
      });
  };

  let ready = choose(status.preference);

  return {
    get ready() {
      return ready;
    },
    get status() {
      return { ...status };
    },
    draw,
    setPreference(preference) {
      if (destroyed || preference === status.preference) return;
      ready = choose(preference);
    },
    destroy() {
      destroyed = true;
      generation++;
      resizeObserver?.disconnect();
      if (backend && backend.kind !== "canvas2d") backend.gpu.destroy();
      backend = null;
      canvas?.remove();
      canvas = null;
    },
  };
}
