# The flight's frame: measured improvements and remaining performance decisions

Measured overnight on 2026-10-21/22 in headless Chrome, WebGPU through ANGLE Metal, on an
M5 MacBook Air on AC power. The page was 1280×800 CSS px at DPR 1, flying the default C172 from the
default spawn. Each run is an 8 s CPU profile at 1× and at 4× CPU throttle. A/B arms were built
from one recorded snapshot of every local source the flight loads, with only the file under test
substituted, so other agents' concurrent edits could not leak into a comparison. Runs alternate
A, B, A, B.

The tools are `foss-earth/research/scripts/benchmarks/startup-audit/profile.mjs --target fly`, plus
the pinning config, A/B runner and comparison script kept under `fly/build/osfs-night/`
(gitignored).

## Where a frame's main-thread time goes

The two clean `resq` runs put `prepareFrame` and Babylon's render together at
254–261 ms/s at 1× and 719–726 ms/s at 4×. This is the pinned C172 measurement arm,
which includes the uncommitted landing-light and ring experiments below; it is not a measurement
of committed HEAD alone. The third `resq` run overlapped a Node benchmark and is excluded here.

| Work | ms/s at 1× | ms/s at 4× |
| --- | ---: | ---: |
| First engine raster update in `prepareFrame` | 112.0–112.4 | 352.9–354.7 |
| Second engine raster update, from the flight's `setSimViewState` (below) | 49.5–53.4 | 168.5–179.7 |
| Babylon render | 57.5–57.6 | 114.3–115.7 |
| Flight tick excluding its nested raster update | 23.0–25.5 | 57.0–61.2 |
| `applyWorldViewport` canvas read, including forced style/layout; **nested in the work above** | 15.6–16.2 | 26.3–29.6 |

The flight's own code is a small share of the frame. Most remaining work is the map engine and
Babylon. Representative self time by file in the `resq` arm at 1× is: imagery selector 53 ms/s,
imagery binding 28, imagery runtime 18, world viewport 15, raster runtime 13, imagery geometry 11,
residency 9.6, terrain height pixels 8.3, Babylon uniform buffers 7.9, GC 7.8, JSBSim WASM 6.8,
and terrain height batches 6.7. These self times do not overlap; the inclusive rows above do.
The selector's largest leaf is `evaluateView`, about 17 ms/s self. The tour pass already sped the
selector up about 30% in engine `497e013`; its bit-for-bit identity digests remain the guard.

## Shipped: the HUD writes only what changed

`src/flight/hud/flightHud.ts` wrote every readout, slider value, output and attribute every frame.
Chrome answers a range input's `value`, `min` or attribute write with a layout or a restyle even
when nothing changes. So each frame the next read of the canvas size, in `applyWorldViewport`,
forced the page through style and layout again. The HUD now compares before writing. A readout's
text is changed in its existing text node (`Text.data`) rather than by replacing the node through
`textContent`, so a changing readout costs a layout but no restyle. The DOM mirror (VR panels,
cockpit screen) observes `characterData` and still sees every change. The same pattern was already
in FOSS Earth's `mapDetailSlider.ts`.

The output is unchanged: the same text, values and attributes reach the page. Range inputs whose
value the browser snaps to the step still get written each frame, exactly as before. A new test
observes the HUD with a `MutationObserver`. It asserts no mutation at all when nothing it shows
changes, and exactly the changed readout, output and `aria-valuetext` when something does. The
test fails against the previous code.

Layout time (`--layout` traced, 2 + 2 runs for each arm, interleaved):

| | Before | After |
| --- | ---: | ---: |
| Layout, 1× | 7.7–7.8 ms/s | 5.9–6.1 ms/s |
| Layout, 4× | 15.8–16.8 ms/s | 11.8–14.2 ms/s |

Untraced (3 + 3 runs, interleaved). Tracing inflates layout and DOM event times, so these are
the numbers to trust:

| | Before | After |
| --- | ---: | ---: |
| Layout, 1× | 6.4–6.7 ms/s | 4.8–4.9 ms/s |
| Layout, 4× | 13.6–14.6 ms/s | 10.5–13.2 ms/s |
| `applyWorldViewport` (where the forced layout lands), 1× | 16.1–18.9 ms/s | 14.7–15.3 ms/s |
| `applyWorldViewport`, 4× | 31.8–32.4 ms/s | 28.5–30.3 ms/s |
| Frames/s, 1× | 58.5–58.6 | 58.6–58.7 |
| Frames/s, 4× | 27.0–28.1 | 24.5–27.9 |

