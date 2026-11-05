# 06 — Find and cut the F135 plant's per-step cost

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** make the default F-35B engine (the coupled turbine plant) cheaper
per physics step, exactly where possible.

**Owns:** `~/gh/Felipegalind0/jsbsim/src/models/propulsion/FGTurbinePlant*`
and the plant's other sources there. The F135 data
(`~/gh/0sfs/F135/public/jsbsim-data/aircraft/F-35B-jsbsim/Engines/F135-PW-600.xml`)
is read-only unless the user agrees.

## Evidence

Measured with the audit's harness at 60 Hz in cruise: an F-35B step costs
341–373 µs with the plant and 86–90 µs with the empirical engine, so the
plant is roughly 260 µs of the step (an SD835 is 5–10× slower than that
machine). The plant already runs its "reduced" algorithm with a
Broyden-updated Jacobian: 2 Newton iterations (1 step, 1 publication), 10
residual evaluations and 1 substep per step, no fallbacks. Switching to the
component reference (`settings/algorithm` 0) gives about 22 residual
evaluations for only about 35% more time. So most of the cost does not scale
with residual evaluations, and the solver itself is not the first suspect.

## Steps

1. **Profile with names.** Use prompt 05's profiling variant (P), or a
   native build of the same sources with `perf`, running the F-35B in steady
   cruise. Attribute the plant's time: controller, fuel and actuators,
   flames, the coupled solve, the publication solve, the ledger, closure
   tables, allocation. Report the breakdown before changing code.
2. **Exact fixes first.** Typical candidates once the profile names them:
   allocations inside a step (vectors, strings), values recomputed each step
   that depend only on configuration, a publication solve that repeats work
   the step's converged solve already did, table lookups that search instead
   of indexing. Each must leave every plant output and the whole F-35B state
   identical (`Object.is`) over long runs, including starts, afterburner,
   STOVL conversion and failures that trigger fallbacks.
3. **Numerical changes only behind a setting.** For example running the plant
   every second step with a doubled step (its shafts are integrated by an
   implicit midpoint, and its time constants are far longer than 33 ms).
   Compare trajectories against today's within tolerances the user accepts;
   default off; the phone profile may enable it.

## Measure

The harness's `f135-plant` and `jsbsim-step` cases, interleaved, plus the
plant's own `numerics/*` outputs to show the work per step did not hide in
more iterations.
