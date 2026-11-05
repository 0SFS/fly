# F2 — Terrain core Math imports (FOSS Earth)

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.
This prompt belongs to the agent that owns FOSS Earth.

**Goal:** stop paying a JavaScript call for every `sqrt`, `floor`, `min`,
`max` and `round` in the terrain core, with bit-identical output.

**Owns:** `~/gh/foss-earth/engine/terrain-WASM/` (`index.js`, the
`earth-terrain` crate, its receipts and checks).

## Evidence

`terrain-WASM/index.js:22` builds the imports as `math[name].bind(math)`. V8
runs a directly imported `Math` function as fast as the native instruction,
but not a bound copy. Measured in Node 22 (V8 12.4) with
`~/gh/0sfs/fly/docs/performance/2026-11-05/harness/wasm-call-overheads.mjs`:
`sqrt` 8.2 ns direct against 19–21 ns bound, `floor` 5.2 against 19 ns, `sin`
26 against 33–34 ns per call in a WebAssembly loop. The sky and projection
cores pass the functions directly. Engine's notes record terrain heights and
geometry measuring slower in WebAssembly than in TypeScript; this may be
part of the reason.

## Steps

1. Pass the functions themselves: `imports[name] = math[name]`, keeping the
   realm check that they are functions of the worker's own `Math`.
2. In the Rust crate, stop importing what WebAssembly computes exactly:
   `f64::sqrt` (IEEE correctly rounded, as `Math.sqrt`), `floor`, and `min`
   and `max` with two arguments (WebAssembly's `f64.min`/`f64.max` order -0
   below +0 and return NaN for NaN, as `Math.min`/`Math.max` do). Replace
   `Math.round` with the exact sequence `c = x.ceil(); if c - 0.5 > x { c - 1.0 } else { c }`,
   which keeps ties toward +∞, -0 for inputs in [-0.5, -0], and large and
   non-finite values. Keep `sin`, `cos`, `atan`, `sinh` and `pow` imported.
3. Update the ABI's import list, the wrapper's import check and the build
   receipts together.

## Validation

`npm run check:parity` must stay bit-identical (the 97 mesh cases, 172,908
coordinates, and the height-batch cases), plus a focused check of the
`round` sequence over edge values (±0.5, ±0.49999999999999994, ±2.5, ±0,
±2^52 and beyond, NaN, ±Infinity) against `Math.round` with `Object.is`.
Then the kernel bench and the paired `typescript-worker` against `single`
comparison the engine's WebAssembly notes describe.