At 4× the main thread is saturated, and frames/s there swings with how much imagery the run
happens to load. One run of the new arm was low, the other two matched. The change only removes
DOM writes; its own script time is the same as before (HUD update 4.7–5.6 ms/s against 5.1–6.0 at
1×).

At a phone's viewport (412×915 CSS px at DPR 2.625, touch; 2 + 2 runs) the result is the same.
Layout went from 6.6–6.7 to 4.9–5.0 ms/s at 1× and from 12.7–14.0 to 10.5–10.9 ms/s at 4×.
`applyWorldViewport` went from 16.8–17.0 to 15.0–15.1 ms/s at 1×. Frames/s did not move beyond
noise.

The angle-of-attack readout (`src/flight/hud/evaluationInstruments.ts`) replaced its text node
every frame. It now edits that node, only when the shown value changes, with a test of its own.

Style recalculations stay at about 2.4 per frame. Other writers still dirty style before each
canvas read: the streaming chip's spinning outline (below), the map detail rail's bars as tiles
load (genuine changes), and the HUD bar. Once the outline stops, these changes also remove a
restyle per frame.

## Shipped: the ground light probe no longer resets every material twice a second

FOSS Earth's sky lights the aircraft from below with what the ground below shows. The flight sets
`sky.groundLight.mode` to rendered, so every `sky.groundLight.probeInterval` (0.5 s) the sky draws
the ground below into a small target and reads it back. Each request emptied the target's render
list with `length = 0` and refilled it with `push`. Babylon watches a render list's `push`: when
the list goes from empty to not empty, it marks every mesh in the scene for its lights. Every
material then prepared its defines and effect again on the next frame. On the F-35B (349 nodes,
259 primitives) that was a 2.4–4 ms spike every 0.5 s. The probe now builds a new array and
assigns it, which Babylon does not treat as a lighting change. It draws the same ground, so the
light is the same, and the lights' own changes still mark the meshes as before.

F-35B, 2 + 2 runs interleaved. A first pair ran while another benchmark loaded the machine;
every source in it cost 2.5–3 times as much, so it is left out.

| | Before | After |
| --- | ---: | ---: |
| PBR `_prepareEffect`, 1× | 11.4–12.4 ms/s | 2.6–2.8 ms/s |
| PBR `isReadyForSubMesh`, 1× | 14.1–15.2 ms/s | 5.4–6.1 ms/s |
| Frames/s, 1× | 57.6–57.7 | 58.8–58.9 |
| PBR `_prepareEffect`, 4× | 25.1–26.1 ms/s | 3.6–4.2 ms/s |
| PBR `isReadyForSubMesh`, 4× | 30.0–30.6 ms/s | 8.4–8.6 ms/s |
| Frames/s, 4× | 17.9–19.6 | 19.9–20.4 |
| p95 frame, 4× | 66.7–83.3 ms | 66.7 ms |

In 250 ms bins, material preparation went from 3–5 ms in every other bin to under 2 ms with no
0.5 s pattern. What remains in the PBR material is its per-draw bind, which every frame needs.

The main-thread share in these runs is not comparable. The profile starts 15 s after the page
first shows content. In both runs without the fix, the F-35B arrived 2–3 s into the 8 s window,
but in both runs with it, the aircraft was already there. Short runs that read the loading history
had the model ready 0.7 s and 1.7 s sooner with the fix, in two pairs. In a third pair, neither run
had the model ready when it ended. A probe that sends every material back to prepare its shader
twice a second, while the aircraft's materials compile, would delay it. Three pairs do not show
that it does.

C172, 2 + 2 runs: material preparation went from 0.9–1.2 to 0.4 ms/s at 1× and from 2.5–3.3 to
0.7–0.8 ms/s at 4×. Frames/s did not move beyond noise (26.4 against 26.5–27.3 at 4×). The C172
has few meshes, so the old cost was small there.

The change is FOSS Earth sky `cb85cb0`, with a test that a second request marks no mesh for its
lights and still sees ground that has arrived since. The test fails against the previous code.

