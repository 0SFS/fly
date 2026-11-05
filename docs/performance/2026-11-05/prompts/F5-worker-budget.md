# F5 — Worker budget on big.LITTLE phones (FOSS Earth)

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.
This prompt belongs to the agent that owns FOSS Earth.

**Goal:** on a phone with four fast and four slow cores, stop preparation
workers from competing with the main thread for the fast cores.

**Owns:** `~/gh/foss-earth/app/src/app/browserPolicy.ts`
(`terrainDecodeWorkersDefault`) and `~/gh/foss-earth/engine/src/settings/catalogue/wasm.ts`
(`wasm.workers`, `wasm.threads`).

## Evidence

An SD835 reports `hardwareConcurrency` 8. The defaults then give 7 elevation
decode workers (`threads - 1`) and a preparation-worker budget of 17
(`min(17, threads)` plus 9 for the default WebAssembly selection's sky,
imagery height, Google, ground and terrain mesh workers and shared-sky
helpers). During streaming bursts several of them run at once on 4 fast
cores, beside the main thread, the GPU process and the audio thread, and the
phone heats sooner. FOSS Earth's adaptive CPU scheduling proposal (backlog
C13) covers the general problem; this is the narrow phone default.

## Steps

1. A mobile default: when the user agent reports a mobile device (or
   `navigator.userAgentData.mobile`) and `hardwareConcurrency` is 8 or less,
   default decode workers to 2–3 and the total budget to what those and the
   dedicated workers need. Desktop defaults stay as they are; saved values
   are kept.
2. Measure on the phone, paired: main-thread frame interval (mean, p95,
   p99) while tiles stream, time until the view settles, and whether the
   phone throttles sooner. Keep the change only if frame time improves
   without a large loss in settle time; report both either way.
