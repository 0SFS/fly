# GPU administration

Current source audit: 29 October 2026. [Audit scope and revisions](README.md)
apply. FOSS Earth owns the renderer, its scheduler and shared native image
resources. Flight features own their aircraft-specific draws and compute.
GPU duration, submission work on the [main thread](main-thread.md), and held
[memory](memory.md) are separate constraints.

## Work and owners

| Consumer | GPU work and holdings | Administration boundary |
| --- | --- | --- |
| Streamed world and sky | Terrain/Google geometry, imagery atlases, sky and lighting passes | FOSS Earth Engine/Sky choose content; Renderer supplies the borrowed device, presentation and resource lifetime mechanisms. |
| Aircraft, engines, stores and lights | Geometry/materials, transparent surfaces, dynamic instrument textures and light effects | Aircraft/engine/feature instances are disposed by the flight session. Map detail does not reduce all model costs. |
| Exhaust | Volume shading and optional opaque-depth target | [Exhaust renderer](https://github.com/0SFS/exhaust/blob/main/src/createEngineExhaust.ts) owns its geometry/material/depth resources and shader sampling settings. Synchronization still runs on the page. |
| Drone capture/optical flow | Additional sensor views, readbacks and direct WebGPU compute/storage resources | [Drone feature](../../src/flight/drone/droneFeature.ts) activates these paths. [Sensor renderer](https://github.com/0SFS/drone-camera/blob/main/src/sensorRender.ts) and [flow](https://github.com/0SFS/drone-camera/blob/main/src/opticalFlow.ts) own their buffers, textures and disposal. These costs are conditional on drone use. |
| Cockpit/VR and diagnostics | Extra presentation targets, cockpit screen and optional debug geometry | Flight composition and shared immersive/diagnostic owners. Include the selected view and enabled diagnostic features in a comparison. |
| Asset publication | Texture copies, mip generation, staging and canvas transfers | Shared image broker/uploader admit named transfers; third-party model loaders and raw feature compute do not all share one upload budget. |

The [Renderer README](https://github.com/foss-earth/renderer/blob/main/README.md)
is canonical for backend selection, scheduler and generic resource APIs.
The flight's [runtime composition](../../src/flight/createFlightSimApp.ts)
connects these to its scene. There is one shared frame authority; preparation
can run between rate-capped presentations. An FPS cap does not cap all resource
work, readbacks or active simulation cost.

## Controls and limits

Registered defaults below precede saved settings and presets. Source:
[Renderer catalogue](https://github.com/foss-earth/renderer/blob/main/src/settings/catalogue.ts)
and [lifecycle](https://github.com/foss-earth/renderer/blob/main/src/babylon/rendererLifecycle.ts).

| Control | Default and effect |
| --- | --- |
| `renderer.backend` | `auto`; renderer creation selects WebGPU or falls back with a recorded reason. Applies after reload. Forced selection is not proof that the requested backend started. |
| `renderer.resolutionScale` | 1 pixel per device pixel normally; safe fallback derives one pixel per CSS pixel. Live range 0.25–2. Lower scale reduces pixel work and target storage; it does not reduce all geometry or CPU work. |
| `renderer.antialias` | `true`, with safe WebGPU fallback disabling it. Applies after reload. Additional samples cost work/storage where supported. |
| `renderer.frameRateCap` | `off`; live presentation cap. It is distinct from the physics rate and the dynamic-resolution target. |
| `renderer.dynamicResolution` | `false`; when enabled and GPU timing is available, changes effective resolution against GPU duration. The lower scale is `min(0.5, manual scale)` and the upper scale is the manual scale. |
| `renderer.targetFps` | 60; dynamic-resolution GPU budget, with roughly four fifths of a frame allocated to GPU work. It does not establish a guaranteed achieved FPS. |
| `renderer.upscaling` / `.upscalingSharpness` | `off` / 0.2. EASU and EASU+RCAS are optional WebGPU/WebGL2 reconstruction passes; they add GPU work while improving enlargement. |

Dynamic resolution uses the shared GPU timing lease and reports unavailable
timing instead of treating it as spare capacity. Its controller lowers scale
for over-budget GPU frames and restores it gradually. It does not lower
resolution merely because CPU-bound frame intervals are long. Settings and
backend notes are part of the result to retain.

World-detail controls affect geometry, streaming, memory and GPU work together.
The shared detail controller and flight minimum/terrain requirements are wired
in [createFlightSimApp](../../src/flight/createFlightSimApp.ts); a visual-quality
change needs its own acceptance check, particularly near terrain.

Image publication has byte admission in addition to GPU duration. The
[map loading catalogue](https://github.com/foss-earth/engine/blob/main/src/settings/catalogue/loading.ts)
defaults `map.imagery.uploadPerFrame` to 2 MiB and staging to 16 MiB; its atlas
GPU budget is device-derived. The common
[image settings](https://github.com/foss-earth/images/blob/main/src/settings.ts)
default `scene.panorama.uploadMiBPerFrame` to 4 MiB and
`scene.panorama.uploadOutstandingMiB` to 16 MiB. These inherited IDs feed the
browser host's shared uploader too. They are development limits, not measured
GPU-time guarantees. See [memory](memory.md) for source/overlap reservations.

## Saturation and resource retirement

A full pool can defer/refuse work without changing the meaning of loaded
content. Capacity notifications wake the existing scheduler; waiting for room
does not need a second render loop. Lowering limits constrains new admissions
without proving current holdings fit. Readback and shader work can still
compete with the main view outside image-transfer accounting.

Prepare incoming content hidden and publish only after readiness under the
owner's current generation. Old and incoming resources may coexist during a
replacement; stale completions must release their own resources without
publishing. The generic
[resource lifecycle](https://github.com/foss-earth/renderer/blob/main/src/resourceLifecycle.ts)
retires accepted resources on generation invalidation and disposes stale
adoptions. It is not a substitute for a parser/decoder's asynchronous drain.

On cancellation or device loss, native adapters reject queued results but keep
submitted inputs/grants held until actual completion or observed loss. The
[native retirement contract](https://github.com/foss-earth/renderer/blob/main/docs/native-frame-retirement.md)
requires real owner drains before a final borrowed-device marker. A timer,
promise resolution or Worker termination alone is not completion proof. That
document marks its new browser/device verification as unrun; this audit adds no
verification claim. Device restoration reacquires managed resources and must
retain cleanup of the previous generation.

The world/device can survive an aircraft switch, while aircraft-specific GPU
resources are replaced. Pause retains them. Drone feature disposal explicitly
destroys its direct WebGPU objects and cancels pending mapping through buffer
destruction; callers handle late rejection.

## Measurement and tuning

Debug → Frame budget exposes GPU timing only where the backend can provide it.
See [frame times](frame-times.md) for timing coverage and exports. CPU time spent
submitting a GPU operation is not its GPU duration; asynchronous GPU rows must
not be summed into main-thread time.

The [GPU memory source](https://github.com/foss-earth/renderer/blob/main/src/babylon/gpuMemorySource.ts)
walks Babylon holdings at most once per second: texture shapes/formats/mips/
samples, unique mesh buffers, and estimated canvas color/depth/multisample
storage. [Owner mapping](https://github.com/foss-earth/app/blob/main/src/app/resourceOwners.ts)
uses resource names. Driver padding, hidden allocations, pipeline storage and
raw drone compute buffers are not completely represented. A flat graph cannot
prove those allocations are absent. The value is estimated holdings, not
driver-reported VRAM or unified physical-memory residency.

1. Record actual backend, viewport/device pixel ratio, effective scale, detail,
   aircraft/engine, view, optional capture/VR and measurement availability.
2. Compare CPU and GPU durations before tuning. If GPU timing is unavailable,
   label the diagnosis incomplete rather than inferring it from FPS alone.
3. For pixel-bound candidates, compare fixed scales with identical camera/content
   before enabling dynamic resolution or reconstruction. Check cockpit text,
   runway/terrain edges, exhaust and transparency as well as timing.
4. For geometry/upload pressure, inspect owner holdings and tile/feature work.
   Compare one detail, residency or upload limit at a time; include time to ready,
   transient overlap and repeated visits as well as settled frames.
5. Validate feature disable, aircraft switch, failure, cancellation and restoration
   release paths. Keep numeric timing evidence separate from a visual check.

The [upscaling proposal](https://github.com/0SFS/docs/blob/main/proposals/spatial-upscaling-and-dynamic-resolution.md)
records design rationale; current controls are established by the source above.
There is no qualified current whole-flight GPU baseline in this guide. Potential
gains from hidden-world culling, model changes or feature compute require their
own measurements; this documentation work makes no new savings claim.