## Shipped: the F-35B's exhaust gas geometry integrates in half the time

The F-35B's exhaust integrates the volume weights of its 64×32 gas field over the engine's flow
domain (`integrateGasFlowFieldVolumeWeights` in `exhaust/src/engineGasOptics.ts`). It does this
again whenever the domain changes, which in flight is every frame (the nozzle-creep decision below). Sections without
a centerbody already reused radial integrals computed once from the grid. Inside the engine, each
radial hat's integral above the centerbody was computed from cubic primitives at every axial
quadrature point. A hat whose lower edge is at or above the centerbody has the same bounds and the
same arithmetic as with no centerbody at all, so it now reuses the same precomputed value. Most of
the engine's hats are clear of the centerbody.

The weights are bitwise identical. A scratch benchmark generated the F135 support's flow domain
at 402 nozzle positions and pitches, integrated each at three grid sizes with the previous code
and the new code, and compared the results bit for bit. It also checked the previous code against
the shipped function. The exhaust and flight tests pass. The change is exhaust `f790503`.

F-35B, 3 + 3 runs interleaved:

| | Before | After |
| --- | ---: | ---: |
| `integrateGasFlowFieldVolumeWeights`, 1× | 4.9–9.7 ms/s | 3.6–5.2 ms/s |
| `integrateGasFlowFieldVolumeWeights`, 4× | 13.7–16.7 ms/s | 7.1–7.8 ms/s |
| Exhaust update, 4× | 41.9–42.6 ms/s | 32.0–35.7 ms/s |
| Frames/s, 1× | 57.6–58.2 | 56.8–58.0 |
| Frames/s, 4× | 19.7–21.3 | 17.8–21.4 |

Frames/s does not move beyond noise: at 4× the main thread is saturated and the imagery takes
whatever the exhaust gives back.

## Shipped: the exhaust's depth pass composes each world matrix once

Before each frame, the exhaust's opaque-depth pass (`exhaust/src/engineExhaustDepth.ts`) projects
the bounds of every visible mesh to decide which ones could hide the gas. For each mesh whose world
matrix was out of date, it called `computeWorldMatrix(true)`. Babylon passes that force up the
parent chain, so every mesh recomputed all its ancestors again. The F-35B model has 149 visible
meshes among 191 nodes, nested 4 deep on average and up to 7. With the aircraft moving, that was
726 matrix compositions per frame for 191 nodes.

The pass now brings each changed node up to date once, ancestors first, and marks it the way
`markAsDirty` does without touching its descendants. A transform edited twice in one render id is
still caught, which is why the pass forced in the first place. Frozen and billboard nodes are
forced as before. The matrices are the same. A new test moves a six-deep chain after it was read in
the same render id: the pass takes 7 compositions where it took 27, and the matrices match a forced
recompute. The change is exhaust `b4ba2c9`.

F-35B, 4 runs before and 3 after, interleaved:

| | Before | After |
| --- | ---: | ---: |
| Depth pass before each frame, 1× | 33.1–50.2 ms/s | 17.6–30.1 ms/s |
| Depth pass before each frame, 4× | 62.6–74.8 ms/s | 41.4–46.0 ms/s |
| Main thread, 1× | 45–51 % | 44–49 % |
| Frames/s, 4× | 15.1–20.4 | 16.1–21.8 |
| p95 frame, 4× | 66.7–83.3 ms | 50–66.7 ms |

What the pass still spends is mostly each mesh's world bounding box (8.8–13 ms/s) and projecting
its eight corners (7.8–14.6 ms/s). The bounding boxes are work the main render would do for the
same meshes moments later when it culls them, so only the projection is the pass's own.

## Shipped: the aircraft's control surfaces are read through one native property batch

Each frame the flight reads the control surface state from JSBSim
(`readControlSurfaceState` in `aircraft/src/aircraftAnimation.ts`): surface deflections, gear,
flaps, wheel loads and engine speeds, each path tried in turn until one exists on the model. Every
read crossed into the WASM property tree on its own. The state is now read through the SDK's
native property batch (`createPropertyBatch`), made once per loaded model, in one call. A path the
model lacks still gets the scalar read it got before, because a property can appear on the tree
after load and the batch would not see it. The values are the same.

