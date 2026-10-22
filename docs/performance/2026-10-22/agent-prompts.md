# Independent performance agent prompts

Give each agent the common brief and one scope below. The four scopes can run concurrently for
reading and editing; measurements and Git mutations require the coordination in the handoff.
The priorities are hypotheses, not promises of additional gains. A well-supported no-change
result is useful. Do not keep an edit just because it is cleaner or allocates fewer objects.

## Common brief — applies to every scope

Continue exact-output performance work in the local 0SFS/FOSS Earth workspace. First read:

1. `/Users/felg/gh/0sfs/fly/docs/performance/2026-10-22/session-handoff.md`
2. `/Users/felg/gh/0sfs/fly/docs/performance/2026-10-22/flight-frame.md`
3. Target repo `AGENTS.md` and its task-relevant linked guidance.

Inspect current Git status and preserve all preexisting changes. Own only the files assigned
below, new uniquely named scratch under that repo's ignored `build/perf-<scope>/`, and your own
candidate report. If an assigned path is newly dirty, identify its owner before editing it.
Do not expand scope into another agent's files. Central reports, shared queues and historical
snapshots are read-only; use unique arm names and captured override sources in the fly benchmark
workspace when building your comparison. Do not run browser measurements from mutable live imports.

Write nothing outside the repository being worked on, including temporary files/caches. Never
write under `~/.claude`. Never print/log the Google key or tile URLs. No push/deploy. An automatic
permission refusal must be reported, never bypassed. Preserve the held engine-summary patch and
all fly integration support. The gear change is already committed in `b92eb7b` with explicit
user approval; its support remains uncommitted. Do not reapply or expand that approval.

Acquire the shared exclusive measurement slot described in the handoff before benchmarks,
browser runs, builds or substantial test suites; a free lock does not excuse checking for older
uncoordinated runs. Do lightweight inspection/editing while another agent measures. Use repo-local
TMPDIR and installed binaries, `nice -n 19` for builds, and clean Chrome clones after every run,
including failures. Repair runner error/cleanup handling in your own copy before using it.

Start with a measured caller and a specific redundant operation. Freeze a baseline, implement the
smallest candidate, establish exact numeric/data/callback results, then measure interleaved old/new
under the same workload. Run focused lint/typecheck/tests; add meaningful regressions that fail on
the old implementation. Use bitwise/identity guards, deterministic fixtures and visual comparisons
where rendering is affected. Do not update golden digests to accommodate differences. New caches
must preserve ownership, revision invalidation, mutation behavior and reentrancy. Preserve operation
order and edge values, not just visually plausible output. Do not silently alter behavior or defaults;
write a decision if exactness is impossible. No new setting is required for these exact-work scopes.

Only commit a demonstrated exact improvement within owned paths after validation. Use one sentence,
explicit paths (`git commit -m "..." -- <paths>`), no AI attribution; serialize commits with other
agents in the same repo. Fly commits go to `main`. Revert only your own no-gain edits and retain the
negative result. If a shared test or runtime file is needed, hand off the patch instead of taking it.

Write a separate report at `<target-repo>/docs/performance/2026-10-22/<scope>.md` (create directories
if needed). Include baseline commit and dirty-input identities, hypothesis, exact paths/patch,
test/visual results, arm/source-map/profile identities, pairs and exclusions, inclusive vs self
cost, FPS limitations, commit IDs, and next decisions. State whether results are exact, measured,
inconclusive or held. Do not edit the central flight report. Finish with a concise handoff.

## Agent 1 — selector measurements (`selector`)

Target: `/Users/felg/gh/foss-earth/engine`.

Own `src/terrain/imagery/imagerySelector.ts`,
`tests/terrain/imagery/imagerySelector.test.ts`, and focused new selector-only tests. The identity
test is a validation guard: run it, preserve existing digests, and avoid unrelated edits. Treat
`imageryGeometry.ts`, binding, runtime and height files as read-only so the scopes stay disjoint.

Investigate `evaluateView` and `measureImageryView`: repeated projection, point measurements,
allocations or reuse within a single call, with current-view/current-surface semantics intact.
Historical reference: selector about 53 ms/s self at 1×, `evaluateView` about 17. The tour's
`497e013` already gained about 30%. Two simple allocation rewrites were measured and reverted:
screen clamping loop and delayed hull construction. Read their results before choosing a hypothesis.

Use `build/evq/` as a historical moving-view benchmark, but capture today's baseline in your own
scratch; its `head` directory is not current HEAD. Drag count equality is only a first smoke check.
Require unchanged identity digests plus complete plan/measurement differential cases, including
surface revisions, unknown heights, horizon/antimeridian/polar views, focus modes and reentrancy.
Preserve point/call order and floating-point arithmetic. A moving flight invalidates a view cache
each frame; do not propose a cache that measures an old view as an exact optimization.

Profile selection and loaded-detail measurement separately. Ship only if savings survive an
interleaved benchmark and a controlled flight arm without changing selection/publication behavior.

## Agent 2 — imagery binding tables (`binding`)

Target: `/Users/felg/gh/foss-earth/engine`.

