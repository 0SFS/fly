# Resume here: 0SFS performance work

Checkpoint date: 2026-10-21. This file preserves the conversation's decisions and
working-tree boundaries. The implementation and evidence are on disk; resuming
does not require the chat history.

## Read in this order

1. [Findings, measurements and validation](README.md).
2. [Later flight-worker experiment and failed gate](flight-dynamics-worker-results.md)
   and [native-access inventory](flight-dynamics-native-inventory.md).
3. The independent [exhaust Rust/WASM specification](exhaust-wasm-worker.md),
   [conditional dynamics-worker specification](flight-dynamics-worker.md), and
   [future F-35 model/LOD specification](f35-model-lod.md).

The worker results and native inventory were added by subsequent work already
present at this checkpoint. Preserve them. The worker was an experiment, not a
shipped migration: its report rejects the performance gate and retains the
batched main-thread solver. Do not restart that rewrite from the original spec
without addressing the measured terrain-service cost and input latency.

## User intent and constraints

- Prioritize the largest measured gains with unchanged or improved UX. The
  reported symptom was roughly 60 FPS in the C172 and 20 FPS in the F-35, with
  one core heavily loaded. The original report did not establish the user's
  exact device, browser, camera view, location or afterburner state.
- Work in the 0SFS repositories. Another agent owns FOSS Earth optimization;
  do not edit its sources, renderer, dependencies, worker pools or deployment
  configuration as part of this task. Browser comparisons pinned its source
  inputs to isolate the 0SFS changes.
- The user favors Rust/WASM/shared-memory workers for substantial mathematical
  work, and requested independent implementation specs for an Opus agent.
  Respect that preference while retaining the measured acceptance gates.
  JSBSim is already C++/WASM and audio DSP already runs in a WASM AudioWorklet.
- The user explicitly prohibited changing the aircraft models now. The lower-poly
  F-35 document is a future task, including draw-call/material/transform budgets,
  not authorization to simplify current assets during this work.
- No commit, push, deployment or repository-setting change was made by this
  conversation. Changes are saved locally and remain uncommitted.

## Repository and change ownership

`/Users/felg/gh/0sfs` is a workspace of separate repositories, not a Git repository
itself. This task changed `fly`, `exhaust` and `ground-contact`.

Performance implementation files:

| Repository | Files and purpose |
| --- | --- |
| exhaust | `src/engineExhaustDepth.ts`: publish depth candidates only on actual changes; `src/engineGasOptics.ts`: exact computation optimizations; `src/createEngineExhaust.ts`: avoid redundant light-membership scans; `tests/engineExhaustDepth.test.ts`: real Babylon invalidation regression. |
| ground-contact | `src/propertyReadBatch.ts` (new), `src/ecefBridge.ts`, `src/safeFlightState.ts`: native batches and lifecycle; `tests/ecefBridge.test.ts`, `tests/safeFlightState.test.ts`: equivalence, optional properties, invalid values and cleanup. |
| fly | `src/flight/jsbsim/createJsbsimRuntime.ts` and its test: dispose both readers before SDK destruction; `src/flight/aircraft/engineGasOptics.test.ts`, `createEngineExhaust.test.ts`: optical ownership/parity and light updates; `stowedGearHitch.entry.ts`, `stowedGearHitch.test.ts`: robust compile-observer positive control and retained gear-transition checks. |
| fly, shared test files | In `src/flight/createFlightSimApp.test.ts` and `.phone.test.ts`, only select the visual property batch by its augmentation path instead of assuming it is the SDK's only/latest batch. These files contain other preexisting work. |
| fly, documentation | This directory and the pointer in the main `README.md`. Later worker experiment documentation also lives here. |

Preexisting unrelated aircraft-switch work was present in `fly` before profiling:
`README.md`, `package.json`, `src/flight/bridge/enuFrame.test.ts`,
`bridge/floatingOrigin.ts`, `createFlightSimApp.ts`, `createFlightSimApp.test.ts`,
`hud/AircraftSelectionPanel.test.tsx`, `hud/FlightControlPanel.tsx`,
`hud/createFlightHudBar.ts` and its test, `settings/flightParameters.ts` and its
test, and `src/styles/flight.css`. It also included untracked
`scripts/check-aircraft-switch-headless.mjs`,
`hud/FlightControlPanel.aircraft.test.tsx` and `hud/createAircraftSwitchOverlay.ts`
and its test. Paths in that sentence are relative to `fly/src/flight/` unless
otherwise written. Do not attribute or discard those changes as part of the
performance task.

