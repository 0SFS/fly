# Resource administration

Current reference for the 0SFS flight app and the shared FOSS Earth runtime it
uses. Audited from local source on **29 October 2026**, including uncommitted
changes. This is a code audit with links to existing evidence; no new profiling
or efficiency claim was produced for these guides.

## Current guides

| Resource | Guide | Administration boundary |
| --- | --- | --- |
| Main-thread execution | [Main thread](main-thread.md) | Work executed on the page, its order and cadence, why it is there, and work that runs elsewhere |
| Frame deadlines | [Frame times](frame-times.md) | Scheduling, CPU/GPU timing, physics time, latency, profiling and interpretation |
| Retained and transient memory | [Memory](memory.md) | Heap, WASM, workers, decoded assets, shared buffers, reservations and release; GPU holdings are a separate estimate |
| CPU outside the page | [Worker CPU](cpu-workers.md) | Placement, worker limits, compute admission, fallback, cancellation and retirement |
| GPU execution and allocations | [GPU](gpu.md) | Drawing, compute, resolution, uploads, admission and device lifetime |
| Transfers and connections | [Network](network.md) | Startup and lazy downloads, maps, remote control and multiplayer |
| Device persistence | [Persistent storage](storage.md) | Settings, saved flights, content, public map cache, freshness and clearing |
| Audio deadlines | [Audio](audio.md) | Page-side control publication, worklet synthesis, transport, quality and overload |

These guides describe how the flight administers resources today. Shared
mechanisms remain defined by their owning packages, linked from each guide.
There is no single page-wide governor that enforces a total RAM, GPU, CPU,
network and power budget.

### Owners and control points

