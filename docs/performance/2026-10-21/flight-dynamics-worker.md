# Flight dynamics worker: implementation handoff

**Result (2026-10-21): the gate failed at step 3. The batched main-thread path
is retained. See [flight-dynamics-worker-results.md](flight-dynamics-worker-results.md).**

Status: a conditional implementation specification, not an instruction to ship
a worker by default. Work only in the 0sfs repositories. A separate agent owns
FOSS Earth; do not edit its source, renderer, worker pools, deployment settings,
or dependencies while implementing this work.

The objective is lower main-thread frame time with the same aircraft behavior,
input response, contact recovery, and sound. Moving CPU utilization between
cores is not itself an acceptance criterion. Browsers choose the CPU cores on
which workers run; this design cannot promise efficiency-core affinity.

## Evidence and first decision

JSBSim already runs compiled C++ in WebAssembly. The current application owns
that SDK on its main thread. Rust is not an automatic improvement over the
existing native solver. Keep the installed C++/WASM artifact and its physics;
start with ownership and transport changes. Do not replace the F135 plant,
aircraft aerodynamics, numerical integrator, or timestep in this project.

The October 21 local paired benchmark used the installed JSBSim artifact, real
model data, hold-down at 5,000 feet, and a 120 Hz timestep. The optimized version
uses native property batches for complete recovery snapshots and flight states.
The fixed-step measurement executes the actual guards, ground clearance,
snapshot capture, native `run()`, candidate validation, and interpolation.

| Operation | C172 before / after, ms | F-35B before / after, ms |
| --- | --- | --- |
| Complete recovery snapshot | 0.03840 / 0.00157 | 0.22741 / 0.00536 |
| Flight state | 0.01069 / 0.00032 | 0.01350 / 0.00030 |
| Complete fixed step | 0.11495 / 0.05520 | 0.44229 / 0.19298 |

Evidence and reproduction, relative to `fly/`:

- `build/perf-20261021/snapshot-batches-ab.json` contains all nine alternating
  samples per measurement, exact snapshot equivalence checks, and a native
  F-35B plant-restore check.
- `node build/perf-20261021/compare-snapshot-batches.mjs` builds and runs the
  paired benchmark against saved original sources and current sources.
- `build/perf-20261021/baseline-ground-contact/src/` holds the original readers.
- `build/perf-sim-audit.json` separately measured F-35B native `run()` around
  0.152 ms and C172 around 0.024 ms. Its snapshot-only comparison is a smaller
  workload than the complete capture measurement above.

These are Node timings without a renderer or live Google terrain. They do not
establish a browser FPS improvement or explain a reported 60-to-20 FPS change.
At two fixed steps per 60 Hz frame, the optimized F-35B loop above costs about
0.386 ms before application callbacks. Offloading only that loop has a small
ceiling; collect browser measurements before accepting a substantial rewrite.

First run the current optimized application, record `flight/physics`, its
terrain/collision children, audio, view, instruments, and total main-thread
frame time. Use the same aircraft, location, backend, resolution, sound,
diagnostics, and input trace for each comparison. Include both a flat offline
fixture and representative terrain. Separate CPU time from render/GPU waits.

Proposed shipping gate: at least 1 ms less main-thread work per target frame,
or at least a 10% improvement in total p95 main-thread frame time, with a
repeatable responsiveness improvement and no regression in contact, audio,
or input tests. Record confidence/range over repeated runs. The worker's CPU,
message handling, main-thread copying, terrain service, and GC all count.
If the complete system fails this gate, retain the existing batched path and
publish the failed experiment. A fast worker `run()` benchmark is insufficient.

## Source map and ownership

Paths below are relative to the `0sfs/` workspace.

