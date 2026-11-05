# 01 — Profile a real Snapdragon 835-class phone

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** the first measured numbers on the target device, so every later
prompt can be judged against them instead of the audit's 10× estimates.

**Who:** a person with the phone, or an agent with ADB and Chrome remote
debugging to one. This prompt changes no source.

## Device and setup

- A Snapdragon 835 phone (Galaxy S8, Pixel 2, OnePlus 5 or similar), or a
  phone of similar single-core speed (Geekbench 6 single-core near 400–450).
  Record the model, Android and Chrome versions, the screen in CSS pixels and
  its device-pixel ratio, and whether it is charging.
- Open `chrome://gpu` on the phone and save it: the WebGL renderer string
  (Adreno 540 expected), whether WebGPU is available, and whether
  `EXT_disjoint_timer_query_webgl2` and `KHR_parallel_shader_compile` are
  listed.
- Serve the flight from the maintainer's machine with `npm run dev` (HTTPS on
  the network address; accept the certificate once) or use the deployed site.
  A plain `http://` network address is not a secure page and is not a valid
  test.

## Scenarios

For each one: let it run 5 minutes so the phone reaches its warm clock speed,
then capture 60 seconds.

1. C172 at the default spawn, cruise, chase view, map streaming as usual.
2. The same, after streaming has settled (hover in place until Debug → Frame
   budget shows no imagery or terrain work).
3. F-35B, cruise, chase view.
4. C172 in the cockpit view.

Open `/fly/?flightPerf=1`. Settings can be applied for one load with
`?set.<setting>=<value>`, for example `?set.renderer.resolutionScale=0.5`;
confirm in the Settings tab that each one took effect, and set any that did
not by hand.

## What to capture

- Debug → Frame budget: copy the summary (mean, p50, p95, p99 frame interval
  and every section) at the end of each window.
- `window.osfsFlightPerformance.snapshot()` from the remote DevTools console.
- One 10-second DevTools Performance recording per scenario, for main-thread
  work outside the named sections (style, layout, garbage collection, worker
  messages). Traced runs are slower; compare traced with traced only.
- GPU time if the timer extension exists; otherwise record that it does not.

Then repeat scenarios 1 and 3 with the audit's phone values applied through
URL settings (resolution scale 0.5, antialias off, exhaust samples 10, exhaust
depth scale 0.5, `osfs.engine.model=empirical` for the F-35B), interleaving
default and phone runs.

## Report

`~/gh/0sfs/fly/docs/performance/<date>/device-baseline-<device>.md` with one
table per scenario: frame interval mean/p95/p99, the top sections, GPU time
or its absence, and the phone-values comparison. Note thermal throttling: a
second warm run that is slower than the first is a result, not noise. No
source changes, no push. Stop the dev server afterwards.