A scratch test ran the real JSBSim WASM for 2,400 steps of each aircraft with throttle, surfaces,
flaps and gear moving. Every third step it read the state both ways and compared every field with
`Object.is`:

| Aircraft | States compared, all identical | Scalar reads per state | Time per read |
| --- | ---: | ---: | ---: |
| C172 | 800 | 13 → 2 | 11.4–12.5 → 2.7–2.8 µs |
| Vision Jet | 800 (638 with gear in transit) | 17 → 5 | 18.6–19.3 → 6.7–6.9 µs |
| F-35B | 800 (399 with gear in transit) | 19 → 7 | 21.3–21.8 → 9.7–10.0 µs |

In the browser, `aircraftAnimation.ts`'s own time, interleaved runs:

| | Before | After |
| --- | ---: | ---: |
| F-35B, 1× (3 + 3 runs) | 10.6–11.6 ms/s | 6.9–8.3 ms/s |
| F-35B, 4× | 16.2–19.3 ms/s | 12.0–12.5 ms/s |
| C172, 1× (2 + 2 runs) | 2.3–2.4 ms/s | 1.4–1.7 ms/s |
| C172, 4× | 4.1 ms/s | 3.1–4.5 ms/s |

The F-35B's remaining scalar reads are paths it lacks: four propeller and engine speed paths and
three wheel loads. Keeping those exact needs the scalar reads, since the SDK cannot say when a
property is added. The change is aircraft `c3bcf8f`. Its test checks four things. The batch and
scalar readers give the same state. Scalar reads happen only for absent paths. A property that
appears later is read. After the SDK disposes the batch on a model change, a new batch is made.

## Ready, not committed: the landing lights read only the gear position

The aircraft lights ask whether the gear is down (`getGearDownNorm`) for each light mounted on it.
They ask once for each of the light's intensity evaluations and once more when placing its beam on
the ground. On the F-35B that is several times a frame. Each answer read the whole control surface
state just to take its `gearDownNorm`. The aircraft now exports `readGearDownNorm`, which reads the
same batch and computes the gear position the same way, and nothing else. Its test runs five gear
cases through three kinds of SDK and checks that it equals the whole state's `gearDownNorm` each
time. The change is aircraft `ab43a16`.

The flight's side is a two-line change in `src/flight/createFlightSimApp.ts`: import
`readGearDownNorm`, and pass `getGearDownNorm: () => readGearDownNorm(jsbsim.sdk)` to the lights.
**It is not committed.** That file also holds another agent's large uncommitted edit, and
committing only my two lines was refused by the session's permission check, so I left it alone.
The patch against `HEAD` is `build/osfs-night/patch/gear.patch`. The two lines are in the working
tree now.

F-35B, 3 + 3 runs interleaved, `aircraftAnimation.ts` and `createAircraftLights.ts` together:

| | Before | After |
| --- | ---: | ---: |
| 1× | 12.7–17.4 ms/s | 3.7–4.8 ms/s |
| 4× | 17.3–24.7 ms/s | 6.9–8.7 ms/s |
| Frames/s, 4× | 17.3–21.8 | 18.8–22.8 |

The lights' own functions shrink as well because V8 had inlined the state read into them.

## Shipped: residency sorts each demand once

`foss-earth/engine/src/terrain/imagery/imageryResidency.ts` used to filter and sort the whole demand
on every `pump`, even while it was unchanged and its requests were already loading. The queue now
keeps one sorted order until `setDemand` changes it. Missing-image checks still run in demand order
on each pump. A NaN priority uses the previous filtered-sort path because its comparator does not
give a total order. Nothing about request priority, retries, cancellation or publication changes.

The change is engine `18e3850`. All 17 residency tests pass, including a regression that fails
against the previous implementation. The earlier verification also passed lint and typecheck.
A differential harness compared the previous implementation with the working copy for 600 seeds
of 250 random operations, including NaNs, infinities, missing images, retries, source changes,
uploads and capacity changes. Every observable result matched, and three intentionally broken
versions were detected.

`resq`, 3 + 3 interleaved runs; the last new-arm 1× profile overlapped a Node benchmark, so its
7.4 ms/s pump sample is excluded from that range:

