# Performance handoff — 22 October 2026

Read this before starting another pass. [flight-frame.md](flight-frame.md) is the measured
report and decision record; [agent-prompts.md](agent-prompts.md) divides the next investigations
into independent scopes. [evidence-index.json](evidence-index.json) fingerprints the local
reproduction material without copying logs, browser state, credentials or tile addresses.

## State at this checkpoint

- The overnight queue completed `ring`, `aoa`, `c11m` and `nimg`; `queue.txt` is empty.
  The later `distq` comparison also completed. Chrome clone cleanup ran after browser work.
- The measured exact optimizations are committed locally. Nothing was pushed or deployed.
- Fly is on `main`. Its approved whole-file application integration is committed, but its
  supporting working-tree changes are not. Do not call the clean checkout build-complete.
- No further measured exact-output candidate from this pass remains ready to ship. The next
  agent needs a new hypothesis and evidence, not a replay of the rejected experiments.
- Measurements describe particular pinned arms, not today's entire working tree. The `resq`
  reference includes the held ring experiment and the isolated gear change.

## Commits and what they establish

Ranges below are inclusive function costs in ms/s unless stated otherwise. They overlap and
must not be summed. Full methods, tests, cohorts and limitations are in the report.

| Repository / commit | Change | Representative evidence |
| --- | --- | --- |
| fly `2a53629` | Write HUD values and text only when changed | Layout at 1×: 6.4–6.7 → 4.8–4.9 |
| FOSS Earth sky `cb85cb0` | Replace ground-probe render list without globally dirtying lights | F-35B PBR preparation at 1×: 11.4–12.4 → 2.6–2.8 |
| exhaust `f790503` | Reuse radial integrals clear of the centerbody | Gas integration at 4×: 13.7–16.7 → 7.1–7.8 |
| exhaust `b4ba2c9` | Update each depth-pass ancestor matrix once | Depth pass at 4×: 62.6–74.8 → 41.4–46.0 |
| aircraft `c3bcf8f` | Batch control-surface property reads | F-35B animation at 1×: 10.6–11.6 → 6.9–8.3 |
| aircraft `ab43a16`, fly `b92eb7b` | Read gear position alone for landing lights | Isolated gear arm at 1×: 12.7–17.4 → 3.7–4.8; at 4×: 17.3–24.7 → 6.9–8.7 |
| FOSS Earth engine `18e3850` | Sort each residency demand once | Pump at 1×: 14.9–18.5 → 4.4 in two clean new-arm runs; at 4×: 28.6–29.7 → 6.2–9.2 |
| FOSS Earth engine `b7a0bbb` | Reuse region calculations while classifying cells | Distribution at 1×: 6.1–7.0 → 5.4–5.6; at 4×: 24.1–25.5 → 17.5–19.2 |
| fly `a44f245`, `12ccb9c`, `b0d1295` | Measurements, decisions and integration review | Documentation only |

The previous tour pass already accelerated the imagery selector about 30% in engine `497e013`.
Retain the identity digests in `tests/terrain/imagery/imagerySelectionIdentity.test.ts` unchanged.
Fly `d143b6a` also preserves native batch release before destroying the JSBSim executive; do not
lose that lifecycle fix while changing readers.

## Ownership and mixed working trees

Always inspect fresh status; this is a checkpoint, not permission to take ownership of every
dirty file. Never reset, stash, clean, reformat, or stage unrelated work. Stage and commit only
explicit owned paths. Serialize Git mutations when several agents share a repository.

Known protected work:

- `foss-earth/engine/AGENTS.md` and `docs/agent-native.md` belong to earlier work. Read the native
  instructions when applicable, but do not include these files in an optimization commit.
- `0sfs/engines/src/engineLiveData.ts`, `src/engineSpoolRenderer.ts`, and
  `tests/engineMonitor.redesign.test.ts` belong to earlier work.
- `0sfs/engines/src/engineSummary.ts` and `tests/engineSummary.test.ts` hold the **uncommitted**
  ResizeObserver experiment. Preserve it. Same-text resize changes its behavior; it is not
  approved to ship. Original prepared source: `fly/build/osfs-night/engineSummary.new.ts`.
- Fly has extensive dirty/untracked cockpit, pilot, physics-rate, runtime, loading, UI, test and
  documentation work. The full `src/flight/createFlightSimApp.ts` was explicitly approved for
  review and commit as `b92eb7b`; that approval does not extend to its supporting files.
- Aircraft has dirty selection/catalog/model/placeholder/settings work. Exhaust has a dirty
  `scripts/validation/f35b/check-exhaust-headless.mjs`. Leave those alone.

The initial automatic permission review refused a hunk-only gear commit because the main app
file also held a large earlier edit. It was not bypassed. The user subsequently said **“Review
and commit the whole mixed file.”** The whole file was reviewed and committed. Do not retry the
old gear patch or describe it as still awaiting permission.

