# JSBSim built with WebAssembly exceptions — 7 November 2026

Part of [prompt 05](../2026-11-05/prompts/05-jsbsim-build.md) of the
[5 November phone audit](../2026-11-05/README.md) (JSBSim's WebAssembly build
flags). Baseline: `@felipegalind0/jsbsim` 1.2.4-fork.21, built from the fork's
`master` at `34eeae66`; fly `2287de0`. Ledger: P-136.

Nothing is shipped. The prompt makes a new fork version and fly's dependency
change wait for the user's agreement. The fork has no commit; the patches are
in its ignored `build/perf-wasm-exceptions/`.

## What it was

The SDK compiles JSBSim with `-fexceptions` and links it with
`-sNO_DISABLE_EXCEPTION_CATCHING`, which is Emscripten's JavaScript exception
model. Every C++ call that may throw leaves the module for one of 45
`invoke_*` functions in the JavaScript glue. That function calls back into
the module through its function table, inside a JavaScript `try`. The audit
counted 273 of these calls in a C172 step, 584 in an F-35B step, and 22 in one
scalar property read.

With `-fwasm-exceptions`, a C++ `try` becomes a WebAssembly `try`, and nothing
leaves the module.

## Variants

All variants are built from the same source:

- the fork at `34eeae66`;
- the release's generated bindings (build input `4cbf76ca72af`);
- Emscripten 6.0.9;
- the release's `SOURCE_DATE_EPOCH`.

A reproduces the installed module and glue byte for byte. In the table,
"helpers" means `getExceptionMessage` and `decrementExceptionRefcount`
exported from the module. Brotli is at quality 11.

| | Flags | Wasm bytes | Brotli | Glue bytes | Imports | `invoke_*` | `try` | SIMD instructions |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | as shipped | 2,423,963 | 484,827 | 135,090 | 100 | 45 | 0 | 0 |
| B | `-fwasm-exceptions` at compile and link | 1,940,863 | 452,566 | 122,036 | 44 | 0 | 8,401 | 0 |
| C | B, `-flto` | 2,136,736 | 477,308 | 123,211 | 47 | 0 | 9,268 | 0 |
| D | C, `-msimd128` | 2,143,272 | 478,461 | 123,211 | 47 | 0 | 9,267 | 10,742 |
| E | D, helpers | 2,200,633 | 495,166 | 124,942 | 47 | 0 | 9,290 | 10,774 |
| G | B, helpers, `-msimd128` | 2,007,016 | 471,436 | 123,767 | 44 | 0 | 8,425 | 8,384 |
| H = J | B, helpers | 2,007,625 | 471,305 | 123,767 | 44 | 0 | 8,425 | 0 |
| K | J, `-sWASM_LEGACY_EXCEPTIONS=0` | 2,063,552 | 479,114 | 123,647 | 44 | 0 | 8,447 `try_table` | 0 |

- **H and J:** H lists the helpers in `-sEXPORTED_RUNTIME_METHODS` and also
  passes `-sEXPORT_EXCEPTION_HANDLING_HELPERS`, which Emscripten 6.0.9 marks
  deprecated. J drops that flag. J is the proposed change, and its module and
  glue are byte-identical to H's, so the deprecated flag added nothing.
- **K:** uses the newer exception encoding (`try_table` and `exnref`). B to J
  use the legacy encoding, which is Emscripten's default.
- **The helpers' cost:** they add 18,739 brotli bytes (B to H), because
  `getExceptionMessage` pulls in libc++abi's demangler to name the exception's
  type.
- **J's download:** module and glue together, A's 515,717 brotli bytes become
  501,046 (−2.8%).
- **P:** J linked with `--profiling-funcs`, for prompt 06 (the prompt
  defined it from C). Its module without the name section is byte-identical
  to J's, and it matches J in all 13 flights.

## Exactness

