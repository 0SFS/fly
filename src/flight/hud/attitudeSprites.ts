import { allAttitudeLabels, type AttitudeMarkerKind, type AttitudeScene } from "./attitudeIndicator";
import {
  PINNED_ALPHA, STICK_CROSSHAIR_ALPHA, aircraftSymbolReach, drawAircraftSymbolGlyph,
  drawLabelGlyph, drawMarkerGlyph, drawStickKnobGlyph, labelFont, markerReach,
  stickKnobReach, stickShown, type AttitudeStick,
} from "./attitudeCanvas";

const DEG = Math.PI / 180;
/** Centre xy, half size xy, atlas uv rect, cos/sin of the turn, alpha, padding. */
export const ATTITUDE_SPRITE_FLOATS = 12;
export const ATTITUDE_MAX_SPRITES = 128;
const SPRITE_FLOATS = ATTITUDE_SPRITE_FLOATS;
const MAX_SPRITES = ATTITUDE_MAX_SPRITES;

export interface AtlasEntry {
  uv: [number, number, number, number];
  /** Half the sprite's size in CSS px, exactly its cell in device px. */
  halfWidth: number;
  halfHeight: number;
}

interface AtlasSprite {
  key: string;
  halfWidth: number;
  halfHeight: number;
  draw(ctx: CanvasRenderingContext2D): void;
}

const MARKER_KINDS: AttitudeMarkerKind[] = ["prograde", "retrograde", "normal", "anti-normal", "radial-out", "radial-in"];

/** Letters every sprite the instrument can show into one canvas, at the screen's pixel density. */
export function letterAttitudeAtlas(doc: Document, fontPx: number, scale: number, pixelRatio: number) {
  const measure = doc.createElement("canvas").getContext("2d");
  const sprites: AtlasSprite[] = [];
  for (const { text, kind } of allAttitudeLabels()) {
    let width = text.length * fontPx * 0.62;
    if (measure) {
      measure.font = labelFont(kind, fontPx);
      width = measure.measureText(text).width;
    }
    sprites.push({
      key: `label:${kind}:${text}`, halfWidth: width / 2 + 2, halfHeight: fontPx / 2 + 3,
      draw: ctx => drawLabelGlyph(ctx, text, kind, fontPx),
    });
  }
  for (const kind of MARKER_KINDS) {
    const reach = markerReach(scale);
    sprites.push({ key: `marker:${kind}`, halfWidth: reach, halfHeight: reach, draw: ctx => drawMarkerGlyph(ctx, kind, scale) });
  }
  const symbol = aircraftSymbolReach(scale);
  sprites.push({
    key: "symbol", halfWidth: symbol.x, halfHeight: Math.max(symbol.up, symbol.down),
    draw: ctx => drawAircraftSymbolGlyph(ctx, scale),
  });
  for (const active of [false, true]) {
    const reach = stickKnobReach(scale);
    sprites.push({ key: `knob:${active}`, halfWidth: reach, halfHeight: reach, draw: ctx => drawStickKnobGlyph(ctx, scale, active) });
  }
  sprites.push({
    key: "white", halfWidth: 2 / pixelRatio, halfHeight: 2 / pixelRatio,
    draw: ctx => { ctx.fillStyle = "#fff"; ctx.fillRect(-2, -2, 4, 4); },
  });

  // Shelves, two device px apart so filtering never reaches a neighbour.
  const gap = 2;
  const cells = sprites.map(sprite => ({
    sprite,
    width: Math.ceil(sprite.halfWidth * 2 * pixelRatio),
    height: Math.ceil(sprite.halfHeight * 2 * pixelRatio),
    x: 0,
    y: 0,
  }));
  const atlasWidth = Math.max(512, ...cells.map(cell => cell.width + 2 * gap));
  let x = gap, y = gap, shelf = 0;
  for (const cell of cells) {
    if (x + cell.width + gap > atlasWidth) {
      x = gap;
      y += shelf + gap;
      shelf = 0;
    }
    cell.x = x;
    cell.y = y;
    x += cell.width + gap;
    shelf = Math.max(shelf, cell.height);
  }
  const atlasHeight = y + shelf + gap;
  const canvas = doc.createElement("canvas");
  canvas.width = atlasWidth;
  canvas.height = atlasHeight;
  const ctx = canvas.getContext("2d");
  const entries = new Map<string, AtlasEntry>();
  for (const cell of cells) {
    if (ctx) {
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, cell.x + cell.width / 2, cell.y + cell.height / 2);
      cell.sprite.draw(ctx);
    }
    // The white cell is sampled at its middle only, so its edges never blur in.
    const inset = cell.sprite.key === "white" ? 1.5 : 0;
    entries.set(cell.sprite.key, {
      uv: [
        (cell.x + inset) / atlasWidth, (cell.y + inset) / atlasHeight,
        (cell.x + cell.width - inset) / atlasWidth, (cell.y + cell.height - inset) / atlasHeight,
      ],
      halfWidth: cell.width / (2 * pixelRatio),
      halfHeight: cell.height / (2 * pixelRatio),
    });
  }
  return { canvas, entries };
}

/** Fills the GPU sprite rows in drawing order; both GPU backends use these exact placements. */
export function writeAttitudeSprites(spriteData: Float32Array, entries: ReadonlyMap<string, AtlasEntry>,
  scene: AttitudeScene, stick: AttitudeStick, pixelRatio: number): number {
  const { projection } = scene;
  const centre = projection.size / 2;
  let count = 0;
  // Upright sprites sit on whole device pixels, where their texels land one to one.
  const snap = (value: number, half: number): number => Math.round((value - half) * pixelRatio) / pixelRatio + half;
  const place = (key: string, x: number, y: number, angle: number, alpha: number, halfWidth?: number, halfHeight?: number): void => {
    const entry = entries.get(key);
    if (!entry || count >= MAX_SPRITES) return;
    const width = halfWidth ?? entry.halfWidth;
    const height = halfHeight ?? entry.halfHeight;
    const upright = Math.abs(angle) < 0.5 * DEG;
    const offset = count * SPRITE_FLOATS;
    spriteData[offset] = upright ? snap(x, width) : x;
    spriteData[offset + 1] = upright ? snap(y, height) : y;
    spriteData[offset + 2] = width;
    spriteData[offset + 3] = height;
    spriteData.set(entry.uv, offset + 4);
    spriteData[offset + 8] = upright ? 1 : Math.cos(angle);
    spriteData[offset + 9] = upright ? 0 : Math.sin(angle);
    spriteData[offset + 10] = alpha;
    count++;
  };
  for (const label of scene.labels) place(`label:${label.kind}:${label.text}`, label.x, label.y, label.angle, 1);
  if (scene.symbol) place("symbol", scene.symbol.x, scene.symbol.y, scene.symbol.angle, scene.symbol.pinned ? PINNED_ALPHA : 1);
  for (const marker of scene.markers) place(`marker:${marker.kind}`, marker.x, marker.y, 0, marker.pinned ? PINNED_ALPHA : 1);
  if (stickShown(stick)) {
    place("white", centre, centre, 0, STICK_CROSSHAIR_ALPHA, projection.half, 0.5);
    place("white", centre, centre, 0, STICK_CROSSHAIR_ALPHA, 0.5, projection.half);
    place(`knob:${stick.active}`, centre + stick.x * projection.half, centre + stick.y * projection.half, 0, 1);
  }
  return count;
}