| | Before | After |
| --- | ---: | ---: |
| `pump`, 1× | 14.9–18.5 ms/s | 4.4 ms/s (2 clean runs) |
| `fillQueue`, 1× | 13.4–16.8 ms/s | 3.2–5.3 ms/s |
| `pump`, 4× | 28.6–29.7 ms/s | 6.2–9.2 ms/s |
| `fillQueue`, 4× | 24.2–24.8 ms/s | 4.3–6.2 ms/s |

Frames/s did not change beyond noise. The inclusive function ranges are not additive.

## Shipped: classify imagery cells without repeating region work

`measureLoadedImageryDistribution` in `imageryBinding.ts` classified every table cell by repeating
its region's footprint validity checks and logarithm, writing an existing image group back to its
Map, and looking up each slot twice. Engine `b7a0bbb` computes the region values once, creates a
group only on first use, uses one slot lookup, and computes the cell-area fraction once per table
intersection. Every cell still contributes in the original order. In particular,
`logarithm + level - referenceLevel` keeps the original floating-point operation order.

All 34 binding and selector identity tests pass, as do engine lint/typecheck and the flight's
typecheck. The new regression counts every table cell but needs one logarithm for the region;
the previous implementation needs four. A separate harness compared every output with the old
function for 1,000 varied distributions, including missing identities, empty cells, direct
bindings, invalid footprints, infinities and fractional values. Every result matched exactly.

An interleaved dense-table microbenchmark took 101.5 ms before and 68.9 ms after, about 32% less.
The actual pinned flight comparison (`distq`, 2 + 2 interleaved runs) is smaller:

| | Before | After |
| --- | ---: | ---: |
| `measureLoadedImageryDistribution`, 1× | 6.1–7.0 ms/s | 5.4–5.6 ms/s |
| `measureLoadedImageryDistribution`, 4× | 24.1–25.5 ms/s | 17.5–19.2 ms/s |
| Frames/s, 1× | 58.6–58.7 | 58.7 |
| Frames/s, 4× | 25.4–27.8 | 28.1–29.1 |
| p95 frame, 4× | 50 ms | 50 ms |

Two pairs do not establish how much of the FPS movement comes from this edit. Other unchanged
work varied substantially: `patchTableDepth` cost 39.5 ms/s in the first baseline 4× profile but
18.8–19.9 in the other three. The function-cost reduction and exact differential results support
the change; the whole-flight FPS range is context. Distribution cadence, feedback and publication
remain unchanged, so the distribution-throttle decision below still stands.

## Waiting on your decision: ring packing after layout

The prepared `engines/src/engineSummary.ts` change uses a ResizeObserver instead of measuring the
ring after every changed digit. The seven summary tests pass. The `ring` profiles show the repeated
packing work disappearing; all recorded label transforms match between arms. The live numeric
text was sampled at slightly different simulation times, so those probes alone are not an
identical-input comparison.

The last two pairs, excluding the first pair because it began during the known Node benchmark:

| | Current packing | ResizeObserver |
| --- | ---: | ---: |
| Summary `render`, 1× | 1.3–1.4 ms/s | 0.2 ms/s |
| Summary `render`, 4× | 5.9–7.3 ms/s | 0.4–0.5 ms/s |
| Layouts/frame, 1× | 1.33–1.34 | 1.26–1.28 |
| Layouts/frame, 4× | 1.82–1.91 | 1.61–1.62 |
| Frames/s, 4× | 19.7–22.4 | 18.3–20.2 |

There is no demonstrated FPS gain. A separate Chrome fixture compared identical inputs at DPR 1
and 2.625: initial packing, unchanged-width digits, growing/shrinking numbers and a size change
accompanied by a text change all produce identical text and transforms. **Resizing with unchanged
text does not:** the observer repacks immediately, while the current implementation keeps its
previous transforms until a digit changes. The optimization therefore remains uncommitted, with
its test, as a decision about that resize behavior. Evidence is in
`engines/build/ring-check/results.json`; the original prepared source is also retained under
`fly/build/osfs-night/engineSummary.new.ts`.

## Waiting on your decision: the gas field is rebuilt for a nozzle that moves 7e-9 per frame

The F135's nozzle position comes from JSBSim (`propulsion/engine[0]/nozzle-pos-norm`). In steady
flight it settles slowly: a probe over 316 frames found it near 0.32441 and changing on 315 of
them, by about 6.8e-9 per frame, shrinking with a time constant of about 11 s. Each change moves
the aperture geometry, so the exhaust rebuilds the gas support, integrates the field's geometry
weights again (the shipped gas-geometry change above) and uploads the support. No one can see a change of 7e-9 of the
nozzle's travel.