The sibling `aircraft` repository also had unrelated selector/UI edits in
`src/AircraftSelectionPanel.tsx`, its headless script and validation document.
The `F-35B` and `F135` asset repositories were clean when checked. Always inspect
fresh status before editing: independent agents may have continued work since
this checkpoint. Do not reset entire files or apply a whole-working-tree patch
to separate the performance changes.

## Findings that should not be rediscovered

- Biggest confirmed bug: clearing Babylon's observed exhaust depth list and
  pushing its first item dirtied lighting across scene meshes every frame.
  It was one global invalidation per frame, not one per pushed mesh. Stable
  list publication removed it while retaining exact candidate selection.
- Controlled headless WebGL2 CPU work fell 7.704 → 3.850 ms/frame for F-35B;
  main draws fell 3.529 → 0.682 ms. Both runs were around 60 FPS. These results
  demonstrate CPU headroom on that machine, not a verified 20→60 FPS recovery on
  the user's device. Nested profiler rows must not be added together.
- Complete F-35 recovery capture fell 0.2274 → 0.00536 ms in alternating Node
  trials; the actual fixed-step loop fell 0.4423 → 0.1930 ms. Keep native plant,
  thermal, fuel and control snapshot semantics and independent returned records.
- Default optical field evaluation improved about 2.7× with exact scalar
  comparison. Immutable emission-table logarithms are cached; output arrays are
  not shared between returned fields. Do not mutate profile tables in place.
- Nozzle rig and gas-support transform math were tiny in isolated probes; they
  were not a priority Rust migration. The current F-35 source assets have only
  about 24,059 combined triangles but 259 primitives and 349 nodes, so polygon
  reduction alone is not a CPU solution.
- Batches belong to one model/SDK. Release readers before executive destruction;
  the owner deletes its WeakMap entry before disposal. Internal batch helpers
  are not intended to be read after release. Preserve missing-property scalar
  fallback and live NaN propagation.
- Workers do not grant browser code control over P-core/E-core placement. Later
  worker measurements found at most about 0.64 ms/frame movable on that machine,
  terrain-query round trips and an extra presentation frame. Read the complete
  later report's methods and limits rather than treating this as universal.

## Evidence, validation and resumption

[evidence-summary.json](evidence-summary.json) retains compact measured results
and source/evidence identities. [retained-evidence.tar.gz](retained-evidence.tar.gz)
preserves selected original sources, benchmark/prototype scripts, CPU profiles,
and reports outside disposable build outputs. Its member list and SHA-256 values
are in [evidence-manifest.json](evidence-manifest.json). No browser profiles,
credentials, `.env` files, downloaded terrain, built site bundles or dependencies
are included. Extract into a separate scratch directory for inspection; do not
overwrite active source trees from an archive. The scripts retain their original
workspace-relative assumptions and may need path adaptation after extraction.

The broader local working evidence remains under
`fly/build/perf-20261021/`. It is gitignored. Closing this conversation preserves
those local files, but deleting `build/` would remove evidence not included in the
bounded archive. The documentation and archive are also currently uncommitted;
local persistence is not a remote Git backup.

At the end of the implementation pass, 2,198 tests passed plus one expected
failure, with lint, typecheck and production build passing. The composite CI
command initially stopped at a browser test's sandbox-denied local port; that
test passed separately with permission after correcting its phase-dependent
compile-observer assertion. Gear transitions still require zero new compiles and
no hitch. The corrected WebGPU run observed 52 preparation calls overall and
zero on transitions. Later worker experiments changed documentation/prototype
files, not the shipping worker architecture; their report lists separate checks.

No new application validation is implied by this documentation checkpoint.
Revalidate only as warranted by subsequent implementation changes. To resume:
inspect each repository's `git status`, read the current findings and failed-worker
result, preserve aircraft-switch work, and select a new measured bottleneck.
Live-device reproduction, representative WebGPU/phone/battery results, and any
authorized future asset work remain separate from the completed CPU fixes.
