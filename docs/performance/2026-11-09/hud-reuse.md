# Exact HUD reuse and property reads — 9 November 2026

Baseline: fly `6ed67d0`. Continues prompts 03 and 04 from the
[5 November audit](../2026-11-05/prompts/README.md). Changes are in fly;
FOSS Earth sources and aircraft assets were not changed.

## What changed

- `attitudeRenderer.ts` keeps its scene for stick-only updates. If only
  velocity changes, it recomputes labels and velocity markers but keeps the
  grid polylines. Size, pixel density, all three aircraft angles, the camera
  frame's presence and its nine components invalidate that reuse. Replacing
  the backend discards the scene. All retained arrays belong to that renderer.
- `attitudeCanvas.ts` keeps its last sky image when the projection key and
  all three up-vector components match with `Object.is`. It still paints the
  grid, text, aircraft, markers and stick every requested draw. The stamp is
  copied, so a caller changing the same vector in place cannot leave stale sky.
  Resizing or changing the projection coefficients invalidates the image.
- `evaluationInstruments.ts` samples its available AoA and CAS properties
  through the existing `createPropertySampler`, rather than scalar property
  lookups each frame. It requests no absent paths. Native slots follow AoA,
  pusher, warning order; these are read-only observations with no intervening
  simulator writes. The warning still gives the pusher priority. The batch
  includes the stall warning even while the pusher is active. The sampler
  retains scalar fallback and re-resolves after SDK model-load disposal.
  A replaced reader releases the old sampler and discovers the new readouts;
  destroy releases it before the flight destroys JSBSim.

No angle or temperature is quantized, no update cadence changes, and no
renderer or quality setting changes. The existing full-frame early return
for identical inputs stays in place. The new reuse helps when something
else on the instrument moves; a continuously rotating view still does all
its original projection and painting work.

## Exactness

- The Canvas reference test compares the uploaded sky with the original
  independent per-pixel calculation. The new cases cover repeated tuples,
  in-place edits, signed zero, NaN, each up component, coefficients changing
  without a dimension change, and resizing. Labels continue moving while
  the sky image is reused.
- The renderer test compares velocity-only scenes against a fresh complete
  `computeAttitudeScene`. It checks all three rotation keys, pixel density,
  stick-only draws, and retained grid ownership. Existing camera and backend
  switch tests still run. A stub WebGPU test also checks fresh markers,
  redraws and cockpit-mirror publication when a scene is reused.
- Chrome 156.0.8078.80, real Canvas 2D, 800×460 viewport, DPR 1:
  before and after produced identical pixels for 240 frames at 101, 160,
  220 and 300 CSS px. **41,808,240 RGBA bytes compared, no difference**.
  Cases include moving sticks and velocities, changing aircraft attitudes,
  a supplied camera frame, and that frame edited in place.
- The evaluation test checks slot order, live NaN/signed-zero values, CAS
  priority, one batch per reader, missing paths, reader replacement, model
  load and disposal. The existing sampler tests cover native fallback.
  A retained real-JSBSim comparison checks identical AoA and complete DOM
  markup for C172, SF50 and F-35B, each at 100 and 40 kt, 90 steps each,
  with moving elevator commands and an intervening model reload: 540 steps.
- Ten deliberate mutants were tested across this work and the
  [exhaust change](https://github.com/0SFS/exhaust/blob/main/docs/performance/2026-11-09/spatial-sampling.md).
  All ten are caught. The first pass exposed missing pitch/heading and
  hot-after-cold test cases; those tests were strengthened. A cold-stamp
  mutant that only prevented cache hits in those fixtures was replaced by
  one that incorrectly reused the first temperature for all nodes.

## Validation

Lint, typecheck and production build passed. The full suite passed 3,680
tests, with 4 expected failures and 1 skipped; the subsequent final focused
run, including the added WebGPU publication case, passed all 27 tests.
See [session-handoff.md](session-handoff.md) for commands and scope.

## Measurements

Apple M5, Node 26.9.0 and headless Chrome 156. CPU throttle: none. AC power
was observed afterward; `pmset` reported no thermal/performance warning.
Temperature was not sampled during the runs. Comparisons held the shared
performance lock. These are component CPU timings, not flight frame times,
GPU measurements, power measurements or phone results.

Chrome, the complete renderer's synchronous `draw` call, including scene
computation and real Canvas drawing: eight alternating A/B rounds after two
warm-up rounds, 90 updates per arm per round. Medians in microseconds:

| CSS size | Stick changes, fixed scene | Velocity changes, fixed attitude | Changing attitude | A/A changing attitude |
| --- | ---: | ---: | ---: | ---: |
| 160 | 144.4 → 42.2 | 141.1 → 60.0 | 151.1 → 151.1 | 150.0 → 151.1 |
| 220 | 170.0 → 46.7 | 170.0 → 64.4 | 175.6 → 175.6 | 174.4 → 174.4 |
| 300 | 216.7 → 46.7 | 220.0 → 66.7 | 217.8 → 217.8 | 220.0 → 218.9 |

At 220 px, steady-attitude updates take 62–73% less CPU in this fixture.
A/A medians differ by at most 0.8%. There is no demonstrated gain during
continuously changing attitude. Canvas may queue raster work; this does not
time its eventual compositing or an entire browser frame.

Node/jsdom, complete evaluation-instrument `update` with the real SDK,
nine interleaved rounds after two warm-up rounds, 10,000 updates per arm:

| Aircraft | Before µs | After µs | A/A µs |
| --- | ---: | ---: | ---: |
| C172 | 0.453 | 0.103 | 0.459 / 0.453 |
| SF50 | 1.257 | 0.121 | 1.247 / 1.242 |
| F-35B | 0.622 | 0.120 | 0.623 / 0.616 |

This is a small property-call saving: less than 0.07 ms per second even on
the SF50 at 60 Hz on this machine. It reuses the existing sampler rather
than introducing another native batching implementation.

Raw paired rounds and versions: [hud-evidence.json](hud-evidence.json).
Scratch: `build/perf-20261109/`. The bounded archive documented in
[session-handoff.md](session-handoff.md) retains source baselines, scripts,
raw measurements, mutants and the before/after image for reproduction.
