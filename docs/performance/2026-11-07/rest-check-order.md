# The rest check's reads in flight, and a recount of JSBSim property calls — 7 November 2026

Part of [prompt 04](../2026-11-05/prompts/04-jsbsim-property-io.md) of the
[5 November phone audit](../2026-11-05/README.md) (JSBSim property traffic).
Baseline: fly `cbc90e2`, ground-contact `556b6b3`, `@felipegalind0/jsbsim`
1.2.4-fork.21. Commit: fly `cd75573`. Ledger: P-117.

## What it was

Once a frame, `observeRest` decides whether a parked aircraft has stayed
still long enough to rest. Its eligibility test read every contact's weight
on wheels (`gear/num-units`, then one `WOW` read per contact: 9 on the C172,
13 on the F-35B) before asking whether an engine turns, and it then read the
aircraft's motion (5 reads) whether or not the aircraft could rest. In
flight, that is 15 scalar reads a frame on the C172 and 19 on the F-35B, for
an answer that is always no.

## What changed

- The engine test runs before the contacts' weight. Every part of the
  eligibility test only reads, so the order does not change the answer. A
  turning propeller answers from the frame's control surfaces with no read;
  a jet's engine test reads the starter and the engine's running flag.
- An aircraft that is not eligible is passed to the rest tracker as a frozen
  `INELIGIBLE_FOR_REST` sample, without reading its motion. The tracker
  already treated an ineligible sample as a reset of the still period,
  whatever its motion and pose, so the outcome is the same.

## Exactness

- `createFlightSimApp.test.ts`, two new tests: an aircraft parked for 2.5 s,
  then one frame with the engine running, then still again does not rest
  after 2.5 s more and does after 3.5 s (the still period starts again); and
  with an engine turning in flight, neither the fourth contact's `WOW` nor
  `velocities/vg-fps` is read, while both are read once the aircraft is
  parked with everything stopped.
- Mutants (`build/rest-order/mutants.py`, against `createFlightSimApp.test.ts`
  and `aircraftRest`'s unit and integration tests): 3 of 3 caught, the old
  order, dropping the ineligible sample, and returning without observing it.
- fly `npm run typecheck` passes.

## Measured

Node 22 on the M5, real JSBSim, airborne at 3,000 ft and 100 kt with the
engine running, the real `touchingGround`, `readAircraftMotion`,
`enginesTurning` and `groundContactUnits`. Medians of 9 interleaved rounds
of 20,000 checks; ranges are the rounds' minimum and maximum. Script:
`build/rest-order/bench.test.ts`.

| Aircraft | Contacts | Before | After |
| --- | ---: | ---: | ---: |
| C172 | 9 | 7.44 µs (7.41–7.58) | 0.01 µs (0.01–0.02) |
| F-35B | 13 | 13.33 µs (13.23–13.41) | 1.87 µs (1.85–1.89) |

At 60 frames a second, about 0.45 ms/s of main thread on the C172 and
0.69 ms/s on the F-35B. These are Node timings, not frame rates.

## Recount in Chrome

`build/prop-count/count.mjs` builds the app unminified with JSBSim's scalar
reads and writes, batch reads and steps counted by caller, flies it in
headless Chrome (WebGPU, Metal) for 10 s after a 6 s settle, and divides by
the steps taken. Counts only: the counter's stack capture makes every call
slow, so its times mean nothing.

Before is fly `cbc90e2` with ground-contact `556b6b3` (the clearance batch,
P-115, already in). After is fly `cd75573` with ground-contact `2f1b707`,
which also reads terrain contact's pose through one batch (P-116). Physics
stepped once a frame in every run.

| Case | Scalar reads a step, before → after | Batch reads | Writes |
| --- | ---: | ---: | ---: |
| C172 in flight | 81.5 → 52.7 | 7.0 → 9.0 | 13 → 13 |
| F-35B in flight | 100.3 → 69.4 | 12.0 → 14.0 | 17 → 17 |
| C172 on the ground, rolling | 77.5 → 56.5 | 9.0 → 11.0 | 13 → 13 |

By caller, C172 in flight: terrain contact's two updates 14 fewer (now one
batch read each), the contacts' weight 9 fewer, the motion 5 fewer, the
contact count 1 fewer. On the F-35B the contacts' weight is 13 fewer and
the engine test adds 2 reads. In the ground run the engine was running, so
the aircraft could not rest there either: terrain contact's 14, the motion's
5 and the contact count go, and one `WOW` read, the first contact's, which
had answered that the aircraft touches the ground before the engine test.

## Left

The largest scalar callers now, C172 in flight, per step: the controls'
11 writes, the step callback's 7 reads (dynamic pressure, speeds, pitch and
roll rates and accelerations), the arbiter's 7, `aircraftOnGround`'s 3
`WOW` reads in each of its three callers, the wheel-spin experiment's 5
(brakes and 3 `WOW`; 15 on the ground) and a dozen single reads. Batching
those is the rest of prompt 04.
