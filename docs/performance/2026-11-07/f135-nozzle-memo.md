# The F135 nozzles' kept solves — 7 November 2026

A follow-up to [the F135 plant's repeated work](f135-plant-repeats.md)
(P-137), with the same baseline, harness and builds. Ledger: P-138.

Nothing is shipped. The fork has no commit. The patches are in its ignored
`build/perf-wasm-exceptions/`:

- `plant-nozzle-memo.patch`: this change alone (Q → T). It applies unchanged
  to S, giving U.
- `plant-repeat-fused-memo.patch`: P-137's patches and this one (J → T).

## The change

At the end of a step, `Fill` writes the plant's outputs. For the main nozzle
and the lift fan it called `NozzleThrust`, which begins with the
required-pressure solve. The last gas-path evaluation had just done that
solve with the same stream, geometry and ambient pressure. In
[Qp's profile](f135-plant-repeats.md#where-the-time-went) the repeat
(`RequiredPressure` under `Fill`) was 2.8% of all samples. The rest of the
thrust calculation (mostly the supersonic exit's area-ratio solve) was 3.7%.

The gas path now keeps each of the two solves in a `NozzleMemo`. A memo holds:

- the solve's inputs;
- its result;
- the work `NozzleThrust` uses (the sonic state, the inlet terms and any
  subsonic exit);
- whether it succeeded;
- its domain clamps.

`NozzleThrust` checks the memo it is given. If the memo's gas model is the
same object and its stream, geometry and ambient pressure are bit-identical
(`memcmp`), it copies the result and work and adds the clamps. Otherwise it
solves as before.

`Plant::Load` forgets both memos, because it configures the gas models again.
The solve depends only on those inputs, apart from the clamp counter (see
P-137's [repeated evaluations](f135-plant-repeats.md#repeated-evaluations)),
so the outputs are unchanged.

`Sonic`, `Inlet` and `NozzleWork` move from the source file's anonymous
namespace to `TurbinePlantComponents.h`. The old signatures of
`NozzleRequiredPressure` and `NozzleThrust` remain.

## Builds

| | What |
| --- | --- |
| T | Q with this change |
| U | S with this change: today's flags with all of the plant patches |

U's glue is byte-identical to A's, and T's to J's.

## Exactness

The comparisons:

- **Flights.** Q against T, and A against U: 13 flights of 12,000 steps each.
  Every catalog property, `run()` result and log line is `Object.is`-equal,
  and every raw-bit digest is equal: 131,364,000 comparisons a pair. The
  F-35B's digest is still `0d9f3be526d19f19`.
- **Scenarios.** P-137's 7 plant scenarios, Q against T and A against U:
  65,005,500 comparisons a pair, all equal. The digests are P-137's.
- **fly's tests.** The 41 test files that import the module, with T and with
  U: 469 passed and 2 expected failures, as with today's module.

**Reuse.** A diagnostic build (Td) counts `Fill`'s reuses on stderr. Its
outputs are identical; only its own log lines differ. `Fill` reused the kept
solve every time but once in each cold windmill. Ignoring the key (mutant a
below) changes nothing, so that call found no kept solve. The counts at the
last report (it reports every 1,024 fills):

| Run | Main nozzle | Lift fan | Reuses with clamps |
| --- | ---: | ---: | ---: |
| Stand start, afterburner, STOVL, restart | 9,216 of 9,216 | 1,800 of 1,800 | 0 |
| Cruise with fallbacks | 7,168 of 7,168 | — | 0 |
| Starvation and airstart | 7,168 of 7,168 | — | 0 |
| Seizure | 3,072 of 3,072 | — | 0 |
| Cold windmill | 7,167 of 7,168 | — | 0 |
| Frozen windmill | 3,071 of 3,072 | — | 2,795 |
| Perfect gas | 5,120 of 5,120 | — | 638 |
| Each F-35B flight | 11,264 of 11,264 | 2,699 of 2,699 | 0 |

**Mutants.**

| | Mutant | Caught by |
| --- | --- | --- |
| c | a reuse does not count its clamps again | frozen windmill (step 138), perfect gas |
| w | the memo's work is not reset before a solve | all 7 scenarios, both F-35B flights |
| x | a reuse drops the work | all 7 scenarios, both F-35B flights |
| k | the key ignores the stream | nothing |
| f | a failed solve is reused as a success | nothing |
| a | the key is ignored altogether | nothing |

The key (k, a) and the failure flag (f) are guards. In these runs, every kept
solve that `Fill` met had exactly the inputs it was given. No failed solve
reaches `Fill`, because a failed evaluation fails the solve. The guards keep
other calls exact, for example:

- publication after `InitializeRunning`, from an operating point rebuilt from
  the state;
- an output fill after a solve that failed partway.

## Measured

Node 26.9.0, the audit's harness, 7 interleaved rounds. Values are µs a step,
as median (range).

| Case | Q | T | Q again |
| --- | ---: | ---: | ---: |
| F-35B step | 40.9 (40.8–41.1) | 39.7 (39.5–39.8), −2.9% | 40.7 (40.6–41.0) |
| F-35B step, empirical engine | 15.1 | 15.1 | 15.1 |
| Plant, reduced algorithm | 39.1 (38.7–39.3) | 37.8 (37.8–38.0), −3.3% | 39.0 |
| Plant, component algorithm | 106.1 (106.0–106.4) | 104.8 (104.7–105.0), −1.2% | 106.1 |

With today's flags:

| Case | A | S (P-137) | U | A again |
| --- | ---: | ---: | ---: | ---: |
| F-35B step | 87.6 (87.4–89.9) | 48.5 (48.4–50.0) | 47.6 (47.5–48.8) | 87.6 |
| F-35B step, empirical engine | 27.4 | 27.9 | 27.7 | 27.6 |
| Plant, reduced algorithm | 89.6 | 50.4 | 49.4 | 89.6 |
| Plant, component algorithm | 153.1 | 117.8 | 116.3 | 153.3 |

What the numbers show:

- **U against S.** The F-35B step is 1.9% faster, but the ranges overlap at
  their top. The plant alone is 2.0% faster with the reduced algorithm and
  1.3% with the component algorithm.
- **Unchanged.** The evaluations a step are unchanged (10 and 21.78).
- **Not measured** in Chrome or on a phone.

## What is left

- **Shipping.** It ships with P-137's patches, if the user agrees.
- **`Fill`'s supersonic-exit solve.** It was 3.7% of Qp's samples. It gets
  new inputs every step, so reusing it needs a warm start, and a warm start
  changes results.
- **The steady solve.** It runs only in `InitializeRunning`, not every step,
  so its repeats are not worth keeping.
