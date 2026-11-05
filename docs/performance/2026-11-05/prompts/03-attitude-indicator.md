# 03 — Make the attitude indicator cheap on WebGL2

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** cut the HUD attitude indicator from about 3.5 ms a frame on an
SD835 (0.35 ms on the M5, 46% of the C172's flight tick) without changing
what it shows.

**Owns:** `~/gh/0sfs/fly/src/flight/hud/attitudeIndicator.ts`,
`attitudeCanvas.ts`, `attitudeRenderer.ts` and their tests. Read
`attitudeWebGpu.ts`; change it only if the WebGL2 path shares code with it.

## What the code does

On any page whose globe is not WebGPU (every SD835-class phone), the
indicator draws in Canvas 2D. Each frame its attitude changes,
`computeAttitudeScene(..., { lines: true })` traces the horizon, 16 rings and
12 meridians through `traceGrid`: about 2,400 calls to `view.sphere()`, each
with four trig calls, an object allocation, `Math.hypot` and `Math.atan2`.
Measured on the audit's machine: 509–538 µs with the grid, 54–62 µs without
it (the WebGPU path draws the grid per pixel and skips it).

## Step 1 — exact: compute the grid's directions once

The grid's elevations and azimuths never change, so their north/east/down
unit vectors can be computed once per projection, with the same expressions
`sphere()` uses, and only rotated and projected each frame into one reused
`Float64Array`. The audit's prototype
(`docs/performance/2026-11-05/harness/attitude-cached-grid.perf.ts`) matches
the shipped scene in all 13,273,834 numbers over 4,000 attitudes, inverted
and vertical included, and takes the grid from about 510 to 280 µs (the
whole scene to about 335 µs).

- Keep every expression and its order: `level * Math.cos(azimuth)`,
  `Math.hypot(y, z)`, `Math.atan2(lateral, x)`, the `1e-12` branch,
  `radiusForAngle`. Do not replace `Math.hypot` with a square root; the bits
  differ.
- Cache per projection (size and half), invalidate when it changes.
- Add a differential test that keeps a plain reference tracer in the test
  file and compares every number with `Object.is` over rolled, inverted,
  vertical and backwards attitudes, plus a mutant (a changed azimuth step)
  that the test must catch. Leave the harness prototype in place; it is the
  audit's evidence.

## Step 2 — a WebGL2 shader path

Mirror the WebGPU renderer in a small WebGL2 context on the indicator's own
canvas: the grid evaluated per pixel through the inverse of the projection
(`angleForRadius`), the symbol, markers and labels as in `attitudeWebGpu.ts`.
Choose it when the globe is WebGL2 and the context starts; keep Canvas 2D as
the fallback. Check that the cockpit screen's DOM mirror still copies the
canvas (`noteCanvasDrawn`). Compare against the Canvas 2D image at a set of
attitudes; edges will differ by antialiasing, so agree a tolerance with the
user and show them side-by-side images.

## Step 3 (optional, a setting) — skip sub-pixel redraws

A rotation by δ radians moves any point of the picture by at most
`max(a, r_max) · δ` pixels, where `a` is the projection's slope at the centre
and `r_max` the corner radius. Skipping a redraw while that bound stays under
a quarter pixel (and the velocity markers move less than that) saves most
frames in steady flight. It is not exact: put it behind a setting, default
off, for the phone profile.

## Measure

`flight/hud/attitude` in Debug → Frame budget, interleaved old/new, in a
WebGL2 flight on the desktop, then on the phone if prompt 01 has run.