| Current source | Responsibility during migration |
| --- | --- |
| `fly/src/flight/jsbsim/createJsbsimRuntime.ts` | SDK creation, aircraft hydration, bootstrap, identity, disposal; instantiate the SDK exclusively inside the worker. |
| `fly/src/flight/jsbsim/bootstrapC172.ts`, `fdmProfiles.ts`, `hydrateJsbsimData.ts` | Existing model selection, requirements, bootstrap, and package data; retain aircraft/engine capability validation. |
| `fly/src/flight/physics/fixedStepLoop.ts` | Preserve 120 Hz stepping, six-step accumulation cap, pause/reset semantics, envelope guards, and failure rollback. |
| `ground-contact/src/ecefBridge.ts`, `safeFlightState.ts`, `propertyReadBatch.ts` | Own native property batches in the worker, preserve captured state, and dispose views before the SDK. |
| `ground-contact/src/terrainContact.ts`, `visibleMeshCollision.ts`, `frameSurfaceQuery.ts` | Separate stateful contact decisions from main-thread scene queries; retain exact coordinates, revisions, and swept rays. |
| `fly/src/flight/createFlightSimApp.ts` | Composition and main-thread presentation; extract simulation orchestration before switching its backend. This file already contains unrelated aircraft-switch work; preserve it. |
| `fly/src/flight/model/flightModelDriver.ts` | An existing headless boundary and test fixture. It is not the live app's complete step boundary: it lacks its full authority, terrain, rollback, audio, and assist ordering. Extend deliberately or introduce a fuller session boundary; do not substitute it blindly. |
| `rc/src/createPhoneControlSession.ts`, `protocol.ts` | Keep network/session authority on the main thread; preserve leases, handoffs, freshness, blending, local takeover, and applied-sequence acknowledgments. |
| `controls/src/applyFlightControls.ts`, `autopilot/src/`, `engines/src/engineControl.ts` | Inputs, assists, engine commands, and their order must operate against one authoritative simulation state. |
| `sound/src/jsbsimAudioAdapter.ts`, `createFlightAudio.ts` | Sample native telemetry in the worker after every accepted step; main thread retains AudioContext, listener pose, and graph lifecycle. |
| `ground-contact/src/wheelSpin.ts`, `g-forces/src/`, `fuel/src/`, `engines/src/engineMonitorModel.ts` | Move force-affecting state to the simulation owner; publish observations for feedback, fuel UI, engine history, and instruments. |
| `fly/src/flight/jsbsim/resetFlightLocation.ts`, `savedFlight.ts` | Turn direct SDK mutations into ordered simulation commands with acknowledgments. Keep saved-flight compatibility and native state validation. |

Inventory every `jsbsim.sdk` consumer in `createFlightSimApp.ts` and linked
packages before the ownership switch. Presentation must consume copied
observations; it must not retain a second SDK, a native property node, or a
WASM heap view. Controls in panels, weather, fuel, external stores, engine
model selection, recorder, evaluation instruments, force overlays, engine
visuals, control-surface animation, and G effects all need explicit adapters.
Do not implement a synchronous RPC-shaped `getPropertyValue()` proxy.

## Proposed boundary

Start with one dedicated dynamics worker and one SDK. Sequential integration
steps depend on preceding steps; a pool cannot run different times of this
same flight independently. Worker pools require separately measured parallel
work, such as independent scenarios, and are outside this handoff.

Suggested new modules under `fly/src/flight/model/`:

- `simulationProtocol.ts`: versioned discriminated messages, numeric schema,
  validation, epochs, and capabilities; importable without DOM or SDK runtime.
- `simulationSession.ts`: backend-independent command and observation contract.
- `mainThreadSimulationSession.ts`: current behavior behind that contract;
  serves as the equivalence reference and fallback.
- `workerSimulationSession.ts`: bounded transport, startup, cancellation,
  observation handoff, and shutdown.
- `flightDynamics.worker.ts`: the sole native owner, fixed steps, native
  snapshots, assists, accepted-step observations, fault and cleanup handling.
