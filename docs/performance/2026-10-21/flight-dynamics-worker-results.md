# Flight dynamics worker: measured result

Date: 2026-10-21. Steps 1–3 of [flight-dynamics-worker.md](flight-dynamics-worker.md).
Step 1's inventory is [flight-dynamics-native-inventory.md](flight-dynamics-native-inventory.md).

**Decision: the gate fails.** Keep the existing batched main-thread path. No
application source was changed, broad migration stopped at step 3, and step 4
(shared memory) is not justified. This page publishes the failed experiment.

- **≥1 ms less main-thread work per frame: fails everywhere.** All the work
  that could move is at most 0.64 ms per frame in every configuration. That
  figure assumes the boundary itself costs nothing.
- **≥10% better p95 frame time: fails.**
  - *Representative terrain:* the worker path saves 1.7% (Google cruise F-35B
    with sound). At low altitude it is 6.4% *slower* (Google, 60 m), because the
    main thread must answer every fixed step's exact terrain and probe queries.
  - *Flat fixture:* the saving is 8–26%, but the main thread there does only
    1.2–4 ms of work per frame, and there is no terrain service. No
    configuration with repeated pairs clears 10% at the lower bound of its 95%
    interval.
- **Responsiveness improvement: fails structurally.** Today a frame's input is
  stepped and rendered in that frame ([createFlightSimApp.ts:2706](../../../src/flight/createFlightSimApp.ts#L2706)
  polls, line 2712 steps). With a worker, the result arrives 0.7–2.0 ms after
  the frame's input is sent (median), with a p95 of up to 11 ms. It is shown one
  frame later, at the earliest.
- **Total CPU rises.** The worker's busy time (0.27–0.53 ms per frame) exceeds
  the main-thread time it removes (0.23–0.41 ms) on the flat fixture.
- **Transport parity holds.** Replays of the worker's steps on a main-thread SDK
  matched bit for bit: 591–597 steps per configuration, with 0 state and 0 audio
  mismatches, including 597 native audio readings with sound on.

## What was built

A shadow worker: an experiment, not shipped, kept with its harness under the
ignored `fly/build/perf-20261021/dynamics/`. It runs beside the live app in the
real browser frame, so the main-thread cost of a worker boundary is measured
against the same scene, not estimated from a `run()` benchmark.

- `shadow/protocol.ts`: a versioned protocol. Every message carries the
  version, a runtime generation and a per-direction sequence number, and the
  receiver rejects anything else before it can touch native state. States and
  observations use fixed `Float64Array` layouts and are transferred, not cloned.
- `shadow/dynamicsShadow.worker.ts`: one worker owns its own JSBSim SDK (the
  installed C++/WASM artifact). It is started from the app's recovery snapshot,
  `captureSimulation`. It keeps the app's 120 Hz accumulator, six-step cap and
  0.1 s frame clamp. For every attempted step it asks the main thread for that
  exact pre-step state's scene queries and waits for the reply. A reply for any
  other step is a fault, so no step runs against another state's terrain. It
  posts one latest-wins observation per drained batch, with the step-ordered
  audio readings.
- `shadow/shadowSession.ts`: the native work of one attempted step, the same
  code in the worker and in the main-thread replay reference. It applies the
  terrain reply, makes the native reads the app's arbiter and assists make,
  calls `applyFlightControls` with the app's own arguments, then runs the
  fixed-step guards, capture, `run()` and candidate checks, restoring on
  rejection. The per-frame presentation reads become observation fields: about
  45 values, with fuel every sixth observation.
- `shadow/dynamicsShadow.ts`: the main-thread side and the exact terrain query
  service. For each query it samples `runtime.surface` at the step's
  coordinates. It re-samples the previous anchor when the surface revision
  changed, as `terrainContact` does. Below 150 m it casts the aircraft's swept
  body probes from the previous pre-step state, as `visibleMeshCollision` does.
  It times its own work into the frame profiler as a top-level `dynamics`
  section. It also records input-to-observation latency and replays the worker's
  record for parity.

The app's own simulation keeps running and stays authoritative, so the app's
behavior cannot change. The worker receives the app's control arguments each
frame through a build-only hook. Two other build-only harness patches exist:
one starts runway scenarios on the ground instead of 1 km up, and one lowers
the app's `low` autopilot route. Both are applied to both modes.

## Method

- **Machine and browser:** Apple M5 (4 performance and 6 efficiency cores),
  headless Chrome 155, WebGL2 through ANGLE Metal, 1280×800 CSS pixels, DPR 1,
  60 Hz `requestAnimationFrame`, cross-origin isolated (5 µs timer).
- **Bundle and modes:** one production bundle per comparison. *Main* runs it
  with the shadow off. *Shadow* starts the worker during the same settle
  period. The modes alternate ABBA after one warm-up of each, each run in a
  fresh tab.
- **Pairs collected:** five each for flat cruise C172 and F-35B, three for
  flat ground C172, and one for each other configuration. A planned five-pair
  matrix was stopped to keep the laptop cool. The decision does not depend on
  it (see the gate below). A separate five-run baseline without the shadow
  covers ten configurations and gives the upper bounds.
- **Why pairing matters:** unpaired runs taken about 45 minutes apart differed
  by up to 0.6 ms in total (flat C172: 1.86 against 1.26 ms). Other browser
  benchmarks were also running on the same laptop.
- **Measured work:** a 10 s FOSS Earth `osfsFrameProfiler` window, then a
  separate 3 s Chrome trace window, so tracing overhead stays out of the
  profiler. Separately recorded:
  - CDP `TaskDuration`, the whole main thread per frame, including message
    dispatch and clone time the profiler cannot see;
  - trace main-thread busy time and GC;
  - the GPU section, kept out of the CPU totals.
- **Terrain:** the flat offline fixture serves no terrain mesh. Every surface
  query misses there, as it does for the app, so it measures the transport
  without terrain cost. Google Photorealistic 3D Tiles near Stockton is the
  representative terrain.
- **Same inputs in both modes:** aircraft, location, backend, resolution,
  sound, diagnostics and one identical click are held equal.

| Configuration | Scenario |
| --- | --- |
| `*-cruise-*` | 1,500 m above ground, C172 110 kt / 65% or F-35B 300 kt / 70% throttle, hands off |
| `flat-ground-c172` | On the ground at idle; it taxis at about 5 kt, level |
| `flat-takeoff-f35b` | On the ground at full throttle; takeoff roll, lift-off, climb |
| `*-sound` | Sound on (`med`), unlocked by the click; native audio readings every accepted step |
| `google-routelow-c172` | The app's own autopilot `low` route (C172 only, Google only), lowered to 60 m above ground so the swept probes run every step (`dev=1` also shows the debug HUD in both modes) |

### Estimating the worker path

The shadow run's main thread does all of the app's work plus the shadow's. If
the worker owned the simulation, the main thread would drop the work that moves
and keep the shadow's:

- **Moves to the worker:** native `run()` and snapshot, flight-state reads,
  controls, accepted-step audio publishing, and the per-frame view and
  instrument SDK reads (*movable*). The app's in-frame terrain contact and swept
  collision would be replaced by the shadow's query service.
- **Added on the main thread:** terrain service, observation copy and tick
  (*dynamics*).

So the worker-path estimate per frame is the shadow-run total minus movable,
contact and collision. The saving is the main-mode total minus that estimate.
It is computed per frame for p95, and on the CDP task basis as well.

The *upper bound* is the main run's movable time alone. It is the saving if the
boundary itself cost nothing.

## Results

### Upper bound (five runs per configuration, no shadow)

Values are milliseconds of main-thread work per frame, mean ±95% CI over runs.
The p95 saving is per frame: total p95 against p95 of (total − movable).

| Configuration | Total mean | Total p95 | CDP task | Trace main p95 | Movable (upper-bound saving) | Upper-bound p95 saving |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| flat-cruise-c172 | 1.856 ±0.125 | 2.636 | 3.290 | 4.578 | 0.396 ±0.027 | 19.8% |
| flat-cruise-f35b | 4.103 ±0.149 | 4.741 | 4.918 | 6.039 | 0.515 ±0.016 | 14.0% |
| flat-cruise-f35b-sound | 4.832 ±0.062 | 5.271 | 5.654 | 6.175 | 0.642 ±0.006 | 15.0% |
| google-cruise-c172 | 3.031 ±0.058 | 3.420 | 4.965 | 7.912 | 0.242 ±0.005 | 7.8% |
| google-cruise-f35b | 7.183 ±0.223 | 8.111 | 8.844 | 11.428 | 0.488 ±0.009 | 7.4% |
| google-cruise-f35b-sound | 6.852 ±0.053 | 7.148 | 8.429 | 9.171 | 0.485 ±0.003 | 7.5% |

Even a free boundary cannot reach 1 ms. On Google terrain it cannot reach 10%
at p95 either. Against the whole main thread (trace or CDP), the movable share
is smaller still.

### Worker path (paired; positive is a saving)

The paired difference is main minus the worker-path estimate, with a 95% CI
over pairs where there are several.

| Configuration | Pairs | Saving mean | Saving p95 | p95 fraction | Saving on CDP task basis | Main-thread cost of the shadow (profiler / CDP) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| flat-cruise-c172 | 5 | 0.232 ±0.018 | 0.233 ±0.133 | 14.7% | 0.181 ±0.047 | 0.037 / 0.088 |
| flat-cruise-f35b | 5 | 0.414 ±0.078 | 0.359 ±0.289 | 8.0% | 0.355 ±0.077 | 0.098 / 0.157 |
| flat-ground-c172 | 3 | 0.264 ±0.075 | 0.412 ±0.384 | 25.9% | 0.250 ±0.145 | ≈0 / 0.007 |
| flat-takeoff-f35b | 1 | 0.235 | 0.610 | 12.2% | 0.211 | 0.364 / 0.388 |
| google-cruise-f35b-sound | 1 | 0.302 | 0.135 | 1.7% | 0.251 | 0.294 / 0.345 |
| google-routelow-c172 (60 m) | 1 | −0.468 | −0.460 | −6.4% | −0.501 | 1.253 / 1.286 |
| google-ground-c172 (invalid flight, below) | 1 | −0.666 | −0.695 | −13.4% | −1.001 | 1.462 / 1.797 |

No configuration passes the ≥1 ms clause, or the 10% p95 clause at the lower
bound of its interval. Single-pair rows have no interval. They are not needed
for the decision: the largest single-pair gain is 0.30 ms on representative
terrain, and the low-altitude row is a loss.

### Worker, transport and latency

| Configuration | Worker steps/s | Worker busy ms/s | Round trip mean / max ms | Input → observation p50 / p95 ms | Late observations | Parity (steps, mismatches) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| flat-cruise-c172 | 120.0 | 16.1 | 0.32 / 8.4 | 0.96 / 1.32 | 0% | 597, 0 |
| flat-cruise-f35b | 120.0 | 31.8 | 0.22 / 9.9 | 1.01 / 1.36 | 0% | 595, 0 |
| flat-ground-c172 | 120.0 | 17.3 | 0.16 / 6.4 | 0.68 / 0.92 | 0% | 597, 0 |
| flat-takeoff-f35b | 120.0 | 29.0 | 0.19 / 1.1 | 0.89 / 1.13 | 0% | 597, 0 |
| google-cruise-f35b-sound | 119.7 | 25.6 | 0.49 / 8.8 | 1.16 / 2.58 | 3% | 597, 0 (597 audio readings) |
| google-routelow-c172 (60 m) | 119.9 | 23.7 | 1.07 / 22.0 | 2.04 / 11.00 | 6% | 591, 0 |

- **Step rate:** the worker kept the full 120 steps per second, and no time was
  dropped by the six-step cap.
- **Queries:** there were two exact queries per frame, one per step. The
  Google low route also cast 5 swept probes per step, about 600 raycasts per
  second.
- **Late observations:** these frames saw an observation more than the
  structural one frame old (up to three on the low route).
- **Copying:** the observation copy cost 0.002 ms per frame.

## Why it fails

1. **Too little work can move.** The native solver was already fast after the
   batched snapshot and state reads: 0.13–0.32 ms per frame for both fixed
   steps. The rest of the frame is rendering, view, HUD and FOSS Earth work,
   which stays on the main thread.
2. **Exact terrain costs more outside the frame than inside it.**
   - *In the app:* terrain contact and swept collision run inside the frame
     against the per-frame surface cache.
   - *With a worker:* every step's query is a separate main-thread task for a
     state the frame never saw.
   - *Measured:* on Google cruise, the shadow's terrain service took 0.30 ms per
     frame where the app's contact took 0.12 ms. At 60 m it took 0.88 ms where
     the app's contact plus collision took 0.49 ms. This is the case the spec
     anticipated: "If the round trips erase the gain, stop".
3. **The boundary adds a frame of latency.** The main thread cannot block on
   the worker (`Atomics.wait` is not allowed there), and the worker cannot step
   before the frame's input exists. So the stepped state is presented a frame
   after today's path presents it. Prediction would change behavior.
4. **Total CPU goes up, not down,** and the spec does not count moving work to
   another core as a gain.

**Step 4 (shared memory) is not justified.** Shared observations would remove
copies that already cost 0.002 ms per frame. They would remove neither the
per-step terrain service nor the added frame.

**Where the main-thread time is instead** (five-run baseline, Google cruise):
- render: 2.0 ms (C172) and 5.1 ms (F-35B) of 3.0 and 7.2 ms in total;
- F-35B view updates: about 0.55 ms;
- swept collision near the ground: 0.40 ms at 60 m;
- GC: 2.8–3.7 ms per second, 8 ms per second at 60 m.

Trace p95 also exceeds the profiled p95 by 2–4.5 ms on Google: main-thread work
the frame profiler does not see. These are better next candidates than a
worker boundary.

## Scenario validity

- **First baseline's ground runs:** they were not on the ground. The app spawns
  at least 1,000 m above terrain unless the start is a resume, a benchmark route
  or a runway preset. A start height of 0 produced a 1 km stall-dive, and
  `google-ground-f35b` crashed and paused. Those runs are discarded. The paired
  matrix uses a harness-only start patch, which sets the startup clearance to 0
  for runway scenarios.
- **Google runway starts, through that patch, are invalid and are excluded.** At
  37.8942, −121.2383, heading 295:
  - the C172 at idle rolled steadily left, past −90° within 8 s, while
    accelerating;
  - the F-35B sank through the surface to −1,467 m in 28 s;
  - the shadow worker refused the same states as deep ground impact.

  This is the app's behavior on a startup path it does not normally use. The
  supported runway start is the departure preset after a location change, which
  also resets contact, collision and controls. It is recorded here for the
  ground-contact owner, not diagnosed. Saved-flight resume also prepares terrain
  with zero clearance, so it may be worth checking a resume on a Google runway.
- **Flat runway starts are valid:** a level idle taxi for the C172, and a full
  takeoff and climb for the F-35B.
- **Cruise starts are untrimmed:** the C172 slows toward 60 kt and oscillates,
  and the F-35B climbs about 300 m. The same trajectory runs in both modes:
  end states matched across runs and modes, and nothing paused.

## Regression coverage

The gate failed, so the spec's full regression list for a shipping worker was
not built. The prototype covers this much:

- **Transport parity:**
  - *How:* in every configuration, the worker is restarted with recording for
    5 s. Its accepted steps, with each step's terrain reply and the control
    arguments of the frame that drove it, are then replayed on a separate
    main-thread SDK built from the same snapshot.
  - *Result:* states compared bit for bit. Native audio readings compared
    exactly, step by step, where sound was on. Same accepted step count.
  - *Aircraft covered:* C172 and F-35B (default engine model).
  - *Not covered:* SF50, the other F-35B engine options, afterburner, STOVL
    transition, control-law modes, trims, flaps, gear, fuel and detached stores.
- **Fixed-step guards:**
  - *Covered:* the same deep-penetration, rejected-`run()`, invalid-state,
    displacement and airspeed-jump checks, with restore. A rejected step faults
    the prototype instead of entering contact recovery. The Google runway starts
    exercised this, as deep ground impact.
  - *Not covered:* NaN injection and failed restore.
- **Terrain:**
  - *Covered:*
    - exact-coordinate queries for every attempted step;
    - anchor re-samples on surface revision change during refinement (45–90 per
      10 s on Google);
    - misses (flat fixture);
    - swept body-probe raycasts (60 m route).
  - *By construction:* a reply for any other step is a fault, and stale or
    cancelled request IDs are dropped.
  - *Not covered:* teleport, model switch during recovery, and deliberate
    reordering or delay.
- **Input:**
  - *Measured:* the applied input sequence of every observation, and the time
    from sending a frame's input to receiving the observation that applied it.
  - *Not covered:* phone authority, hidden desktop and main-thread stalls.
- **Lifecycle:** generations and sequence checks on both sides; start, dispose
  and restart once per configuration for the parity run; bounded shutdown with
  terminate. Not covered: crash or startup-failure injection, or aircraft switch.

No application source changed, so the existing suites are unaffected. The
prototype typechecks against the app's `tsconfig.app.json`
(`npx tsc -p build/perf-20261021/dynamics/shadow --noEmit`). The app's own
`npm run typecheck` and `lint` were not rerun, because only documentation changed.

## Reproduction

From `fly/`, with the Google key available as for other flight benchmarks:

```sh
node build/perf-20261021/dynamics/baseline.mjs --variant=paired --build-only
npx tsc -p build/perf-20261021/dynamics/shadow --noEmit
node build/perf-20261021/dynamics/baseline.mjs --variant=paired --no-build --runs=5 --warmup=1 \
  --configs=flat-cruise-c172,flat-cruise-f35b,flat-ground-c172,flat-takeoff-f35b,flat-cruise-f35b-sound,google-cruise-c172,google-cruise-f35b,google-cruise-f35b-sound,google-routelow-c172
node build/perf-20261021/dynamics/aggregate.mjs results/main-<stamp> results/paired-<stamp>
```

The full matrix takes about two hours and is **not needed for the decision**.
It would only narrow the single-pair intervals. A quick check of one
configuration takes about 2 minutes:

```sh
node build/perf-20261021/dynamics/baseline.mjs --variant=paired --no-build --runs=1 --warmup=0 --configs=google-cruise-f35b-sound
```

If the full matrix is wanted, run it on a machine where a long browser load is
acceptable. On a cloud VM without a GPU, WebGL runs in software, so compare
only the paired differences, not absolute frame times. `--sample-state` adds
4 Hz flight-state samples to each result for validating a scenario. Leave it
off for timing. Results, logs and `aggregate.json`
are under `fly/build/perf-20261021/dynamics/`. Like the other local evidence,
their absolute paths are not portable infrastructure.

## Limits

These results come from one machine, one headless browser and a 60 Hz display.
There is no phone, WebGPU, battery or thermal run. Google tile streaming adds
run-to-run variance, which is why the modes are paired. The shadow duplicates
the simulation instead of replacing it, so the worker-path figures are
estimates by subtraction. They are not measurements of a shipped worker. They
include every cost the spec counts: worker CPU is reported separately; message
handling, copying and GC appear in the CDP, trace and GC figures. Nothing here
supports a claim about all-core scaling, efficiency-core placement or a 60 FPS
outcome.
