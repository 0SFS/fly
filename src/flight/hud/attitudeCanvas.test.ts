import { describe, expect, it } from "vitest";
import { createCanvasAttitudePainter, drawLabelGlyph } from "./attitudeCanvas";
import {
  angleForRadius,
  bodyToLocal,
  colourAtElevation,
  computeAttitudeScene,
  createAttitudeProjection,
  labelFontPx,
  type AttitudeProjection,
  type AttitudeScene,
  type AttitudeState,
  type Vec3,
} from "./attitudeIndicator";

const DEG = Math.PI / 180;
/** No stick, so the painter ends with the markers. */
const STILL = { x: 0, y: 0, active: false };

type State = {
  font: string; fillStyle: string; strokeStyle: string; lineWidth: number; lineJoin: string; lineCap: string;
  textAlign: string; textBaseline: string; globalAlpha: number; imageSmoothingEnabled: boolean;
  transform: number[];
};

/** Records the state each text draw sees, and copies every image put, through save and restore. */
class RecordingContext {
  declare font: string;
  declare fillStyle: string;
  declare strokeStyle: string;
  declare lineWidth: number;
  state: State = {
    font: "10px sans-serif", fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, lineJoin: "miter", lineCap: "butt",
    textAlign: "start", textBaseline: "alphabetic", globalAlpha: 1, imageSmoothingEnabled: true,
    transform: [1, 0, 0, 1, 0, 0],
  };
  stack: State[] = [];
  texts: Array<{ op: string; text: string; x: number; y: number; state: Partial<State> }> = [];
  images: Uint32Array[] = [];
  constructor() {
    for (const key of Object.keys(this.state) as Array<keyof State>) {
      if (key === "transform") continue;
      Object.defineProperty(this, key, { get: () => this.state[key], set: value => { (this.state as Record<string, unknown>)[key] = value; } });
    }
    return new Proxy(this, { get: (target, key) => key in target ? target[key as keyof this] : () => {} });
  }
  save() { this.stack.push({ ...this.state, transform: [...this.state.transform] }); }
  restore() { const top = this.stack.pop(); if (top) this.state = top; }
  translate(x: number, y: number) {
    const [a, b, c, d, e, f] = this.state.transform;
    this.state.transform = [a, b, c, d, a * x + c * y + e, b * x + d * y + f];
  }
  rotate(angle: number) {
    const [a, b, c, d, e, f] = this.state.transform;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    this.state.transform = [a * cos + c * sin, b * cos + d * sin, c * cos - a * sin, d * cos - b * sin, e, f];
  }
  strokeText(text: string, x: number, y: number) { this.record("stroke", text, x, y); }
  fillText(text: string, x: number, y: number) { this.record("fill", text, x, y); }
  createImageData(width: number, height: number) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
  putImageData(image: { data: Uint8ClampedArray }) { this.images.push(new Uint32Array(image.data.slice().buffer)); }
  /** Only what each draw reads: a stroke ignores the fill, and a fill the line. */
  private record(op: "stroke" | "fill", text: string, x: number, y: number) {
    const { fillStyle, strokeStyle, lineWidth, lineJoin, lineCap, ...shared } = this.state;
    const own = op === "stroke" ? { strokeStyle, lineWidth, lineJoin, lineCap } : { fillStyle };
    this.texts.push({ op, text, x, y, state: { ...shared, ...own, transform: [...this.state.transform] } });
  }
}

function fakeDocument(field: RecordingContext): Document {
  return { createElement: () => ({ width: 0, height: 0, getContext: () => field }) } as unknown as Document;
}

function state(overrides: Partial<AttitudeState> = {}): AttitudeState {
  return { rollRad: 0, pitchRad: 0, headingRad: 0, northVelocityFps: 200, eastVelocityFps: 0, verticalSpeedFps: 0, ...overrides };
}

const STEPS = 1024;
/** The colourmap as the painter builds it. */
const COLOURMAP = (() => {
  const words = new Uint32Array(STEPS + 1);
  const bytes = new Uint8Array(words.buffer);
  for (let index = 0; index <= STEPS; index++) {
    const sine = index / STEPS * 2 - 1;
    const [r, g, b] = colourAtElevation(Math.asin(Math.max(-1, Math.min(1, sine))) / DEG);
    bytes.set([r, g, b, 255], index * 4);
  }
  return words;
})();