That integration includes separate behavior changes: selected physics rate (supporting settings
default 60 Hz instead of 120; 30 and 120 are choices), pilot/G-force responses, cockpit look and
screen, XR/UI integration, live tint, reset controls and feedback UI. The isolated gear result
does not establish pixel identity or speed for all those features. Its source imports uncommitted
`cockpitLook.ts`, `cockpit/*`, `createFlightPilot.ts`, `physics/physicsRate.ts`, plus changed
runtime/settings/UI and sibling APIs. Only the combined working tree was validated.

Integration checks passed: changed-file lint, app and node typechecks, normal Vite build, and
150 tests across ten app/cockpit/pilot/physics suites. Two additional 30 Hz tests are expected
failures (gear-rest stability and short full-elevator pull); 30 Hz is not broadly validated.
Logs: `fly/build/osfs-night/review-whole-app.{tests,build}.log`.

Two VR follow-ups remain documented, unfixed and not visually validated:

1. Camera switching during XR can hide/stop the cockpit screen while headset placement still
   suppresses HUD copies. Choose an XR view lock or placement based on actual screen visibility,
   with an XR app integration regression.
2. G-force blackout is DOM-only and excluded from headset mirroring. An unconscious pilot can
   lose control while retaining headset visibility. Eye effects or explicit product policy are needed.

## Rules for every continuation

- Keep all writes in the repository being worked on. Scratch, temporary files, browser profiles,
  logs and build output belong in its ignored `build/`. Never write to `/tmp`, `/var/folders`, a
  scratchpad directory, or `~/.claude`. Use repo-local `TMPDIR` and caches where tools need them.
- Never print or log `FOSS_EARTH_GOOGLE_KEY` or tile URLs. Do not dump `.env` files, network logs,
  raw profiles or snapshots. Retain only bounded, reviewed evidence when adding tracked docs.
- Read target `AGENTS.md` and the relevant adjacent `.github/` guides. For engine native work,
  read `engine/docs/agent-native.md`. Prefer direct installed binaries over package downloads.
- One-sentence commit messages, explicit paths, no AI author/co-author lines. Fly commits go
  directly on `main`. No push, deploy, history rewrite or repository-settings changes.
- An automatic permission rejection is not an invitation to find another route. Stop that
  action, report the rejection and reason, and finish unaffected work.
- Preserve visible output, numeric results, callback/publication semantics and scheduling.
  A changed default, delayed update, different draw ordering or altered resize behavior needs
  an explicit decision, or a setting whose default is the existing behavior. Exact data tests
  alone do not establish identical rendering; use controlled visual evidence where applicable.

## Independent agents and exclusive measurements

The four scopes in the prompts can read and edit different files concurrently. Measurements
must be serialized across **all** repositories on this machine. A Node benchmark overlapped an
earlier Chrome run and contaminated the result. Build/test load can do the same.

Before a CPU benchmark, browser run, build, or substantial test suite, acquire an exclusive slot.
Use atomic `mkdir /Users/felg/gh/0sfs/fly/build/perf-exclusive.lock` as the common convention;
fly is the shared measurement workspace. On success, record your agent name, task and process
identity in `owner.txt` inside it. Release only your own lock after processes have ended and
cleanup is complete. If it exists, continue lightweight reading/editing and coordinate a slot.
Never remove another agent's lock or assume it is stale. Verify the owner/process first. This
is a new coordination convention, not something the historical runners enforce.

Also check for preexisting profile/queue processes: a free new lock alone does not prove the
machine is idle. Each agent owns uniquely named arm files, labels, logs and reports. Do not
modify the historical shared `queue.txt`, scripts, snapshots, or central report concurrently.
Use a measurement coordinator if the agents cannot reliably share this convention.

Use `nice -n 19` for builds; do not use it as a reason to run a build during a comparison. Keep
local checks short and stop when the evidence is clear. Run
`/Users/felg/gh/foss-earth/browser-testing/scripts/chrome-clones.sh --clean` after **every**
Chrome run, including failures. Keep cleanup output separate from profile results.

## Reproduction and analysis

The historical lab is `/Users/felg/gh/0sfs/fly/build/osfs-night/` (ignored). Each arm uses
`snap-0.json` and a JSON map from real absolute source path to replacement source path.
`build/perf/osfs-<arm>` contains each built arm and its source maps. Never overwrite the old
snapshot or evidence when beginning a new experiment. Freeze override files too: `distq.json`
originally points at the live binding file, so rebuilding it after edits changes the arm.

From `fly/`, after acquiring the measurement slot (replace the illustrative arm name):

