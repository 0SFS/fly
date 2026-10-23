# F-35B performance findings and implementation handoffs

Date: 2026-10-21. Scope: the 0SFS repository family only. No FOSS Earth sources,
aircraft models, textures, simulation rates, visual quality settings or deployment
settings were changed. Existing aircraft-switch work was retained.

For conversation-independent resumption, current change ownership and the retained
evidence archive, start with [session-handoff.md](session-handoff.md).

## Implemented changes

1. **Stop invalidating scene lighting from the exhaust depth list.**
   `exhaust/src/engineExhaustDepth.ts` previously cleared Babylon's observed
   `renderList` and pushed candidates into it every frame. Babylon's transition
   from an empty list to a nonempty list marks lighting dirty on scene meshes.
   This forced repeated PBR light-define and effect preparation although the
   lighting configuration had not changed. Build candidates in detached scratch
   storage and replace the list only when its members or order change. Retain
   current occlusion tests, readiness checks and hidden-gear pipeline warmup.
   A direct Babylon comparison found redundant lighting invalidation on 120/120
   unchanged frames before the fix and 0/120 afterward.
2. **Read native flight state and recovery snapshots in batches.**
   `ground-contact/src/ecefBridge.ts`, `safeFlightState.ts` and the internal
   `propertyReadBatch.ts` use existing JSBSim native property batches, resolving
   nodes once per model. Preserve independent snapshot records, optional
   properties, thermal/plant state, invalid-value rejection and scalar fallback.
   `fly/src/flight/jsbsim/createJsbsimRuntime.ts` releases the readers before
   destroying their owning SDK.
3. **Remove repeated work from exhaust field evaluation.**
   `exhaust/src/engineGasOptics.ts` caches immutable spectral logarithms, reuses
   per-evaluation scratch vectors, and computes repeated axial reaction terms
   and unobstructed radial integrals outside inner loops. No state quantization,
   field decimation or optical approximation was introduced. A comparison against
   the original implementation matched 2,798,908 scalar values exactly across
   168 scenarios, including retained diagnostic fields.
4. **Avoid repeated light-membership scans.**
   `exhaust/src/createEngineExhaust.ts` changes a nearby light's enabled state
   only when that state changes. Babylon's `Light.setEnabled` scans scene meshes
   even when given its existing value. Emission intensity/color still update
   immediately; membership and resource lifetime retain their existing behavior.

The flight dynamics were already C++ compiled to WASM. The measured problems did
not require replacing that simulator with Rust. Audio DSP already uses a WASM
AudioWorklet; this work did not add a second audio engine or transport.

## Measurements and limits

The controlled browser comparison used headless Chrome, WebGL2 through ANGLE
Metal on Apple M5, 1280×800 CSS pixels, DPR 1, flat offline terrain, sound disabled,
and eight-second CPU-profile windows after aircraft loading settled. Both builds
used the same pinned FOSS Earth source inputs, so concurrent work in that checkout
could not change the comparison. The baseline substitutes saved original 0SFS
sources for the changed modules; the rest of the application remains the same.

| Mean CPU section per frame | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| F-35B measured frame work | 7.704 ms | 3.850 ms | 50.0% |
| F-35B render work | 5.124 ms | 2.205 ms | 57.0% |
| F-35B main draws | 3.529 ms | 0.682 ms | 80.7% |
| F-35B flight tick | 2.531 ms | 1.591 ms | 37.1% |
| F-35B view updates | 1.260 ms | 0.567 ms | 55.0% |
| F-35B physics loop, including app callbacks | 0.672 ms | 0.433 ms | 35.5% |
| C172 measured frame work | 1.257 ms | 1.182 ms | 5.9% |

Rows are nested sections, not additive. CPU sampling adds overhead. The runs
remained around 60 FPS, so the improvement is additional frame-time headroom,
not a demonstrated doubling of FPS. This is not a reproduction of the user's
reported 60→20 FPS on live terrain, nor a battery, E-core-placement, WebGPU or
all-device qualification. The remaining profile is dominated by ordinary matrix,
draw/uniform and viewport work, with much less repeated material preparation.

Separate alternating Node/WASM trials at a fixed 120 Hz measured:

