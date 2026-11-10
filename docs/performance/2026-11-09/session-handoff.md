# Performance continuation — 9 November 2026

This pass completed three local optimizations:

- [HUD scene/sky reuse and batched instrument observations](hud-reuse.md).
- [Exact spatial sampling in the exhaust evaluator](https://github.com/0SFS/exhaust/blob/main/docs/performance/2026-11-09/spatial-sampling.md).

Baseline heads were fly `6ed67d0` and exhaust `acd49fa`. No FOSS Earth
sources, assets, dependencies, device defaults or deployment configuration
were changed. Existing fly mod-loading edits were preserved separately.
Nothing was pushed or deployed by this pass.

## Validation

- Organization-wide `npm run lint` passed.
- `npm run typecheck` passed.
- Production `npm run build` passed, including JSBSim, audio, optical and
  engine asset verification and the built JSBSim/audio artifact checks.
- Full `npx vitest run --configLoader native --passWithNoTests --maxWorkers=2`:
  356 files passed, 1 skipped; 3,680 tests passed, 4 expected failures and
  1 skipped. It took 180.59 seconds. The pretest pack linker ran first.
- A subsequent WebGPU publication test uses a stub GPU backend to check
  scene reuse, fresh velocity markers, redraws and the cockpit mirror's
  event on every draw. The final focused run of renderer, painter,
  evaluation, sampler and exhaust sampling tests passed all 27 tests.
  This is not a WebGPU image or GPU-time claim.
- Ten deliberately broken versions were caught. Production sources were
  restored after each run; the full suite used the restored implementation.
- Real Chrome Canvas comparison: 240 frames, 41,808,240 identical RGBA bytes.
- Complete optical result comparison: 281 cases, 7,435,796 identical scalars.
- Native JSBSim instrument comparison: C172, SF50 and F-35B, 540 steps,
  identical AoA and DOM, with model reloads and moving controls.

Logs are in ignored `fly/build/perf-20261109/`. No server was started;
browser checks used the pipe controller and an in-memory Vite bundle.
The Chrome instance was closed and the shared performance lock released.

## Retained reproduction

[retained-evidence.tar.gz](retained-evidence.tar.gz), 25 members, about
117 KB, preserves the original HUD and exhaust source modules, bounded
comparison scripts, raw paired measurements, mutant runner and before/after
image. [evidence-manifest.json](evidence-manifest.json) has its SHA-256 and
each member's hash. The archive's baselines were checked byte-for-byte
against the recorded Git heads, and every archived member's hash checked
again after packing. It contains no dependency trees, WASM artifacts,
credentials, map tiles or machine/browser profiles.

Archive members are under `fly/build/perf-20261109/` and
`exhaust/build/perf-20261109/`. Inspect/extract in a scratch folder first.
To run the scripts in an installed sibling-checkout workspace, restore those
ignored per-session directories at the organization root. These commands
need the same baseline F135 profile and JSBSim fork.21 data; the scripts use
only public repository resources. Acquire the shared performance lock before
timing and release it afterward so another agent's measurements stay isolated.

From `~/gh/0sfs/fly`:

```sh
# About 10 seconds: real Canvas image identity and interleaved Chrome timings.
node build/perf-20261109/browser.mjs
# About 2 seconds: real SDK instrument identity and Node/jsdom timings.
npx vitest run --configLoader native --config build/perf-20261109/vitest.config.ts
# About 3 seconds: painter-only Node timings (the context's calls do no work).
node --import ./build/perf-20261109/register.mjs build/perf-20261109/painter-bench.ts
# About 10 seconds: negative controls; serially edits and restores only owned sources.
python3 build/perf-20261109/mutants.py
```

From `~/gh/0sfs/exhaust`:

```sh
# About 5 seconds: complete numeric differential and paired evaluator timings.
node build/perf-20261109/compare.mjs
# Correctness only, without timing rounds.
DIFF_ONLY=1 node build/perf-20261109/compare.mjs
```

Timings vary with the machine's power state. See each report for hardware,
backend, viewport, settings, A/A controls and measurement limits. Chrome's
Canvas CPU measurements are not end-to-end flight, GPU or phone measurements.

## Next work

The audit's expensive changes still need their existing acceptance gates:

- Attitude prompt 03's WebGL2 shader and subpixel skipping change pixels;
  keep the current defaults while developing/reviewing those options.
- The JSBSim build and F135 plant patches remain the separately measured
  candidates described in the [7 November notes](../2026-11-07/jsbsim-build-flags.md)
  and [plant notes](../2026-11-07/f135-plant-repeats.md). This pass did not
  adopt a new artifact or change the SDK build chain.
- Remaining scalar property calls include the HUD reading tints and absent
  control-surface/RPM paths. The latter need a property-tree revision for
  exact absence caching; do not silently assume a path stays absent.
- The exhaust worker still has its complete-cost and state-age gate; the
  depth sphere pre-test was already measured and rejected. Read those dated
  results before trying them again.
- Phone results still require a real device. No SD835 frame-rate or battery
  claim follows from these desktop component improvements.

For local manual testing:

```sh
cd ~/gh/0sfs/fly && npm run dev
```

Check the attitude display while moving the stick in pause, changing camera
view, resizing, and changing aircraft. In F-35B flight, compare dry and
reacting exhaust and switch the instrument backend while paused. The output
should look and behave as before. This pass does not need a new UI decision
or change any visual-quality option.

## Continuation: the WebGL2 attitude indicator

[attitude-webgl2.md](attitude-webgl2.md) covers prompt 03's step 2, shipped
in fly `8c053b8`. *WebGL2* is a new, opt-in choice for the attitude
indicator, and Auto is unchanged.

On this machine, the WebGL2 indicator takes 0.31 ms a frame off the main
thread in the app. When the GPU is the bottleneck, it adds 0.24 ms to the
frame where Canvas 2D adds 1.07 ms.

The frame budget's WebGL2 GPU timers measure spans that include other
contexts' work. Read `gpu/attitude indicator`, and possibly `gpu/globe`, on
WebGL2 with that in mind.

The user still has to decide two things: the image tolerance, and whether
Auto should choose WebGL2 on WebGL2 globes. Step 3 (skipping sub-pixel
redraws, behind a setting) has not been started.
