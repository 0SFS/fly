# WebGL2 attitude indicator — 9 November 2026

Baseline: fly `016e191`. The change is in fly `8c053b8`, which also carries
unrelated local-checkout mod loading. This continues step 2 of
[prompt 03](../2026-11-05/prompts/03-attitude-indicator.md) from the
[5 November audit](../2026-11-05/README.md). FOSS Earth was not changed.

**Hypothesis.** On a WebGL2 globe, the indicator traces its grid in
JavaScript and strokes it on a Canvas 2D every frame. The WebGPU path instead
draws the grid per pixel. A WebGL2 port of that shader should remove most of
the main-thread cost without adding GPU cost.

## What changed

- **New choice.** The *Attitude indicator* setting
  (`osfs.renderer.attitudeIndicator`) has a new choice, **WebGL2**, which is
  opt-in and labelled experimental. **Auto is unchanged:** it uses Canvas 2D
  on WebGL2 globes and WebGPU on WebGPU globes.
- **The WebGL2 renderer.** `attitudeWebGl2.ts` and `attitudeWebGl2Shader.ts`
  port the WebGPU renderer to GLSL ES 3.00.
  - It draws in its own WebGL2 context, on the indicator's own canvas.
  - The grid, horizon, ticks and border are computed per pixel through the
    inverse projection, with antialiasing derived from screen-space
    derivatives.
  - The aircraft symbol, markers and labels are instanced quads drawn from
    the same glyph atlas as WebGPU.
  - GPU time is read from `EXT_disjoint_timer_query_webgl2` on later frames,
    never waited for. [This timer measures a span, not a cost.](#the-webgl2-gpu-timer-measures-a-span-not-a-cost)
- **Shared atlas code.** The atlas and sprite layout moved from
  `attitudeWebGpu.ts` to `attitudeSprites.ts`, where both GPU renderers use
  them. WebGPU's pixels are unchanged (see below).
- **Fallback.** If WebGL2 cannot start, fails to draw or loses its context,
  `attitudeRenderer.ts` switches to Canvas 2D on a fresh canvas. The
  setting's note gives the reason. WebGL2 draws notify the cockpit screen's
  DOM mirror (`noteCanvasDrawn`) the same way WebGPU draws do.
- **Fix made during review.** When WebGL2 was chosen in flight and could
  not redraw the frame already shown, `ready` still resolved to `"webgl2"`,
  although the status and canvas had already fallen back to Canvas 2D. It
  now resolves to the backend actually in use. A new test covers this, and
  reverting the fix fails only that test.
- **Test feedback.** The app's test feedback has a new `instruments` source:
  the attitude preference, backend and reason, the canvas size, and the
  last `flight/hud/attitude` time when the profiler is on.
- **Profiler script.** `scripts/profile-flight.mjs` can run `webgl2-webgl2`,
  and its summary records which indicator backend actually drew.

## Exactness and image comparison

The WebGPU refactor is exact. A WebGPU renderer built from the baseline
source and one built from the new source drew 24 frames at each of the
eight sizes in the table below. The images matched exactly: maximum
difference 0.

WebGL2 is not exact, and it does not try to be. Its antialiasing is
WebGPU's. Chrome 156, ANGLE Metal on an Apple M5, 24 attitudes per size,
including a supplied camera frame. Values are 8-bit channel differences:

| Backing px (CSS × DPR) | Canvas 2D vs WebGL2: max | mean | channel values > 2 levels | WebGL2 vs WebGPU: max | > 2 levels |
| --- | ---: | ---: | ---: | ---: | ---: |
| 101 (101 × 1) | 255 | 4.96 | 29.4% | 50 | 0.784% |
| 160 (160 × 1) | 255 | 3.32 | 20.7% | 1 | 0 |
| 220 (220 × 1) | 255 | 2.33 | 14.5% | 1 | 0 |
| 300 (300 × 1) | 230 | 1.88 | 12.3% | 1 | 0 |
| 440 (220 × 2) | 255 | 1.44 | 8.2% | 2 | 0 |
| 600 (300 × 2) | 255 | 1.25 | 7.5% | 2 | 0 |
| 660 (220 × 3) | 255 | 1.22 | 6.5% | 2 | 0 |
| 275 (220.25 × 1.25) | 255 | 2.55 | 14.1% | 37 | 0.119% |

- **WebGL2 against WebGPU.** At even backing sizes the two match within 2
  levels. At odd sizes, lines differ on under 1% of values. The cause is how
  each API builds the 2×2 pixel blocks it estimates screen-space
  derivatives from:
  - WebGL counts its rows from the bottom and WebGPU from the top.
  - At an odd height the two therefore pair different rows.
- **Canvas 2D against either GPU path.** Both differ from Canvas 2D at
  antialiased edges and in text. WebGPU globes already show this
  difference by default.

Side-by-side images at 220 CSS px and DPR 2 (440 × 440 px):

- `build/perf-20261109-webgl2-resume/side-by-side/side-by-side.png` shows
  four attitudes: level, a climbing right turn, an inverted dive, and a
  camera looking back. Each row has Canvas 2D, WebGL2, WebGPU, and
  |Canvas 2D − WebGL2| × 4. Between 10.7% and 13.3% of pixels differ from
  Canvas 2D by more than 2 levels.
- `side-by-side-zoom.png` is a 3× crop of the climbing turn.
- What they show:
  - Canvas 2D's thin grid lines are slightly heavier.
  - Labels and symbols match except at their edges.
  - WebGL2 and WebGPU cannot be told apart.

## In the real app

`npm run llm-dev`, Chrome at DPR 2, opened through the test link
`/fly/test/attitude-webgl2?renderer=webgl2`:

- **Test link.** It opened the *Try the WebGL2 attitude indicator* panel,
  with no unavailable data.
- **Auto on a WebGL2 globe** drew with Canvas 2D. The note read
  "Drawing with Canvas 2D."
- **Choosing WebGL2** read "Drawing with WebGL2 (experimental), on the
  indicator's canvas."
  - The canvas was 352 px: 220 CSS px × DPR 2 × the HUD's 0.8 zoom.
  - The cockpit-mirror event fired 15 and 27 times in the two WebGL2
    periods. It never fired for Canvas 2D, which matches the old behaviour.
  - One canvas stayed in the host.
- **Losing the WebGL2 context** (`WEBGL_lose_context`) fell back to one
  fresh Canvas 2D canvas. The note read "Drawing with Canvas 2D. WebGL2 lost
  its drawing context."
- **Switching back.** Choosing WebGL2 again worked, and Auto returned to
  Canvas 2D.
- **Feedback file.** Its start and finish samples include the
  `instruments` source.
- **Console.** No exceptions. There were three unrelated warnings: no map
  key, and two about Babylon's asset-container hierarchy.

## Measurements

The machine was an Apple M5 MacBook Air (fanless) running macOS 27.0, with
Node 26.9.0. Runs were on AC power with the battery at 69% and charging.
`pmset` reported no thermal or performance warning before or after. Every
timing run held the shared performance lock. Chrome updated itself from 156
to 157 at 19:41. The component runs used 156; the app probe, both in-app
passes and the GPU harness ran later, on 157.

These are desktop measurements, not phone measurements; prompt 01 has not
been run.

### Main-thread time, component (Chrome 156, headless)

The time of the complete synchronous `draw`. Each round drew 120 changing
attitudes with each renderer, and the table gives the median over 8 rounds
of the mean per draw. Two warm-up rounds came first, and the order reversed
every round. "A/A" is a second Canvas 2D renderer in the same rounds.

| CSS px, DPR | Canvas 2D | WebGL2 | WebGPU | A/A Canvas 2D |
| --- | ---: | ---: | ---: | ---: |
| 160, 1 | 139.2 µs | 22.5 µs | 25.8 µs | 140.0 µs |
| 220, 1 | 159.2 µs | 22.5 µs | 27.5 µs | 160.0 µs |
| 300, 1 | 195.8 µs | 22.5 µs | 28.3 µs | 196.7 µs |
| 220, 2 | 159.2 µs | 23.3 µs | 27.5 µs | 164.2 µs |

These draws ran back to back, with no frame between them. Drawing once per
frame costs more; see the next two sections.

### Frame budget in the app (Chrome 157, headless)

`scripts/profile-flight.mjs` with `?flightPerf=1` measures the frame budget
in the app.

- **Setup.** WebGL2 globe, 1280 × 720 CSS px at DPR 1, the app's default
  aircraft, physics rate and settings, and map tiles from the network. Only
  the indicator choice differed between runs.
- **Runs.** Each run is a fresh Chrome and a fresh flight, measured over a
  10 s window after a 5 s settle.
- **Order.** Two passes in opposite orders.

| Run, in order | `flight/hud/attitude` mean (p95) | `flight/hud` mean | `gpu/globe` mean | `gpu/attitude indicator` mean (p50) | Frames, p95 interval |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pass 1: Canvas 2D | 0.419 (0.5) ms | 0.522 ms | 2.725 ms | — | 599, 16.8 ms |
| Pass 1: WebGL2 | 0.110 (0.2) ms | 0.216 ms | 1.975 ms | 1.094 (0.796) ms | 599, 16.7 ms |
| Pass 2: WebGL2 | 0.117 (0.2) ms | 0.219 ms | 2.195 ms | 1.225 (1.007) ms | 599, 16.7 ms |
| Pass 2: Canvas 2D | 0.424 (0.5) ms | 0.526 ms | 1.924 ms | — | 599, 16.7 ms |

- **CPU.** WebGL2 takes 0.31 ms off the main thread every frame, about 1.8%
  of a 60 Hz frame, in both orders.
  - The same configuration repeated within 0.005 ms (Canvas 2D) and
    0.007 ms (WebGL2).
  - The profiler's clock ticks in 0.1 ms; the means are over 599 frames.
- **Frame pacing.** Unchanged. Both configurations ran at the display rate,
  with 2–3 frames over 25 ms per run.
- **GPU.** The in-app figures cannot answer the question. The two Canvas 2D
  runs' globe times differ by 0.8 ms, and Canvas 2D's own drawing happens in
  Chrome's GPU process, where no in-app timer sees it. The
  `gpu/attitude indicator` figure is explained in the next two sections.

### Whole GPU cost when the GPU is the bottleneck (Chrome 157, headless)

This harness answers the question the app cannot (sources in
`build/perf-20261109-webgl2-resume/gpu-cost/`).

- **Setup.** A WebGL2 canvas of 1280 × 720 CSS px stands in for the globe.
  It runs a looping shader (2560 × 1440 px at DPR 2). Both indicators sit
  beside it at 220 CSS px (440 × 440 px), a phone-sized backing.
- **Conditions.**
  - Every frame draws the load.
  - "Canvas 2D" and "WebGL2" also redraw that indicator at a new attitude.
  - "+3% load" (the positive control) draws 3% more shader iterations and
    no indicator.
- **Why it works.** With the load sized so that the GPU is the bottleneck
  (28.45 ms a frame), each condition's extra interval over "none" is its
  whole cost to such a frame. That includes Canvas 2D's drawing in Chrome's
  GPU process.
- **Rounds.** Six interleaved rounds, with the order reversed every round.
  Each condition ran 150 frames per round, the first 10 discarded. A block's
  interval is (last − first frame time) / 140. Vsync rounding therefore
  limits each block to about ±0.12 ms.

| Condition | Added to the frame: median (range over 6 rounds) | Main-thread `draw` mean |
| --- | ---: | ---: |
| Canvas 2D | +1.07 ms (+0.71 to +1.31) | 0.83 ms |
| WebGL2 | +0.24 ms (−0.24 to +0.59) | 0.23 ms |
| +3% load, expected ≈ +0.85 ms | +0.83 ms (+0.71 to +1.07) | — |

"None" was 28.451 ms in five of six rounds and 28.331 ms in the sixth.

- **Result.** In a GPU-bound frame, the WebGL2 indicator costs about a
  quarter of what Canvas 2D does.
- **Canvas 2D's main-thread time.** It doubled from about 0.43 ms to
  0.83 ms when the GPU was saturated. I did not separate how much of
  Canvas 2D's added interval is GPU work and how much is that wait. Both
  are on the frame's critical path here.
- **Pixel ratio.** At 60 Hz with a light load, the per-frame `draw` at
  DPR 2 was 0.419–0.438 ms for Canvas 2D and 0.215–0.235 ms for WebGL2.
  The app's WebGL2 figure of 0.11 ms was measured at DPR 1.

### The WebGL2 GPU timer measures a span, not a cost

These are the same harness's own `EXT_disjoint_timer_query_webgl2` readings.
Each is a median over blocks: four per load at 60 Hz, six when GPU-bound.
The load's figure comes from the blocks without an indicator.

| Load drawn beside the indicator | Load's own timer | WebGL2 indicator's timer |
| --- | ---: | ---: |
| Trivial, 60 Hz | 0.38 ms | 0.48 ms |
| Globe-sized, 60 Hz | 3.74 ms | 3.84 ms |
| GPU-bound, 28.45 ms frames | 54.8 ms | 27.9 ms |

- **What it measures.** On Chrome's ANGLE Metal backend, this query
  behaves as the GPU time between its begin and end. That time includes
  other contexts' work that runs or waits in the meantime. This is what the
  readings show; I did not read ANGLE's source.
- **Evidence.** Beside a globe-sized load, the indicator's timer reads
  roughly the load's time. The GPU-bound load's own timer reads about two
  frame intervals. Meanwhile the end-to-end cost above is 0.24 ms.
- **Consequence in the app.** The `gpu/attitude indicator` figure of
  1.1–1.2 ms is mostly the globe's work, and the frame budget's `gpu` total
  counts it twice.
- **The globe's figure.** The globe's WebGL2 `gpu/globe` comes from
  Babylon's frame-time counter, which uses the same extension. I did not
  measure how much that figure is affected.

## Decisions for the user

1. **The tolerance.** Proposed:
   - WebGL2 matches WebGPU within 2 levels at even backing sizes. At odd
     sizes, line edges may differ on under 1% of values.
   - Against Canvas 2D, differences are limited to antialiased edges and
     text. WebGPU globes already show these differences by default.
   - Compare with the side-by-side images above.
2. **Auto on WebGL2 globes.** Should Auto choose WebGL2, keeping Canvas 2D
   as the fallback and as a selectable choice?
   - On this machine it saves 0.31 ms of main thread a frame in the app.
     When the GPU is the bottleneck it saves about 0.8 ms a frame, at a
     440 px backing.
   - The audit estimated that on an SD835 a shader would bring the
     indicator to about 0.4 ms of main thread a frame, from 2.3–3.5 ms. That
     is an estimate, not a phone measurement.
   - I recommend switching, but it changes pixels for every WebGL2 pilot,
     so it needs your agreement.
3. **The frame budget's WebGL2 indicator timer.** Remove it, or keep it
   with a label saying it is a span? As it stands, it overstates the
   indicator and double-counts in the `gpu` total.

## Validation

The validation ran at HEAD `11f1605`, which includes `8c053b8`.

- `npm run lint` and `npm run typecheck` pass.
- The HUD tests, the settings parameter tests and the mod-loading tests
  pass: 29 files and 226 tests, with 1 file and 1 test skipped.
- `node --test scripts/profile-flight-options.test.mjs` passes 6 of 6.

The renderer source in `8c053b8` is byte-identical to the copy checked
against the reverted-fix mutant.

## Reproduction

Scratch is in ignored `fly/build/perf-20261109-webgl/` (image check and
component benchmark) and `fly/build/perf-20261109-webgl2-resume/` (probe,
in-app passes, GPU harness and images).

- [attitude-webgl2-evidence.json](attitude-webgl2-evidence.json) has the
  summaries and every GPU-bound block.
- [attitude-webgl2-evidence.tar.gz](attitude-webgl2-evidence.tar.gz)
  (21 files, 46 KB) has the scripts, the raw reports, the mutant log and
  the WebGPU baseline source. It has no images; the scripts regenerate
  them. Its SHA-256 and each file's hash are in the evidence file.

Take the shared performance lock before timing, and release it afterwards.
From `~/gh/0sfs/fly`:

```sh
# Image comparison across the 8 sizes. It needs build/perf-20261109-webgl/old/attitudeWebGpu.ts,
# which is `git show 016e191:src/flight/hud/attitudeWebGpu.ts`.
node build/perf-20261109-webgl/check.mjs
# Component main-thread timings and isolated GPU timer readings.
node build/perf-20261109-webgl/bench.mjs
# In-app frame budget, both orders: about 50 seconds each.
node scripts/profile-flight.mjs --out=build/perf-20261109-webgl2-resume/profile --runs=webgl2-canvas2d,webgl2-webgl2 --seconds=10 --settle=5
node scripts/profile-flight.mjs --out=build/perf-20261109-webgl2-resume/profile --no-build --runs=webgl2-webgl2,webgl2-canvas2d --seconds=10 --settle=5
# About 2.5 minutes: GPU-bound end-to-end cost, timer spans and positive control.
node build/perf-20261109-webgl2-resume/gpu-cost/run.mjs
# A few seconds: the side-by-side images.
node build/perf-20261109-webgl2-resume/side-by-side/run.mjs
```

To try it by hand, start the dev server:

```sh
cd ~/gh/0sfs/fly && npm run dev
```

Then open `https://localhost:7470/fly/test/attitude-webgl2?renderer=webgl2`.
The test panel walks through choosing WebGL2, comparing it in flight,
changing the camera, resizing, checking the frame budget, and restoring
Auto. The plan is in ignored `build/test-plans/attitude-webgl2.json`, so the
link works only from this checkout's dev server.

## Next work

- **Step 3 of prompt 03.** Skip sub-pixel redraws, behind a setting that
  is off by default.
- **Phone measurement (prompt 01).** This replaces the SD835 estimate for
  both paths.
- **The tint reads.** The HUD reading tints still read scalar properties.
