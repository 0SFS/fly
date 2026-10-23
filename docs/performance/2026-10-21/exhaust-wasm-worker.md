# Implementation handoff: exhaust gas optics in Rust/WASM and a reusable worker

Date: 2026-10-21. This document specifies future work for an Opus implementation
agent. The Rust kernel and worker described below are not implemented yet.

## Objective and ownership

Move the aircraft exhaust optical field calculation out of JavaScript where
measurement shows a net benefit, preserving the existing physics, field quality,
lighting, controls and response to aircraft state. Keep an optimized synchronous
path for workloads where worker scheduling costs more than the calculation.

Own these 0SFS surfaces:

- `exhaust/src/engineGasOptics.ts`: reference implementation and public types.
- `exhaust/src/engineReactionEmission.ts`: chemistry interpolation and temperature PDF.
- New Rust crate, WASM artifact, worker, ABI adapter and build/verification scripts
  under `exhaust/`.
- `exhaust/src/createEngineExhaust.ts`: integration with physical field revisions,
  source texture uploads and the approximate nearby light.
- `fly/`: app lifetime wiring, artifact build checks and regression/performance tests.

Read the organization and repository `AGENTS.md` files first. Coordinate ownership
of `createEngineExhaust.ts` and app lifetime wiring before editing them. Do not edit
`foss-earth/`, its renderer, its worker pools, its deployment headers, or engine
physics/JSBSim as part of this rewrite. The concurrently running FOSS Earth agent
owns that separate repository family. Do not change the generated F135 optical
profile or regenerate its underlying scientific model to make this rewrite faster.

## Measured starting point and decision gate

The 2026-10-21 TypeScript optimization already cached immutable emission-table
logarithms, removed per-texel temporary vectors, and moved repeated reaction
trigonometry/exponentials and unobstructed radial integrals outside inner loops.
It retained exact arithmetic results for 2,798,908 scalar comparisons across 168
cases, including archived v1 and corrected v2 profiles, parcel emission, annular
domains, temperature endpoints and three field resolutions. Gas optics and
reaction tests passed, 19 tests total.

At the default 64 axial × 32 radial field resolution, alternating Node v26.9.0
trials of 160 changing states, five rounds, produced these median times:

| Workload | Original TS | Optimized TS | Speedup |
| --- | ---: | ---: | ---: |
| Changing temperature/fuel, dry, fixed authored geometry | 1.105 ms | 0.410 ms | 2.70× |
| Changing temperature/fuel, parcel active, fixed geometry | 1.567 ms | 0.588 ms | 2.67× |
| Changing temperature/fuel and authored geometry | 3.489 ms | 1.571 ms | 2.22× |

The moving-geometry measurements had competing CPU activity. An earlier run gave
approximately 2.74 → 0.99 ms. Treat these as kernel measurements on this machine,
not browser frame-time improvements or evidence that gas optics explains the
reported C172-versus-F35 FPS gap. Profile the integrated browser again.

The local evidence is in `fly/build/perf-20261021/gas-optics-benchmark.mjs`,
`gas-optics-report.json` and `gas-optics-before/`. These are ignored scratch
artifacts; promote a bounded, portable harness and fixtures into tracked source
as part of the implementation. The optimized reference source SHA-256 was
`0e2b70b1c94a2ea2426ed200133bf60d81a74ec0dfc9f2a81ff4a8ca29d3825a`;
the saved original was
`a2ed5be59fcc40e2f6d984fa949d2cc5908c14696d1fac94c09591aac9f43634`.

Compare four paths independently: optimized TS on the main thread, synchronous
Rust/WASM, worker Rust/WASM using transferables, and optional shared-buffer worker
Rust/WASM. Include dispatch, copies, publication, result adoption and texture
upload in the browser comparison. Do not select a worker by default from a Rust
microbenchmark alone. In particular, moving a 0.4–0.6 ms fixed-geometry kernel
behind message delivery may lose more time than it saves.

Implement and measure synchronous Rust first. A separate worker dispatched after
main-thread physics will often miss the current frame's same-state presentation
deadline. Repeatedly computing the same field again in the synchronous fallback
can erase any benefit. Continue to a default worker only if early scheduling or
coordinated simulation ownership resolves that dependency without added state age.

