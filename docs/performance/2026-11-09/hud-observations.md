# Actuator and HUD property traffic — 9 November 2026

Baseline: fly `4df45f9`. Continues the scalar-read inventory in
[prompt 04](../2026-11-05/prompts/04-jsbsim-property-io.md).

## Change

`controlPositions.ts` already reads physical flap position in its actuator
batch. Its new `flapPosition()` returns that exact raw observation divided by
the profile's full travel. Unlike the optional feedback position, it does
not clamp, reject non-finite values or round. An absent path or failed batch
retains a live scalar read. The flight reads the actuator batch and then its
raw flap position at all three paired read points: frame, startup and reset.
Only read-only native observations occur between the old and new read points.

`hudReadingSampler.ts` uses the existing property sampler for weight, the
first three contacts' weight-on-wheels and, on STOVL aircraft, conversion
position. Each call refreshes the batch at that consumer's read point; no
physics-step sample is reused. Ground-only actions use the same reader as
the HUD. The finite WOW test and both thresholds are unchanged. The SDK's
model reload re-resolves disposed batches; the flight releases the reader
before destroying the SDK. Reading does not add properties.

For a normal airborne C172/SF50 frame, the paired actuator/HUD read set goes
from one native batch plus five scalar calls to two batches and no scalar
calls. F-35B has six scalar calls before. These counts exclude other flight
consumers and the existing evaluation-instrument batch. Ground-only actions
also read weight/STOVL in their batch, even when only WOW is consumed.
The old actuator reader continues returning absent optional positions after
its SDK batch is disposed; the raw flap fallback remains scalar in that case.

## Correctness and checks

- 123 app, phone, actuator and sampler tests passed before adding the new
  frame-order test. That additional app test checks changing flap positions
  and WOW against the exact same frame's expected airspeed tint and checks
  reader disposal. It passes.
- Real SDK differential: 1,200 steps each of C172, SF50, F-35B plant,
  F-35B empirical, Mini 2 and Air 2S: 7,200 steps, with a model reload halfway
  through each. Every weight, ground flag, STOVL flag and raw flap value
  matches scalar reads with `Object.is`. Drone cases exercise their native
  JSBSim property bridge; they do not run the Rust multirotor plant.
- Unit cases include NaN, signed zero, infinities, both thresholds, all three
  contact slots, raw flaps outside their stops, missing observations,
  batch failure and disposal.
- Seven mutants are caught: clamped raw flaps, keeping a failed sample,
  removing missing-property fallback, changing either threshold, using the
  previous frame's flap sample, and dropping the HUD reader's disposal.
- Typecheck and organization-wide lint pass. The full suite and production
  build of the preceding wave passed as recorded in
  [session-handoff.md](session-handoff.md); they were not repeated for this
  narrow read-path change. Current focused tests exercise both app entry paths.

## Measurement

Apple M5, Node 26.9.0, real JSBSim fork.21, 60 Hz aircraft initialized at
5,000 ft / 100 kt. Complete paired actuator/flap/HUD read sets are timed,
including optional actuator normalization and returned observations, with
20,000 read sets per arm per round. Two warm-up rounds, then nine alternating
A/B/A rounds. Both A arms are independent readers of the original module.
The shared performance lock excludes competing measurements.

| Aircraft | Before µs | After µs | A again µs |
| --- | ---: | ---: | ---: |
| C172 | 4.297 | 0.340 | 4.295 |
| SF50 | 5.662 | 0.447 | 5.758 |
| F-35B | 7.283 | 0.496 | 7.335 |

92–94% less CPU for these reads; the two A medians differ by at most 1.7%.
The absolute saving is about 0.24–0.41 ms per second at 60 Hz on this machine.
These are Node read costs, not total flight physics time, FPS or phone data.
Raw rounds: [hud-observations.json](hud-observations.json).

[The bounded evidence archive](hud-observations-evidence.tar.gz) retains the
baseline actuator reader, benchmark and negative controls.
[Hashes](hud-observations-evidence.json) cover the archive and members.
Restore its `build/perf-20261109-io/` members under fly in an installed
workspace. Under the shared performance lock, run:

```sh
npx vitest run --configLoader native --config build/perf-20261109-io/vitest.config.ts
```

About 10 seconds. The negative controls take about 15 seconds:
`python3 build/perf-20261109-io/mutants.py`. They serially edit and restore
only this change's source files; do not run them alongside source edits.
