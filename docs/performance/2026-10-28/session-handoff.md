# Performance handoff — 28 October 2026

Read this before another 0sfs performance pass. It records the night of 27–28
October, after the [27 October wrap-up](../2026-10-27/session-handoff.md). That
wrap-up’s “no new investigation” line applied only to the session that wrote
it. Nothing here was pushed or deployed. No commit was made for this wave.

## What shipped

All of these keep the previous numeric results. None is an FPS, power, or
whole-flight claim. Microbenchmarks were interleaved Node runs under
`nice -n 19`. Scratch stays in each repo’s ignored `build/`.

| Change | Where | Evidence |
| --- | --- | --- |
| Reuse one quaternion per hinge; skip the write when the angle is unchanged | `aircraft/src/aircraftAnimation.ts`, `engines/src/engineNozzleRig.ts` | [hinge pose](../../../aircraft/docs/performance/2026-10-27/hinge-pose.md), [aperture pose](../../../engines/docs/performance/2026-10-27/aperture-pose.md). Median ratios 0.566 and 0.851. About 0.03 and 0.02 ms/s at 60 fps. |
| Force a compass parent world matrix only when `!isSynchronized()`; force the camera view only when its view matrix is stale | `fly/src/flight/hud/flightCompass.ts` | [compass](../2026-10-27/compass.md). Clean chain 73–76% cheaper (tens of nanoseconds). Dirty chain still matches the old call counts. ECEF eye after a move matches to `1e-9`. |
| Skip the gas-support parent walk when the aperture fields are `Object.is` to the last accepted values and each walked node’s parent, quaternion reference and components, position, scaling, and euler match the stamp | `exhaust/src/engineGasSupport.ts` | [gas walk](../../../exhaust/docs/performance/2026-10-27/gas-walk.md). Stable aperture 106.70 → 77.20 ms over 130,641 calls, median ratio 0.724, noise 0.67%. |
| Cache `JSON.stringify(support.flowDomain)` on the domain object’s identity | `exhaust/src/createEngineExhaust.ts` | [synchronize](../../../exhaust/docs/performance/2026-10-27/synchronize.md). Stable plume median ratio 0.401 (156.7 → 62.7 ms over 120,000 calls). |

Quaternion components are in the gas-support stamp because nozzle vectoring
rewrites one quaternion object in place. A creeping aperture still walks,
rebuilds, and stringifies a new domain. That cost is not saved.

`F135/tests/engineNozzleRig.test.ts` checks bearing and convergent components
with `Object.is` and still requires the same quaternion objects when an
observation repeats.

## Measured and reverted

Do not rediscover these as new ideas.

- Exhaust depth-options `Vector2` reuse and volume `Vector3` reuse. Stable and
  creeping `synchronize` ratios sat inside the identical-copy band. Eight
  thousand binds were also inside that band. See the synchronize note.
- Depth projection result-array reuse, seed-first extrema, and forward-extrema
  comparisons. Slower in every pair. The coefficient hoist remains **held**:
  about 3.4% on the full helper versus 1.7% unchanged-module variation, and it
  still has no ready-aircraft depth/color image pair. See
  [depth](../../../exhaust/docs/performance/2026-10-27/depth.md).
- The October 27 engine rejections (binding word compares, unrolling, combined
  traversal, common-prefix cache, height dedup, newest-LRU) still stand.

## Do not start from this handoff

- Nozzle-command quantization. It would skip the 112-flap update and the gas
  rebuild, and it changes the pose. The creep is about `6.8e-9` per frame.
- Exhaust WASM/worker, a JSBSim rebuild, F-35B primitive merging, and the ring
  ResizeObserver. Each changes behavior, assets, or build flags and already has
  a spec or a held patch.
- FOSS Earth imagery, terrain, raster, and toolbar work. Another agent owns
  that tree. The second raster update and the spinning activity outline stay
  product decisions there.
- Ground contact, terrain queries, collision, and
  `fly/src/flight/physics/fixedStepLoop.ts`. Another agent owns them.
- A browser or GPU cohort unless the machine is otherwise idle and the user
  asks. The optional checks in
  [off-hours-todo](../2026-10-27/off-hours-todo.md) are still unscheduled.

## Ownership

Working trees are mixed. Stage only paths this performance work owns. Do not
reset, stash, or reformat the rest.

Owned by this wave, still uncommitted on `main`:

- `aircraft/src/aircraftAnimation.ts`, `aircraft/tests/aircraftAnimation.test.ts`, `aircraft/docs/performance/`
- `engines/src/engineNozzleRig.ts`, `engines/docs/performance/`
- `F135/tests/engineNozzleRig.test.ts`
- `exhaust/src/createEngineExhaust.ts`, `exhaust/src/engineGasSupport.ts`, `exhaust/docs/performance/2026-10-27/gas-walk.md`, `exhaust/docs/performance/2026-10-27/synchronize.md`
- `fly/src/flight/hud/flightCompass.ts`, `fly/src/flight/hud/flightCompass.test.ts`, `fly/src/flight/aircraft/engineGasSupport.test.ts`, `fly/docs/performance/2026-10-27/compass.md`, this file

Leave alone even if they are dirty: `createFlightSimApp.ts` and its tests,
`fly/src/flight/physics/`, jsbsim runtime and profiles, mods, multiplayer,
combat, drone, settings, `aircraft` catalog/selection/model files,
`engines/src/engineControl.ts`, package manifests, and lockfiles. Re-check
`git status` before editing; this list is the 28 October snapshot.

## Bar for a new change

Ship only an exact result: `Object.is` or the existing test’s numeric
contract, same callback and publication order. Interleaved old/new pairs must
beat about 2% unchanged-module noise. Record a no-gain result and revert it.
Absolute savings under a few hundredths of a millisecond per second are not a
reason to keep going. Focused vitest from `fly`, eslint with `fly/eslint.config.js`
from the org root. No push unless the user asks.
