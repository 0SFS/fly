# The F135 plant's repeated work — 7 November 2026

Part of [prompt 06](../2026-11-05/prompts/06-f135-plant.md) of the
[5 November phone audit](../2026-11-05/README.md) (the F135 plant's per-step
cost). Baseline: `@felipegalind0/jsbsim` 1.2.4-fork.21, built from the fork's
`master` at `34eeae66`; fly `31af53c`. Ledger: P-137.

Nothing is shipped. Like [prompt 05's build](jsbsim-build-flags.md), a new
fork version and fly's dependency change wait for the user's agreement. The
fork has no commit. The patches are in its ignored
`build/perf-wasm-exceptions/`:

- `plant-repeat.patch`: the repeated evaluations (J → R);
- `plant-fused.patch`: the fused gas properties (R → Q);
- `plant-repeat-fused.patch`: both (J → Q). It applies unchanged to today's
  sources, because the plant's sources are the same in A and J.

The F135 data file is not changed.

## Builds

All builds come from the fork at `34eeae66`, the release's generated bindings
and Emscripten 6.0.9, as in prompt 05's note.

| | What |
| --- | --- |
| A | as shipped |
| S | A with both plant patches |
| J | prompt 05's proposed build (`-fwasm-exceptions`) |
| R | J with the repeated evaluations |
| Q | R with the fused gas properties |
| P, Qp | J and Q linked with `--profiling-funcs`, for profiles |

S's glue is byte-identical to A's, and Q's to J's.

## Where the time went

Setup:

- The F-35B in cruise as the audit's harness boots it: 5,000 ft, 288–297 kt,
  throttle 0.48, external tanks off, 60 Hz.
- 3,600 warm-up steps, then 30,000 profiled steps.
- V8's sampler at 50 µs, with `--no-wasm-inlining` so that each C++ function
  keeps its own samples.
- The scripts are in `build/f135-plant/`: `profile.perf.ts`, `attribute.py`,
  `children.py` and `analyze.py`.

Share of all samples:

| | P | Qp |
| --- | ---: | ---: |
| Total | 2,797 ms | 1,394 ms |
| JSBSim's `run()` | 88.2% | 87.5% |
| The plant (`FGTurbine::Calculate`) | 68.3% | 48.2% |
| The step solve | 27.1% | 23.5% |
| The publication solve | 33.5% | 22.6% |
| … its residual evaluations | 29.6% | 15.4% |
| … `Fill` (the outputs) | 3.7% | 6.9% |
| Plant, other (mostly an evaluation called from the inlined `Advance`) | 7.3% | 1.2% |
| The rest of JSBSim | 19.9% | 39.4% |

- **Steady parts.** The rest of JSBSim takes 555 ms in P and 549 ms in Qp, so
  it serves as a control.
- **The rest of the plant is small.** Publishing to properties, the plant's
  inputs, the linear algebra, the controller, fuel, actuators, flames, the
  ledger and the closure tables have no frame above 0.4%.
- **No allocation.** No plant sample was in `malloc`, `free` or
  `operator new`.
- **Gas properties.** Enthalpy, cp, entropy function and their inversions are
  73.2% of the plant's samples in P (libm 12.0%, other code 14.9%). In Qp
  they are 58.6%, with libm at 18.8%.
- **The evaluations.** Residual evaluations of the gas path (`EvaluatePath`)
  were about 63% of all samples in P. The solver itself was not the cost, as
  the prompt expected.

## Repeated evaluations

`EvaluatePath` writes every gas-path field before it reads it. So its
residuals and its gas path depend only on the operating point and the
unknowns. The one exception is the gas model's domain-clamp counter, which
the plant publishes as `numerics/domain-clamps`.

The solves evaluate the same unknowns twice in a row:

- the feasible start's evaluation, then Newton's first, at the same unknowns;
- after convergence, the Newton loop's last evaluation, then the caller's, in
  both the step solve and the publication solve.

**The change (R).** A `RepeatedEvaluation` wraps the evaluation in `SolveAt`
and in `StepOnce`:

- It keeps the last successful evaluation's unknowns, residuals,
  bypass-blocked flag and clamp count.
- A call with bit-identical unknowns (`memcmp`) and the same flag returns the
  stored residuals and adds the stored clamps to the counter.
- A failed evaluation clears the memory.
- So a hit means the most recent evaluation was at the same point, and the
  gas path the caller reads next is that evaluation's.

The callers still count every evaluation, so `numerics/residual-evaluations`
is unchanged: 10 a step with the reduced algorithm and 21.78 with the
component algorithm in the harness, and 9.257 in the cruise profile.

**How many repeats.** A build that counts them (Qr) found that, in the cruise
profile, 60.2% of the step solve's evaluations and 68.2% of the publication
solve's are repeats. That is about 5.9 of the 9.26 a step.

**The caveat.** The memory is exact only while `EvaluatePath` depends on
nothing but the operating point and the unknowns. A later change that makes
it read leftover gas-path state would make it diverge silently. The plant
scenarios below would catch that.

## Fused gas properties

Q removes work that was repeated inside one evaluation. It keeps each
expression's text and order, so the results are bit-identical.

- **One basis for two lookups.** Enthalpy and cp, and the entropy function and
  cp, at one temperature share one cubic Hermite basis (`HCp`, `PhiCp`). The
  Newton loops that invert enthalpy and the entropy function need both on
  every iteration.
- **The isentrope.** `IsentropicT`'s inlet terms (the entropy function, R, and
  the exponent from γ at the inlet) are computed once per stream. The
  nozzle's area-ratio solve expands one inlet to as many as 80 pressures.
