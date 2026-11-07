# The attitude grid's directions computed once — 7 November 2026

Step 1 of [prompt 03](../2026-11-05/prompts/03-attitude-indicator.md) of the
[5 November phone audit](../2026-11-05/README.md) (the attitude indicator on
WebGL2). Baseline: fly `c67157c`. Ledger: P-122.

## What it was

On any page whose globe is not WebGPU, the attitude indicator draws in
Canvas 2D, and each frame its attitude changes `computeAttitudeScene` traces
the grid: the horizon, 16 pitch rings, 12 meridians and 24 heading ticks,
2,417 points. Each point was a `view.sphere(elevation, azimuth)` call: three
trig calls for a direction that never changes, the projection's rotation,
`Math.hypot`, `Math.atan2`, and a new `ScreenPoint` object, read once by
`trace`. The WebGPU renderer draws the grid per pixel and skips all of this.

## What changed

- The grid's north/east/down directions are made once, in the order the grid
  is traced, with the expressions `View.sphere` uses (`level * Math.cos(azimuth)`
  and so on). The ticks' directions depend on their length, which follows the
  instrument's size: they are made again only when that length changes, and
  the rest of the grid never is.
- Each frame turns and projects them into one reused `Float64Array` of x, y
  and angle from the nose, with `local`'s expressions in the same order:
  the same `Math.hypot`, `Math.atan2`, `1e-12` branch and `radiusForAngle`.
  The rotation's nine numbers are read into locals first, which changes no
  value.
- `trace` walks one run of that array instead of calling a function per point.
  Its splitting and trimming are unchanged. The scene's polylines are new
  arrays each frame, as before, so nothing the renderer holds is reused.

## Exactness

- `attitudeIndicator.test.ts`, a new test: a reference tracer in the test file
  (`sphere`, `local`, `trace` and `traceGrid` as at `c67157c`, one fresh
  projection per point) against `computeAttitudeScene`. It covers 1,810
  frames:
  - level, rolled, inverted, vertical, nearly vertical and backwards
    attitudes (11 rolls × 11 pitches × 5 headings, angles such as 1e-9 rad,
    ±90°, 89.999° and 180°), each drawn from the aircraft and from a camera
    looking back at it;
  - a 600-frame tumble through every attitude.
  - Sizes alternate frame by frame across four (96, 160, 220 and 300 px), so
    the ticks are remade between frames, and one is below the size where the
    artwork stops shrinking.
  - Every number of the horizon, rings, meridians and ticks is compared with
    `Object.is`, along with each polyline's count and length: more than
    a million numbers, and none differ.
  - The test passed against the old code before the change too.
- Mutants (`build/attitude-grid/mutants.py`, against the attitude indicator
  and renderer tests): 14 of 14 caught.
  - Exactness: a 2.5° horizon step (the prompt's changed azimuth step), the
    meridians' elevation regrouped as `index * 3 * DEG - 90 * DEG`, a square
    root for `Math.hypot`, x summed in another order, and y from the wrong
    column.
  - The nose: no branch on the nose, and a nose point left as the last frame
    had it in the reused array.
  - The ticks: not remade when their length changes, their ends swapped, and
    checked at one end only.
  - Tracing: no lead-in point, the reach without its extra pixel, each run one
    point short, and meridians split at 60° instead of 90°.
  - Two first candidates were equivalent and replaced:
    - `index * (4 * DEG)` for the rings' azimuth, since multiplying by 4 is
      exact in binary;
    - not clearing the previous point's inside flag after a gap near the tail,
      which can only push a lone point that `finish` then drops.
- fly `npm run typecheck` passes; the HUD tests (20 files, 177 tests) pass.

## Measured

**Node 22 on the M5** (`build/attitude-grid/bench.test.ts`): the whole
`computeAttitudeScene`, before (the module at `c67157c`) and after, each frame
a new attitude. Medians of 9 interleaved rounds of 5,000 frames; ranges are
the rounds' minimum and maximum.

| Case | Before | After |
| --- | ---: | ---: |
| 220 px, grid traced (Canvas 2D), aircraft view | 167.8 µs (165.0–169.2) | 91.2 µs (89.7–93.2) |
| 220 px, grid traced, camera view | 166.8 µs (164.1–170.0) | 89.7 µs (88.4–91.6) |
| 150 px, grid traced, aircraft view | 170.2 µs (168.9–171.0) | 92.9 µs (91.2–94.3) |
| 220 px, no grid (WebGPU), control | 18.7 µs (18.5–19.2) | 19.1 µs (18.4–19.6) |

The grid's own share drops from about 149 to 72 µs. The no-grid control
does not move. These are Node timings, not frame rates.

**Chrome on the M5** (`scripts/profile-flight.mjs --runs=webgl2-canvas2d`,
headless, Metal, 1280×720 at DPR 1, the default start, 60 fps in every run):
the frame profiler's `flight/hud/attitude` section over 10 s (599 frames)
after a 5 s settle. Two builds, one from each version of
`attitudeIndicator.ts`, run interleaved before, after, after, before, under
the perf lock.

| Run | `attitude` mean | `attitude` p95 | `hud` mean |
| --- | ---: | ---: | ---: |
| before 1 | 0.391 ms | 0.5 ms | 0.452 ms |
| after 1 | 0.283 ms | 0.4 ms | 0.353 ms |
| after 2 | 0.283 ms | 0.4 ms | 0.350 ms |
| before 2 | 0.369 ms | 0.5 ms | 0.433 ms |

The two runs of each build differ by up to 0.022 ms; the builds differ by
about 0.1 ms a frame (26%), about 5.8 ms/s of main thread at 60 fps. The
page's timer has 0.1 ms resolution, so the means are over coarse samples.
Nothing on the SD835 phone was measured. The audit's estimate scales this
step's saving by about ten on that phone, and it remains an estimate until
prompt 01 runs.

## Left

- Step 2 (a WebGL2 shader path) needs a visual tolerance agreed with the user;
  step 3 (skipping sub-pixel redraws) is a setting, default off. Neither is
  started.
- What remains of the grid's cost is mostly `Math.hypot` and `Math.atan2` on
  each point. Both must stay to keep every bit.