- `terrainQueryService.ts`: the main-thread adapter to existing public surface
  query methods. No FOSS Earth source changes.

The contract should expose asynchronous lifecycle/transactions and
nonblocking `getLatestAcceptedObservation()`. Proposed commands are `start`,
`setPaused`, `setControlsAndAuthority`, `setConfiguration`, `reposition`,
`restoreSavedFlight`, `captureSavedFlight`, and `dispose`. Avoid unrestricted
string property writes across the boundary: each operation must validate the
aircraft capability, units, values, and point at which it takes effect.

Every command/reply carries `protocolVersion`, `runtimeGeneration`,
`requestId`, and a sequence number. Observations also carry accepted
`stepId`, `simTimeS`, `resetEpoch`, authority epoch, applied input sequence,
and terrain/collision provenance. An aircraft/engine switch creates a new
runtime generation; reset and reposition advance the reset epoch. Reject
stale generations, duplicate commands, out-of-order input, incompatible
schemas, and non-finite required values before they can mutate native state.

Publish flight pose/velocities, actual controls and actuators, native engine
and fuel telemetry, gear/wheel observations, force/G inputs, and availability
flags needed by existing consumers. Preserve double precision for geodetic
and simulation state. Optional/unavailable native values remain explicitly
unavailable; zero must not impersonate a missing sensor. UI-rate telemetry
can be decimated separately from per-step audio and discrete events.

## Step ordering and phone authority

Retain this sequence for each attempted fixed step:

1. Resolve terrain refinement and support, then swept body collision, against
   the exact authoritative pre-step state. Apply allowed recovery transactions
   and clear the appropriate interpolation/probe histories.
2. Recheck input authority after terrain/collision work. The present app calls
   `phoneSession.beforeStep()` at this point because scene work can consume
   the remaining input lease. A frame-start decision is insufficient.
3. Apply current local/phone blending, passed-out-pilot behavior, autopilot
   arbitration, starter/engine interlock, trims, flap assists, control-law and
   STOVL commands in their existing order. Use current native values for
   state-dependent assists.
4. Read/validate the pre-step flight state and true contact clearance. Capture
   the complete recovery snapshot, including all fuel tanks, optional store
   controls, thermal initialization, and coupled plant state.
5. Execute exactly one native step. Read the candidate, apply the existing
   envelope, motion, and airspeed-jump checks. A rejected step restores its
   snapshot before reporting the fault; it emits no accepted-step effects.
6. Publish accepted-step audio/discrete engine events, wheel state/cues, route
   progress, and other simulation-time consumers, then an observation for
   rendering. Retain the latest two accepted states for interpolation.

Do not queue an unbounded run of authorized steps. Each authorization ticket
must identify its state/step, authority epoch, input sequence, pause/visibility
state, and freshness deadline. The worker rechecks that gate immediately
before applying controls and running native code. Local takeover, phone
release, hidden-page pause, reset, and handoff cancellation invalidate all
queued tickets. Once invalidation is observed, no new step may begin; at most
one already executing step can finish, matching the current indivisible run.

Network validation and phone ownership remain in the current RC session.
The worker does not invent fresh leases or refresh one from telemetry. Send
the applied-sequence acknowledgment only after the corresponding accepted
step. Preserve starter hold behavior, stale-input neutralization, blended
lever feedback, and local flap revision tracking.

Use an explicit monotonic clock mapping/uncertainty bound for ticket expiry
across contexts; do not compare unrelated raw `performance.now()` values or
use wall-clock changes to extend a lease. A stalled main thread must cause
the worker to stop granting steps when its conservative authorization expires.
Test main-thread stalls and a delayed terrain response across the lease
boundary. Preserve the existing phone timing constants and observable policy.

## Terrain and rollback are a required part of the design

