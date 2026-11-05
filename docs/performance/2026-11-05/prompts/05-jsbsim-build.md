# 05 — JSBSim WebAssembly build flags

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** remove emscripten's JavaScript exception trampolines and measure
LTO and SIMD, with identical simulation results.

**Owns:** `~/gh/Felipegalind0/jsbsim` (`CMakeLists.txt`, `wasm/CMakeLists.txt`,
`wasm/scripts/`, the SDK in `wasm/src/`), and, only after the user agrees, the
SDK tarball in `~/gh/0sfs/fly/deps/` and fly's `package.json`.

## Evidence

The current build compiles with `-fexceptions` (`CMakeLists.txt:51`) and links
with `-sNO_DISABLE_EXCEPTION_CATCHING`, so every call that may throw goes
through one of 45 `invoke_*` JavaScript trampolines. Measured with the
audit's harness: 273 trampoline calls per C172 step, 584 per F-35B step, 22
per scalar property read; in a CPU profile they are 12–14% of a C172 step's
self time and 4% of an F-35B's. There is no LTO, no SIMD and no name
section.

## Variants, built from one source revision

- **A:** today's flags (the baseline).
- **B:** `-fwasm-exceptions` on every compiled object and at the link,
  without `-sNO_DISABLE_EXCEPTION_CATCHING`. WebAssembly exceptions are
  supported since Chrome 95, Firefox 100 and Safari 15.2.
- **C:** B with `-flto` at compile and link.
- **D:** C with `-msimd128`.
- **P:** C linked with `--profiling-funcs`, for prompt 06; never shipped.

## Checks for each variant

1. The binary imports no `invoke_*` function (B, C, D).
2. The SDK still turns a C++ exception into the same JavaScript error:
   trigger a failing `loadModel` and compare the thrown message with A's.
   Fix the SDK's translation if the exception object changed.
3. The SDK's own tests and fly's JSBSim integration tests pass.
4. A differential run against A: C172, Vision Jet, F-35B with both engine
   models and the drones, several thousand steps each with moving inputs,
   every state value compared with `Object.is`. LTO and SIMD may legally
   change floating-point results only through contraction or reordering;
   if any value differs, find the flag that changed it and drop it rather
   than accept the difference.
5. Time with `docs/performance/2026-11-05/harness/` (`jsbsim-step` and
   `jsbsim-profile` cases), A and each variant interleaved, with an A/A pair.

## Deliverable

A report with sizes, trampoline counts, parity results and timings per
variant. Ship the fastest exact variant as a new fork version only when the
user agrees to the dependency change; the tarball and `package.json` update
are a separate commit in fly.