- **The sonic state** also keeps γ and enthalpy at T* (its secant's last
  evaluation) and the entropy function at Tt. The subsonic exit, the subsonic
  static state and the mixer use them, and stop evaluating them again.
- **The nozzle's thrust** reuses its required-pressure solve's sonic state,
  inlet and subsonic exit. Before, it solved each of them a second time. The
  reused exit adds its clamps to the counter again, as the second solve did.
- **The area-ratio solve** takes `log(target)` out of its loop and keeps
  `exp(lnx)`.

## Exactness

**The flights.** `build/jsbsim-flags/diff.perf.ts` (prompt 05's differential)
flew the 13 flights for J against R, J against Q and A against S. Every
digest is equal: 131,364,000 comparisons for each pair.

**The plant scenarios.** `build/f135-plant/scenarios.perf.ts` flies the
F-35B on two builds in lockstep:

- After every step it compares all 1,435 catalog properties with
  `Object.is`, and the NaNs' bits apart from that.
- It also compares the catalog, every `run()` result and every log line.

| Scenario | Steps | What it exercises |
| --- | ---: | --- |
| Stand start, afterburner, STOVL and back, shutdown, hot restart | 10,200 | starts, afterburner, the lift fan |
| Cruise with forced fallbacks | 7,500 | iteration cap 2, the component algorithm, no closure budget, tolerance 10⁻¹⁵, subdivision cap 1, afterburner, a stall and an IC reset; 240 failed steps |
| Starvation and airstart at 15,000 ft | 7,800 | flameout, windmilling, restart |
| Seizure | 3,600 | a seized engine |
| Cold, high windmill at 45,000 ft, ΔT −100 °R | 7,200 | shutdown and restart; 308,790 clamps |
| Frozen windmill at 45,000 ft, ΔT −200 °R (new) | 3,600 | both algorithms, with the bypass air below the gas model's 200 K floor; 7,222,818 clamps |
| Calorically perfect gas (new) | 5,400 | the engine file's `<gas-model>` set in memory; afterburner, idle, both algorithms, a cold soak; 855,276 clamps |

J against R, J against Q and A against S all give equal digests in all seven
scenarios: 65,005,500 comparisons for each pair.

**Mutants.** Each one was built and flown against J, on the flights and on
the scenarios that existed when it was made. The cold windmill was written
to catch R's first mutant, and the frozen windmill to catch Q's first.

| Mutant | Caught by |
| --- | --- |
| R without the clamp replay | the cold windmill only |
| R with the bypass flag left out of the key | the first four scenarios, and both F-35B flights |
| R with the first unknown left out of the key | the first five scenarios, and both F-35B flights |
| R keeping its memory after a failed evaluation | nothing, in all seven scenarios and the 13 flights |
| Q without the clamp replay for the reused subsonic exit | the frozen windmill only, at step 120 (5,245 clamps instead of 5,250) |
| Q with γ at T* from the secant's previous point | the first five scenarios, and both F-35B flights |
| Q whose area-ratio fallback keeps the rejected step's pressure ratio | the first five scenarios, and both F-35B flights |
| Q with the isentrope's exponent written 1 − 1/γ | the first five scenarios, and both F-35B flights |
| Q summing the fused enthalpy's Hermite terms in another order | the first five scenarios, and both F-35B flights |

- **The surviving mutant.** No solve today evaluates its stored point again
  after a failure, so the clearing is a defensive guard only.
- **Coverage.** A coverage build (Qv) reports the first run of each rewritten
  branch. Across the seven scenarios and both F-35B flights every branch ran
  except one: a jet that separates at the throat. That branch uses γ at T*,
  which the sonic state now keeps. It is the same value the original computed
  there.
- **Review.** An independent read of both patches, without building, found
  no difference in any output, return value or counter, on failure paths and
  NaN inputs included.
- **A trap in the method.** CMake's makefiles here run Apple's
  `/usr/bin/make` 3.81. In the first batch of mutant builds, two of five came
  out byte-identical to an earlier build: a source rewritten in the same
  second as its object was not rebuilt. The mutant scripts now delete the
  plant's objects, the library and the module before each build, and check
  that every mutant's module hash is unique.

**fly's tests.** The 41 test files that import the module, with S and then Q
swapped in (`build/jsbsim-flags/variant.config.ts`): 469 passed and 2
expected failures each time, as with today's module.

## Measured

Setup:

- The audit's harness: its `jsbsim-step` case for the F-35B with each engine
  model, and its `f135-plant` case.
- Through `build/jsbsim-flags/audit.config.ts`, one process per lane.
- Seven rounds with the lanes' order rotated, and a second A (A2) as the
  control.
- Node 26.9.0 on the M5. These are not frame rates.
- Each cell is the median in µs, with the round range.

| Case | A | S | J | Q | A2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| F-35B step | 87.6 (86.9–88.9) | 48.4 (−44.7%) | 80.7 (−7.9%) | 40.7 (−53.5%) | 87.5 |
| F-35B step, empirical engine | 27.6 (27.4–28.2) | 27.7 (+0.4%) | 15.0 (−45.7%) | 15.2 (−44.9%) | 27.5 |
| Plant, reduced algorithm | 89.6 (88.8–90.4) | 50.2 (−44.0%) | 79.4 (−11.4%) | 38.8 (−56.7%) | 89.2 |
| Plant, component algorithm | 152.5 (151.9–156.0) | 117.9 (−22.7%) | 144.8 (−5.0%) | 105.8 (−30.6%) | 153.2 |

- **Noise.** A2 is within −0.4% to +0.5% of A.
- **The work did not move.** The plant's `numerics/*` are the same in every
  lane and round: 10 and 21.78 evaluations a step, 2 and 1.8 iterations, 1
  substep, no fallbacks.
- **Each patch on its own.** A second run on J's flags:
  - F-35B step: J 80.4, R 44.0 (−45.3%), Q 40.5 (−49.6%).
  - Plant, reduced algorithm: 78.9, 42.3, 38.7.
  - Plant, component algorithm: 144.2, 112.1, 105.3.
  - A second J was within 0.2%.
- **The repeats matter more than the fusions.** The component algorithm
  gains less: it rebuilds its Jacobian every iteration, so it evaluates more
  distinct points, and the few repeats are a smaller share of its work.
- **Profiled.** 93.2 µs a step in P and 46.5 µs in Qp.
- **Not measured** in Chrome or on a phone.

## What is left

- **Shipping.** The user decides whether to ship. The plant patch does not
  depend on prompt 05's flags: S is A plus the patch.
- **What a Q step still costs.** In Qp the plant is 48.2% of the samples.
  Inclusive shares, which overlap:
  - the mixer, 18.3%;
  - the nozzle's required pressure, 16.1%, of which its area-ratio solve is
    13.5%;
  - the enthalpy and entropy-function inversions, 13.2% and 11.9%;
  - the fused lookups' self time, 12.0% (`HCp`) and 6.7% (`PhiCp`).
- **Exact candidates not tried:**
  - The outputs' `Fill` repeats the last evaluation's required-pressure solve
    for the main nozzle. Done later the same day as P-138, in
    [the nozzles' kept solves](f135-nozzle-memo.md).
  - The steady solve (`SolveSteady`) has repeats of its own. It runs only
    in `InitializeRunning`.
- **Numerical changes,** such as warm starts for the area-ratio solve or the
  inversions, or running the plant every second step (prompt 06's step 3),
  would change trajectories. They need tolerances the user accepts and a
  setting whose default is today's behaviour.