Own `src/terrain/imagery/imageryBinding.ts`, `tests/imageryBinding.test.ts`, and new binding-only
tests. Read selector, geometry and runtime code as needed; do not edit them or change cadence.

Investigate table construction, `patchTableDepth`, traversal/key/allocation work, fill/comparison
work and repeated classification beyond committed `b7a0bbb`. Historical binding self time is
about 28 ms/s at 1×. The shipped region-log/slot-lookup optimization already reduced distribution
4× cost from 24.1–25.5 to 17.5–19.2 ms/s; do not rediscover or revert it.

Require byte-identical tables and exact direct-binding/distribution metadata, order, identity,
`capped`, empty-cell counts and diagnostics. Cover inherited pages, fractional regions, missing
slots, invalid footprints, NaN/infinity and mixed direct/table bindings. Keep every publication;
skipping `publishManaged` on staged revisions was rejected. Do not replace exact comparison with
hash-only equality. Preserve `logarithm + level - referenceLevel` operation order.

Extend the approach in `build/distq/` using a newly frozen baseline and randomized differential
cases. Measure target work under identical residency inputs before the browser arm: old browser
`patchTableDepth` ranged 18.8–39.5 ms/s across unchanged work, so unqualified whole-flight FPS
claims would be misleading. No distribution throttling in this scope.

## Agent 3 — terrain height packing and transport (`heights`)

Target: `/Users/felg/gh/foss-earth/engine`.

Own `src/browser/terrainHeightPixels.ts`, `src/browser/terrainHeightBatches.ts`, their existing
tests (`terrainHeightPixels.test.ts`, `terrainHeightBatches.test.ts`,
`terrainHeightBatches.adversarial.test.ts`), and new height-only tests. Protocol/kernel files
`terrainHeightBatchProtocol.ts` and `terrainHeightBatchKernel.ts` are in scope only when needed
for an exact internal change. Follow native parity/build guidance. Selector, binding,
`createRasterTilesRuntime.ts` and `createImageryRuntime.ts` are read-only.

Find exact savings in sparse pixel collection/sorting/packing, repeated cache bookkeeping,
copying, message validation or flush/receive work. Keep worker verification, placement, batching,
fallback and settings defaults intact. Historical self costs: height pixels 8.3 and batches
6.7 ms/s at 1×. Worker flush+receive was roughly 10.6–12.9 at 1× and 29.9–30.5 at 4×.

The `nimg` TypeScript arm was slower overall because it also removed packed queries and caching;
it is not evidence for disabling verification. Do not turn that off in this scope. Preserve
Float64 coordinates, interpolation arithmetic, first-covering-neighbor tie order, repeated
neighbor slots, byte budgets, revision/provenance, stale reply rejection, retirement, fallback
and error behavior. Test invalid/unknown values and mutation/reentrancy explicitly. Run existing
adversarial tests plus bitwise differential fixtures before timing. Separate main-thread savings
from work moved to a worker, and verify the same query/reply and selected-detail results.

If a worthwhile idea needs a runtime or verification-policy change, document it for a later
owner with a setting defaulting to current behavior; do not cross the independent scope boundary.

## Agent 4 — exhaust depth projection (`depth`)

Target: `/Users/felg/gh/0sfs/exhaust`.

Own `src/engineExhaustDepth.ts`, `tests/engineExhaustDepth.test.ts`, and new depth-only tests.
Read adjacent exhaust/model code as needed, but leave the preexisting dirty validation script,
gas optics/support, aircraft assets and fly app source untouched.

Investigate per-mesh eligibility and eight-corner projection/allocation work after `b4ba2c9`.
That commit already updates ancestors once and reduced depth-pass 4× cost from 62.6–74.8 to
41.4–46.0 ms/s. Remaining projection was about 7.8–14.6 ms/s; world bounding-box work is largely
also required by the main render, so do not count it all as recoverable.

Require identical candidate lists/order, matrices, projected bounds and depth images. Preserve
same-render-id edits, frozen/billboard nodes, parent chains, near-plane retention, orthographic
cameras, skeleton/morph/instance behavior, material readiness, render-list side effects and
render-pass restoration. Do not merge model primitives, quantize nozzle motion, change gas
cadence, reorder draws or substitute approximate arithmetic. Those are separate decisions.

Use focused synthetic/adversarial matrix and camera fixtures, then the F-35B pinned workload.
Ensure the model is ready at comparable times in both arms. Check steady plume and moving gear
do not reintroduce shader preparation/invalidation. Use the existing browser helpers without
editing another agent's validation script. Preserve exact visual output, and report function
savings independently of noisy frame-rate ranges.

## Later work requiring a separate assignment

The ring candidate is small and held because same-text resize differs. It is not assigned above:
preserve its dirty files. A later agent may design an exact alternative in scratch, using the
identical-input DPR 1/2.625 fixture, or seek a decision on resize behavior.

The seven performance product decisions and two VR correctness decisions are listed in the
handoff. Assign those separately after choosing an approach; they overlap runtime/UI/SDK files
and should not be folded into these four independent exact-output investigations.