| Owner | Responsibility in this flight |
| --- | --- |
| [0SFS/fly](../../README.md) and its [composition entrypoint](../../src/flight/createFlightSimApp.ts) | Flight lifecycle, synchronous model stepping, input, camera, UI, optional features and coordination of feature teardown |
| [0SFS feature packages](https://github.com/foss-earth/docs/blob/main/docs/agent-start.md) | Aircraft, engines, contact, multirotor, exhaust, sound, controls, mods and network features; each owns its internal allocations and limits |
| [FOSS Earth app](https://github.com/foss-earth/app/blob/main/src/app/browserRuntime.ts) | Shared host composition, policy wiring, network/memory observation and lifecycle |
| [FOSS Earth engine](https://github.com/foss-earth/engine/blob/main/README.md) | Maps, terrain, surface queries, tile caches, worker queues and compute admission |
| [FOSS Earth renderer](https://github.com/foss-earth/renderer/blob/main/README.md) | Frame scheduling, GPU resource lifetime, uploads, resolution and profiling |
| [FOSS Earth images](https://github.com/foss-earth/images/blob/main/README.md) | Image transfer/decode queues and shared encoded, decoded and source-GPU reservations |
| [FOSS Earth sky](https://github.com/foss-earth/sky/blob/main/README.md) and [UI](https://github.com/foss-earth/ui/blob/main/README.md) | Sky evaluation/tables; settings, windows, persistence controls and diagnostics |

## Investigate and tune

Start with the resource whose symptom is observable. Use **Debug → Frame
budget** to inspect the instrumented CPU and GPU sections and the owner streams.
Unsupported measurements mean unavailable, not zero. The streams are neither a
complete process-memory report nor a system-wide CPU meter.

| Symptom | First checks |
| --- | --- |
| Stutter, delayed controls or slow approach | [Frame timing recipe](frame-times.md), then the [main-thread inventory](main-thread.md); distinguish physics, map preparation, UI/event work, GC and GPU load |
| Memory grows across switches or flights | [Memory lifecycle](memory.md) and [storage](storage.md); compare the same settled workload after teardown, not just an allocation peak |
| Many workers but poor responsiveness | [CPU admission and fallback](cpu-workers.md); distinguish worker existence, active computation, elapsed job duration and page fallback |
| GPU-bound frames or device loss | [GPU controls and retirement](gpu.md), then memory estimates and pending uploads |
| Downloads delay flight or keep repeating | [Network queues and metering](network.md), then cache freshness and storage limits |
| Crackles, stale sound or quality reductions | [Audio observation](audio.md); inspect worklet deadlines and transport independently of display FPS |

Change one control at a time and record the effective settings, aircraft, flight
phase, map source/detail, backend, viewport/device pixels and feature state.
Validate behavior before comparing cost. A lower physics rate or detail setting
can change simulation accuracy or terrain coverage; a higher worker count can
increase memory, contention and thermal load. Render caps do not cap every
preparation job. GPU resolution changes help only when GPU work is limiting.
Caching saves repeated work by retaining memory or disk, and upload batching can
exchange throughput for frame latency.

Power and temperature are cross-resource outcomes. Reduced instrumented CPU
time, more idle workers, or higher FPS alone do not establish energy savings.
Use the existing [flight/power protocol](../benchmark-routes.md) and shared
[benchmark interference policy](https://github.com/foss-earth/research/blob/main/docs/validation/benchmark-interference.md)
for a future measurement. Record power mode and observable thermal/drift
conditions, interleave comparable candidates and retain uncertainty. There is
no qualified current flight or power baseline in the route guide. Do not infer
efficiency-core placement from logical concurrency, or infer isolated execution
by subtracting other applications' usage.

### Evidence and opportunities

The guides distinguish **current implementation**, **historical measurement**,
**proposed budget** and **opportunity needing measurement**. A control's limit
is not evidence of actual consumption. Historical evidence keeps its original
workload, rate, build, device and qualification limits.

| Evidence index | What it can establish |
| --- | --- |
| [FOSS Earth performance ledger](https://github.com/foss-earth/docs/blob/main/docs/performance-ledger.md) | Shared shipped, rejected and held work, with links to dated measurements |
| [F-35B findings, 21 October](../performance/2026-10-21/README.md) and [worker experiment](../performance/2026-10-21/flight-dynamics-worker-results.md) | Past integrated CPU comparisons and why that flight-worker experiment was not retained; not a current flight baseline |
| [Flight frame, 22 October](../performance/2026-10-22/flight-frame.md) | Dated frame decomposition and remaining costs |
| [28 October handoff](../performance/2026-10-28/session-handoff.md) | Links to retained and rejected component microbenchmarks; its session restrictions are historical context |
| [Audio implementation ledger](https://github.com/0SFS/sound/blob/main/docs/validation/audio-implementation-ledger.md) | Implemented versus unqualified audio capabilities |
| [Collision comparison](https://github.com/0SFS/ground-contact/blob/main/docs/validation/collision-geometry-cost-quality.md) | Query-specific geometry cost/accuracy evidence and limitations |
| [Flight benchmark routes](../benchmark-routes.md) | Reproduction protocol, unresolved route coverage/tracking qualification and existing harnesses |

First close attribution gaps that block a decision: whole-main-thread work beyond
instrumented sections, worker/WASM/native memory, unobserved network sizes and
feature-specific peaks. Then use the evidence indexes to select the largest
relevant cost. Do not repeat held or rejected experiments without a new
hypothesis. Measure end-to-end cost, including adapters, copies, queueing and
state age, before moving work to a worker or adding a cache. The shared
[realism/cost guidance](https://github.com/0SFS/docs/blob/main/realism-cost.md)
sets the correctness and resource tradeoff criteria.

## Keep this reference current

Update the affected guide in the same change that adds or moves a callback,
changes placement/rate/limits/defaults, adds an allocation or cache, changes a
fallback, or changes teardown or measurement coverage. Add a guide only when a
distinct resource needs its own administration procedure; keep shared policy
in its owning repository.

For each update, trace the execution path and registration site, identify the
owner, and check startup, active flight, pause, aircraft switch, failure and
destruction. Record which resources stay alive after cancellation and what
actually releases them. Link source definitions for settings and separate
enforced limits from targets. Reconcile the inventory with callbacks registered
outside the render tick. Label rationale that is not recorded rather than
inventing a browser requirement or a measured benefit.

New measurements belong in the owning repository's dated performance tree and
its ledger, following the shared
[documentation layout](https://github.com/foss-earth/docs/blob/main/docs/documentation-layout.md).
Link the evidence here; do not maintain a second copy of its numbers. Check
links and source claims for documentation-only changes. Runtime tests and
profiling become necessary when behavior changes or a measurement is claimed.

## Source snapshot

These are the checked-out base revisions observed at the start of the audit.
**Modified** includes pre-existing uncommitted source; the revision alone cannot
reproduce that working tree. Links use each owner's current `main` so this stays
a navigable reference, not a claim about deployed or published behavior. Refresh
the relevant rows on the next substantive audit.

| Repository | Base revision | Initial state |
| --- | --- | --- |
| 0SFS/fly | `8dc608aee880819c5fddae69f31fc33c0756af44` | Modified |
| 0SFS/docs | `bf6d42d4d1e8d0bf08253c848a7a5ca0c92a988e` | Clean |
| 0SFS/aircraft | `9c5c140cf753aa01d813d448c3ab5ec3a181d5ae` | Modified |
| 0SFS/engines | `646f39bf2b695767fe95baca2cd851bafdeb2cb4` | Modified |
| 0SFS/sound | `246f1e61e2b29fd6e7a21317841c7fc158ac6396` | Modified |
| 0SFS/electric-sound | No committed revision | New working tree |
| 0SFS/ground-contact | `762d480b7d65da839a57f343530e65c9e87ba764` | Clean |
| 0SFS/multirotor | `ffa196ffc2a80c799438f63a16599d99b34753c5` | Clean |
| 0SFS/exhaust | `e779e4c3505656c907f3111a94009aed4939f2f3` | Clean |
| 0SFS/drone-camera | `67a5d4a7cb2aa6dd233d9ada6e7dd0eee7257859` | Clean |
| 0SFS/camera-preview | `768dae8f0eaa24b8508a633fd4a40c39a6b31848` | Clean |
| 0SFS/mods | `9a565c9b6738b7a95b78f3216011ba73fb9fafe8` | Modified |
| 0SFS/multiplayer | `fb788e3707cb03dca7569ac98637932a934072de` | Clean |
| 0SFS/multiplayer-server | `5167258bbcb642dc5d06651446d321492f8c3647` | Clean |
| 0SFS/rc | `26f62deaf402ea16f00ef2e0a21d9b51445467d2` | Modified |
| 0SFS/logging | `47ddf95a9f346cbacfd16e7534a7da76d533186d` | Clean |
| 0SFS/controls | `08960f3191f39441dc1e3f555fa65419b0939a7d` | Modified |
| 0SFS/autopilot | `67f27d7644b987293c53409a227324039646bc73` | Clean |
| 0SFS/camera-gimbal | `1d8efee679dabe1d8124c328808cf7e1edee9a60` | Clean |
| 0SFS/default-modpack | `01565485e923ab9c9543daacb325a7d596d48685` | Clean |
| foss-earth/app | `8edac4a424b04f1b3bedb3ce5b37f8525a7fad12` | Clean |
| foss-earth/engine | `54e6797f9a12bdb27254a4b975e152e0f7282ed8` | Clean |
| foss-earth/renderer | `63984f44225f07af070f41764202213e9040177e` | Clean |
| foss-earth/images | `6310a262adaa14b7d8c2c1ec2695e67ce44aedb4` | Clean |
| foss-earth/sky | `6dabf1889f8929082388564b1d241bd4290cf51f` | Clean |
| foss-earth/ui | `a5edf83bad0385168c938f962fb1bdce188b8741` | Clean |
| foss-earth/docs | `6d2919996bfef833e311bac98021f065c6e6ac48` | Clean |
