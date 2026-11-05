# Implementation prompts — phone performance, 5 November 2026

One prompt per independent piece of work from the
[Snapdragon 835 audit](../README.md). Give an agent the common brief below and
one prompt file. Run them in number order where they depend on each other;
F1–F5 belong to the agent that owns FOSS Earth.

| # | Prompt | Repositories | Effort | Expected effect on an SD835 (estimate) | Output |
| --- | --- | --- | --- | --- | --- |
| 01 | [Profile a real phone](01-device-baseline.md) | fly (report only) | Hours | Replaces every estimate here with a measurement | — |
| 02 | [Phone profile](02-phone-profile.md) | fly | Days | Pixels ÷4, F-35B physics ÷4, exhaust work ÷3–4 | Settings only, offered not forced |
| 03 | [Attitude indicator](03-attitude-indicator.md) | fly | Days | 3.5 ms → about 2.3 ms a frame exact; about 0.4 ms of main thread with a WebGL2 shader | Exact first; shader path visually equivalent |
| 04 | [JSBSim property traffic](04-jsbsim-property-io.md) | controls, ground-contact, engines, fly, aircraft, jsbsim | Days to weeks | 0.3–1 ms per physics step | Exact |
| 05 | [JSBSim build](05-jsbsim-build.md) | jsbsim, fly deps | Days | 12–14% of a C172 step, 4% of an F-35B step, 25–45% of each scalar call | Exact |
| 06 | [F135 plant cost](06-f135-plant.md) | jsbsim | Weeks | Up to about 1.3–2.6 ms per F-35B step | Exact where possible; else a setting |
| 07 | [Exhaust, GPU](07-exhaust-gpu.md) | exhaust, fly | Weeks | Plume fragments ÷4–7 | Settings judged by error against a reference |
| 08 | [Exhaust, CPU](08-exhaust-cpu.md) | exhaust, fly | Weeks | Most of 5–9 ms a frame | Exact depth pre-test; worker per its spec |
| 09 | [F-35B draws](09-f35b-draws.md) | engines, aircraft, F-35B, F135 | Weeks | A large share of 22 ms of draw CPU | Exact culling; instancing and merging validated by images |
| 10 | [Wire ground-contact Rust](10-ground-contact-core.md) | fly, ground-contact | Hours | Small | Exact (parity-checked kernels) |
| 11 | [HUD compositing](11-hud-compositing.md) | fly | Hours | Unmeasured compositor work | Visual change for approval |
| 12 | [Frame-locked steps](12-fixed-step-phase.md) | fly | Days | p99 frames on the F-35B | A setting, default off |
| 13 | [Draw order and the cockpit view](13-draw-order-cockpit.md) | fly (scene order agreed with FOSS Earth) | Days | Hidden map pixels not shaded, most in the cockpit view | Identical images except coplanar ties, checked |
| F1 | [One raster update per frame](F1-single-raster-update.md) | foss-earth/engine | Hours | About 33% more frames at 4× CPU (measured 22 Oct) | A setting, default today's |
| F2 | [Terrain core Math imports](F2-terrain-wasm-math.md) | foss-earth/engine | Hours | Worker throughput; 2.5–3.7× per bound call | Exact |
| F3 | [Imagery off the main thread](F3-imagery-main-thread.md) | foss-earth/engine | Weeks | Most of the map's 27.5 ms | Design first |
| F4 | [Phone rendering](F4-phone-rendering.md) | foss-earth/renderer, engine, sky | Days | Dynamic resolution that works on phones; even 30 fps; one forced layout less per frame | Settings, default today's |
| F5 | [Worker budget on phones](F5-worker-budget.md) | foss-earth/app, engine | Days | Less contention for 4 fast cores | Default change for mobile, measured |

## Common brief — applies to every prompt

**Read first:** `~/gh/0sfs/.github/AGENTS.md` and its linked
`agent-reference.md` sections on Checks and Contributions, the target
repository's `AGENTS.md`, and `~/gh/0sfs/fly/docs/performance/2026-11-05/README.md`.
Inspect `git status` in every repository you touch and preserve work you did
not make.

**Organization rules that decide how you work** (the `AGENTS.md` file is the
authority; this is a reminder):

- Never add AI author, committer or co-author attribution, and add nothing to
  a commit message beyond one plain sentence describing the change.
- Never push, tag or deploy unless the user explicitly asks for that push.
  Finish with the exact push command and wait.
- Scratch files, logs, profiles and screenshots go in the target repository's
  ignored `build/`.
- Numeric kernels in Rust/WebAssembly are twins of a TypeScript reference in
  the same package (`<package>/wasm/`), admitted only after matching it.
- Keep laptop checks short: the maintainer's laptop is a fanless M5. Write a
  hand-off with commands and expected duration for anything longer than a
  few minutes. On a VM without a GPU, compare only paired differences, never
  absolute frame times.
- New UI goes in the app's tabbed interface; no overlays or top bars unless
  the user asks.

**Exactness:** prefer changes whose output is identical: the same numbers
(`Object.is`), the same images, the same callback and publication order.
Prove it with a differential test against the old code and a mutant that the
test catches. A change that alters output (a different quadrature, cadence or
threshold) goes behind a setting whose default keeps today's behaviour; the
phone profile ([02](02-phone-profile.md)) may choose another value once its
error is measured and the user accepts it. Never update a golden digest or an
expectation to make a change pass.

**Measuring:** interleave old and new runs under the same workload and report
an A/A control for noise. Record machine, browser, backend, viewport and DPR,
aircraft, physics rate, settings and thermal state. In the app use
`?flightPerf=1` and Debug → Frame budget; for kernels use
`~/gh/0sfs/fly/docs/performance/2026-11-05/harness/`. A phone figure is a
measurement only if it came from a phone ([01](01-device-baseline.md));
otherwise label it an estimate.

**Reporting:** write your results to
`<target-repo>/docs/performance/<YYYY-MM-DD>/<scope>.md`: baseline commits,
hypothesis, what changed, exactness evidence, paired measurements and noise,
and the decisions left for the user. Do not edit the audit or these prompts;
they are a dated record.

**Commits:** stage explicit paths only (`git commit -m "..." -- <paths>`).
fly commits go to `main`. Several prompts touch the same files
(`fly/src/flight/createFlightSimApp.ts` in 02, 04, 10 and 12; the exhaust in
07 and 08): check who else is working before you edit, and never run two
prompts on one file at once. 0SFS prompts do not edit `~/gh/foss-earth/`; F1–F5
do not edit 0SFS repositories.