Before enabling a path by default, show repeatable main-thread p95 savings of at
least 0.25 ms per updated default-resolution field on a relevant target device,
with no regression in presented frame-time p95/p99, input response, state age or
total CPU cost beyond measurement noise. This is an initial acceptance target;
record a justified stricter device-specific gate if the noise floor requires it.
If a worker fails the gate, deliver the validated Rust kernel and keep the faster
synchronous path selected. A pool of several workers for one small field is not
required; add parallel tiles only if measured work size justifies synchronization.
Browsers do not give this code reliable P-core/E-core placement control. Report
main-thread time, worker time and total utilization, not a promise of E-core affinity.

## Kernel contract and ABI

Port the complete mathematical dependency chain required by
`evaluateEngineGasOptics`, including legacy uniform-field behavior, spatial bases,
exact bilinear nodal volume weights, exterior-only volume weights, log-linear
absolute emission, particle Planck means, parcel interpolation, temperature PDF,
signed XYZ-to-linear-RGB mixing and the single Y-preserving output gamut map.
Retain input validation, domain validation, corrected-versus-legacy distinctions,
fuel allocations, Float32 storage headroom and cold-source behavior. Preserve the
public TS API for tests and external consumers through an adapter.

Use f64 internally and retain the current Float32 RGBA output. Do not substitute
f32 internals, fast-math, fewer grid nodes, fewer quadrature nodes, a new gamut map,
temperature quantization or update throttling. Cache profile data and reusable
geometry by their actual invariants; never assume a mutated nozzle/domain remains
unchanged because its wrapper object or support pose is reused.

Publish a versioned, documented binary ABI, with explicit sizes, offsets, alignment
and maximum capacities. A small C-style export surface is sufficient:

- ABI/build identity and capacity query.
- Context allocation/destruction and profile installation by content identity.
- Evaluation with input pointer/length and output pointer/capacity; return an
  explicit success/invalid-input/error code. Invalid input must have the same
  observable zero/invalid semantics as TS and must never leave a previous field
  appearing current.
- Output descriptor with scalar optical totals, flags, dimensions and offsets to
  RGBA, section metadata, volume weights and diagnostic arrays.

Represent optional numeric inputs with presence bits, not zero or NaN sentinels
that collapse existing `undefined` behavior. Define every unit and enum. Include
temperature, ambient/upstream state, ambient pressure, augmentation, actual total
and burned fuel flows, radius, length, requested dimensions, signed axial bounds,
section distances/radii/inner radii/area factors, profile ID and revisions.
Input presence, domain changes and resolution changes are part of the physical
state identity; camera movement and shader display gain are not.

Send immutable profile tables once per worker/context, not with every state. Keep
all returned diagnostics available with their existing meaning and precision.
The renderer may consume a compact result if diagnostics remain obtainable for
the exact same state without rerunning a different approximation. Do not remove
arrays from the public result merely to improve benchmark transfer size.

Preallocate bounded kernel arenas for the supported resolution range. Validate
all pointer/length pairs, descriptor arithmetic and section counts before use.
JS views must be recreated after any WASM memory growth. Freeze shared-memory
capacity after initialization; resizing requires a new protocol generation, not
overwriting a buffer still visible to a reader. Ordinary shared result buffers
can be separate from the WASM heap; Rust atomics/threaded WASM are optional and
must earn their deployment/build complexity independently.

## Worker lifetime, scheduling and buffer ownership

Create or acquire one optical compute worker at the flight app lifetime boundary
and reuse it across aircraft and exhaust renderers. Do not create workers per
frame, per field update, or on every aircraft switch. If a compatible app-owned
worker already exists, use its explicit scheduler only after coordinating with
its owner; never silently compete with simulation deadlines. App disposal closes
the worker and frees contexts. Aircraft/exhaust disposal releases its own client
handle without killing other clients. Bound cached profiles and reusable buffers.

Every request and result carries at least `abiVersion`, `appGeneration`,
`clientId`, `clientGeneration`, `profileRevision`, `geometryRevision`, `requestId`,
simulation timestamp, and field dimensions. Use separate lifecycle generations
for disposal/recreation, reset, respawn, aircraft switch and incompatible buffer
reconfiguration. Scope sequence counters to generations and define wrap handling.
Validate the full identity before uploading a texture or updating a light.

Maintain bounded latest-state work: at most one running job and one replacement
pending state per client. A newer pending state replaces the older pending state;
do not accumulate a message/job queue during stalls. Cancellation is logical:
an old WASM calculation may finish, but its result cannot touch a disposed or
new-generation renderer. For continuous state streams, do not blindly reject
every completed job merely because a newer request exists; that can starve result
adoption forever. Adopt only results permitted by the presentation contract below,
in increasing request order, and count replacements, late results and fallbacks.