`SurfaceQuery.sample()` and `raycast()` operate on live main-thread scene
state. A worker cannot call them synchronously. Start with an exact request/
reply query service, with bounded one-step requests and cancellation, to
prove correctness and measure the full round-trip cost. Each request names
the pre-step state and exact coordinates/rays. Replies include the actual
hit or miss, surface revision/quality and mesh identity where available.
When a correction changes the state used by a subsequent query, query the
corrected state; never reuse a reply from the old state.

The existing frame query cache is exact-coordinate and scoped to one
synchronous flight tick. Preserve that rule. A previous displayed position,
nearby rounded coordinate, stale terrain height, or extrapolated plane is
not an equivalent replacement. Keep first-reference, missing/coarse-surface,
airborne continuation, blind-step, refinement-anchor, implausible-rise,
and resting-aircraft policies exactly as their current implementations.
Read the actual surface revisions rather than inventing one universal
revision shared by unrelated hits.

If the round trips erase the gain, stop or prepare a separate measured design
for immutable terrain geometry using an existing public API. This project
does not authorize a new FOSS Earth mesh-export API or speculative terrain
reuse. A shared telemetry buffer alone cannot remove a scene-query dependency.

Keep snapshot capture, all native restore writes, `RunIC`, clock preservation,
thermal restoration, plant-field staging/commit, and post-restore validation
inside the worker. No other thread can observe a half-restored state.
Report contact diagnostics from before rollback. Terrain refinements retain
tire momentum; teleport/mode/fault resets keep their existing distinct wheel
cue invalidation behavior. Reset and fault handling must cancel outstanding
terrain queries and reject replies from the previous epoch.

## Transport, rendering, and audio

Implement a bounded transferable-buffer or structured-message transport first.
Measure it before adding shared memory. A dedicated worker can own the current
single-threaded WASM build; shared JS observation buffers do not require a
pthread conversion of the native solver.

For a measured shared-memory improvement, use a versioned header and
double/triple-buffered observations with atomic publication and verified
sequence/slot ownership. Copy an accepted coherent observation before using
it. Test torn writes, delayed readers, buffer reuse, wraparound, overflow,
and shutdown during publication. The main thread must never block on
`Atomics.wait`, spin until a worker responds, or receive a raw mutable WASM
heap view. Prefer the last coherent observation if a writer is busy.
Keep a complete transport-equivalent path when shared memory or isolation
is unavailable; use current hosting/isolation policy without FOSS Earth edits.

Render interpolation uses the two most recent accepted observations, with
explicit simulation/wall-time mapping and reset barriers. Do not hide missing
observations with unbounded extrapolation. Camera/UI continue updating while
paused; a stale worker must not keep the UI believing it is simulating.

Audio currently observes every accepted step, preserves ignition/flameout/
starter/running transitions before continuous-telemetry decimation, and
uses simulation timestamps and epochs. Preserve those properties. The
worker owns the native `jsbsimAudioAdapter`; the main thread retains the
AudioContext, AudioWorklet graph, listener/source pose, and user-gesture unlock.
Publish ordered per-step audio readings/events separately from latest-wins
visual observations so short transitions cannot disappear.

Give the ordered channel a documented finite capacity, monotonically increasing
sequence numbers, and acknowledgement/backpressure rules. Never overwrite an
unconsumed discrete transition or treat it as latest-wins. Reserve space before
admitting the next step; if it is unavailable, hold admission and expose the
reason in diagnostics until the consumer catches up. Test saturation, consumer
stalls and epoch changes, including exact once-only delivery after resumption.

Preserve missing-telemetry availability, native nozzle/exhaust direction,
rewind detection, mute/unmute, pause/background/loading holds, and the
distinction between tire-cue contact holds and engine sound. Discard audio
from stale model/reset epochs. A failed or rejected physics step generates
no fresh accepted-step sound or haptic event. Reusing the existing audio
transport is preferable to a second independent AudioWorklet protocol.

## Startup, switch, and shutdown