With the faster integration, that geometry work is about 5–7 ms/s at 1× and 10–11 ms/s at 4× on
the F-35B: geometry weights 3.9–5.7 and 7.5–8.3, support rebuild 0.5–0.6 and 0.9–1.5, and the
support upload about 1.1–1.5 at 4×. These are profile attributions, not an arm. The rest of the
gas optics (about 11–19 ms/s at 1×) follows the gas temperatures and fuel flow, which also change
every frame. That part is the work the exhaust's planned WASM worker would take off the main thread
(`docs/performance/2026-10-21/exhaust-wasm-worker.md`).

Options:

- Feed the exhaust a quantized aperture, for example to 1e-4 of the nozzle's travel. The geometry
  then changes only when it crosses a quantization boundary. The normalized aperture differs
  by up to that step; this does not bound image error, which needs visual review.
- A setting for how often the gas field's geometry may be rebuilt, defaulting to every change,
  which is today's behaviour.
- Keep it as it is.

## Waiting on your decision: one raster update per frame instead of two

The engine's `setExternalViewState`, which the flight calls through `setSimViewState` from inside
its tick, runs `rasterTilesRuntime.update()` again
(`foss-earth/engine/src/babylon/createGlobeRuntime.ts`, `setExternalViewState`). The frame's own
update in `prepareFrame` has already run. Only sim-mode hosts (the 0SFS flight) take this path;
the tour and the app run one update per frame. The flight calls `setSimViewState` before
`floatingOrigin.apply` and `applyChaseFrame` move the camera. The update reads its view and focus
from the camera, so the second update sees the same view as the first. What it adds is a second
budgeted selection step and upload pump each frame, plus a second pass of the per-update fixed
work: publication, loaded-detail refresh, feedback, and a forced layout to read the canvas size.

An arm with that one call removed (3 + 3 untraced runs, interleaved):

| | Two updates (now) | One update |
| --- | ---: | ---: |
| Frames/s at 4× | 26.5–28.1 | 36.4–37.2 |
| p95 frame at 4× | 50 ms | 33.3 ms |
| Raster update work at 4× | 538–566 ms/s | 465–472 ms/s |
| Imagery selection at 4× | 136–144 ms/s | 93–96 ms/s |
| Main thread at 1× | 35–37 % | 34 % |
| Raster update work at 1× | 167–180 ms/s | 150–154 ms/s |
| Forced style / layout per frame | 2.4 / 1.4 | 2.0 / 1.0 |

At full speed the selection work is the same either way (46–52 ms/s against 46–47), because
selection is not budget-bound there and the remaining call absorbs it. On a CPU-starved device
(the measured 4× arm), the flight runs about a third faster, but imagery selection gets about a
third less time per second, so detail may arrive more slowly. That trade is a product decision,
so it is not shipped.

The change, if wanted, keeps the immediate update for calls made while the simulation is not
running (startup placement, relocation), so loading still starts at once:

```ts
simViewState = { ...current, ...partial };
if (!simRunning) rasterTilesRuntime?.update();
```

It belongs in FOSS Earth's engine and should go behind a setting, or be adopted outright, by
whoever owns the globe runtime.

A measured middle course (`c11m`, 3 + 3 interleaved runs) uses one update with imagery selection
4 ms, upload 4 MiB and terrain mesh rebuild 4 ms, versus the defaults of 2 each. It preserves
selection effort while dropping repeated fixed work:

| | Two updates | One update, doubled budgets |
| --- | ---: | ---: |
| Raster update, 1× | 177.2–191.4 ms/s | 152.0–163.1 ms/s |
| Raster update, 4× | 537.4–554.4 ms/s | 479.8–513.7 ms/s |
| Imagery selection, 1× | 48.2–49.6 ms/s | 47.6–50.6 ms/s |
| Imagery selection, 4× | 115.1–132.3 ms/s | 118.4–139.6 ms/s |
| Frames/s, 4× | 22.6–25.8 | 25.9–30.9 |
| p95 frame, 4× | 50–66.7 ms | 50 ms |
| Style / layout per frame, 4× | 2.60–2.66 / 1.59–1.61 | 2.01–2.02 / 1.03–1.05 |

