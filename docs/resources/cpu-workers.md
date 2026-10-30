# Worker CPU and compute administration

Current source audit: 29 October 2026. [Audit scope and revisions](README.md)
apply. Worker lifetime, active numeric computation and the page's
[main thread](main-thread.md) have different controls. A live idle worker still
holds memory; a limited worker count does not bound all CPU work.

## Placement and ownership

The flight calls FOSS Earth's `createBabylonRuntime`. Its
[compatibility host](https://github.com/foss-earth/app/blob/main/src/app/runtimeCompatibility.ts)
constructs the common [browser policy](https://github.com/foss-earth/app/blob/main/src/app/browserPolicy.ts).
That policy supplies worker factories for imagery decode, raster elevation
decode, terrain mesh targets, imagery height queries, Google tile preparation,
ground BVH construction, and sky evaluation/helpers. Feature-specific execution
such as the [AudioWorklet](audio.md) has its own owner and is outside that
preparation-worker budget.

| Consumer | Work that can run in a preparation worker | Work still on the page |
| --- | --- | --- |
| Raster elevation | RGBA-to-height conversion after browser image decoding | On-page fallback when workers are unavailable; terrain selection and scene application |
| Terrain geometry | Target positions and height bounds | Initial meshes, callback elevation and application of results |
| Imagery heights | Batched interpolation over adopted grids | Selection/drawing and exact fallback for cache misses |
| Google tiles | Supported-profile geometry/JPEG preparation | Babylon nodes/materials/textures; unsupported tiles use the original loader |
| Ground acceleration | Supported displayed-mesh BVH construction | Finite-ray queries with current transforms; unsupported/pending meshes retain picking |
| Sky | Atmosphere tables, illumination and radiance; a shared WASM build can use cooperating helpers | Exposure, night lights, scene transforms and drawing; presentation-dependent fallback remains |

The [execution catalogue](https://github.com/foss-earth/engine/blob/main/src/settings/catalogue/wasm.ts)
is the canonical inventory of each kernel's scope and placement. Its registered
`wasm.tier` default is `single`: single-threaded WASM in workers, with optional
shared sky behavior. `auto` is a separate selection that retains each core's
recorded choice; it is not the default. A failed load/compile/start or first-input
comparison falls back with a reason. Read the effective component report rather
than assuming the requested implementation ran.

JSBSim physics, flight ground-contact adapters and multirotor calls are separate
from these shared preparation plans. Their current synchronous call path is
documented in [main thread](main-thread.md). Moving one numeric kernel to WASM
does not by itself move its caller off the page.

## Controls and admission

Controls below are registered by the
[execution catalogue](https://github.com/foss-earth/engine/blob/main/src/settings/catalogue/wasm.ts)
and projected by the browser policy. Saved settings and presets may replace the
registered defaults. Execution and compute scheduling selections apply after
reload; they are not a live adaptive governor.

| Control | Default and administration |
| --- | --- |
| `wasm.tier`, `wasm.core.*` | `single` globally; component overrides inherit. Original TypeScript, TypeScript workers, WASM workers, recorded Auto, threaded sky and manual implementation/placement/parallelism are available. |
| `wasm.workers` | Derived from browser logical concurrency and coarse memory hints, plus dedicated component/helper capacity; selectable 1–32. Bounds combined live preparation Worker objects. Dedicated slots are reserved before the elevation pool fills. |
| `map.loader.decodeWorkers` | One per reported hardware thread except the page's, clamped to 1–16; at most 2 when reported memory is at most 1 GiB; 3 when thread count is unknown. A saved 0 decodes on the page. Actual slots are further limited by reserved workers and serial selection. |
| `wasm.threads` | Shared team includes its coordinator: `max(1, min(4, logicalConcurrency − 1))`, using 2 logical threads when unknown; maximum selectable 8. Helpers count against `wasm.workers`. A shared build and cross-origin isolation are required. |
| `wasm.sharedSky` | `true`; requests the shared sky build for a WASM sky even under the single selection, with reported fallback where unavailable. |
| `wasm.compute` | `legacy` (UI label Off). `fixed` is an experimental shared allowance for active preparation lanes. It changes neither quality nor the physics rate. |
| `wasm.computeLanes` | 32 requested, selectable 1–32; effective fixed allowance is the smaller of this and `wasm.workers`. Sky coordinator and cooperating helpers each count. |
| `wasm.computeInitialization` | 1 in fixed mode, selectable 1–32 and bounded by `wasm.workers`; separate allowance for worker module preparation before numeric compute. |
| `wasm.computeAging` | 1,000 ms, selectable 1–60,000 ms; raises waiting urgency on a real admission event, without an aging timer. Equal urgency uses submission order, including whole-team fairness. |
| `wasm.computeObserve` | `false`; when enabled in fixed mode, retains bounded wait/elapsed/useful/stale/retired observations. |

The [worker pool](https://github.com/foss-earth/engine/blob/main/src/browser/workerPool.ts)
dispatches the next priority-queued task to a free worker. Faster workers finish
more jobs without identifying their physical cores. Workers start on demand and
retire after the caller-supplied idle timeout. Worker loss/unavailability can
make the owner use its synchronous fallback; reducing the lifetime budget can
therefore increase main-thread work.

Fixed [compute admission](https://github.com/foss-earth/engine/blob/main/src/browser/computeAdmission.ts)
queues capacity waits instead of treating them as worker failure and choosing a
page fallback. It grants a whole team together at the smaller of the requested
width and effective lane limit; the sky dispatcher forwards that admitted width
so its core uses exactly that many lanes. It does not reserve some lanes while
waiting for the rest. Inspect actual team status as well as the requested thread
count. Module preparation uses a separate
[initialization path](https://github.com/foss-earth/app/blob/main/src/app/computeWorker.ts).
There is no shipped adaptive lane controller or qualified energy saving.

## Cancellation, pause and teardown

Cancelling queued work removes its caller's interest. Cancelling a running
caller does not prove execution stopped: a pool slot remains busy and its compute
lease stays charged until the reply or explicit worker retirement. Obsolete
replies are discarded/marked stale; they are not useful content progress.
Termination releases the host's live-worker slot and retires attached admission
state. A byte or native resource returned by a late result still needs its own
owner cleanup; worker CPU retirement is not proof of GPU retirement.

The streamed world survives an aircraft switch. Its preparation workers can
therefore survive too. Pausing flight stops accepted simulation progress but
does not necessarily stop map refinement, sky preparation or resource draining.
Final host disposal retires computation and worker owners; see the
[browser runtime](https://github.com/foss-earth/app/blob/main/src/app/browserRuntime.ts).

## Observability and tuning

Component execution reports distinguish requested and actual backends, fallback
reasons and preparation status. The shared
[compute report](https://github.com/foss-earth/app/blob/main/src/app/computeReport.ts)
includes requested lanes, live workers, admission state and, when enabled,
recent rendered-frame duration and input-dispatch delay. Browser topology reports
logical concurrency only: efficiency-core count and actual core residency are
unknown. Admission elapsed time includes descheduling and waits; it is not
physical thread CPU time, frequency, watts or energy.

1. Export effective component choices and settings for a representative flight.
   Keep aircraft, map coverage/detail, viewport, route and simulation rate fixed.
2. Diagnose page stalls with [frame timing](frame-times.md). Distinguish numeric
   worker cost from page dispatch, transfer, result application and readiness.
3. Compare TypeScript and WASM in the same placement before attributing a change
   to WASM; compare original and worker placement separately. Record useful versus
   stale work and completion latency as well as page time.
4. Treat lower worker counts and fixed lane limits as candidates. Check content
   readiness, terrain holds, input delay, memory and startup as well as frame
   percentiles. A smaller count can move work onto the page; a smaller lane limit
   can reduce sky parallelism or delay a team behind existing work.
5. Retain only a qualified integrated benefit. Power claims require a separate
   power experiment with observable device state and interference qualification.

The dated [flight-dynamics worker experiment](../performance/2026-10-21/flight-dynamics-worker-results.md)
did not ship: terrain round trips and presentation latency defeated its stated
gates. It explains one retained decision, not the current cost of every worker
candidate. Current worker choices and fixed scheduling remain subject to their
own qualification; this documentation audit ran no new benchmark.
