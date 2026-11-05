# 04 — Batch JSBSim property traffic

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** replace the 30–50 scalar JSBSim property calls made in every physics
step, and the scalar reads made every frame, with property batches. Same
values, same write order.

**Owns, coordinate per file:** `~/gh/0sfs/controls/src/applyFlightControls.ts`,
`~/gh/0sfs/ground-contact/src/terrainContact.ts`,
`~/gh/0sfs/engines/src/engineControl.ts`, the step callback and per-frame
readers in `~/gh/0sfs/fly/src/flight/createFlightSimApp.ts`
(about lines 4157–4470), `fly/src/flight/hud/evaluationInstruments.ts`, the
absent-path reads in `~/gh/0sfs/aircraft/src/aircraftAnimation.ts`, and, for
step 4, the SDK in `~/gh/Felipegalind0/jsbsim/wasm/`.

## Evidence

Measured with the audit's harness (Node, real JSBSim): a scalar
`getPropertyValue` costs 1.7–2.0 µs and passes 22 exception trampolines; a
scalar set costs 1.8–3.4 µs; one `PropertyBatch.read` of 22 values costs
1.4–1.5 µs. Per step, `terrainContact.update` and `applyFlightControls`
make 8 reads and 12 writes (about 50 µs together, more than the C172's whole
step), and the step callback reads about 10 more directly. The native batch
(`wasm/bindings/PropertyBatchBindings.cpp`) resolves each path once and keeps
per-slot `get` and `set`.

## Steps

1. **Count.** Wrap `sdk.getPropertyValue` and `sdk.setPropertyValue` in a
   flight to count calls per step and per frame by caller (the harness's
   `jsbsim-and-hud.perf.ts` shows the pattern). Write the inventory into your
   report before changing anything.
2. **Writes.** Give `applyFlightControls` a batch created once per loaded
   model, filled in today's write order and written with one `write()`.
   Conditional writes (control law, automatic flaps, roll rate, STOVL) keep
   their conditions: use separate small batches or keep them scalar.
   Tied setters run in slot order, so the slot order must equal today's
   call order.
3. **Reads.** Read each step's inputs in one batch at the start of the step
   and hand the values to the consumers that need them (contact, trims,
   engine control, the step callback). A value read after a write in the
   same step must still be read after it; do not hoist a read across a write
   to the same or a dependent property.
4. **Absent paths.** The control-surface reader reads 7 absent F-35B paths
   one at a time every frame because a property may appear later. Add a
   property-tree revision to the SDK (incremented when a node is created) and
   cache absence until it changes. This is the exact version of the
   "re-resolve absent properties" decision recorded on 22 October.
5. **Later, optional.** One native export that applies a command block,
   runs the step and fills a state block, replacing the remaining calls.

## Exactness

A differential run of C172, Vision Jet, F-35B (both engine models) and the
drones over several thousand steps, with control inputs moving, must give
identical state and identical write sequences (`Object.is` on every value),
old against new. Run fly's JSBSim integration tests and the affected
packages' tests. Recreate batches after a model load; the SDK disposes them.

## Measure

`flight/physics` in Debug → Frame budget, interleaved, plus the harness's
step-calls case. Report calls per step before and after.