Start with non-shared transferables: reuse a bounded pool of owned ArrayBuffers,
transfer ownership explicitly, and return buffers after the consumer no longer
needs them. Never detach memory referenced by a public retained result, by the
active upload, or by another client. Ordinary structured-clone fallback is valid
for small metadata, not an accidental full-profile copy on every update.

An optional SAB path requires successful feature/capability checks including
cross-origin isolation. Support double or triple result slots with atomic slot
states such as FREE → WRITING → READY → READING → FREE and explicit generations.
Write payload and header completely before publishing READY with Atomics; the
reader claims a ready slot atomically and releases it only after consumption.
Never write into READY or READING storage. When no slot is free, replace pending
input or skip optional worker work; do not block the main thread or allocate an
unbounded spill buffer. Do not call `Atomics.wait` on the main thread, spin, or
read a partially published result. A triple buffer is a scheduling option, not
permission to add three frames of visible latency.

The nonisolated path must work without changed FOSS Earth headers: use a regular
worker and transferable buffers when available, otherwise synchronous WASM or
optimized TS. Feature absence, CSP/module load failure, compile failure, worker
crash and memory exhaustion must yield a bounded fallback with a diagnostic reason.
Allow at most a bounded restart attempt per failed generation; no crash/restart
loop or per-frame error logging.

## Presentation and no-lag requirements

Keep Babylon objects, camera/visibility decisions and GPU uploads on the main
thread. Apply a completed field, its metadata and its nearby-light totals as one
revision. A field calculated for different support geometry, dimensions, profile
or lifecycle generation must never be stretched onto the current nozzle/domain.
World pose changes may reuse an axisymmetric field only when physical geometry
and every field input are unchanged, as in the current physical-key separation.

Preserve the current hidden/out-of-range/no-gas-view behavior: do not calculate
unused fields continuously. Reentry must request the current state. Engine stop,
fuel cutoff, invalid state and aircraft disposal immediately enforce current
visibility/zero-source rules; a late bright field cannot resurrect a plume or
light. Retain hot-surface thermal behavior, which is separate from combustion.

Do not add a mandatory frame of latency to throttle, ignition, flameout, nozzle
motion or contribution-view changes. Schedule early only with an actual known
simulation snapshot. Associate the result with the state being presented; if it
is unavailable by that presentation deadline, use the optimized synchronous path
for that state or select synchronous operation for this workload/device. Do not
invent future state, wait for the worker on the render thread, or claim a faster
frame by displaying a persistently older field. Integrating optical work into a
future simulation-worker pipeline requires explicit ownership coordination and
must preserve the same presentation-state pairing.

Measure submission-to-ready, ready-to-upload and simulation-state-to-presentation
ages, including p95/p99 and missed deadlines. Continuous newer requests must not
hide starvation. Test step changes and video/frame captures alongside steady
flight. Any proposed perceptual tolerance that relaxes state pairing needs a
separate explicit product decision; it is outside this no-UX-impact rewrite.

## Numerical parity and optical bounds

Retain the optimized TS implementation as an independent oracle and deterministic
fallback. The completed TS optimization was bit-for-bit identical to its original;
that does not establish bitwise parity for Rust. Rust/libm implementations of
`exp`, `log`, `sin`, powers and floating-point contraction can differ from the JS
engine even when both use f64. Pin the toolchain and math implementation, avoid
uncontrolled fused operations, and report actual discrepancies rather than
claiming exactness from the language or target.

Require exact agreement for validity, enum/boolean flags, source temperature
meaning, mode, dimension/section identity, clamping/resolution status, absence of
a field, zero-source cases, support inclusion and authored table endpoints where
direct copying applies. For floating fields, first compare all f64 outputs with
a relative target of 1e-12 plus a documented per-unit absolute floor near zero;
record the maximum error, reference magnitude and case for each output class.
Do not use one large absolute tolerance across temperatures, metres, watts and
radiometric/color quantities. For RGBA, require no more than two Float32 ULPs for
nonzero representable values as an initial target, and separately bound errors
near zero and gamut transitions. Any relaxation requires a written numerical
explanation and image/energy evidence; it must not conceal an altered model.

