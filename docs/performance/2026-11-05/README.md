# Performance audit for Snapdragon 835-class phones — 5 November 2026

What 60 fps on an old phone (Snapdragon 835 level) needs, what already runs
as Rust or C++ WebAssembly, what is worth porting, and what to change in the
modules that exist. Scope is the 0SFS repositories: fly, the JSBSim fork,
aircraft, engines, exhaust, ground-contact, controls and sound. FOSS Earth
findings are collected in [For the FOSS Earth agent](#for-the-foss-earth-agent)
for the agent that owns that code. Implementation prompts for other agents
are in [prompts/](prompts/README.md).

**Measured** numbers come from this session's harness
([harness/](harness/)) or the repository's dated performance notes.
**Estimates** scale Apple M5 measurements by about 10× for an SD835's single
core. No SD835 has been profiled yet; the first prompt
([01](prompts/01-device-baseline.md)) is to profile one. A browser profile of
the current build could not be taken in this session either: FOSS Earth's
packages need building, the session's permission check refused that step,
and this cloud VM has no GPU, so only paired differences would mean anything
on it.

These findings were reviewed twice, adversarially, before this commit.
[Corrections](#corrections-from-the-review-passes) lists what the reviews
changed.

## Summary

1. **The gap is about 4× in main-thread work.** During normal flight, with
   map tiles streaming, an SD835 would spend roughly 40 ms of main thread per
   frame against a 16.7 ms budget. Most of that is FOSS Earth's map engine,
   which runs its raster update twice per flight frame. Settled C172 flight
   (no streaming) is close to the budget with 0SFS changes alone. The F-35B
   is about 2.3× over even with the map settled.
2. **The largest 0SFS costs on that phone** (estimates): F-35B drawing, about
   22 ms of CPU a frame plus a heavy GPU load; F-35B exhaust CPU, 5–9 ms a
   frame; the HUD attitude indicator, about 3.5 ms a frame on every aircraft;
   the default F135 engine plant, about 1.7–3.5 ms per physics step; and 30–50
   scalar JSBSim property calls in every step, about 0.3–1 ms.
3. **Already WebAssembly:** JSBSim and the audio DSP are C++; multirotor,
   electric-sound and ground-contact are Rust. The ground-contact kernels are
   built and parity-checked, but the flight never passes them in.
4. **Worth porting:** the exhaust gas optics, to Rust in a worker, and a
   per-step input/output call inside JSBSim's C++. The attitude indicator's
   grid belongs on the GPU rather than in Rust.
5. **Existing modules to fix:** JSBSim uses emscripten's JavaScript exception
   handling. Its trampolines take 12–14% of a C172 step, 4% of an F-35B step,
   and 25–45% of every scalar property call. Native WebAssembly exceptions
   remove them. The F135 plant already reuses its Jacobian; its remaining
   cost needs a profile with function names before tuning.
6. **Cheapest wins:** a phone profile made of settings that already exist
   (resolution, exhaust quality, the F-35B's empirical engine), batched
   property reads and writes, and the attitude grid with its directions
   computed once: a prototype gives identical numbers at 1.5× the speed.

## The budget

60 Hz leaves 16.7 ms per frame. An SD835 has four fast cores (Kryo 280 Gold,
Cortex-A73 class, 2.45 GHz) and four slow ones, an Adreno 540 GPU and LPDDR4X
memory, and it slows down further once warm. Plan for about 12 ms of main
thread and 12 ms of GPU. The mean is not enough: a frame over 16.7 ms waits
for the next vsync, so the slow frames (p95, p99) have to fit as well.

Geekbench 6 single-core scores are about 400–430 for the SD835 and
4,200–4,260 for the base M5 ([sources](#sources)), so the M5 measurements in
this repository are scaled by 10×. The "4× CPU throttle" runs in the earlier
notes model a phone about 2.5× faster than an SD835; those runs reached
20–28 fps with the main thread saturated.

SD835 phones (Galaxy S8, Pixel 2, OnePlus 5) ended their updates on Android 9
to 11. Chrome 121 enabled WebGPU on Android 12 and later with Qualcomm and ARM
GPUs, with Android 11 announced for later. Assume **WebGL2**: WebGPU-only
optimizations do not reach these phones.

Estimated main thread per frame on an SD835 (M5 measurements × 10, GPU
excluded):

| Scenario | 0SFS flight tick | Babylon render (CPU) | FOSS Earth map | Total |
| --- | ---: | ---: | ---: | ---: |
| C172, settled, flat terrain | 7.7 ms | 3.6 ms | — | 11.3 ms |
| F-35B, settled, flat terrain | 15.9 ms | 22.1 ms | — | 38 ms |
| C172, streaming live imagery and terrain | 4.2 ms | 9.8 ms | 27.5 ms | 41.5 ms |

The settled rows come from the 21 October controlled runs
([2026-10-21](../2026-10-21/evidence-summary.json): WebGL2, 1280×800, DPR 1,
physics then at 120 Hz). In them the C172's attitude indicator was 0.35 ms of
a 0.77 ms flight tick. The F-35B's flight tick was 1.59 ms (view 0.57, physics
0.43, HUD 0.42) and its render 2.21 ms (draw 0.68, render targets 0.46, active
meshes 0.21). The streaming row comes from the 22 October C172 profile at 1×
([flight frame](../2026-10-22/flight-frame.md)): first raster update 112 ms/s,
second 50 ms/s, Babylon render 58 ms/s and flight tick 24 ms/s at about
58.6 fps. Those profiles carried CPU-profiler overhead, and later commits
reduced some of these costs, so the table is an order of magnitude, not a
baseline.

GPU: the M5 drew the C172 in 0.55 ms and the F-35B in 3.05 ms at 1280×800. An
Adreno 540 is roughly 7–8× slower, and a phone at full device-pixel ratio
draws about 2.5 megapixels. That puts the C172 near 10 ms and the F-35B far
past 30 ms (estimate). Drawing about 1.25 device pixels per CSS pixel cuts the
pixel count about 4×. It is the first GPU change to make.

## What runs as WebAssembly today

| Module | Language and build | Runs on | In the flight |
| --- | --- | --- | --- |
| JSBSim flight model ([Felipegalind0/jsbsim](https://github.com/Felipegalind0/jsbsim), SDK 1.2.4-fork.21) | C++ through emscripten: `-O3`, embind, JavaScript exception handling (`-fexceptions`, `-sNO_DISABLE_EXCEPTION_CATCHING`), memory growth, no LTO, no SIMD. 2.4 MB, no name section. 45 `invoke_*` trampoline imports. | Page main thread, every physics step (60 Hz; drones ask for 120 Hz) | Used |
| ground-contact kernels: hull collision, contact support, coupled wheels, wheel spin | Rust, `simd128`, no wasm-bindgen, 74 KB, parity-checked against the TypeScript. About 1.1 µs per full C172 step on an M5. | Would run on the page per step | **Not used.** `createTerrainContact` and `createVisibleMeshCollision` are created without a `core` (`src/flight/createFlightSimApp.ts:1359–1366`), so the TypeScript reference runs. |
| multirotor plant and flight controller | Rust, `simd128`, 30 KB | Page, per step | Used for drones |
| electric-sound voice | Rust, `simd128` | AudioWorklet | Used |
| sound DSP core (`core.cpp`), piston and turbine voices | C++ through emscripten, standalone, `-O3`, no exceptions, no SIMD | AudioWorklet | Used. The quality tiers already shed load on overload. |
| FOSS Earth cores: raster decode, terrain geometry and heights, ground index, sky, Google tiles, panorama projections | Rust | Workers; the ground index's world-pick batch can run on the page | Used through FOSS Earth. The map's per-frame selection and binding stay TypeScript on the page. |

Still JavaScript in 0SFS and hot every frame or step: the exhaust gas optics
and its depth candidates, terrain contact and collision orchestration,
control application, the HUD and its attitude indicator, aircraft rigs and
sound telemetry.

## Measurements

Node 22.23 (V8 12.4) on a cloud Intel Xeon at 2.8 GHz, with the real JSBSim
WebAssembly and the repositories' own TypeScript. Aircraft are bootstrapped
as the flight does it, at 60 Hz, airborne at 5,000 ft. This machine is 1–2×
slower than the M5 for this work, so treat an SD835 as 5–10× slower than the
numbers below. Ranges cover the runs made in this session.

| What | Result | What it means |
| --- | ---: | --- |
| JSBSim step, C172 / Vision Jet | 35–48 / 35–38 µs | About 0.2–0.5 ms a step on an SD835 (estimate) |
| JSBSim step, F-35B with the default plant engine | 341–373 µs | About 1.7–3.5 ms a step on an SD835 (estimate) |
| JSBSim step, F-35B with the empirical engine (`osfs.engine.model`) | 86–90 µs | 4× cheaper; already selectable |
| `invoke_*` trampoline calls per step | 273 / 270 / 584 / 651 | C172 / Vision Jet / F-35B plant / F-35B empirical |
| Trampoline calls per scalar `getPropertyValue` | 22 | Every scalar read crosses JavaScript 22 times |
| Trampoline self time in a CPU profile of `sdk.run()` | 12–14% (C172), 4% (F-35B) | What native WebAssembly exceptions would remove from a step |
| One trampoline against a direct indirect call | 34–36 ns | Microbenchmark; the profile share above is the better guide |
| Scalar `getPropertyValue` / `setPropertyValue` | 1.7–2.0 / 1.8–3.4 µs | String conversion, property-tree path lookup, trampolines |
| 22 properties: one `PropertyBatch.read` / 22 scalar reads | 1.4–1.5 / 37–56 µs | Batches are 25–40× cheaper and cross no trampolines |
| Scalar calls per step from `terrainContact.update` and `applyFlightControls` | 8 reads, 12 writes | The real modules over a flat test surface; 11 of the writes are the controls |
| `terrainContact.update` / `applyFlightControls` per step | 23–28 / 22–29 µs | Together more than the C172's whole JSBSim step |
| Further scalar reads written directly in the step callback (`createFlightSimApp.ts:4157–4300`, counted in source) | about 10 | qbar, true and calibrated airspeed, body rates and accelerations, control law, pusher; engine control and trim consumers add more |
| F135 plant numerics in cruise (default "reduced" algorithm) | 2 iterations, 10 residual evaluations, 1 substep, no fallback | Already reuses a Broyden-updated Jacobian between steps |
| F135 component reference (`settings/algorithm` 0) | 468–497 µs, 22 residual evaluations (one outlier run: 660 µs) | More than twice the evaluations cost only about 35% more than the reduced algorithm |
| Attitude indicator scene with grid lines (Canvas 2D path, every WebGL2 device) | 509–538 µs | 1,703 polyline points drawn from about 2,400 projections |
| Same scene without grid lines (the WebGPU path) | 54–62 µs | The grid tracing is about 90% of the indicator's cost |
| Attitude grid with its directions computed once ([prototype](harness/attitude-cached-grid.perf.ts)) | 273–281 µs for the grid | 13,273,834 numbers compared with the shipped scene, all identical; the whole scene goes from about 510 to 335 µs |
| WASM calling `Math.sqrt` / `Math.floor`: the function itself / `.bind(Math)` | 8.2 → 19–21 / 5.2 → 19 ns | V8 runs a directly imported Math function as fast as the native instruction; a bound one is 2.5–3.7× slower |

The 21 October browser run puts `flight/hud/attitude` at 0.35 ms a frame on
the M5: 87% of the HUD and 46% of the C172's flight tick.

A model of the fixed-step loop
([prompt 12](prompts/12-fixed-step-phase.md)) shows that with a 60 Hz
display and 60 Hz physics, 1.3–5% of frames run 0 or 2 steps under 0.3–1 ms
of vsync jitter. Snapping the accumulator to one step within 1 ms cuts that
to under 0.1% at 0.3 ms jitter and to about 3% at 1 ms, for a time warp under
0.1%. On the F-35B a second step in one frame costs another 1.7–3.5 ms on an
SD835, so this matters for p99 frames, not the mean.

## Found in the code

The second review read the remaining hot paths with an eye for redundant
work that can be removed without changing what is drawn or simulated.

- **Exhaust plume shader** (`exhaust/src/createEngineExhaust.ts`). Every ray
  takes `osfs.exhaust.sampleCount` samples (default 32) whatever its length
  through the plume, so short chords near the edge are sampled as finely as
  the longest. Samples on the flow-support path compute `gasCoordinates`
  before learning they lie outside the gas. The proxy is a box, so rays through
  its empty corners, outside the plume's envelope, still run the full loop:
  an estimated 20–30% of the covered pixels, depending on the view and how
  the plume tapers. There is no early exit at full opacity.
  The material disables depth writes, yet the shader writes `gl_FragDepthEXT`
  for the depth test; on Adreno 5xx and later, writing fragment depth turns
  off low-resolution Z culling ([sources](#sources)). With the default
  opaque-depth occlusion active, the box's own depth test rejects the same
  pixels the shader discards, so a variant without the depth write should
  draw the same image.
- **Exhaust depth candidates** (`exhaust/src/engineExhaustDepth.ts`). Every
  frame the pass walks every mesh in the scene, terrain and Google tiles
  included, and projects all eight corners of each world bounding box. A
  bounding-sphere test against the plume's sub-frustum, expanded by the same
  two-texel margin and applied only when the sphere lies wholly in front of
  the near plane, rejects a subset of the meshes the corner test rejects, for
  about an eighth of the arithmetic. The candidate set stays identical.
- **F135 nozzle**. The aperture is 7 flap roles × 16 identical segments: 112
  moving meshes that could be 7 instanced draws, which the F-35B model
  specification already allows after validation.
- **Aircraft culling**. Babylon tests each of the F-35B's ~260 parts against
  the frustum with its sphere and then its box. Babylon's optimistic-inclusion
  strategy accepts a part as soon as its sphere's centre is in view; that
  centre is the box's centre, so the standard test would accept it too, and
  the culled set is identical for a cheaper test.
- **Absent properties**. The control-surface reader still reads 7 absent
  F-35B paths one at a time every frame, because a property may appear later.
  A property-tree revision counter in the JSBSim SDK would let absence be
  cached exactly until the tree changes.
- **Dynamic resolution** (`renderer/src/babylon/rendererLifecycle.ts`). The
  governor switches itself off without GPU timestamps, and web3dsurvey
  reports the WebGL2 timer extension on about 0.2–0.4% of Android devices
  ([sources](#sources)). On these phones it never runs.
- **Draw order and the cockpit view**. Babylon draws opaque meshes in
  material order (`PainterSortCompare`), not front to back, and nothing here
  sets another order, so map pixels behind the aircraft or the cockpit panel
  are shaded before being covered; the world behind the cockpit is still
  drawn (the TODO in `src/flight/cockpit/cockpitScreen.ts`). The screen
  mirror refreshes at `osfs.cockpit.screen.refreshRate` (30 Hz).

Checked and ruled out: sound telemetry already uses a `SharedArrayBuffer` ring
on isolated pages and batched port messages elsewhere; the HD Vision Jet and
its 4096² texture are opt-in; the periodic save uses the batched snapshot and
a small record; the sky's ground-light probe reads back asynchronously on
WebGL2; the lens flare is off by default; pointer-move picking is already
off; deployed builds enforce cross-origin isolation.

## What is worth porting

1. **Exhaust gas optics to Rust, in a worker.** `exhaust/src/engineGasOptics.ts`
   and the field geometry weights run on the main thread every frame for the
   F-35B. The earlier notes put the exhaust's main-thread cost at 33–55 ms per
   second on the M5: gas optics 11–19, geometry 4–6, depth candidates 18–30.
   That is 5–9 ms a frame on an SD835 (estimate). The field changes slowly,
   so a worker answering one frame late would not be visible. The
   specification exists: [exhaust-wasm-worker.md](../2026-10-21/exhaust-wasm-worker.md).
   Apply the exhaust settings in the phone profile first; they cost nothing.
2. **A per-step input/output call inside JSBSim (C++).** Each step makes
   30–50 scalar embind calls. One export that takes the step's commands and
   returns the state its consumers read would replace them with one call.
   JSBSim is already C++, so this belongs in the fork rather than in Rust.
   Until then use `PropertyBatch` reads and writes, which the SDK already has
   (its native class resolves each path once and keeps per-slot `get`/`set`).
   Saves roughly 0.3–1 ms per step on an SD835 (estimate).
3. **The attitude indicator grid, to the GPU.** On WebGL2 the indicator traces
   its horizon, 16 rings and 12 meridians as polylines in JavaScript every
   frame, then strokes them on a Canvas 2D that is uploaded again. The WebGPU
   path already draws the grid per pixel and skips that work. A WebGL2
   version of the same shader removes about 3.5 ms a frame on an SD835
   (estimate) and about 2,400 short-lived objects a frame. Until then the
   cached-direction prototype is an exact 1.5× on the Canvas 2D path. A Rust
   port of the tracing would also work, but it keeps the Canvas 2D raster and
   upload, and the remaining cost is `Math.hypot` and `Math.atan2`, which
   WebAssembly cannot reproduce bit for bit without importing them.
4. **ground-contact: already ported; wire it in when convenient.** Pass
   `core: loadGroundContact()` to the contact and collision modules. The gain
   is small: the 21 October profile shows terrain contact and collision at
   0.01–0.02 ms a frame on the M5, and most of `terrainContact.update`'s time
   here is its property calls. Batch those first.

Not worth porting: HUD text and panels (DOM-bound), settings, the recorder,
sound telemetry, aircraft rigs and autopilot. After the October passes these
cost tens of microseconds on the M5.

## Improving the existing WebAssembly modules

### JSBSim build and SDK

- **Native WebAssembly exceptions.** Build every object and the link with
  `-fwasm-exceptions` and drop `-sNO_DISABLE_EXCEPTION_CATCHING`
  (Felipegalind0/jsbsim `CMakeLists.txt:51` and `wasm/CMakeLists.txt`).
  Supported since Chrome 95, Firefox 100 and Safari 15.2. This removes the 45
  trampoline imports: 12–14% off a C172 step, 4% off an F-35B step and
  25–45% off every scalar property call. Floating-point code is untouched, so
  results should be identical; confirm with fly's JSBSim integration tests.
  Check how the SDK turns a C++ exception into a JavaScript error, because
  that path changes.
- **LTO, then SIMD.** Add `-flto` for inlining across JSBSim's many small
  virtual calls, then try `-msimd128`. Measure each on its own.
- **The F135 plant.** In cruise it already runs the reduced algorithm with a
  Broyden-updated Jacobian: 2 Newton iterations and 10 residual evaluations
  per step, against about 22 for the component reference. Yet the plant
  costs roughly 260 µs of the F-35B's ~350 µs step (the empirical engine
  variant is 87 µs in all), and doubling the evaluations adds only about
  35%. Most of the plant's time is outside the residual evaluations. Profile
  a build with function names before changing the solver. Until then, the
  empirical engine is the phone setting.
- **A property-tree revision counter.** Absent paths are read one at a time
  every frame in case they appear. A counter the SDK bumps when a node is
  created lets callers cache absence until it changes, with identical
  results.
- **Property access by string.** Every scalar call converts a JavaScript
  string and walks the property tree. Paths read every step or frame should
  go through batches, which resolve their nodes once.
- **A profiling build.** Ship a variant linked with `--profiling-funcs` so CPU
  profiles name JSBSim's functions. The current binary has no name section.

### Other modules

- **Sound DSP (`core.cpp`):** add `-msimd128`. Without fast-math the compiler
  vectorizes only element-wise loops, so output bits should not change; the
  deterministic fixtures will show it.
- **ground-contact:** wire it in (above). Its parity checks already exist.
- **multirotor and electric-sound:** fine as they are. Drones ask for 120 Hz
  physics; check whether 60 Hz keeps their behaviour on the phone profile.

## Other 0SFS changes

### 1. A phone profile from settings that already exist

Offer it when a device looks old: WebGL2 only, mobile, 8 or fewer cores,
4 GB or less memory, or frames averaging over 20 ms in the first 10 s of
flight. Offer it rather than switching silently.

| Setting | Default | Phone | Why |
| --- | --- | --- | --- |
| `renderer.resolutionScale` | 1 | ≈1.25 ÷ DPR | 0.5 at DPR 2.6: about 0.65 instead of 2.6 megapixels |
| `renderer.antialias` | on | measure off | MSAA is cheaper on tile GPUs than on desktop GPUs; keep it if the frame allows. `renderer.upscaling` EASU softens less if it goes. |
| `renderer.dynamicResolution` | off | on, once it has a fallback | Needs GPU timestamps today (hand-off item 4) |
| `osfs.exhaust.sampleCount` | 32 | 8–12 | Ray-march samples per plume pixel, each with nested support loops |
| `osfs.exhaust.depthResolutionScale` | 1 | 0.5 | The opaque-depth pre-pass draws the aircraft again |
| `osfs.exhaust.axialFieldSamples` × `radialFieldSamples` | 64 × 32 | 32 × 16 | 4× fewer field cells to compute on the CPU and upload |
| `osfs.exhaust.light.enabled` | on | off | A real Babylon point light on the scene's lit materials |
| `osfs.exhaust.smoke.maxParticles` | 64 | 16–24 | Particle updates and blended overdraw |
| `osfs.engine.model` (F-35B) | plant | empirical | 86–90 instead of 341–373 µs a step |
| `osfs.cockpit.screen.refreshRate` | 30 Hz | 15 Hz | The cockpit view's page mirror |
| `osfs.cockpit.screen.background` | black, except on fast computers | black | The chase background draws the view a second time |
| `interface.toolbar.activityOutline` | spinning | still | Measured restyle every frame while tiles stream ([flight frame](../2026-10-22/flight-frame.md)) |
| Sky and map detail | defaults | the "Save battery" preset's values | Coarser sky computed less often, coarser imagery and terrain, smaller GPU budget |

### 2. Batch the per-step property traffic

`applyFlightControls` writes 11 properties one at a time every step;
`terrainContact.update` reads 8 and writes 1; the step callback reads about
10 more. Move them to `PropertyBatch`: one read at the start of the step for
every consumer, one write of the commands. Then the engine, trim, gear, fuel,
rest and HUD-tint reads.

### 3. Exhaust, GPU side

In order of certainty: a shader variant without the fragment-depth write
while depth occlusion is active; the ray clipped analytically to the plume's
envelope instead of the box, with an immediate discard outside it; samples
proportional to the ray's span through the envelope instead of a fixed count;
and the plume drawn at half resolution with a depth-aware upsample. The last
three change the quadrature, so judge them by their error against a
128-sample reference image, not by eye: each must be no worse than today's
32-sample default. Details in [prompt 07](prompts/07-exhaust-gpu.md).

### 4. Drop the HUD's backdrop blurs

The toolbar instrument pills (`src/styles/flight.css:370–378`: load, gear and
autopilot in the default compact layout; tapes in the classic one), the
circle buttons (`src/styles/globe.css:93–104`) and the status card
(`src/styles/flight.css:1406`) use `backdrop-filter: blur()` over a canvas
that changes every frame, so the compositor blurs what is behind each one
every frame. Their fill is already 76% opaque, so the blur is barely visible;
a flat fill near 85% looks the same. Not measured: try it as one A/B on the
phone.

### 5. F-35B model and draws

The airframe and installed F135 are 259 primitives and 349 nodes for about
25,000 triangles, so the cost is per draw, not per triangle: render CPU was
2.2 ms against the C172's 0.36 ms on the M5. Instance the nozzle's 112 flap
meshes as 7 draws, switch the parts to optimistic-inclusion culling, and
follow the model specification ([f35-model-lod.md](../2026-10-21/f35-model-lod.md)) for
merging static parts. Most of the installed engine sits inside the fuselage;
leave it out of exterior views.

## For the FOSS Earth agent

Checked against FOSS Earth `main` on 5 November 2026. These are outside 0SFS
but decide most of the streaming frame. Each has a prompt (F1–F5 in
[prompts/](prompts/README.md)).

1. **Two raster updates per flight frame.** `setExternalViewState` calls
   `rasterTilesRuntime?.update()` (`engine/src/babylon/createGlobeRuntime.ts:2187`)
   after `prepareFrame`'s own update (line 747). Removing it measured
   26.5–28 → 36–37 fps at 4× CPU on 22 October. Backlog item C11, waiting on
   a decision.
2. **The terrain core binds its Math imports.** `engine/terrain-WASM/index.js:22`
   passes `math[name].bind(math)`, which turns off V8's fast path for
   imported Math functions: 2.5–3.7× slower per `sqrt` or `floor` call here.
   The sky and projection cores pass the functions directly. Better still,
   emit native `f64.sqrt`, `floor`, `min` and `max` (identical apart from NaN
   payloads) and an exact ceil-based `Math.round`. This may be part of why
   terrain heights and geometry measured slower in WebAssembly than in
   TypeScript; it runs in workers, so it costs throughput and heat rather
   than frame time.
3. **The imagery pipeline is the largest main-thread cost.** Selection,
   binding, residency and the loaded-detail refresh are TypeScript on the
   page, with a 2 ms selection budget per update and two updates per frame.
   On an SD835 that budget buys a tenth of the work, so imagery lags while
   the frame still pays. Candidates: selection in a worker with a Rust core,
   selection that starts from the previous cut instead of the root, and a
   lower refresh cadence on slow devices (backlog C12).
4. **Phone rendering.** Full device-pixel ratio, MSAA on and no frame cap by
   default. Dynamic resolution needs GPU timestamps, which Android WebGL2
   devices almost never expose; a governor driven by frame interval and
   main-thread time would work there. A device that cannot hold 60 should
   settle at an even 30 rather than an uneven 40–55. The lens flare's
   readback is a blocking `gl.readPixels` on WebGL (off by default); the
   ground-light probe already reads back asynchronously. The world
   viewport's canvas-size read forces style and layout every frame
   (15.6–16.2 ms/s at 1× on the M5); a `ResizeObserver` size behind a
   setting would avoid it at the cost of showing a resize one frame late.
5. **Worker counts on big.LITTLE phones.** An SD835 reports 8 threads, so the
   preparation-worker budget is 17, with 7 elevation decoders. During
   streaming bursts they compete with the main thread for the 4 fast cores
   and heat the phone sooner. Cap decoding at 2–3 workers on mobile.
6. **Already in the backlog with measurements:** per-frame UI occlusion box
   reads (C14) and the spinning activity outline (P13).

## Corrections from the review passes

The first version of these findings, shared as a web page earlier in the
session, was checked twice before this commit. Changes:

- **Exception trampolines:** a CPU profile of the real binary puts them at
  12–14% of a C172 step and 4% of an F-35B step. The first version estimated
  20–25% and 6% from the microbenchmark alone. The JSBSim exception change
  moved below property batching.
- **Scalar calls per step:** the first harness counted through two extra
  timing loops and reported 16 reads and 24 writes for terrain contact and
  controls; they make 8 and 12. The second review then found about 10 more
  reads in the step callback itself, so the per-step total is 30–50 calls and
  the estimate rose to 0.3–1 ms per step.
- **F135 plant:** it already reuses a Broyden-updated Jacobian. The first
  version's advice to add that was withdrawn; the plant needs a named
  profile instead.
- **Worker budget:** 17 on an 8-thread phone, not about 13.
- **ground-contact Rust:** still unused, but ranked lower: the work it
  replaces is small.
- **Cross-origin isolation:** deployed builds enforce it through the service
  worker, so the first draft's note that it was off was dropped.
- **WebGPU on Android:** Chrome 121 shipped it for Android 12 and later, with
  Android 11 announced for later, so a Pixel 2 on Android 11 may have it.
  WebGL2 is still the path to make fast.

## Not verified

- No SD835 or other phone was profiled; every per-frame figure for the phone
  is an estimate.
- No browser profile of the current build was taken; the browser figures are
  the 21 and 22 October measurements.
- GPU estimates are rough ratios. Babylon's per-draw CPU on Android WebGL is
  probably worse than 10× the M5's.
- The costs of the backdrop blurs, the plume's fragment-depth write and the
  box proxy's empty corners are not measured, nor the gains from
  optimistic-inclusion culling and nozzle instancing.
- Where the F135 plant spends its time is not measured; only that it is
  mostly outside the residual evaluations.
- The frame-pacing figures come from a model with Gaussian vsync jitter, not
  from a phone trace.

## Order of work

The prompts are numbered in the order to run them.

1. **Measure one real phone first** ([01](prompts/01-device-baseline.md)).
2. **Settings only:** the phone profile ([02](prompts/02-phone-profile.md)),
   then the HUD blur A/B ([11](prompts/11-hud-compositing.md)).
3. **Small code:** the attitude indicator ([03](prompts/03-attitude-indicator.md)),
   property batches ([04](prompts/04-jsbsim-property-io.md)), wiring
   ground-contact ([10](prompts/10-ground-contact-core.md)).
4. **JSBSim build** ([05](prompts/05-jsbsim-build.md)): native exceptions,
   then LTO, each as its own A/B.
5. **Larger:** the F135 plant ([06](prompts/06-f135-plant.md)), the exhaust
   GPU and CPU work ([07](prompts/07-exhaust-gpu.md),
   [08](prompts/08-exhaust-cpu.md)), the F-35B draws
   ([09](prompts/09-f35b-draws.md)), and frame-locked steps
   ([12](prompts/12-fixed-step-phase.md)) last.
   Draw order and the cockpit view ([13](prompts/13-draw-order-cockpit.md))
   can run any time after 01.
6. **In parallel:** the FOSS Earth prompts F1–F5, starting with the double
   raster update.

## Reproduction

From the fly checkout, after `node scripts/link-packs.mjs` (which `npm test`
runs first):

```sh
npx vitest run --configLoader native --config docs/performance/2026-11-05/harness/vitest.config.ts
COUNT_INVOKES=1 npx vitest run --configLoader native --config docs/performance/2026-11-05/harness/vitest.config.ts -t "JSBSim step"
node docs/performance/2026-11-05/harness/wasm-call-overheads.mjs
```

The vitest run takes about a minute and appends one JSON line per case to the
ignored `build/perf-20261105/results.jsonl`. `COUNT_INVOKES=1` uses a copy of
the emscripten glue whose trampolines count their calls; its step times are
not comparable with the plain run. The third command is plain Node with
hand-encoded modules and no dependencies. On a checkout whose FOSS Earth
packages are not built, the vitest config falls back to source resolution,
which is how it ran in this session. The frame-pacing model is the short
Python program in [prompt 12](prompts/12-fixed-step-phase.md).

## Sources

- Geekbench 6 single-core, Snapdragon 835:
  [CPU Monkey](https://www.cpu-monkey.com/en/benchmark-qualcomm_snapdragon_835-geekbench_6_single_core),
  [Comparigon](https://comparigon.com/mobilesocs/snapdragon-835).
- Geekbench 6 single-core, Apple M5:
  [Geekbench Browser](https://browser.geekbench.com/v6/cpu/14705414),
  [MacRumors](https://www.macrumors.com/2025/10/17/m5-chip-macbook-pro-geekbench-benchmark/),
  [iClarified](https://www.iclarified.com/100132/first-m5-max-benchmarks-reveal-fastest-apple-cpu-yet).
- WebGPU on Android: [What's New in WebGPU (Chrome 121)](https://developer.chrome.com/blog/new-in-webgpu-121).
- WebGL2 GPU timers on Android: [web3dsurvey, EXT_disjoint_timer_query_webgl2](https://web3dsurvey.com/webgl2/extensions/EXT_disjoint_timer_query_webgl2).
- Adreno low-resolution Z: [Qualcomm Game Developer Guide FAQ](https://developer.qualcomm.com/sites/default/files/docs/adreno-gpu/snapdragon-game-toolkit/gdg/gpu/faq.html),
  [Igalia, Low-resolution-Z on Adreno GPUs](https://blogs.igalia.com/dpiliaiev/adreno-lrz/),
  [Mesa freedreno LRZ notes](https://docs.mesa3d.org/drivers/freedreno/hw/lrz.html).
