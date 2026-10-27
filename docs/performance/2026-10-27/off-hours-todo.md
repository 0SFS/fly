# Optional off-hours validation

Do not run these while the computer is in use. The user stopped all testing on
October 27, 2026; nothing here is scheduled or running. Resume only with a new
instruction and exclusive machine availability. The retained engine changes
already passed the checks listed in the session handoff.

1. **Held exhaust candidate: ready F-35B browser and exact images.** Allow roughly
   20–40 minutes for three balanced profile pairs plus WebGL2/WebGPU depth/color
   image comparisons. Verify a real ready mesh (reject fallback), running engine
   and active plume/depth caller before timing. `outcome === "ready"` alone is
   insufficient. Baseline/depth bundles and their source maps remain at
   `fly/build/perf/oct27-{base,depth}`; the exact unshipped patch and completed
   numeric/full-helper results are in exhaust's October 27 report. Use the
   existing `exhaust/scripts/validation/f35b/check-exhaust-headless.mjs` fixture
   where applicable. If callers are absent, exclude that run instead of claiming
   savings or silently changing defaults. A fresh explicitly labeled engine-model
   cohort may be needed. Do not promote until images and paired costs pass.

2. **Optional stronger whole-flight attribution.** Budget 20–45 minutes for
   controlled individual selector/height/runtime arms and independent unchanged
   controls, after stabilizing imagery/height/residency and recording equal work
   counts. The completed six 30-second pairs show large baseline variation, so
   they establish no overall FPS claim. Do not simply average away the anomalous
   baseline or count its 35 FPS as a representative control. The final source
   hashes and results are in engine `docs/performance/2026-10-27/`.

3. **Cross-repository full-suite recheck after separate artifact/ABI resolution.**
   The completed run took about 78 seconds with 50% workers. It had three
   unrelated failures in installed exhaust LUT bytes, smoke sprite bytes and
   the audio snapshot-size expectation (34 versus current 37). The owning inputs
   are unchanged by this performance session. Resolve those in their own scope;
   do not blindly regenerate assets or update an expectation to obtain green.
   The engine suite itself passed all 1,401 tests in about 28 seconds.

Before any future measurement, inspect the machine-wide lock and active
processes, then acquire a new owner (the previous owner was released):

```sh
cd ~/gh/foss-earth/research
node scripts/benchmarks/startup-audit/perf-lock.mjs status --json
node scripts/benchmarks/startup-audit/perf-lock.mjs acquire \
  --agent perf-future-root --task "Explicitly resumed off-hours validation"
```

Serialize every build, suite and CPU/GPU benchmark. Use repository-local
`build/` scratch/TMPDIR, immutable source arms and their matching source maps.
Clean Chrome clones after every browser run, including errors; stop all owned
processes and release only the acquired owner when finished. Never print keys,
tile URLs, raw profiles or snapshots. Do not push or deploy without a separate
explicit request.
