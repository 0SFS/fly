# Main-thread work

Current implementation audit: 29 October 2026, including local uncommitted
source. [Resource administration](README.md) records the audit revisions.

The flight's JavaScript, synchronous JSBSim calls, scene queries, camera and
visual updates, DOM controls and browser event callbacks execute on the page's
main thread. The shared runtime owns the frame scheduler; the flight supplies
one simulation callback through `runtime.setSimTick`. WASM does not imply a
worker. Audio synthesis is in an AudioWorklet; selected shared-world numeric
work can use workers. See [worker CPU](cpu-workers.md) and [audio](audio.md).

This is an inventory of application-controlled workloads and their registration
points, not an enumeration of browser-internal tasks. Sources linked below are
the authority when optional features or settings change.

## Ownership and placement

| Work | Owner and source | Why it is on the page |
| --- | --- | --- |
| Boot, route selection, loading screen and diagnostics | [page entry](../../src/main.tsx) | DOM and navigation require the document's thread. Module loading is asynchronous, but module evaluation and its promise continuations execute here. |
| Frame admission, map selection/update, camera and sky composition | [globe runtime](https://github.com/foss-earth/engine/blob/main/src/babylon/createGlobeRuntime.ts), [render scheduler](https://github.com/foss-earth/renderer/blob/main/src/renderScheduler.ts) | Current scene and renderer are page-owned. Scheduling and publishing prepared content stay with that owner; preparation kernels may run elsewhere. |
| Input, control arbitration, terrain/collision queries, physics and accepted-step consumers | [flight composition](../../src/flight/createFlightSimApp.ts), [fixed-step loop](../../src/flight/physics/fixedStepLoop.ts) | Current implementation keeps one authoritative state and same-frame input → step → view order. Scene surface queries and SDK reads are synchronous here. This placement is a design choice, not a browser restriction on physics. |
| Aircraft meshes, floating origin, cameras, rig poses, exhaust and lights | `mountFlightWorld`, `engineVisuals`, `floatingOrigin.apply` and the `flight/view` section in [flight composition](../../src/flight/createFlightSimApp.ts) | Mutates the live page-owned Babylon scene. Numeric work need not intrinsically run here, but publishing results must respect this scene's lifetime. |
| HUD, instruments, settings panels and layout | [HUD](../../src/flight/hud/flightHud.ts), [control panel](../../src/flight/hud/FlightControlPanel.tsx), flight composition | DOM updates require the document. SDK reads and formatting currently share its thread; only writes that actually change values are needed. |
| Sound telemetry and spatial view | [flight composition](../../src/flight/createFlightSimApp.ts), [sound owner](https://github.com/0SFS/sound/blob/main/src/createFlightAudio.ts) | Telemetry is read from the authoritative SDK after accepted steps; view data comes from the scene. Synthesis runs elsewhere. |
| Optional drone, phone and multiplayer work | [drone gate](../../src/flight/drone/droneGate.ts), [multiplayer feature](../../src/flight/multiplayer/createMultiplayerFeature.ts), flight composition's `loadPhonePairing` | Current hooks mutate the same SDK/scene/UI and handle browser messages here. Lazy import delays activation; it does not create another execution thread. |
| Save/export and diagnostics | `saveFlight`, recorder and report callbacks in flight composition | Snapshot capture reads live SDK state. Serialization, local-storage calls and download setup currently execute on the page. Large exports are not exempt from the main-thread budget. |

The [21 October worker experiment](../performance/2026-10-21/flight-dynamics-worker-results.md)
retained the synchronous batched dynamics path: it failed its main-thread saving
and p95 improvement gates and added observation latency. That is dated evidence
for a retained decision, not proof that a worker can never help or a measurement
of today's aircraft or physics rate.

The DOM requirement is a browser constraint; the other placement explanations
above describe the current dependency/order, not a requirement imposed by WASM
or Babylon. Where source supplies no separate cost justification for running a
numeric helper, formatter or recorder read here, its placement rationale is
undocumented beyond that integration. Treat it as an audit opportunity, not as
evidence that moving it will save time.

## Frame execution order

The shared [globe runtime](https://github.com/foss-earth/engine/blob/main/src/babylon/createGlobeRuntime.ts)
prepares the viewport and opens the profile frame, updates navigation/preparation
camera state, Google tiles, raster tiles and the current surface, then invokes
the host's simulation tick. It updates the sky after the flight has placed the
world and camera. Babylon then renders; after a rendered frame the runtime
advances terrain preparation and closes its frame lifecycle. Preparation and
presentation are separately scheduled: an FPS cap is not a cap on all work.

Inside the `setSimTick` callback in
[flight composition](../../src/flight/createFlightSimApp.ts), this is the order:

| Phase | Main-thread work | Profile coverage |
| --- | --- | --- |
| Admission | Return when disposed or loading; begin the frame surface-query scope; ignore idle time on first resume, otherwise clamp offered frame delta to 0.1 s. | Before or inside `flight`, depending on the operation. |
| Camera | Apply phone aim, local/phone glide and orbit return; update cockpit look/screen; update the half-second FPS counter; mount the flight world when needed. | `flight/camera` |
| Initial contact | Refresh terrain contact, reset interpolation/collision history when placement changes. | First contribution to `flight/terrain` |
| Input | Apply pause state; claim and poll the flight gamepad once; poll controls and notice local flap changes. | `flight/input` |
| Physics | Drain bounded fixed steps as described below; obtain the interpolated display state. | `flight/physics`, with contact/collision children |
| Feedback | Hold/update tire sound and advance haptic outputs. | `flight/feedback` |
| Status/save | Track contact refusal, show fault/wait status, pause on fault, save when the configured interval elapses. | Included in `flight`; not all has a named child. |
| Surface | Sample the displayed aircraft's surface height and observe the low-spawn detail requirement. | Sample contributes to `flight/terrain`; requirement logic remains parent work. |
| View | Set the shared simulation view, end surface-query scope before moving the floating origin, run drone `afterView`, combat, falling tank/store views and bay doors, chase camera, compass, sound view, debug geometry and aircraft/engine rigs. | `flight/view` |
| HUD | Read actual controls/flaps and update flight instruments. | `flight/hud` |
| Panels | If at least 100 ms has elapsed, update panels, armament widget, HUD bar and map status. This is frame-throttled, not an independent 10 Hz timer. | `flight/panels` |
| Instruments | Sample recorder and evaluation instruments, update G/load tints, phone attitude, G-vision and engine monitor. | `flight/instruments` |
| Capture | Optionally append a phone-camera trace observation, add the flight parent duration, then optionally append a flight-performance sample. | `flight` ends before flight-performance sample insertion. |

Parents include their children. Adding `flight` to its subrows counts the same
work twice. See [frame times](frame-times.md) for timing boundaries and gaps.

### Fixed steps

[physicsRate.ts](../../src/flight/physics/physicsRate.ts) defines 30/60/120 Hz,
with a 60 Hz saved default. The step is `1 / physicsHz`; it is fixed for a
flight and checked against the native SDK's step. The catch-up cap is 2, 3 or 6
steps per update respectively: 66.7 ms at 30 Hz, 50 ms at 60/120 Hz. Excess
received time is counted as discarded; it is not simulated later. Rendering
interpolates between accepted states and need not match the physics rate.

There is a current composition exception to the general 60 Hz policy: entering
a drone through the aircraft-switch path sets the requested physics rate to
120 Hz, retaining the prior request for restoration on leaving the drone. Read
the effective flight rate rather than inferring it from the default or a preset.

For each attempted step, the callback supplied to `physicsLoop.update`:

1. Checks route completion, refreshes terrain contact, runs visible-mesh
   collision and handles placement reset.
2. Rechecks phone authority and pause after scene queries; blends local/remote
   input, applies pilot incapacity and synchronizes autopilot ownership.
3. Reads flight/engine properties, advances engine control, trim/flap assists
   and gear/bay interlocks, runs a loaded drone's `beforeStep`, then writes
   commanded controls to the SDK.
4. The [fixed-step loop](../../src/flight/physics/fixedStepLoop.ts) validates
   the pre-step state, records recovery values, calls synchronous `sdk.run()`,
   reads/validates the candidate state and restores or faults on rejection.
5. Only an accepted step advances route accounting, accumulated falling-store
   time, pilot physiology, engine audio publication, and enabled wheel-spin /
   wheel-cue consumers. Display interpolation follows the drained steps.

Contact/collision timings are children of `flight/physics`. Control reads,
guards, the native run, recovery capture and accepted-step consumers currently
share the parent's remainder; it is not a pure JSBSim solve time. Refused,
faulted and paused steps do not advance accepted-step consumers.

## Work outside the flight tick

These are also main-thread workloads. A quiet `flight/*` table does not account
for all of them.

| Trigger and registration | Work and lifetime |
| --- | --- |
| Startup in [page entry](../../src/main.tsx) and `createFlightSimApp` | Install diagnostics/loading UI; import application code; prepare mods, world and native SDK; register settings/watchers and feature handles; load model and terrain asynchronously; publish their ready state on the page. Initial terrain readiness gates placement. Hidden-gear shader warm-up runs before releasing loading, yielding in 20 ms intervals for up to 2 s. |
| Settings `watch` callbacks and panel actions in flight composition | Apply settings, update sound/visual/debug owners, write SDK values, update controls and request frames. Fuel, stores, damage, weather and location actions can do synchronous work while paused. Closing a panel does not dispose its underlying feature. |
| [UI refresh host](../../src/flight/earthUiHost.ts) | Emits after render, settings changes and from a 1 s interval so readings continue while a paused view draws no frames. Disposal removes the settings subscription, interval and listeners. This is separate from the flight snapshot's 100 ms frame throttle. |
| Keyboard, pointer, wheel, touch and gamepad input | Input/camera adapters handle browser events and update state. Gamepad flight polling is frame-claimed; the shared input system owns its other polling. View keys and focus keys are registered in flight composition, with matching detach paths. |
| Window/document lifecycle | `visibilitychange` cancels armament/haptics, informs phone ownership and saves; `blur`/`focus` clear armed input; `pagehide` saves. Hiding the page is not a synchronous full resource teardown. |
| Phone session messages/timers | After `loadPhonePairing`, message callbacks, ownership/lease checks, status/attitude publication and camera aim run on the page. Pending camera aim/glide explicitly requests further frames, including while paused. Protocol timer ownership is in [rc](https://github.com/0SFS/rc). |
| Multiplayer feature | After lazy activation, a 30 Hz interval publishes local pose while connected and requests redraws; a Babylon before-render observer updates remote aircraft. Local pause leaves this connection and remote view active. Disposal clears the interval, observer, sessions and remote slots. See [feature source](../../src/flight/multiplayer/createMultiplayerFeature.ts). |
| Asset/network/worker/audio completions | Fetch and worker execution can be elsewhere; parsing performed by callbacks, result adoption, scene attachment, settings/UI notifications and failure handling run here. See [network](network.md), [GPU](gpu.md) and [worker CPU](cpu-workers.md). |
| Scene observers | Flight UI emits after render; shared profiling observers bracket Babylon phases; optional debug, cockpit, drone, light/exhaust and remote-aircraft owners attach their work to the scene. Inspect each active owner, not only `setSimTick`. |
| [Cockpit screen](../../src/flight/cockpit/cockpitScreen.ts) | Mirrors page content and copies canvases at the configured screen refresh rate; a deferred `setTimeout` requests a paused frame when a stale mirror can next refresh. Disposal cancels the wake. |
| [Drone preview look](../../src/flight/drone/dronePreviewLook.ts) | While an active preview look is moving, an animation-frame callback advances its aim/glide and requests a world render. Release/disposal cancels it. This input callback is separate from the shared renderer's frame authority. |
| [Terrain recovery](../../src/flight/terrainRecovery.ts) and [location transport](../../src/flight/location/lookup/transport.ts) | Progress-stall, retry/delay and lookup timeout callbacks run while those operations are pending. Each attempt owns its cancellation and timer cleanup; a pending network operation does not mean the page is idle. |
| Saving and exports | `saveFlight` runs after the requested running interval (default 5 s), pause, placement and relevant state edits, and page hide/leave. CSV/report/image downloads and diagnostics serialization are event-driven; they can cause work outside the frame profile. See [storage](storage.md). |
| Aircraft-switch readiness | While switching, model readiness is checked at 25 ms intervals, with cancellation/error checks and a 120 s deadline. This polling ends on readiness or rejection; it is not a normal-flight timer. |

The default save interval and bounds are in
[flight parameters](../../src/flight/settings/flightParameters.ts):
`osfs.start.saveInterval`, 5 s, editable from 1–600 s. It counts non-held tick
delta, not a dedicated wall-clock timer or the fixed-step accepted-time total.

## Pause, saturation and release

`syncSimulationPaused` holds physics/audio, resets pending wheel cues, saves on
pause and releases the runtime's simulation-running demand. A requested view,
map streaming, camera glide, multiplayer or another owner can still keep frames
coming. A paused redraw still updates view/HUD/instruments without accepting
physics steps. Resume ignores the idle interval; it also attempts physics/contact
recovery if a prior fault exists. Shared settings, destruction, switching and
an open aircraft dialog can block resume.

An aircraft at rest is held the same way without being paused
([aircraftRest.ts](../../src/flight/physics/aircraftRest.ts)). It rests after 3 s
of flight on the ground with nothing turning (every JSBSim engine and propeller
spooled down, or a drone's motors stopped), no input held, no autopilot, no
terrain question, and nothing moving: under 1 cm/s, 0.005 rad/s, and no
control surface, flap, gear or nozzle travelling. A parked C172 and the landed
DJI drones settle to about 10⁻⁶ m/s with real JSBSim
([measured](../../src/flight/physics/aircraftRest.integration.test.ts)). At rest
physics stops stepping, audio is held (`"rest"`, which suspends the audio
context), the flight is saved once and the simulation-running demand is
released; the pause buttons still show running, and frames drawn for the
camera, map or flashing lights do not advance physics. `wakeFromRest` starts it
again, ignoring the time spent resting, on local input (keys, controller, HUD,
engine lever), phone input, a multiplayer combat message, a weather change, a
changed `osfs.*` setting value (notes under a control do not count), a pause
or resume, a placement or recovery, and ground that moves the aircraft or asks
about it. While multiplayer is connected its own 30 Hz frame demand still draws
frames at rest. The brake key (Space) does not count as input, so it does not wake
the aircraft, and flight time stands still while resting: an engine stopped
before it rests does not cool meanwhile.

Startup placement requires terrain. In the current composition, terrain
streaming is intended not to pause an established flight. The pre-step contact
callback nevertheless handles explicit refusal by dropping the pending step
backlog and showing the reason. Do not bypass refusal or state guards to meet a
frame budget; bounded work and accepted-time accounting preserve their meaning.

An aircraft switch suspends the old flight, preserves the shared world, prepares
the replacement SDK and then replaces the flight session. Failure paths restore
or report the selection as described in [aircraft switching](../aircraft-switching.md).
`destroy(preserveWorld)` removes the simulation callback, listeners, watchers,
feature sessions and profiling bindings, then disposes feedback, native readers,
models and SDK. Audio/collision property readers must be disposed before the SDK.
The shared runtime is destroyed only when its world is not being retained.
This is the intended teardown order. The flight's watcher loop and subsequent
disposals do not aggregate exceptions: a throwing cleanup can prevent later
flight cleanup. A disposal failure therefore needs an error-path check; this
inventory does not assert that every release always completes.

## Measuring and improving efficiency

Start with [frame times](frame-times.md). Compare section time with a separate
whole-main-thread browser trace: dispatch, asynchronous callbacks, style/layout,
GC and uninstrumented work can sit outside the named sections. Worker wait
elapsed time is not physical CPU occupancy. There is no global admission budget
covering every page callback.

Use this order for a resource change:

1. Reproduce the actual aircraft, view, terrain, optional features and rate;
   establish whether CPU, GPU, streaming or a one-time allocation blocks progress.
2. Remove repeat work whose inputs and outputs are unchanged, then consider
   cadence and admission. The [22 October HUD findings](../performance/2026-10-22/flight-frame.md)
   demonstrate changed-only DOM writes and the resulting layout reduction;
   their timings remain evidence for that dated workload.
3. Before moving physics or scene queries to workers, measure the complete
   transport/query/publication path, input latency and numerical parity. Before
   lowering a physics or feedback rate, validate the supported behavior.
4. Check active, paused, switching, failed-start and destroyed states. Verify
   that saved settings or a closed tab do not leave obsolete callbacks active.
5. Record new measurements with their conditions in the owning dated performance
   directory, then update this inventory if execution placement or lifetime changes.

Unmeasured opportunities include callbacks without individual profiler children,
flight-specific memory attribution, and total event/GC cost. They need evidence
before a priority or expected saving is assigned. [Memory](memory.md),
[GPU](gpu.md), [network](network.md) and [audio](audio.md) explain the resource
tradeoffs a main-thread optimization can introduce.