- **Differential harness.** `build/jsbsim-flags/diff.perf.ts` runs every lane
  in lockstep, each lane a real SDK instance:
  - **Lanes:** A, a second A (A2), B, C, D, E, G and H.
  - **Driven by fly's code:**
    - `bootstrapAircraft`;
    - `createTerrainContact` on a flat floor;
    - for the aircraft, moving stick, throttle, trim, flaps and brakes;
    - for the drones, their own controller.
  - **Flights:** 13, each of 12,000 steps (200 s; 100 s for the two drones
    at 120 Hz):
    - the C172;
    - the Vision Jet, its G2 and its G3 (the G2 and G3 are the same model
      under two names, since their XML differs only in the name, a comment
      and the description, so they share a digest);
    - the F-35B with each engine model;
    - the C172, the Vision Jet and both F-35Bs again, from 20,000 ft;
    - the R22;
    - the DJI Mini 2 and the Air 2S, at 120 Hz.
  - **Ground contact:** 85,229 of the steps have weight on wheels.
- **What it compares.** After every step it reads every catalog property
  (510–1,435 per aircraft) through one batch (`create: false`) and compares
  them with `Object.is`. It also compares the catalog, every `run()` result
  and all 32,093 log lines.
- **Result.** 919,548,000 comparisons on Node 26.9.0 and again on Node
  22.22.3. There were no differences and no refused steps.
