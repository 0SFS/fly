// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { MeshBuilder, NullEngine, Scene } from "@babylonjs/core";
import { fitRect, MIRROR_MAIN_THREAD_SHARE, nextMirrorAt, pageAt, pointAtUv, screenAspect, screenIncludes, textureAt } from "./cockpitScreen";

const engines: NullEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  document.body.innerHTML = "";
});

describe("the page's picture on the cockpit screen", () => {
  it("is as large as fits, centred: a wider screen leaves bars at its sides", () => {
    expect(fitRect({ width: 1280, height: 800 }, { width: 1280, height: 540 })).toEqual({ x: 208, y: 0, width: 864, height: 540 });
    expect(fitRect({ width: 800, height: 800 }, { width: 400, height: 800 })).toEqual({ x: 0, y: 200, width: 400, height: 400 });
  });

  it("is pressed where it is touched, and not on the bars", () => {
    const viewport = { width: 1280, height: 800 }, texture = { width: 1280, height: 540 };
    expect(pageAt(0.5, 0.5, viewport, texture)).toEqual({ x: 640, y: 400 });
    // The texture's top row is at v = 0, as the page's.
    expect(pageAt(208 / 1280, 0, viewport, texture)).toEqual({ x: 0, y: 0 });
    expect(pageAt(0.05, 0.5, viewport, texture)).toBeNull();
    expect(pageAt(0.5, 0.5, viewport, { width: 0, height: 0 })).toBeNull();
  });

  it("shows a point of the page where pressing it presses that point", () => {
    const viewport = { width: 1280, height: 800 }, texture = { width: 1280, height: 540 };
    const uv = textureAt(320, 600, viewport, texture)!;
    const page = pageAt(uv.u, uv.v, viewport, texture)!;
    expect(page.x).toBeCloseTo(320, 9);
    expect(page.y).toBeCloseTo(600, 9);
    expect(textureAt(0, 0, viewport, { width: 0, height: 0 })).toBeNull();
  });

  it("is on the screen's mesh where its texture has that point", () => {
    // A quad 2 m by 1 m standing at z = 3, its texture's top left at its top left.
    const positions = [-1, 0.5, 3, 1, 0.5, 3, 1, -0.5, 3, -1, -0.5, 3];
    const uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    const indices = [0, 1, 2, 0, 2, 3];
    expect(pointAtUv(positions, uvs, indices, 0.5, 0.5)).toEqual([0, 0, 3]);
    const corner = pointAtUv(positions, uvs, indices, 0.25, 0.75)!;
    [-0.5, -0.25, 3].forEach((value, i) => expect(corner[i]).toBeCloseTo(value, 9));
    expect(pointAtUv(positions, uvs, indices, 1.5, 0.5)).toBeNull();
  });
});

describe("the cockpit screen's shape", () => {
  it("is its mesh's two longest sides in the world, the longer across: the F-35B's 0.54 m by 0.23 m", () => {
    const engine = new NullEngine();
    engines.push(engine);
    const scene = new Scene(engine);
    // The F-35B's panel quad: ±1.2151 by ±0.5 in its own space, scaled by its node.
    const panel = MeshBuilder.CreateGround("panel", { width: 2.4302, height: 1 }, scene);
    panel.scaling.set(0.2206, 0.2263, 0.2263);
    expect(screenAspect(panel)).toBeCloseTo((2.4302 * 0.2206) / 0.2263, 3);
  });
});

describe("what the cockpit screen shows of the page", () => {
  const parts = { instruments: ".hud", toolbar: ".bar", windows: ".windows" };
  const page = () => {
    document.body.innerHTML = `<canvas class="view"></canvas><div class="hud"></div><div class="bar"></div><div class="windows"></div>`;
    return (selector: string) => document.querySelector(selector)!;
  };

  it("is every part on the screen, never the 3D view", () => {
    const element = page();
    const includes = screenIncludes(parts, ".view", { instruments: "screen", toolbar: "screen", windows: "screen" });
    expect([".view", ".hud", ".bar", ".windows"].map(selector => includes(element(selector)))).toEqual([false, true, true, true]);
  });

  it("leaves out each part placed in the HUD", () => {
    const element = page();
    const includes = screenIncludes(parts, ".view", { instruments: "hud", toolbar: "screen", windows: "hud" });
    expect([".view", ".hud", ".bar", ".windows"].map(selector => includes(element(selector)))).toEqual([false, false, true, false]);
    expect(screenIncludes(parts, "", { instruments: "screen", toolbar: "screen", windows: "screen" })(element(".view"))).toBe(true);
  });
});

describe("copies of the page for the cockpit screen", () => {
  it("wait the refresh interval, or longer to keep their share of the main thread", () => {
    expect(nextMirrorAt(1000, 1, 30)).toBeCloseTo(1000 + 1000 / 30);
    // A copy that took 5 ms waits for 5 ms / 5 % = 100 ms.
    expect(MIRROR_MAIN_THREAD_SHARE).toBe(0.05);
    expect(nextMirrorAt(1000, 5, 30)).toBeCloseTo(1100);
  });
});