Tolerances cannot waive physical invariants: all stored RGBA values must remain
finite and nonnegative; total source upper bound must stay within allocated
power; absorption caps and four-Float32-ULP storage headroom must remain; signed
component RGB survives until the single combined gamut map; the combined map
preserves photopic Y; complete and exterior integrals retain their respective
domains; CH emission is not moved outside the resolved reacting hardware. Compare
the integrated actual Float32 field and the diagnostic f64 arrays, not only one
sample or aggregate maximum. Preserve the existing tests' boundary/rounding
allowances and investigate every newly exceeded allowance.

## Build and artifact identity

Keep Rust source, `Cargo.lock`, a pinned toolchain and an explicit reproducible
build script under `exhaust/`. Minimize dependencies; document licenses and pinned
transcendental-math behavior. Produce a small identified release WASM artifact
and, if necessary, loader glue. A threaded variant must be a separately
identified capability variant with a working ordinary-WASM fallback. Builds must
not fetch a compiler or Cargo dependency at app runtime.

Record source/input SHA-256 hashes, build flags, target, exact tool versions,
ABI/schema versions, dependency lock hash, exported/imported symbols, artifact
hash/size and completed validation commands. Include the JS worker/adapter inputs
in protocol provenance. Add explicit build and verify commands to the app's
quality checks, following the established source-drift and emitted-asset checks
in `sound/scripts/verify-audio-artifact.mjs` and
`fly/scripts/verify-jsbsim-artifact.mjs`; do not modify those unrelated artifacts.

Verification must fail for changed Rust/protocol source with an unchanged
artifact, a wrong ABI, missing/unexpected exports, or bundled bytes that differ
from the selected artifact. Load worker/WASM through bundler-resolved URLs that
work under `/fly/` and other nonroot base paths. Verify production HTTP-loaded
bytes, MIME/load success, worker path and fallback behavior, not only files on
disk. A TS fallback must not silently hide a broken production Rust artifact in
the acceptance run: report which backend actually executed and its identity.

## Reproduction, acceptance and delivery

From the existing checkout, the current evidence can be reproduced from `fly/`:

```sh
node build/perf-20261021/gas-optics-benchmark.mjs
npx vitest run --configLoader native src/flight/aircraft/engineGasOptics.test.ts src/flight/aircraft/engineReactionEmission.test.ts
```

The future tracked harness must run after a clean checkout with documented build
commands and no dependency on ignored evidence files. Save generated logs,
profiles and screenshots under gitignored `build/`. Deliver these checks:

1. Compare TS, synchronous WASM, transferable-worker WASM and SAB-worker WASM on
   the same recorded deterministic input streams. Cover both model generations,
   uniform/spatial paths, 8–64 valid grid dimensions, table endpoints, invalid and
   missing inputs, negligible cold tails, fuel caps, dry/parcel-active operation,
   unresolved reaction zones, annular/oblique domains, duplicate stations, changing
   nozzle radius/inner radius/area factors and geometry cache invalidation.
2. Exercise reset/switch/dispose while a job is in flight; profile/resolution
   changes; out-of-order and duplicate replies; ID wrap; exhausted result slots;
   hidden-tab suspension; rapid throttle/fuel steps; CPU contention; worker crash;
   failed WASM load; nonisolated fallback. Prove stale generations cannot publish,
   buffers cannot tear, all clients progress and retained results do not mutate.
3. Benchmark warmed and cold startup separately, with alternating baseline and
   candidate trials on desktop and a constrained/mobile target. Include default
   and maximum supported dimensions, fixed/moving geometry, hidden exhaust and
   rapid state changes. Report p50/p95/p99 main-thread time, worker time,
   end-to-end state age, total CPU, allocations, queue depth, missed deadlines,
   fallback counts, texture uploads, worker count and steady memory after repeated
   C172 ↔ F35 switches. Do not run competing benchmark sessions.
4. Run the existing optics, reaction, support, exhaust-domain/render integration
   tests plus meaningful new kernel/protocol/lifetime tests. Run app typecheck,
   lint, required build/artifact checks and production browser verification.
   Keep the currently passing optical energy, gamut and boundary tests intact.
5. Publish a concise before/after report with exact commands, browser/device,
   artifact identities, correctness maxima, visuals for transient events and the
   backend selection decision. Explain failures of the worker decision gate;
   shipping the proven synchronous path is preferable to a default latency or
   overhead regression. Do not deploy as part of this handoff.

The work is complete when the portable Rust kernel, bounded app-lifetime worker
adapter, capability fallbacks, verified production artifact, parity/lifecycle
tests and reproducible evidence are reviewable, and the chosen default satisfies
the measured performance and no-lag gates. A Rust port alone is not completion.