- **Raw bits.** The harness also keeps a digest of every value's raw bits:
  - A2, B and H match A in all 13 flights on both Node versions.
  - C, D, E and G differ in one flight only, the F-35B with the empirical
    engine from 20,000 ft. The difference is the sign of some NaNs: 265
    values in C, 266 in D, 266 in E and 246 in G.
  - The first differences are at steps 3,069–3,072, 3,231 and 6,001. By
    then the flight's 570 kt ground impact has already turned its state into
    NaN. It touches down at step 3,044 and reaches its first NaN at step
    3,067, 23 steps later (18 after its last gear contact). fly's
    ground-impact guard would have stopped the flight at the impact, before
    any of those steps.
  - `Object.is` cannot tell two NaNs apart. Two non-NaN numbers that
    `Object.is` calls equal have the same bits, so every other value is
    bit-identical in every variant.
  - WebAssembly does not define the sign of a NaN that arithmetic produces.
    In `build/jsbsim-flags/nan-sign/`, one module's arithmetic exports give
    `7ff8…` on arm64 and `fff8…` on x86-64. The two runs use the same
    Electron binary (Cursor's, V8 15.0, `ELECTRON_RUN_AS_NODE=1`), natively
    and under Rosetta; the export that negates explicitly flips the other
    way. The outputs are in `arm64-electron.json` and `x64.json`. LTO and
    SIMD reorder the arithmetic, so they are free to flip it.
- **After the CMake change.** A, H, J and K on Node 26.9.0, the same 13
  flights: 394,092,000 comparisons with no difference, and every flight's
  digest equals A's.
- **Mutants.** Both were caught in all 13 flights:
  - M, built with `-fassociative-math -freciprocal-math -fno-signed-zeros
    -fno-trapping-math`, at step 0;
  - N, which multiplies the gear strut force (every unit's) by 1 + 2⁻⁵²,
    between steps 439 and 8,009.
- **Across Node versions.** The DJI Mini 2's digest is different on Node 22
  and Node 26 (the Air 2S's is not). Every lane agrees within each Node
  version, so the difference comes from the JavaScript side, probably a
  `Math` function in its controller (not isolated).

## Failed loads and other exceptions

Each case makes a load fail through `loadModelOrThrow`. The table gives the
error's reason, the text in parentheses. Columns A and H come from
`build/jsbsim-flags/exceptions.perf.ts`, with the installed SDK. Column J
comes from the fork's `build/perf-wasm-exceptions/load-error.mjs` and
`load-error-table.mjs`, run through the patched SDK.

| Case | A | H, installed SDK | J, with the SDK change |
| --- | --- | --- | --- |
| Missing model | `LoadModel returned false` | same | same |
| Malformed XML | `[object Object]` | `[object WebAssembly.Exception]` | `JSBSim::LogException: In file …/broken.xml: line 1` and `XML parse error: mismatched tag` |
| Bad table | `[object Object]` | `[object WebAssembly.Exception]` | `JSBSim::XMLLogException: Illegal character found in line 427:` and `0 1 x 2` |

- **The exception object changes.** It was Emscripten's `CppException` and is
  now a `WebAssembly.Exception`. Neither one prints anything useful.
- **The SDK change** (`sdk-exceptions.git.patch`) names the exception. When
  the module exports the helpers and the cause is a `WebAssembly.Exception`:
  - `JSBSimModelLoadError` gets a `nativeException` field (`{type, message}`)
    and uses it as the reason;
  - the SDK then releases the exception with `decrementExceptionRefcount`.

  A new SDK test loads malformed XML and checks the error.
- **Freeing the exception also logs it.** A `LogException`'s logger writes
  its message when the exception is destroyed (`BufferLogger::~BufferLogger`),
  just as it does for errors JSBSim catches itself. With the change, a failed
  load also logs "In file …: line 1" and "XML parse error: mismatched tag" on
  stderr. The error carries those lines in `logs` and repeats them after its
  message.
  - For the bad table, the logged lines also name the file ("In file
    …/c172p.xml: line 426"), which the exception's own message lacks; the
    message gives only "line 427".
  - The bad-table row was checked through the patched SDK with both J and K.
  - In A, an exception that reaches JavaScript is never destroyed and never
    logged. Today a malformed model fails with `[object Object]` and no log
    line at all.
- **Exceptions from `run()`.** An unknown property in a function makes
  `run()` throw. That exception reaches the caller unchanged in both builds
  (a `CppException` in A, a `WebAssembly.Exception` in H). fly's step loop
  does not catch it.
- **Recovery.** After every case, a fresh SDK instance flies the C172 to
  5,612.978 ft in 600 steps in A, B, E and H (and so J).
- **Problems found that are also in A** (not changed here):
  - an unknown function element (`<quux>`) fails with "RuntimeError: function
    signature mismatch";
  - after that failure, and after an exception from `run()`, `destroy()`
    throws an `AggregateError`;
  - about 3,000 failed loads in one instance make it hang.
- **Research's smoke test** (`smoke-test-flightgear-fdm.mjs:75`) calls only a
  `CppException` a native exception. With J it falls back to `String(error)`.
  It shows the log lines first anyway.

## Tests

- **SDK:**
  - 52 of 52 on A, B and D.
  - 53 of 53 on E, H = J and K with the SDK change; the extra one is its
    test.
  - The malformed-propulsion test passes on every variant that ran the
    tests. In that test the engine catches its own XML error, which is why
    `-fexceptions` must reach every compiled object (see
    [the JSBSim notes](../../jsbsim.md#adopted-idbfs-and-native-exception-corrections)).
    `-fwasm-exceptions` keeps that.
- **fly:**
  - The 41 test files that import the SDK's wasm entry directly: 469 passed
    and 2 expected failures. (`f135ExhaustOnset.integration.test.ts` also
    loads the module, through its harness, and was not run on the variants.)
  - Run with the installed SDK, and with B, C, D, E, H and K swapped in for
    its module (`build/jsbsim-flags/variant.config.ts`).

## Measured

All Node timings are on the M5 with Node 26.9.0. They are not frame rates.

### The audit's harness

Setup:

- The harness is `docs/performance/2026-11-05/harness/`, unedited: its
  `jsbsim-step` and `jsbsim-profile` cases.
- It runs through `build/jsbsim-flags/audit.config.ts`, which only points the
  SDK's module at a variant.
- One process per lane, with the lanes' order rotated each round, over 5
  rounds. A second A process (A2) is the control.
- Each cell is the median in µs, with the round range for A.

First run, with H and E:

| Case | A | A2 | H | E |
| --- | ---: | ---: | ---: | ---: |
| C172 step | 11.1 (11.0–11.4) | 11.2 | 7.1 (−36.0%) | 6.8 (−38.7%) |
| Vision Jet step | 11.7 (11.6–12.1) | 11.6 | 6.5 (−44.4%) | 4.8 (−59.0%) |
| F-35B step | 89.4 (89.0–91.9) | 90.4 | 78.8 (−11.9%) | 71.0 (−20.6%) |
| F-35B step, empirical engine | 26.9 (26.7–27.7) | 26.8 | 14.5 (−46.1%) | 12.1 (−55.0%) |
| C172 step while profiling | 13.3 (13.1–13.3) | 13.2 | 7.2 (−45.9%) | 5.4 (−59.4%) |
| F-35B step while profiling | 102.0 (101.7–102.8) | 102.0 | 90.5 (−11.3%) | 81.6 (−20.0%) |
| C172 scalar read | 0.51 | 0.51 | 0.23 | 0.22 |
| C172 scalar write | 0.59 | 0.59 | 0.25 | 0.24 |
| C172, 22 scalar reads | 12.4 | 12.3 | 5.5 | 5.0 |
| C172, one 22-path batch read | 0.42 | 0.42 | 0.43 | 0.36 |

Second run, after the CMake change, with J and K:

| Case | A | A2 | J | K |
| --- | ---: | ---: | ---: | ---: |
| C172 step | 11.3 (11.1–11.6) | 11.2 | 7.0 (−38.1%) | 7.2 (−36.3%) |
| Vision Jet step | 11.9 (11.6–12.0) | 11.7 | 6.6 (−44.5%) | 6.1 (−48.7%) |
| F-35B step | 90.3 (89.2–90.4) | 90.4 | 79.0 (−12.5%) | 77.3 (−14.4%) |
| F-35B step, empirical engine | 26.8 (26.5–27.2) | 26.5 | 14.4 (−46.3%) | 14.3 (−46.6%) |
| C172 step while profiling | 13.2 (13.1–13.4) | 13.2 | 7.2 (−45.5%) | 6.6 (−50.0%) |
| F-35B step while profiling | 102.1 (101.5–102.9) | 101.8 | 90.9 (−11.0%) | 88.6 (−13.2%) |

- **Noise:** A2's steps are within −1.7% to +1.1% of A's in both runs.
- **Scalar property calls:** in this harness, reads and writes take 35–45%
  of their old time on all three aircraft, in H, E, J and K (about 33–47% in
  the flights' harness).
- **Batch reads:** they don't change, except with LTO (E: −14 to −17%).
- **Profile self time**, first round:
  - On A, a C172 step is 65.3% WebAssembly, 17.1% `wasm-to-js`, 8.7%
    `invoke_*`, and 8.1% the trampolines' stack and table helpers. On H it
    is 99.1% WebAssembly.
  - An F-35B step goes from 90.8% to 99.8% WebAssembly.

### The flights

Setup:

- `build/jsbsim-flags/time.perf.ts` times six of the differential's flights
  (those in the table).
- "Step" is fly's own step: terrain contact, then the controls or the drone's
  controller, then JSBSim. "`run()`" is JSBSim on its own.
- Step is timed over steps 600–6,600 (600–3,600 for the F-35Bs), after 600
  warm-up steps. `run()` is then timed on its own for half as many further
  steps, so on the F-35B it can exceed the step.
- There were 7 rounds, with the lanes rotated and an A2 control.
- Each cell is the median in µs.

| Flight | A step | H | E | A `run()` | H | E |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C172 | 16.90 | 11.15 (−34.0%) | 10.08 (−40.4%) | 11.32 | 6.23 (−45.0%) | 5.33 (−52.9%) |
| Vision Jet | 20.03 | 12.24 (−38.9%) | 10.18 (−49.2%) | 15.64 | 7.88 (−49.6%) | 6.17 (−60.5%) |
| F-35B | 134.20 | 119.96 (−10.6%) | 110.77 (−17.5%) | 158.74 | 148.25 (−6.6%) | 139.48 (−12.1%) |
| F-35B, empirical engine | 38.21 | 21.38 (−44.0%) | 18.55 (−51.5%) | 29.05 | 15.05 (−48.2%) | 12.55 (−56.8%) |
| R22 | 12.14 | 6.69 (−44.9%) | 5.92 (−51.2%) | 7.08 | 3.68 (−48.0%) | 2.77 (−60.9%) |
| DJI Mini 2 | 16.29 | 12.77 (−21.6%) | 11.71 (−28.1%) | 6.14 | 3.13 (−49.0%) | 2.24 (−63.5%) |

- **Noise:** A2 is within −1.0% to +1.5% of A (steps +0.1% to +1.3%,
  `run()` −1.0% to +1.5%).
- **B and G:** B, in an earlier run of the same harness, and G (SIMD without
  LTO) time like H.
- **Whole-catalog batch read:** with H it takes 0.8–9.2% less time.

### Chrome

Setup:

- **Tool:** research's `profile.mjs`, with `--target fly --no-throttle
  --cold-only --rates 1 --seconds 10`.
- **App:** fly `2287de0`, plus the uncommitted work in its tree (the same in
  every run), built once for each module (`build/jsbsim-flags/browser/`).
- **Browser:** headless Chrome on the M5, WebGPU. The profiles do not
  record its version; the installed app, which `profile.mjs` launches, is
  156.0.8078.80.
- **Flights:** the F-35B (`?aircraft=f-35b`) and the default C172, each at
  fly's default physics rate.
- **Order:** A H E E H A, under the perf lock.
- **Analysis:** `build/jsbsim-flags/browser/jsbsim-time.py` reads JSBSim's
  time from the CPU profile. "Inside" counts every sample under a stack that
  entered JSBSim, including the JavaScript that JSBSim calls back into.

| ms/s (two runs each) | A | H | E |
| --- | --- | --- | --- |
| F-35B, inside JSBSim | 17.1, 16.6 | 13.4, 14.0 | 13.9, 13.8 |
| of which WebAssembly | 13.8, 13.8 | 12.9, 13.2 | 12.9, 13.0 |
| of which V8's JS–wasm wrappers | 1.84, 1.40 | 0.15, 0.18 | 0.28, 0.26 |
| of which `invoke_*` | 0.40, 0.38 | 0 | 0 |
| of which the rest of the glue | 1.06, 1.11 | 0.33, 0.60 | 0.70, 0.50 |
| C172, inside JSBSim | 7.5, 8.2 | 5.9, 6.4 | 5.5, 5.9 |

- **Frame rate:** 59.0–59.2 fps in every run, since the M5 holds 60 either
  way.
- **Main thread:** 39–40% of a core on the F-35B and 25–26% on the C172.
- **What H saves:** about 3.2 ms/s on the F-35B and 1.6 ms/s on the C172.
  About four fifths of that is the wrappers, the trampolines and the glue.
  The rest is WebAssembly time, which on the F-35B goes from 13.8 to
  12.9–13.2 ms/s.
- **E:** on the F-35B it is within H's two runs. On the C172 its runs
  overlap H's (5.5 and 5.9 against 5.9 and 6.4), by less than A's own
  0.7 ms/s spread. LTO and SIMD gain nothing here that can be measured,
  unlike in Node.
- **Phones:** none was measured. JSBSim takes a larger share of a phone's
  frame, so the saving should matter more there, but that is an estimate.

## Browsers

Minimum versions, from MDN's browser-compat-data:

| Needs | Chrome | Firefox | Safari |
| --- | ---: | ---: | ---: |
| Legacy exceptions (B to J) | 95 | 100 | 15.2 |
| exnref (K) | 137 | 131 | 18.4 |
| Fixed-width SIMD (D, E, G) | 91 | 89 | 16.4 |

fly builds for Vite 8's default target, `baseline-widely-available`:
Chrome 111, Firefox 114, Safari 16.4.

- J and the SIMD variants run on every browser in that target.
- K would raise the minimum to Chrome 137, Firefox 131 and Safari 18.4.

## Decision for the user

**Recommended: J.**

- It is bit-identical to today in every flight.
- It removes all 45 trampolines.
- It saves 3.2 ms/s of main thread on the F-35B and 1.6 ms/s on the C172 in
  Chrome.
- Its download is 2.8% smaller.
- It runs on every browser fly builds for.
- With the SDK change, a failed load names its exception and logs it.

The alternatives:

- **E (LTO and SIMD):**
  - It is faster in Node: a C172 step −40% against −34%, and an F-35B step
    −17% against −11%.
  - In Chrome, it is not measurably faster than J (its runs are within the
    spread of H's).
  - It flips NaN signs in a flight that has already diverged.
  - Its download (module and glue) is 4.8% larger than J's: 525,235 brotli
    bytes against 501,046.
- **K (exnref):**
  - It gives the same results. In Node it ranges from 3% slower than J to
    8% faster.
  - Its download (module and glue) is 1.6% larger.
  - It needs newer browsers than fly builds for.
- **B (J without the helpers):**
  - It is the smallest download: 452,566 brotli bytes, 4% under J.
  - A failed load still says `[object WebAssembly.Exception]` and logs
    nothing.
  - Exceptions that reach JavaScript are never freed, as today.

The CMake change (`cmake-wasm-exceptions.git.patch`):

```diff
--- a/CMakeLists.txt
+++ b/CMakeLists.txt
@@ -48,7 +48,8 @@
 if(BUILD_WASM_MODULE)
   # Engine object libraries must retain their C++ catch blocks as well as the
   # bindings. Enabling exceptions only at the final link cannot restore them.
-  add_compile_options($<$<COMPILE_LANGUAGE:CXX>:-fexceptions>)
+  # They use WebAssembly's own exceptions rather than JavaScript trampolines.
+  add_compile_options($<$<COMPILE_LANGUAGE:CXX>:-fwasm-exceptions>)
 endif()
--- a/wasm/CMakeLists.txt
+++ b/wasm/CMakeLists.txt
-target_compile_options(jsbsim_wasm PRIVATE -fexceptions)
+target_compile_options(jsbsim_wasm PRIVATE -fwasm-exceptions)
 …
-  -sNO_DISABLE_EXCEPTION_CATCHING
+  -fwasm-exceptions
   -sWASM_BIGINT=1
-  "-sEXPORTED_RUNTIME_METHODS=['FS']"
+  # getExceptionMessage names a C++ exception that reaches JavaScript.
+  "-sEXPORTED_RUNTIME_METHODS=['FS','getExceptionMessage','decrementExceptionRefcount']"
```

The SDK change (`sdk-exceptions.git.patch`) touches:

- `wasm/src/sdk/jsbsim-sdk.ts`: a `takeNativeException` step in
  `loadModelOrThrow`.
- `model-load-error.ts`: the `nativeException` field and the reason.
- `types.ts`: the two optional module methods.
- a new `wasm/test/native-exception.test.mjs`.

Both patches apply cleanly to the fork's `master` (`34eeae66`) and to its
current checkout (`b53ed5a8`, `migration/repository-split-20261008`).

Shipping it, once you agree:

1. Commit both patches to the fork's `master`.
2. Build and pack 1.2.4-fork.22 as
   [the JSBSim notes](../../jsbsim.md#build-and-installation-chain) describe.
3. In a separate fly commit, add the tarball in `deps/` and update
   `package.json`, `package-lock.json` and `jsbsimBuildIdentity.ts`, with
   adoption evidence as for earlier versions.

## Left

- No phone, Safari or Firefox was measured. K was not run in Chrome.
- The SDK's error repeats a `LogException`'s message: once in the reason and
  once in the logged lines.
- Research's smoke test calls only a `CppException` a native exception.
- These problems are also in A:
  - the `<quux>` signature mismatch;
  - `destroy()` failing after a failed load or after a `run()` exception;
  - the hang after about 3,000 failed loads.
- Scratch:
  - fly's `build/jsbsim-flags/`: the harnesses, logs and results;
  - the fork's `build/perf-wasm-exceptions/`: the sources, builds, patches
    and SDK workspaces;
  - FOSS Earth research's `build/benchmarks/startup-audit/profile-fly-jsbsim-*`:
    the Chrome profiles.