Publish ready only after hydration, model validation, native bootstrap,
property reader creation, initial accepted observation, and required terrain
preparation. Keep the current aircraft-switch cancellation and loading UX.
A failed startup releases a late native allocation and any model views.
An old worker can never publish into a newly selected aircraft generation.

On disposal: stop admitting commands; invalidate authority and observation
epochs; hold/fade feedback; cancel queries; dispose native audio, gear,
snapshot, diagnostics, and property readers; then destroy the SDK exactly
once. Acknowledge complete cleanup before terminating the worker where
possible. Enforce a bounded shutdown timeout; terminate an unresponsive
worker, discard all its buffers/replies, and record the failure. Late graph,
model, data-download, and worker-start promises must observe cancellation.

Recovery from a worker crash must start paused at an acknowledged recoverable
snapshot or show the existing recover/reposition state. Do not create two
concurrent owners, silently restart at full throttle, or load old native
engine state into another model. Keep the main-thread backend available
until real browser acceptance proves the new lifecycle.

## Implementation sequence and required evidence

1. Inventory native readers/writers and extract a headless full simulation
   session with the existing main-thread implementation. Add deterministic
   replay fixtures; establish complete per-step observation/side-effect parity.
2. Add the versioned protocol, one-worker owner, ordered transactions, and exact
   terrain query service. Keep presentation on the main thread. Validate the
   transferable transport before any shared-memory optimization.
3. Measure complete browser frame cost, input-to-applied-step latency, worker
   utilization, terrain round trips, copying/serialization, and GC. Run the
   shipping gate. Stop broad migration if it fails.
4. Only if measurements justify it, add shared observations/authority gates,
   rerun transport equivalence and lifecycle races, and compare again. Do not
   introduce a pool or a Rust rewrite as a prerequisite.

Required regression cases:

- Native C172, SF50, and every F-35B engine option: equivalent replay at the
  same accepted step count; startup/shutdown, afterburner, STOVL transition,
  control-law modes, trims, flaps, gear, fuel and detached stores.
- Existing fixed-step pause/reset/cap guards; rejected native `run()`, NaNs,
  implausible displacement and airspeed jump; exact coupled-plant restore and
  independent pending thermal initialization. Failed restore remains a fault.
- Terrain refinement while resting and airborne; exact-coordinate misses;
  runway placement; deep penetration; building/wingtip swept collision;
  rejected spikes; surface revision change during a pending query; teleport
  and model switch during contact recovery. No accepted step against an old
  state's terrain reply.
- Phone handoff/ack, delayed/out-of-order frames, stale lease during terrain
  work, starter hold, local takeover, blending, hidden desktop, main-thread
  stall, reset and pause while a step is queued. Verify actual applied input
  sequence and latency, not only the visible control position.
- Engine audio short transitions within multiple steps per frame, reset/rewind
  epochs, background/resume, sound disabled, gesture unlock, missing native
  telemetry, contact faults and tire/haptic holds. No duplicated/missing events.
- Double initialization/disposal; failed/late hydration; cancelled model switch;
  worker crash/startup failure; pending audio unlock; query timeout; stale
  response after a new model; unavailable Worker/SAB/isolation fallback.

Use and extend the existing suites in `ground-contact/tests/`,
`fly/src/flight/physics/`, `fly/src/flight/model/`,
`fly/src/flight/jsbsim/*integration.test.ts`, `fly/src/flight/audio/`,
`fly/src/flight/createFlightSimApp*.test.ts`, and `rc/tests/`.
Run `npm run typecheck`
and relevant lint/build checks in `fly/`. Keep measurement scripts, traces,
source snapshots, logs, and screenshots under ignored `fly/build/`; summarize
the reproducible results in tracked performance documentation.

The final change must report the full-system result and its limits, including
cases where the worker path is slower. Do not claim all-core scaling,
efficiency-core placement, or a 60 FPS outcome from an isolated solver timing.
