import { ATTITUDE_TICK_HALF_LENGTH, GROUND_STOPS, SKY_STOPS, type Rgb } from "./attitudeIndicator";

const FRAME = `layout(std140) uniform Frame {
  vec4 rowNorth;
  vec4 rowEast;
  vec4 rowDown;
  vec4 view;
  vec4 lens;
};`;

function colourmap(name: string, stops: [number, Rgb][]): string {
  const rgb = ([r, g, b]: Rgb) => `vec3(${[r, g, b].map(value => (value / 255).toFixed(6)).join(", ")})`;
  const lines = [`vec3 ${name}(float deg) {`, `  vec3 colour = ${rgb(stops[0]![1])};`];
  for (let index = 1; index < stops.length; index++) {
    const from = stops[index - 1]![0], [to, colour] = stops[index]!;
    lines.push(`  colour = mix(colour, ${rgb(colour)}, clamp((deg - ${from.toFixed(1)}) / ${(to - from).toFixed(1)}, 0.0, 1.0));`);
  }
  return [...lines, "  return colour;", "}"].join("\n");
}

/** The WebGPU ball's lens and analytic line coverage, in WebGL2's shader language. */
export function attitudeWebGl2Shaders() {
  return {
    ballVertex: `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`,
    ballFragment: `#version 300 es
precision highp float;
${FRAME}
out vec4 outColour;
const float DEG_PER_RAD = 57.29577951308232;
${colourmap("sky", SKY_STOPS)}
${colourmap("ground", GROUND_STOPS)}
float cover(float distancePx, float halfWidthPx) {
  return clamp(halfWidthPx + 0.5 - distancePx, 0.0, 1.0);
}
void main() {
  float pxPerCss = view.y;
  // GL's window origin is at the bottom; the scene and the artwork use the top.
  vec2 d = vec2(gl_FragCoord.x, view.x * pxPerCss - gl_FragCoord.y) / pxPerCss - vec2(view.z);
  float a = lens.x, b = lens.y, art = lens.z;
  float r = length(d);
  float theta = r / (a - b * r);
  float lateral = r > 1e-4 ? sin(theta) / r : 0.0;
  vec3 body = vec3(cos(theta), d.x * lateral, d.y * lateral);
  vec3 local = vec3(dot(rowNorth.xyz, body), dot(rowEast.xyz, body), dot(rowDown.xyz, body));
  float elevation = atan(-local.z, length(local.xy)) * DEG_PER_RAD;
  float azimuth = atan(local.y, local.x) * DEG_PER_RAD;
  float behind = atan(-local.y, -local.x) * DEG_PER_RAD;
  float elevationRate = max(length(vec2(dFdx(elevation), dFdy(elevation))), 1e-6);
  float azimuthRate = max(min(length(vec2(dFdx(azimuth), dFdy(azimuth))),
    length(vec2(dFdx(behind), dFdy(behind)))), 1e-6);
  float hairline = 0.5 * pxPerCss;
  vec3 colour = elevation >= 0.0 ? sky(elevation) : ground(-elevation);
  float ring = round(elevation / 10.0);
  float onRing = cover(abs(elevation - ring * 10.0) / elevationRate, hairline)
    * (ring != 0.0 && abs(ring) <= 8.0 ? 1.0 : 0.0);
  colour = mix(colour, ring > 0.0 ? vec3(1.0) : vec3(1.0, 0.925, 0.839), onRing * (ring > 0.0 ? 0.3 : 0.28));
  float meridian = round(azimuth / 30.0);
  float onMeridian = cover(abs(azimuth - meridian * 30.0) / azimuthRate, hairline);
  colour = mix(colour, vec3(1.0), onMeridian * (mod(abs(meridian), 3.0) == 0.0 ? 0.42 : 0.2));
  float tick = round(azimuth / 10.0);
  float onTick = cover(abs(azimuth - tick * 10.0) / azimuthRate, 0.625 * pxPerCss)
    * cover(abs(elevation) / elevationRate, ${ATTITUDE_TICK_HALF_LENGTH.toFixed(1)} * art * pxPerCss)
    * (mod(abs(tick), 3.0) == 0.0 ? 0.0 : 1.0);
  colour = mix(colour, vec3(1.0), 0.75 * onTick);
  colour = mix(colour, vec3(1.0), 0.95 * cover(abs(elevation) / elevationRate, art * pxPerCss));
  float corner = lens.w;
  vec2 q = abs(d) - vec2(view.w - corner);
  float edge = (length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - corner) * pxPerCss;
  float inside = clamp(0.5 - edge, 0.0, 1.0);
  float border = 0.7 * cover(abs(edge), 0.75 * pxPerCss);
  outColour = vec4(colour * inside, inside) * (1.0 - border) + vec4(border);
}`,
    spriteVertex: `#version 300 es
precision highp float;
${FRAME}
layout(location=0) in vec2 centre;
layout(location=1) in vec2 halfSize;
layout(location=2) in vec4 uvRect;
layout(location=3) in vec2 turn;
layout(location=4) in float alpha;
out vec2 uv;
out float opacity;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 offset = (corner * 2.0 - 1.0) * halfSize;
  vec2 turned = vec2(offset.x * turn.x - offset.y * turn.y, offset.x * turn.y + offset.y * turn.x);
  vec2 at = (centre + turned) / view.x;
  gl_Position = vec4(at.x * 2.0 - 1.0, 1.0 - at.y * 2.0, 0.0, 1.0);
  uv = mix(uvRect.xy, uvRect.zw, corner);
  opacity = alpha;
}`,
    spriteFragment: `#version 300 es
precision highp float;
uniform sampler2D atlas;
in vec2 uv;
in float opacity;
out vec4 outColour;
void main() { outColour = texture(atlas, uv) * opacity; }`,
  };
}