```sh
mkdir -p build/tmp
TMPDIR="$PWD/build/tmp" PIN_REPLAY=build/osfs-night/snap-0.json \
  PIN_OVERRIDES=build/osfs-night/<arm>.json \
  nice -n 19 ./node_modules/.bin/vite build --configLoader native \
  --config build/osfs-night/pin-arm.config.ts --sourcemap \
  --outDir build/perf/osfs-<arm> --emptyOutDir
```

The pin config reads current `vite.config.ts`, and does not pin dependencies, public assets,
environment, or every query-bearing module. It warns about local source files absent from the
snapshot. Treat unexpected unpinned inputs as invalidating an isolated comparison until they
are resolved identically. `PIN_RECORD=<new path>` records a new snapshot; snapshot only once
after coordinating source stability. Do not compare two independently captured snapshots.

Historical runner syntax, from `build/osfs-night/`:

```sh
./ab.sh <unique-label> <pairs> <armA> <armB> [--query ...] [--probe ...]
node cmp.mjs <label> '<source-or-function-regex>'
node byfile.mjs <arm-dist-root> label=<profile.cpuprofile>
node under.mjs <arm-dist-root> <profile.cpuprofile> '<ancestor-regex>' [count]
node callers.mjs <arm-dist-root> <profile.cpuprofile> '<function-regex>' [count]
```

`arm@query` receives log name `arm+q`; quote any argument containing `&`. The runner calls
`foss-earth/research/scripts/benchmarks/startup-audit/profile.mjs --target fly`.
Results are indexed in `<label>.runs`; profiles and `summary.md` live under
`foss-earth/research/build/benchmarks/startup-audit/profile-fly-<label>-<arm>/<time>/`, including
`fly-still-{1x,4x}.cpuprofile`. `cmp.mjs` also depends on the ignored
`foss-earth/research/build/heights/bysource.mjs`. The mapping tools require the matching arm's
source maps; do not substitute a later build.

**Repair runner handling before new runs.** Historical `ab.sh` lacks per-run cleanup and does
not reliably stop on profiling errors. `ab-clean.sh` adds cleanup before reading the log's last
line, so its `.runs` entry can become cleanup text. For new uniquely named runners, capture and
validate the actual profile directory before cleanup; put cleanup output in a separate log,
run cleanup on failure too, and stop on failed profiles. Do not blindly reuse either script.
`distq.runs` was repaired from actual profile directories; the malformed index remains in
`distq.runs.raw`. The measured profiles themselves were unaffected.

Historical `queue.sh` removes each first line even if a run fails. Its `done` message alone is
not proof of a complete run: verify expected A/B pairs and both CPU rates in the artifacts.
If ever editing a running queue, atomically replace its file while preserving the running line.

Method: headless Chrome/WebGPU through ANGLE Metal, M5 MacBook Air on AC, 1280×800 CSS pixels,
DPR 1, default C172 unless the query selects F-35B. Each profile captures 8 s at 1× and 4× CPU
throttle; runs alternate A/B. Phone checks used 412×915 at DPR 2.625 with touch. Compare within
one cohort. Terrain loading and model arrival vary, so function savings are stronger evidence
than small FPS changes. Never add nested inclusive rows. CPU throttle is not a real-phone result.

Known exclusions and caveats:

- `resq` new-arm `2026-10-22_110058` overlapped the Node benchmark; exclude its 1× pump result
  and use the clean new-arm `105611` and `105834` for the headline frame breakdown.
- The first `ring` pair (`110211`, `110331`) is excluded because of that overlap; use the last
  two pairs. Similar live spool numbers do not prove identical inputs.
- Ground-probe F-35B measurements exclude the first contaminated pair. See the report for
  aircraft-arrival timing limits; do not merge unrelated `g1f35` cohorts blindly.
- `distq` baseline `115411` has unrelated `patchTableDepth` at 39.5 ms/s at 4× versus
  18.8–19.9 in the other three runs. Do not attribute the full FPS improvement to classification.
- `nimg` switches placement and also loses page batching/cache. It does not isolate verification.

