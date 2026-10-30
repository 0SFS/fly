# Frame times

Current implementation audit: 29 October 2026, including local uncommitted
source. [Resource administration](README.md) records revisions and scope.

The shared renderer owns frame scheduling and profiling. The flight adds its
sections to that same session and exposes it at **Debug → Frame budget** and
through [frameProfile.ts](../../src/flight/diagnostics/frameProfile.ts). A frame
time is an outcome of several resources; use the [main-thread inventory](main-thread.md),
[GPU](gpu.md), [worker CPU](cpu-workers.md), [memory](memory.md),
[network](network.md) and [audio](audio.md) to identify the constrained owner.

## What each time means

| Reading | What it establishes | What it does not establish |
| --- | --- | --- |
| Frame interval, ms | Time between profiler frame boundaries; mean/p50/p95/p99/max describe pacing. `1000 / meanMs` gives average frame frequency over that sample. | Script execution duration, display scanout, input-to-photon latency or a complete census of every preparation callback. Idle/wait time can be included. |
| Instrumented CPU sections, ms/frame | Elapsed time inside named synchronous spans; `measuredMeanMs` adds top-level non-concurrent sections. | Total main-thread busy time, CPU cycles, utilization of every worker/core, or an isolated JSBSim solve cost. |
| Whole main-thread busy time / browser trace | Browser-observed tasks, events, style/layout, GC and script samples, including work omitted from named spans. | Instrumentation-free performance; tracing itself changes cost. |
| GPU duration, ms | Renderer timer result where supported, reported under `gpu/globe`. | Driver-reported utilization, VRAM usage, or the exact GPU work belonging to the currently displayed CPU trace frame. Readings arrive late and may be reused between timer updates. |
| Resource CPU/GPU streams, ms/s | Instrumented elapsed work accumulated per wall-time sample and attributed by owner. | Percent CPU utilization or physical CPU work while a worker is descheduled/waiting. Concurrent owners can overlap. |
| Physics simulated/discarded time, s | Accepted native steps, queued fractional time and time deliberately not simulated. | Render FPS or wall-clock flight progress when the simulation is held/falling behind. |
| Input dispatch / observation / presentation delay, ms | The specific endpoints actually measured by that diagnostic. | End-to-end input-to-photon delay. Do not relabel one endpoint pair as another. |

The profiler's [contract and summary types](https://github.com/foss-earth/renderer/blob/main/src/profiling/frameProfiler.ts)
are canonical. Parents include children; `flight/physics` is already inside
`flight`. `gpu` and `background` are concurrent roots excluded from
`measuredMeanMs`. Unclaimed interval can be waiting, browser work or missing
instrumentation; it cannot all be assigned to CPU overhead. Nor can section
p95s be summed to obtain the p95 of a frame: their slow samples may differ.

## Scheduling and budgets