/** The sky and ground before 15330a3: every pixel's direction kept and shaded on its own. */
function referenceSky(projection: AttitudeProjection, [ux, uy, uz]: Vec3): Uint32Array {
  const side = Math.max(1, Math.ceil(2 * projection.half));
  const pxPerCell = 2 * projection.half / side;
  const pixels = new Uint32Array(side * side);
  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      const u = (column + 0.5 - side / 2) * pxPerCell;
      const v = (row + 0.5 - side / 2) * pxPerCell;
      const radius = Math.hypot(u, v);
      const angle = angleForRadius(projection, radius);
      const lateral = radius > 0 ? Math.sin(angle) / radius : 0;
      const sine = Math.fround(Math.cos(angle)) * ux + Math.fround(u * lateral) * uy + Math.fround(v * lateral) * uz;
      pixels[row * side + column] = COLOURMAP[Math.max(0, Math.min(STEPS, Math.round((sine + 1) * (STEPS / 2))))]!;
    }
  }
  return pixels;
}

/** The labels before 15330a3: each saved, placed and drawn by `drawLabelGlyph` on its own. */
function referenceLabels(scene: AttitudeScene, before: (ctx: RecordingContext) => void): RecordingContext["texts"] {
  const ctx = new RecordingContext();
  before(ctx);
  const fontPx = labelFontPx(scene.projection);
  for (const label of scene.labels) {
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate(Math.round(label.angle / DEG) * DEG);
    drawLabelGlyph(ctx as unknown as CanvasRenderingContext2D, label.text, label.kind, fontPx);
    ctx.restore();
  }
  return ctx.texts;
}

// Odd and even sides, and sizes from a phone's to a large desktop's.
const PROJECTIONS = [
  createAttitudeProjection(220, 96), createAttitudeProjection(160, 72), createAttitudeProjection(96, 43.2),
  createAttitudeProjection(300, 135), createAttitudeProjection(101, 45.25), createAttitudeProjection(64, 20.5),
  createAttitudeProjection(8, 0.4),
];
const ANGLES = [0, 1e-9, 0.3, 45 * DEG, 89.999 * DEG, 90 * DEG, 135 * DEG, 180 * DEG, -30 * DEG, -90 * DEG, -179.9 * DEG];

function* scenes(): Generator<AttitudeScene> {
  let call = 0;
  for (const roll of ANGLES) for (const pitch of [0, 0.3, 89.999 * DEG, -45 * DEG, -90 * DEG]) {
    const flying = state({ rollRad: roll, pitchRad: pitch, headingRad: roll * 0.7 });
    const projection = PROJECTIONS[call++ % PROJECTIONS.length]!;
    yield computeAttitudeScene(flying, projection);
    yield computeAttitudeScene(flying, projection, { view: bodyToLocal(0, pitch * 0.5, roll + 180 * DEG) });
  }
}

describe("attitude painter on Canvas 2D", () => {
  it("shades every pixel of the sky and ground as shading each on its own did, at odd and even sizes", () => {
    const field = new RecordingContext();
    const paint = createCanvasAttitudePainter(fakeDocument(field));
    const sides = new Set<number>();
    let compared = 0;
    for (const scene of scenes()) {
      paint(new RecordingContext() as unknown as CanvasRenderingContext2D, scene, STILL);
      const painted = field.images.at(-1)!;
      const expected = referenceSky(scene.projection, scene.up);
      expect(painted.length).toBe(expected.length);
      for (let index = 0; index < expected.length; index++) {
        if (painted[index] !== expected[index]) expect.fail(`pixel ${index} of ${expected.length}: ${painted[index]} vs ${expected[index]}`);
      }
      sides.add(Math.sqrt(expected.length) % 2);
      compared += expected.length;
    }
    expect([...sides].sort()).toEqual([0, 1]);
    expect(compared).toBeGreaterThan(1_000_000);
  });

  it("draws every label with the state and placement drawing each through drawLabelGlyph gave it", () => {
    let labels = 0;
    for (const scene of scenes()) {
      const ctx = new RecordingContext();
      const paint = createCanvasAttitudePainter(fakeDocument(new RecordingContext()));
      paint(ctx as unknown as CanvasRenderingContext2D, scene, STILL);
      // What the painter leaves set when it reaches the labels: the frame's outline.
      const expected = referenceLabels(scene, reference => {
        reference.strokeStyle = "rgba(255, 255, 255, 0.7)";
        reference.lineWidth = 1.5;
      });
      expect(ctx.texts).toEqual(expected);
      expect(ctx.stack.length).toBe(0);
      labels += scene.labels.length;
    }
    expect(labels).toBeGreaterThan(500);
  });
});
