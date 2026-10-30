# Memory administration

Current source audit: 29 October 2026. [Audit scope and revisions](README.md)
apply. Memory is administered by its owning subsystem; the application has no
single limit that bounds all page, worker, WASM, native and GPU allocations.
Persistent browser data has a separate [storage guide](storage.md).

## Owners and lifetime

| Holdings | Allocation and owner | Release boundary |
| --- | --- | --- |
| Flight objects, UI, listeners and diagnostics | `fly` composes the flight session in [createFlightSimApp](../../src/flight/createFlightSimApp.ts). Panels, instruments and optional features retain their own objects. | Session destruction detaches callbacks and disposes features. Pause retains the flight; it is not a memory-release operation. |
| JSBSim module, native model and data files | [createJsbsimRuntime](../../src/flight/jsbsim/createJsbsimRuntime.ts) creates an SDK and hydrates its data. SDK persistence is disabled. | Native property readers and simulation captures are released before `sdk.destroy()`. A late SDK allocation after startup failure is also destroyed. Do not keep native handles after their executive. |
| Ground-contact and multirotor WASM | Package-owned cores allocate typed views into linear memory. These cores can execute on the page; WASM does not imply a worker. | Dispose kernels and their owning core as specified by [ground-contact](https://github.com/0SFS/ground-contact/blob/main/wasm/index.d.ts) and [multirotor](https://github.com/0SFS/multirotor/blob/main/wasm/index.d.ts). Re-read buffer getters after creating another kernel; do not assume an old view survives memory growth. |
| Preparation worker heaps, WASM modules and transferred/shared grids | FOSS Earth host factories and component owners; see [worker CPU](cpu-workers.md). A shared grid is one backing allocation with multiple views; transferred and copied arrays have different costs. | Worker retirement releases its realm, while component caches may retain page-side outputs. Cancelling a waiter alone does not prove the worker computation or its holdings ended. |
| Encoded images, decoded images, source textures and upload staging | The shared Images broker reserves bytes before admitted work. Engine imagery also has atlas, staging and cache policies. | Release consumer holds, cached resources and native holds through the owning service. Submitted uploads and nonabortable decode remain charged until completion/retirement. |
| Aircraft, engines, stores, exhaust and instruments | Feature packages own Babylon meshes, textures, material state and CPU data; the flight holds their instances. | Aircraft switching preserves the streamed world while replacing aircraft-owned resources. Final session teardown disposes the model, attachments, lights and SDK. See [aircraft switching](../aircraft-switching.md). |
| Drone sensor and optical flow | [Drone feature](../../src/flight/drone/droneFeature.ts) activates sensor render targets, readback and direct WebGPU compute resources. | Feature disposal releases capture/flow and meshes. Raw WebGPU buffers/textures require explicit owner destruction; they are not all visible to Babylon's memory estimator. |
| Audio state and transport | Worklet DSP, snapshot/event buffers and optional shared transport; see [audio](audio.md). | Audio disposal disconnects its transport and adapter; pausing physics does not destroy the audio engine. |

The [flight destroy path](../../src/flight/createFlightSimApp.ts) is the review
point for lifecycle changes. During startup, world and physics are prepared
concurrently; both failure cleanup and late completion matter. During a switch,
a temporary incoming physics/model allocation can overlap outgoing state. Budget
for that peak rather than just a steady flight.

## Limits and admission

These controls cover named consumers, not total process memory. Values are
registered defaults, before saved settings or presets. MiB means 1,048,576 bytes.

| Control | Registered default and effect | Source |
| --- | --- | --- |
| `map.imagery.gpuBudget` | Device-derived: 1/32 of browser-reported device memory, or 128 MiB when unknown, bounded by atlas/texture limits. Holds the complete atlas mip chain and transactional page tables; changing it reloads imagery. | [Map loading catalogue](https://github.com/foss-earth/engine/blob/main/src/settings/catalogue/loading.ts) |
| `map.imagery.stagingBudget` | 16 MiB of imagery waiting for upload, requests in flight included. A development starting value, not a qualified device budget. | Same catalogue |
| `map.terrain.cachedTiles` | Soft retention target of 160 terrain tiles. Tiles needed/shown by the view and their coarser ancestors can keep retention above it. A count does not establish retained bytes. | Same catalogue |
| `map.google.cacheBytes` / `map.google.cacheTiles` | 307.2–409.6 MiB / 6,000–8,000 tiles: eviction starts above the lower threshold, with the upper threshold used by the tiles renderer. These are its cache accounting, not a whole-page cap. | Same catalogue |
| `scene.panorama.sourceGpuMiB`, `.overlapMiB`, `.decodedMiB` | Derived from the renderer's largest texture: room for previews plus two source images, one incoming overlapping image, and one decoded image plus preview decode room. Overlap is a subset of source GPU capacity, never extra capacity. | [Image settings](https://github.com/foss-earth/images/blob/main/src/settings.ts) |
| `scene.panorama.encodedMiB` / `.uploadOutstandingMiB` | 32 MiB encoded input / 16 MiB submitted uploads. Provisional development values. | Same settings |
| `wasm.workers` | Bounds shared preparation Worker objects and indirectly their retained heaps; it does not impose a byte ceiling. | [Worker CPU](cpu-workers.md) |

The `scene.panorama.*` names are inherited settings IDs. The browser host
[projects these controls](https://github.com/foss-earth/app/blob/main/src/app/browserPolicy.ts)
into the common image broker/uploader used by maps too; they do not bound
aircraft meshes, JSBSim memory or every GPU allocation. An allocation may have
both an Engine policy and a common broker reservation.

[Resource pools](https://github.com/foss-earth/images/blob/main/src/pools.ts)
report limit, reserved bytes, peak and reservation count. Reservations forecast
or charge admitted holdings; they are not measurements of physical residency.
Lowering a limit affects future reservations and can leave existing holdings
over the new limit. A refusal reports the pool; capacity releases wake waiting
work. Increasing a limit without finding the blocked owner can simply move the
bottleneck to decoded memory or uploads.

There is no audited flight-wide WASM linear-memory ceiling or RAM-pressure
controller. A package's allocation failure and fallback belong to that package;
do not infer a global automatic quality reduction from the presence of pools.

## What the graphs measure

In Debug → Frame budget, enable measuring and inspect RAM and GPU memory.
The [browser host](https://github.com/foss-earth/app/blob/main/src/app/browserRuntime.ts)
registers only these explicit RAM owners: `images/encoded`, `images/decoded`,
`sky/tables` and `sky/night lights`. Encoded and sky tables/lights are marked as
part of the JavaScript heap; decoded images are counted outside it.

The [memory source](https://github.com/foss-earth/renderer/blob/main/src/profiling/memorySource.ts)
adds browser-reported heap remainder after subtracting owners marked `inHeap`.
Without a browser heap reading, only named owners show and the graph says so.
The stream does not establish total browser-process RAM, worker heaps, WASM
linear-memory residency, browser-native allocations or all feature buffers.
Do not add a heap snapshot total to the RAM graph as if they were disjoint.

The GPU graph estimates Babylon-held textures, unique mesh buffers and canvas
storage at most once a second. It excludes some raw WebGPU feature allocations
and driver-private storage; see [GPU administration](gpu.md). RAM and GPU estimates
can describe different views/copies of related data. They are not a reliable sum
for unified physical memory on a shared-memory device.

Default streams retain 60 seconds in 250 ms samples. Measuring off stops
sampling and observers and clears measurement history. Short peaks between
samples can be missed; browser heap readings can be rounded or updated rarely.
Unavailable coverage is not zero usage. [Frame times](frame-times.md) explains
the profiler's own cost and export procedure.

## Investigating and improving use

1. Record aircraft, mods, map source/detail, renderer, viewport, effective settings
   and revisions. Separate cold startup, a settled view, moving flight and a
   switch; record which stages overlap.
2. Enable the existing streams and export the report at each stage. For a growth
   investigation, use browser allocation/heap tools as a separate instrument;
   include worker/WASM readings only where the tool actually reports them.
3. Compare repeated equivalent pause/resume, aircraft switches and feature
   activation/deactivation. Check retained owner counts and reservation peaks
   after asynchronous cleanup settles. A single lower heap reading after GC is
   not proof that native resources retired.
4. Identify the growing owner before tuning: encoded backlog suggests transfer
   versus decode imbalance; decoded backlog suggests upload pressure; a growing
   retained mesh/texture count suggests scene/cache lifetime. Compare cache reuse
   against extra memory and repeated network/CPU/GPU work.
5. Validate unchanged behavior, failure cleanup and cancellation as well as the
   new peak. Keep measurements in dated performance evidence and link them here.

The clearest accounting opportunity is explicit worker/WASM and feature-owned
buffer reporting. This is an unimplemented coverage gap, not a measured leak.
Native retirement must preserve actual completion proof: the shared
[retirement contract](https://github.com/foss-earth/renderer/blob/main/docs/native-frame-retirement.md)
distinguishes cancellation from release and explicitly marks its browser/device
verification limits. This audit ran no new memory or GPU experiment.