The [shared scheduler](https://github.com/foss-earth/renderer/blob/main/src/renderScheduler.ts)
has one frame authority. Running simulation, loading and other continuous
owners can hold activity; settled work can sleep until input, data or readiness
requests another frame. Preparation can continue separately from rate-capped
presentation. See the canonical [render-on-demand guide](https://github.com/foss-earth/docs/blob/main/docs/render-on-demand.md).

At a target rate of `F` Hz, `1000 / F` ms is the interval available between
presentations: 16.67 ms at 60 Hz, 33.33 ms at 30 Hz. These are arithmetic
deadlines, not measured application budgets or permission to spend the entire
interval in script. CPU, GPU, input processing and browser presentation interact;
reserve headroom according to the tested workload rather than adding CPU and
GPU durations as though they executed serially.

Physics has its own fixed rate and catch-up cap. The
[physics policy](../../src/flight/physics/physicsRate.ts) defaults to 60 Hz,
offers 30/60/120, and caps work at 2/3/6 fixed-step attempts per update.
The current drone aircraft-switch composition requests 120 Hz. A missed frame
can therefore do several steps, and a longer stall can discard time. The
[loop's accounting](../../src/flight/physics/fixedStepLoop.ts) preserves
`receivedSeconds = simulatedSeconds + discardedSeconds + pendingSeconds`.
Only accepted time reaches step consumers. Record the actual rate and discarded
time when comparing frame costs; reducing rendered frames can increase the
number of steps per frame without lowering physics work per simulated second.

Resolution, dynamic resolution and visual detail are administered in
[GPU](gpu.md). A presentation cap does not limit network/decode work, all
main-thread callbacks or audio quantum processing.

## Controls and measurement lifetime

These session-only settings are defined by the shared renderer's
[profiling catalogue](https://github.com/foss-earth/renderer/blob/main/src/settings/profiling.ts)
and registered by the flight. They apply live.

| Setting | Default | Allowed range / effect |
| --- | --- | --- |
| `renderer.profiling.enabled` | `false` | Attach measurement when enabled; a new start resets the profiler window. |
| `renderer.profiling.windowFrames` | 600 | 1–36,000 frames; changing capacity starts a fresh window. |
| `renderer.profiling.refreshMs` | 500 ms | 100–5,000 ms; refreshes the shown panel from host notifications, rather than creating another render loop. |
| `renderer.profiling.traceFrames` | 0 | 0–36,000 frames; retain per-frame sections/tags when nonzero. Changing capacity resets collection. |
| `renderer.profiling.streamSeconds` | 60 s | 10–600 s; resource history length. |
| `renderer.profiling.streamMs` | 250 ms | 50–5,000 ms; resource sample duration. |
| `renderer.profiling.streamShape` | `stream` | `stream` or `stacked`; rendering choice, not a different measurement. |

The route harness explicitly configures a 65,536-frame summary window through
the session API; this is a harness override beyond the settings control's
36,000-frame range. Normal flight-performance capture has its own bounded
sample capacity, independent of summary and trace capacities.

Turning measurement off detaches scene timing observers and stops resource
sampling/observation; resource-stream history is discarded. A retained profiler
summary/trace can still be inspected until a reset, reconfiguration, new start
or disposal. Closing the panel is not the same as turning measurement off.
The panel refresh and resource sampler time themselves as `profiler/panel` and
`profiler/streams`. Trace/history memory and instrumentation overhead belong
in the result's conditions.

GPU timing requires supported timestamp-query/timer-query capabilities.
[Babylon timing](https://github.com/foss-earth/renderer/blob/main/src/babylon/frameProfiler.ts)
uses a shared lease with dynamic resolution. Disabling the profiler releases
its lease; it does not disable a timer still needed by the scaler. Unsupported
or not-yet-ready GPU observations remain unavailable/waiting, not zero cost.

## What is covered

The shared [globe frame](https://github.com/foss-earth/engine/blob/main/src/babylon/createGlobeRuntime.ts)
opens the measurement boundary, adds `map/camera`, `map/google tiles`,
`map/raster tiles`, `sky` and `map/terrain preparation`. Babylon contributes
`render`, with `render/active meshes`, `render/render targets` and `render/draw`,
and the optional concurrent `gpu/globe` section. Other owners can contribute
additional sections as their features activate.

The flight's [simulation callback](../../src/flight/createFlightSimApp.ts)
contributes:

- `flight/camera`, `flight/terrain` and `flight/input`;
- `flight/physics`, including `flight/physics/terrain contact` and
  `flight/physics/collision`;
- `flight/feedback`, `flight/view`, `flight/hud`, `flight/panels` and
  `flight/instruments`, all inside the `flight` parent.

`flight/physics` includes guards, controls, native stepping and accepted-step
consumers; `flight/view` can include shared work triggered by setting a view.
They are inclusive integration timings, not isolated subsystem microbenchmarks.
Rare work contributes zeros on frames when it is inactive, so inspect
`activeFrames` and the trace as well as its all-frame mean.

The flight capture exposed as `window.osfsFlightPerformance` records frame
interval, flight tick/terrain/collision/physics CPU timings, tile counts,
streaming state and download rate. Its [implementation](https://github.com/0SFS/logging/blob/main/src/flightPerformanceCapture.ts)
defines capture/export capacities and formats. It is enabled by `flightPerf=1`
or a development benchmark route; it does not run on every ordinary flight.

Gaps include asynchronous result handlers, network/message dispatch, input
events, save/export, garbage collection and browser style/layout outside the
named spans. A browser trace is needed to assess whole-thread work. Startup
needs its own phase investigation rather than a settled-frame average.

## Reproduction and interpretation

For a short interactive diagnosis, start the app yourself:

```sh
cd ~/gh/0sfs/fly && npm run dev
```

Open the printed `/fly/` URL with `?flightPerf=1`, reproduce one named scenario,
and use **Debug → Frame budget**. Record aircraft, actual physics rate, location,
camera, backend, viewport/DPR, detail, sound, optional features and cache state.
Wait for startup to finish when testing steady flight. Re-enable measuring to
start a fresh window, reproduce the action, and use the panel's copy/save
actions. For programmatic inspection in that page's developer console:

```js
window.osfsFrameProfile.setEnabled(true); // starts fresh when previously off
window.osfsFrameProfiler.summary();
window.osfsFrameProfile.gpuTimed();
window.osfsFrameProfiler.trace(); // empty unless traceFrames was enabled
window.osfsFlightPerformance?.snapshot();
```

Use a separate brief browser performance recording to investigate unclaimed
main-thread time, GC, style/layout and input callbacks. Compare traced runs
with traced runs and keep the untraced frame capture for performance conclusions.
Do not infer the current bottleneck from FPS alone: a display-capped flight can
gain headroom without changing FPS.

The existing script can collect a short headed diagnostic from the repository:

```sh
cd ~/gh/0sfs/fly
node scripts/profile-flight.mjs --headed --runs=webgpu-webgpu --seconds=10 --settle=5
```

It builds and loads a production bundle, runs the selected globe/attitude-renderer
pair, and writes the report beneath ignored `build/`. See
[the runner](../../scripts/profile-flight.mjs) and
[options](../../scripts/profile-flight-options.mjs) before invoking it. This
diagnostic does not validate a representative terrain route or establish a
power baseline. Chrome availability and supported backend still matter.

The longer route recipe is deliberately separate:

```sh
node scripts/profile-flight.mjs --route=low --runs=webgpu-webgpu
```

[Benchmark routes](../benchmark-routes.md) is the canonical procedure: each
route lasts 180 accepted simulated seconds; loading, pauses and holds can make
wall time longer. Google tiles/key access is required, coverage remains
`unverified`, and tracking must pass the recorded tolerances. Repeat with
`--route=cruise` only when collecting that scenario. Headless is an explicit
diagnostic override. Neither route currently establishes a qualified current
flight or power baseline. Battery procedures are in the route guide and are
not part of ordinary frame diagnosis.

For an optimization comparison, hold the workload and effective settings fixed,
alternate comparable old/new runs, retain raw samples and report variation and
accepted counts. Follow the canonical
[benchmark interference policy](https://github.com/foss-earth/research/blob/main/docs/validation/benchmark-interference.md).
Other apps, thermal drift, core migration and tracing can dominate a small
change. Do not subtract other applications' activity to fabricate isolated cost.

## Evidence and efficiency decisions

The [21 October findings](../performance/2026-10-21/README.md),
[worker experiment](../performance/2026-10-21/flight-dynamics-worker-results.md)
and [22 October frame investigation](../performance/2026-10-22/flight-frame.md)
retain their original scenarios, methods and conclusions. Their historical
120 Hz assumptions and timings are not today's default or a current baseline.
Recent small retained changes are indexed by the
[28 October handoff](../performance/2026-10-28/session-handoff.md).

Choose the next action from the observed constraint: whole-thread tracing for
unclaimed CPU work; owner sections for repeated frame work; GPU timing for
resolution/detail tradeoffs; tile and network state for streaming stalls;
allocation/GC evidence for [memory](memory.md). A faster isolated helper is
insufficient evidence of an FPS, latency or power gain. Publish a qualified
comparison in its owning dated performance directory and update this guide
when boundaries, defaults or measurement coverage change.
