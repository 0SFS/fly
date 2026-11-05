# 10 — Wire in the ground-contact Rust kernels

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** the flight uses the Rust ground-contact kernels that already exist
and pass their parity checks.

**Owns:** `~/gh/0sfs/fly/src/flight/createFlightSimApp.ts` around lines
1359–1366, `~/gh/0sfs/ground-contact/package.json` exports, and
`ground-contact/wasm/index.js` only if loading needs a change.

## Evidence

`ground-contact/wasm/` holds Rust twins of the hull collision, contact
support, coupled wheel solver and wheel spin, about 1.1 µs per full C172 step
on an M5. `createTerrainContact` and `createVisibleMeshCollision` accept a
`core` option, but fly creates them without one, so the TypeScript reference
always runs. The gain is expected to be small: the 21 October profile shows
terrain contact and collision at 0.01–0.02 ms a frame on the M5, and most of
`terrainContact.update`'s time is its JSBSim property calls (prompt 04).

## Steps

1. Export the loader from the package (its README notes it is "not in
   package.json exports yet") and load it once per flight.
2. Pass the core, or its load promise, to `createTerrainContact`,
   `createVisibleMeshCollision`, the coupled wheel solver and the wheel-spin
   stepper. The modules fall back to TypeScript for good if a kernel fails
   and report why through `status()`; surface that status in the existing
   diagnostics.
3. Dispose the kernels before the JSBSim SDK, as the TypeScript readers are.

## Validation

`node ground-contact/wasm/scripts/check.mjs` (parity), fly's contact and
landing integration tests, and a flight with the core on and off compared
step by step for identical state. Measure `flight/physics/terrain contact`
and `flight/physics/collision` on and off; report the result even if it is a
wash.