This cohort's baseline was slower than the earlier `c11` cohort; compare within each table.
The middle course still changes selection/upload scheduling and may change when detail appears.
Neither arm is shipped. Any setting should default to today's two updates, and preserve immediate
updates when the simulation is stopped. The second update costs roughly 50–65 ms/s at 1× across
these profiles; that inclusive cost is not all recoverable because the remaining update absorbs
selection and upload work.

## Waiting on your decision: the spinning activity outline

While tiles stream, the streaming chip and the FPS chip run a light around their outline. The
light is a registered custom property (`--hud-spin-angle`) animated by CSS. Chrome runs that
animation on the main thread, not the compositor, and restyles the page for it every frame. The
canvas read in `applyWorldViewport` then pays for that restyle. The comment in
`src/styles/globe.css` saying the animation costs nothing in script is wrong. The shared
`foss-earth/toolbar/src/styles/toolbar.css` already says it restyles and repaints.

The setting to turn it off already exists: Interface → Toolbar → Activity outline
(`interface.toolbar.activityOutline`), Spinning by default. Still draws the steady outline used
for reduced motion. Same build, the two settings alternated, 4 runs each:

| | Spinning (default) | Still |
| --- | ---: | ---: |
| Style recalculation, 1× | 9.5–9.8 ms/s | 3.2–3.3 ms/s |
| `applyWorldViewport`, 1× | 14.8–16.0 ms/s | 6.9–7.6 ms/s |
| Main thread, 1× | 35–36 % | 33–35 % |
| Style recalculation, 4× | 20.0–20.2 ms/s | 7.4–8.5 ms/s |
| `applyWorldViewport`, 4× | 27.9–32.0 ms/s | 16.9–17.9 ms/s |
| Frames/s, 4× | 27.3–28.2 | 28.3–29.8 |

The number of recalculations stays at 2.4 per frame. Each one costs about a third as much
without the animated property. Paint and raster of the chips are not in these numbers; they are
on top. The light runs whenever tiles stream, which in flight is most of the time.

With Still set in both arms, the separate `aoa` comparison (2 + 2 runs) isolates the
angle-of-attack text-node optimization described above. Style recalculations/frame fall from
2.39–2.43 to 1.65–1.66 at 1× and from 2.64–2.67 to 2.15–2.20 at 4×. Layouts/frame move only
slightly: 1.41–1.43 to 1.37–1.38 and 1.59–1.62 to 1.58–1.59. This confirms that the animated
outline masked redundant text-driven restyles. It does not change the default animation.

The options:

- Default the flight to Still. It is one default, it is pixel-different only in the chips'
  outlines, and anyone can turn the light back on.
- Keep a moving light but rotate it with a transform on a pseudo-element, which the compositor
  runs without restyling the page. It looks close to the current comet but is not pixel-identical,
  and the change belongs in FOSS Earth's toolbar styles, which the app and tour share.
- Keep it as it is.

## Waiting on your decision: imagery height verification in a worker

With `native.tier=single`, the page already computes the heights needed to select and measure
imagery. The imagery worker then verifies those results. Earlier attribution put the main-thread
`flush`/`receive` work at about 13.4 ms/s at 1× and 35.6 ms/s at 4×.

`nimg` alternated the same `osfs-ring` build with and without
`set.native.core.imagery=typescript`, 2 + 2 runs:

| | Worker placement | TypeScript placement |
| --- | ---: | ---: |
| Main thread, 1× | 35–39% | 47–54% |
| Imagery update, 1× | 163.9–176.4 ms/s | 298.8–344.3 ms/s |
| Imagery selection, 1× | 47.3–53.1 ms/s | 147.0–173.1 ms/s |
| Imagery update, 4× | 490.7–526.7 ms/s | 581.7–583.8 ms/s |
| Frames/s, 4× | 23.0–24.3 | 21.3–23.5 |
| p95 frame, 4× | 50 ms | 66.7 ms |

In this cohort, worker `flush` plus `receive` cost 10.6 and 12.9 ms/s at 1×, and 29.9 and
30.5 ms/s at 4×. They disappear in TypeScript placement. **This arm also removes page batching
and memoization**: `createRasterTilesRuntime.ts` creates `heightBatches` only for worker placement
and only then exposes `imagerySurface.heightsAt`. The increase in selector work dominates the
saved verification overhead. These results do not establish a saving from disabling verification
alone, and selecting TypeScript globally is not an optimization for this workload.

