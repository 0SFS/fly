# Attitude indicator on Canvas 2D: mirrored sky and batched labels — 8 November 2026

From [prompt 03](../2026-11-05/prompts/03-attitude-indicator.md) of fly's
5 November phone audit, after step 1 ([P-122](../2026-11-07/attitude-grid-cache.md)).
Ledger: P-144. Baseline: the painter at fly `15330a3^`
(`git show 15330a3^:src/flight/hud/attitudeCanvas.ts`).

Commits:

- fly `15330a3` (already pushed and deployed, together with the flat HUD
  setting): the two changes below, with no test or note at the time.
- fly `82ec057`: the test that proves them exact.
- fly `4a55de8`: the sky loop reads its arrays and sizes from locals, so the
  largest indicator is no slower than before.

**Status:** exact, shipped. Every pixel and every label draw is the same as
before. The WebGL2 shader path (prompt 03 step 2) is not started.

## What changed

**Sky and ground** (`createSkyField`). Each pixel's direction in body axes is
fixed, so it was kept for every pixel, and a frame was one dot product with
local up and a colourmap lookup per pixel.

- The four pixels mirrored about the centre have the same direction, except
  that right, down, or both change sign. Negating a float is exact, and
  `Math.hypot(u, v)` is the same for ±u and ±v.
- Now only the top-left quarter's directions are kept (a quarter of the
  memory and of the start-up trig). Each kept pixel works out
  `f·ux`, `r·uy` and `d·uz` once and adds them, with the signs, for all four
  pixels, in the order the old sum used.
- With an odd side, the middle row and column are written twice, from the
  same values.

**Labels.** Each label was drawn through `drawLabelGlyph`, which set the
align, baseline, line join, outline colour, line width, font and fill colour
every time.

- Now the align, baseline, line join, outline colour and line width are set
  once for all labels. The font and fill colour are set only when the label's
  kind changes from the one before.
- Each label still has its own save, translate, rotate (to whole degrees) and
  restore, so its stroke and fill see the same state as before.

**Loop locals** (`4a55de8`). The quarter loop read `side`, `quarter`, the
three direction arrays and the pixel array from the painter's closure. Read
from local constants instead, the 270-pixel indicator stopped being slower
than the old loop. The arithmetic is unchanged.

## Exactness

`src/flight/hud/attitudeCanvas.test.ts`, with a fake 2D context that records
every image put and, at each `strokeText` and `fillText`, only the state that
draw reads (text, position, font, align, baseline, alpha, transform; plus
outline colour, line width, join and cap for a stroke, or fill colour for a
fill):

- **Pixels.** 110 scenes (11 rolls × 5 pitches, own view and a camera view,
  inverted and vertical included) over 7 sizes from 8 to 300 px, odd and even
  sides. Every pixel is compared with the old per-pixel shading (its
  directions rounded to float32 as the old arrays stored them): more than a
  million pixels, all equal.
- **Labels.** The same scenes, each label drawn the old way through the
  exported `drawLabelGlyph`: the recorded draws are deep-equal, more than 500
  labels, and the save/restore stack ends empty.
- A NaN up vector would give the same empty pixel both ways
  (`lookup[NaN]` is `undefined`, stored as 0); it does not come from the
  scene.

Mutants (each applied, the test run, the file restored):

| Mutant | Caught |
| --- | --- |
| Mirror column off by one (`side - column`) | yes |
| Wrong sign of `dz` in a bottom-row pixel | yes |
| `Math.floor` instead of `Math.ceil` for the quarter | yes |
| Font not reset after a kind change | yes |
| Fill colour set only for the first kind | yes |
| Outline width 2 instead of 2.5 | yes |
| Label angle not rounded to whole degrees | yes |
| After `4a55de8`: mirror column off by one | yes |
| After `4a55de8`: wrong sign of `dz` in a bottom-row pixel | yes |
| After `4a55de8`: bottom row off by one (`(n - row) * n`) | yes |

10 of 10 caught.

## Measured

**Node 22 on the M5** (`build/attitude-shader/painter.bench.test.ts`, run
with its own vitest config): the whole Canvas 2D painter, before (the module
at `15330a3^`) and after, on a context whose calls do nothing. So this is
mostly the sky loop; the browser's own text and image costs are not in it.
240 frames of a changing attitude per round; medians of 10 interleaved rounds
(2 warm-up rounds dropped), ranges the rounds' minimum and maximum.

| Indicator | Sky side | Before | `15330a3` | `4a55de8` |
| --- | ---: | ---: | ---: | ---: |
| 160 px | 144 | 167.4 µs (165.0–172.0) | 143.8 µs (143.0–144.3) | 141.3 µs (140.8–142.1) |
| 220 px | 192 | 241.5 µs (239.7–242.3) | 222.5 µs (221.0–225.6) | 217.3 µs (214.9–218.8) |
| 300 px | 270 | 375.4 µs (374.4–376.9) | 386.8 µs (385.5–390.3) | 372.1 µs (370.4–376.4) |

- The `15330a3` and `4a55de8` columns come from separate runs, each against
  its own before. A second run of `4a55de8` gave 142.9, 217.4 and 374.3 µs
  against 169.6, 242.9 and 378.2.
- The saving is 1 to 16 % of the painter here. The loop still does the same
  number of lookups and writes; what it saves is three quarters of the
  direction reads and multiplications.
- These are Node timings, not frame rates. Nothing was measured in Chrome or
  on a phone.

## Left

- Prompt 03 step 2: a WebGL2 shader for sky, ground and grid, behind a
  setting whose default keeps Canvas 2D. Not exact (edges antialias
  differently), so it needs the tolerance test (L25) and the user's sign-off.
- Prompt 03 step 3: skipping redraws that would move nothing by a quarter
  pixel. Not exact; a setting, default off.
- An exact skip of the sky loop and `putImageData` when the size and the up
  vector are bit-for-bit those of the last frame (parked, paused). Not done.

## Measurement plan

Under the perf lock, Chrome on the M5, the frame profiler's
`flight/hud/attitude` section, two builds interleaved before, after, after,
before:

```sh
node ~/gh/0sfs/fly/build/perf-lock-wait.mjs acquire --agent <name> --task "attitude P-144 timing"
cd ~/gh/0sfs/fly
# The "after" build is HEAD. For "before", build from a copy of the tree whose
# attitudeCanvas.ts is `git show 15330a3^:src/flight/hud/attitudeCanvas.ts`.
node scripts/profile-flight.mjs --runs=webgl2-canvas2d --seconds=10 --settle=5 --out=build/attitude-shader/after-1
# ... before-1, after-2, before-2 the same way
cd ~/gh/foss-earth/research && node scripts/benchmarks/startup-audit/perf-lock.mjs release --agent <name>
~/gh/foss-earth/browser-testing/scripts/chrome-clones.sh --clean
```

About 2 minutes a run with the build. The Node numbers suggest a difference of
under 0.03 ms a frame on the M5 at 220 px, near the page timer's 0.1 ms
resolution; the phone (prompt 01) matters more.

The Node bench again (about 30 s):

```sh
cd ~/gh/0sfs/fly && npx vitest run --config build/attitude-shader/vitest.config.mts --disable-console-intercept
```