Useful retained exactness harnesses (the names `head`/`before` refer to captured historical
sources, not today's Git HEAD):

| Local path | Purpose |
| --- | --- |
| engine `build/resq/` | 600 seeds × 250 residency operations; every observable matched, three mutants detected |
| engine `build/distq/` | 1,000 varied distribution cases and interleaved dense-table benchmark |
| engine `build/evq/` | Captured `git archive` source tree, moving-view selection/measurement benchmark, drag-count equality |
| engines `build/ring-check.mjs`, `build/ring-check/results.json` | Identical-input text/transform fixture at DPR 1 and 2.625, including same-text resize mismatch |
| fly `build/osfs-night/surface.bench.test.ts`, `gas.bench.test.ts`, `depth.bench.test.ts` | Native surface parity, gas integration and depth experiments |
| fly `build/osfs-night/patch/gear.patch` | Historical isolated patch; already integrated in the whole-file commit, do not reapply |

For example, from `foss-earth/engine/`, with the exclusive slot:

```sh
mkdir -p build/tmp
TMPDIR="$PWD/build/tmp" ../node_modules/.bin/vitest run \
  --config build/evq/vitest.config.ts selection
```

Use the corresponding `build/resq/vitest.config.ts` or `build/distq/vitest.config.ts` for those
harnesses. Keep timing output local and bounded. Fly's installed binaries are under
`./node_modules/.bin`; engine's are under `../node_modules/.bin`. Preserve exact `Object.is`/
bitwise comparisons for edge values; aggregate drag counts alone are insufficient.

## Findings that should not be rediscovered

- In clean `resq` profiles the frame/render work totals 254–261 ms/s at 1× and 719–726 at 4×.
  First raster update: 112.0–112.4 / 352.9–354.7; second: 49.5–53.4 / 168.5–179.7.
  These are historical pinned-arm numbers including held work, not today's HEAD baseline.
- Representative 1× self ms/s: selector 53, binding 28, imagery runtime 18, viewport 15,
  raster runtime 13, imagery geometry 11, residency 9.6, height pixels 8.3, Babylon uniform
  buffers 7.9, GC 7.8, JSBSim WASM 6.8, height batches 6.7. `evaluateView` is about 17 self.
- `measureImageryView` costs about 39 ms/s across callers (23 loaded-detail refresh, 16
  distribution). The moving view defeats its view cache. `syncDistribution` is 27.8–28.8
  inclusive in the clean pair; these caller costs overlap.
- Selector screen-area loop rewrite: work 388 ms vs reference 382.4; unchanged-source baseline
  391.7 vs 386.6. Delaying hull construction: 402.1 vs 399.6. Both were reverted: no gain.
- `Math.hypot` → `sqrt` changes result bits. Caching canvas size lags resizes. Skipping
  `publishManaged` on staged revisions changes publication. None is an exact optimization.
- Residency sort reuse needs the old filtered-sort fallback for NaN priorities and unchanged
  missing-image check order. Distribution keeps `logarithm + level - referenceLevel` order.
- Missing JSBSim batch slots still need scalar fallback because properties can appear later.
  Batches belong to one model/SDK and must be released before destroying the executive.
- Exhaust depth bounding-box work is largely also needed by the main renderer; remaining
  eight-corner projection was about 7.8–14.6 ms/s. Do not claim all bounding cost recoverable.
- The prior worker and F-35B asset investigations are in `../2026-10-21/`. Those files are
  currently untracked; preserve them. Their worker/mesh ideas are not approved exact changes.

## Every pending decision

No default-changing performance decision below was adopted in this pass. Full numbers/options
are in [flight-frame.md](flight-frame.md).

| Decision | Evidence and constraint |
| --- | --- |
| Nozzle creep | ~6.8e-9 normalized motion/frame still rebuilds geometry; ~5–7 ms/s at 1× remains. Quantization/cadence changes output; no isolated arm. |
| Second raster update | One update with doubled budgets: raster 1× 177.2–191.4 → 152.0–163.1; 4× FPS 22.6–25.8 → 25.9–30.9. Scheduling/detail arrival changes; keep stopped-simulation immediate updates. |
| Spinning activity outline | Existing Still option reduces style 1× 9.5–9.8 → 3.2–3.3. Changing default or compositor rendering changes pixels. `aoa` with Still also reduced recalcs/frame 2.39–2.43 → 1.65–1.66. |
| Imagery heights worker verification | `flush`+`receive` ~10.6–12.9 ms/s at 1×, ~29.9–30.5 at 4× in `nimg`. TypeScript placement was slower overall; preserve batching/cache to isolate optional verification. |
| Distribution throttle | Earlier ~19 ms/s attribution; clean pair 27.8–28.8 inclusive. Cadence changes detail-rail/feedback freshness; no isolated arm. |
| Absent-path periodic re-resolve | F-35B keeps seven scalar fallback reads/state. Periodic resolution delays new properties. Exact alternative requires a reliable SDK mutation revision/notification; not measured. |
| F-35B primitive merging | 259 source primitives / 349 nodes including F135. Structural/render-order change; follow the earlier model spec, no exactness claim. |
| Ring ResizeObserver | Render 1× 1.3–1.4 → 0.2; 4× 5.9–7.3 → 0.4–0.5. Same-text resize differs and FPS gain was not demonstrated; leave the dirty patch held. |

The two VR integration decisions above are additional correctness/product follow-ups, separate
from the performance backlog. New agents should not silently absorb them into an optimization.

The evidence index records file identities and locations, not a backup of build directories.
Tracked reports preserve the findings if build output is cleaned; source snapshots, raw profiles,
maps and scratch harnesses would need a separately reviewed retention step before such cleanup.