The useful next experiment would keep the page's packed queries and revision cache while making
worker verification optional or sampled. A setting must default to current verification, and
report the actual backend, verification policy and fallbacks. No placement or verification
behavior changed in this pass.

## Waiting on your decision: throttle the loaded-detail distribution

`createImageryRuntime.ts` already throttles its primary loaded-detail measurement with
`reselectWhileMovingMs`. A binding change can still reach `syncDistribution`, which measures
loaded pages at `latestView` whenever the page set, camera or surface changes. In flight the
camera changes every frame, so its view cache rarely hits. The distribution drives the detail
rail's population of source images, with their measured detail and visible-area weights.

The earlier attribution was about 19 ms/s at 1× for this distribution work. A clean `resq`
pair attributes 27.8–28.8 ms/s inclusively to `syncDistribution`, including selection measurements
and binding classification. Across the representative analysis, `measureImageryView` alone costs
about 39 ms/s: 23 under `refreshLoadedDetail` and 16 under `syncDistribution`. Those caller
attributions overlap the distribution total and must not be added to it.

Reusing the previous measured view until the existing throttle permits another measurement would
reduce this work, but the rail would lag the current camera while tiles arrive. It could also
alter the timing of published feedback. This has no isolated A/B yet. Options are to retain the
current cadence, or expose a distribution refresh interval defaulting to today's behavior and
measure both its cost and the visible lag before choosing a new default.

## Waiting on your decision: periodically re-resolve absent native properties

The control-surface batch resolves property paths once. A missing path still gets a scalar read
every time because JSBSim can add it later; the SDK has no property-tree revision notification.
On the F-35B that leaves seven scalar reads per surface state: four propeller/engine speed paths
and three wheel loads. The committed batch optimization preserves all of them. The remaining
animation cost reported above includes other work, so it is not a saving estimate for this idea.

Periodically rebuilding or re-resolving absent batch slots could avoid most of these crossings,
but would delay detection of a newly added property. A refresh-interval setting must default to
the current every-read fallback. An exact alternative is an SDK property-tree mutation revision
or notification, so absence can be cached until the tree changes; that requires work in the SDK.
Neither option was implemented or measured as an arm.

## Waiting on your decision: merge F-35B primitives

The airframe and installed F135 have 259 source primitives and 349 nodes combined. Static opaque
pieces sharing a material and motion group are candidates for merging, with the logical nodes
retained for animation and attachments. This changes the scene structure and may change draw
order, transparency, depth and material behavior. It has not been shown pixel-identical and is
not part of the runtime fixes shipped here. The separate
[F-35B model work specification](../2026-10-21/f35-model-lod.md) records the inventory, required
motion/visibility boundaries and visual review needed before such a change.

## Remaining exact-output candidates and stopping point

- Selector allocations: `evaluateView` still creates point, hull and measurement arrays and
  closures. Delaying the combined hull and hull-point arrays until clip culling succeeds took
  402.1 ms against the reference's 399.6 ms in 12 interleaved moving-view benchmark rounds.
  It preserved the benchmark's drag result but gave no measurable benefit and was reverted.
  More invasive reuse would need to preserve point order, surface calls and reentrancy; there
  is no measured reason to ship it yet.
- The screen-area experiment removed `slice`, `map`, clamp closures and repeated clamps. Its
  moving-view benchmark was 388 ms versus the reference's 382 ms (12 interleaved rounds;
  unchanged-source baseline 392 versus 387 ms). There was no measured gain, so it was reverted.
- The measured cell-classification improvement above is shipped. Further binding-table work must
  preserve every publication and diagnostic update. Skipping `publishManaged` on staged revisions
  was already rejected because it changes behavior.
- The canvas-size read is where other DOM writers' pending restyles are paid. Caching it would
  delay resize handling by a frame; it was rejected. `Math.hypot` to `sqrt` was rejected because
  the results differ in their bits.
- No further default or scheduling changes are included. The decisions above, the held ring
  change and the mixed-file landing-light commit need review before they can become shipped
  improvements. All four queued comparisons completed, and Chrome clone cleanup was run.