| Work | Before | After |
| --- | ---: | ---: |
| F-35B complete recovery snapshot | 0.2274 ms | 0.00536 ms |
| F-35B actual fixed-step loop | 0.4423 ms | 0.1930 ms |
| C172 actual fixed-step loop | 0.11495 ms | 0.05520 ms |
| Default 64×32 dry optical field, fixed geometry | 1.105 ms | 0.410 ms |
| Default 64×32 afterburner field, fixed geometry | 1.567 ms | 0.588 ms |

These isolated timings are not browser frame estimates. The snapshot comparison
also verified identical records and exact restoration of native plant fields.
Changing-geometry optics improved too, but those timing trials had competing CPU
activity; the optical handoff records the range instead of claiming a stable gain.

Local evidence and reproduction scripts are under ignored
`fly/build/perf-20261021/`: `profile.mjs`, `controlled-before/`,
`controlled-after/`, `pinned-earth-sources.json`, `snapshot-batches-ab.json`,
`compare-snapshot-batches.mjs`, `gas-optics-report.json`,
`gas-optics-benchmark.mjs`, and `render-list-invalidation-report.json`.
They include original source snapshots. Do not treat their absolute local paths
as portable infrastructure; future implementations should retain a bounded
portable comparison harness with their source changes.

Source checkout heads before these edits were:

- fly: `2d66a888a04d31a59634d868e8294e4d76986b79` plus existing aircraft-switch work.
- exhaust: `194d7fb59e54504e8396f02a7a0313ebd32ea3d3`.
- ground-contact: `e941f4432334f96ff3959a78da3c9869eabb2f80`.

## Validation

- Lint, TypeScript checks and the production build passed, including JSBSim,
  audio, exhaust and engine-asset artifact verification.
- The full suite passed 2,197 tests plus one expected failure. Its real-browser
  gear test initially could not open a local port in the sandbox. Run separately
  with browser/network permission, it exposed a positive-control assertion that
  assumed shader compilation occurred during a particular warmup frame.
- The gear fixture now counts preparation throughout model loading, and observes
  asynchronous WebGPU pipeline creation too. All original zero-compilation and
  stall assertions for actual gear transitions remain. The corrected test passed
  on WebGPU: 52 total observed preparation calls, zero compiles on extension,
  retraction or repeated extension, with transition frames around 1.6–1.9 ms.
  This brings the validated total to 2,198 passing tests plus one expected failure.
- Focused tests cover native batch lifetime/missing values/rollback, independent
  retained optical outputs, depth candidate changes and live light updates.
  Independent code review found no correctness or lifecycle blockers.

The complete `npm run ci` invocation stopped at the sandboxed browser test;
the required browser test, build, lint and typecheck were completed separately.
Logs remain in the local evidence directory.

## Independent implementation specifications

Each document is a standalone handoff, with ownership, current source paths,
interfaces, correctness requirements and performance gates:

- [Exhaust Rust/WASM and optional worker](exhaust-wasm-worker.md): measure a
  synchronous Rust kernel first; enable worker transport only when its complete
  cost and state age beat the optimized synchronous baseline.
- [Flight dynamics worker](flight-dynamics-worker.md): retain JSBSim's existing
  native model while moving complete, ordered simulation ownership off the render
  thread. Terrain/contact dependencies, input authority, rollback, audio and
  aircraft-switch lifetime are part of this rewrite.
  **Measured and stopped:** the gate failed. Movable work is at most 0.64 ms per
  frame. Exact per-step terrain queries cost more off-frame than in-frame, and
  the boundary adds a frame of input latency. See
  [flight-dynamics-worker-results.md](flight-dynamics-worker-results.md).
- [F-35B model LOD pipeline](f35-model-lod.md): a future asset task. Reduce draw
  submissions/material/transform overhead as well as polygon count, preserving
  rig, cockpit, gear, STOVL, engine and collision contracts. **Do not change the
  plane models as part of the current optimization work.**

Reprofile after these fixes before selecting the next rewrite. A worker pool does
not make dependent simulation steps parallel, and several workers for one small
field can cost more than they save. Browser code cannot promise E-core affinity.
The specs require measured main-thread savings without added response latency,
loss of optical/mechanical fidelity, or regressions in total CPU cost.
