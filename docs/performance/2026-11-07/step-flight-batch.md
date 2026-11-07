# The step's flight readings through two property batches — 7 November 2026

Part of [prompt 04](../2026-11-05/prompts/04-jsbsim-property-io.md) of the
[5 November phone audit](../2026-11-05/README.md) (JSBSim property traffic).
Baseline: fly `8d656a9`, `@felipegalind0/jsbsim` 1.2.4-fork.21. Ledger:
P-120.

## What it was

Every physics step, before `run()`, the flight app read the flight state its
control arbiter, auto-trims and automatic flaps need one property at a time:

- the arbiter's ten (three contacts' weight on wheels, roll, pitch and
  heading with their rates, calibrated airspeed);
- the step's own ground test again (up to three more weight reads), dynamic
  pressure and true airspeed;
- the pitch auto-trim's pitch acceleration and rate, the roll auto-trim's
  roll acceleration and rate, and the automatic flaps' airspeed.

In flight with both trims and the automatic flaps running, that is 20 scalar
reads a step. Each one looks its path up in JSBSim's property tree.

## What changed

- `src/flight/jsbsim/propertySampler.ts`: a fixed list of properties read
  through one native `PropertyBatch` (`create: false`, so reading never adds
  a property). A path the model lacks reads NaN in a batch and 0 from a
  scalar read, so those slots stay scalar reads. Loading a model disposes
  every batch; the next read makes a new one and reads again. Without the
  native batch, or if making one throws, every slot is a scalar read.
- `src/flight/physics/stepFlight.ts`: the two path lists and the mapping
  from slots to the arbiter's flight state (degrees to radians as before,
  and the same `Number.isFinite(wow) && wow > 0.5` ground test).
- `createFlightSimApp.ts`: the first batch is read at the arbiter's read
  point, and the step takes its ground test, dynamic pressure and true
  airspeed from the same sample. Nothing between the two old read points
  writes to JSBSim, so this reads the same values. The second batch holds
  the trims' and flaps' readings. They come after the engine control's start
  and stop writes, so it is read where the first of them is needed, once a
  step, and only if one runs. No read moved across a write.

## Exactness

- Differential harness `build/step-flight/diff.test.ts`: two real JSBSim
  instances in lockstep, one read the old way (the readers copied from
  `8d656a9`), the other through the samplers. C172, SF50 and F-35B, 6 seeds
  each, 1,500 steps a seed, half of them starting on a floor at 984 ft with
  the gear down. Random model reloads (50), IC resets (84), engine-test steps
  that skip the arbiter (1,389), engine start and stop writes between the
  two read points (787), random control inputs and brakes. Every arbiter
  field, the ground test, dynamic pressure, true airspeed and each trim and
  flap reading compared with `Object.is` at its read point, and 16 state
  properties after every step. 27,000 steps, 10,215 of them on the ground,
  25,108 trim batch reads: no difference. The A/A run (`AA=1`, old against
  old) passes too.
- `propertySampler.test.ts` (real C172): every slot equals a scalar read
  (`Object.is`) over 20 steps and again after a model load; only the absent
  path is read on its own; one new batch after the load; the catalog shows
  no added property. Fallbacks and dispose are tested on fakes.
- `createFlightSimApp.test.ts`: over 10 ticks each batch is made once and
  read 10 times, with no scalar read of the batched paths. The app and phone
  tests' batch mock answers the step's paths as a scalar read would, so the
  existing tests see the same flight states as before.
- Mutants (`build/step-flight/mutants.py`, app and sampler tests plus the
  harness): 16 of 17 caught. Mapping slots, the ground test, the trim paths,
  `create: true`, missing slots left as NaN, no retry after a load, dispose,
  the fallback, the arbiter reading its own sample, and the trim batch read
  at every use are all caught. The survivor reads the trims' pitch rate from
  the first batch, across the engine's writes. It is equivalent: pitch rate
  is a state that only `run()` or an IC changes, and neither happens between
  the two read points.
- fly `npm run typecheck` passes; app, phone and sampler tests: 116 pass.

## Measured

Node 22 on the M5, real JSBSim at 3,000 ft and 100 kt (and the C172 parked
on a floor), both trims and the automatic flaps reading. Medians of 9
interleaved rounds of 20,000 steps' readings; ranges are the rounds' minimum
and maximum. Script: `build/step-flight/bench.test.ts`.

| Case | Before | After |
| --- | ---: | ---: |
| C172 in flight | 10.70 µs (10.68–10.87) | 0.38 µs (0.37–0.42) |
| SF50 in flight | 14.28 µs (14.22–14.43) | 0.43 µs (0.42–0.44) |
| F-35B in flight | 14.30 µs (14.28–14.35) | 0.47 µs (0.46–0.49) |
| C172 on the ground | 11.74 µs (11.71–11.96) | 0.44 µs (0.44–0.47) |

At 60 steps a second, about 0.62 ms/s of main thread on the C172 and
0.83 ms/s on the jets. These are Node timings, not frame rates.

## Recount in Chrome

`build/prop-count/count.mjs` (see [the rest check's note](rest-check-order.md#recount-in-chrome)),
headless Chrome on the M5 (WebGPU, Metal), 10 s after a 6 s settle, physics
stepping once a frame. Counts only. Before is the 11:08 count (fly `ce8c850`,
ground-contact `2f1b707`, controls and engines before P-118 and P-119). After
is fly `62b6632`, ground-contact `3fe5b2c`, controls `72fc160` and engines
`7cebc17`, so it also holds P-118 (the commands' batch write) and P-119 (the
engine sample's batch read), which had not been counted in the browser.

| Case | Scalar reads a step, before → after | Batch reads | Scalar writes | Batch writes |
| --- | ---: | ---: | ---: | ---: |
| C172 in flight | 52.7 → 16.7 | 9 → 13 | 13 → 2 | 0 → 1 |
| F-35B in flight | 69.4 → 30.3 | 14 → 18 | 17 → 6 | 0 → 1 |
| C172 on the ground | 56.5 → 14.5 | 11 → 15 | 13 → 2 | 0 → 1 |

By caller, C172 in flight:

- This change (P-120): 20 fewer scalar reads, 2 more batch reads.
- The wheel-spin batch (ground-contact, P-121): 5 fewer, 1 more batch read.
  On the ground it is 15 fewer (the three wheels' compression, compression
  speed and wheel speed, and the steering).
- The engine sample (P-119): 11 fewer, 1 more batch read.
- The commands' batch write (P-118): 11 fewer sets, one batch write.

## Left

- Still scalar each step in flight on the C172 (16.7 a step):
  - altitude twice (kept on purpose);
  - the engine control's running flag and fuel;
  - the terrain elevation;
  - the contact count;
  - the flight recorder's brake;
  - the pilot load factor;
  - the two ruddervator paths the C172 lacks;
  - once a frame, the reading tints' flaps, angle of attack, weight and three
    contacts' weight.
- On the F-35B also:
  - six propeller and rotor rpm candidates a frame, all missing on a jet;
  - the external tanks;
  - the STOVL position twice;
  - the fly-by-wire flag;
  - four conditional mode sets a step.
