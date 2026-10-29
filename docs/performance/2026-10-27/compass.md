# Shipped: compass refresh skips a clean camera chain

`createFlightCompass` forced `computeWorldMatrix(true)` on every camera parent, then `getViewMatrix(true)`, on every update. A forced world matrix recomputes the node even when it is already current, and the chase frame often refreshed that chain in the same render. The update now walks parents root-first and forces a parent only when `!isSynchronized()`. It forces the camera view only when `_isSynchronizedViewMatrix()` is false, so an unsynchronized projection does not rebuild the view.

The eye samples are unchanged. After an aircraft move, including a cockpit-style chain (camera, mount, aircraft), the ECEF eye matches the previous forced refresh. The following update on that clean chain calls neither `computeWorldMatrix` nor `getViewMatrix`. A dirty aircraft still refreshes: one parent does one world-matrix update and one view update; two parents still do three world-matrix updates, because forcing the child recomputes its parent, and one view update. Those dirty counts match the old path.

Scratch bench, two runs, `nice -n 19`, 8 interleaved passes of 200,000 clean updates. Medians:

| Chain | Forced | Guarded | Saved | Unchanged pair gap |
| --- | ---: | ---: | ---: | ---: |
| 1 parent (chase) | 197–209 ns | 47–49 ns | 76% | 1.0–5.8% |
| 2 parents (cockpit) | 282–315 ns | 72–86 ns | 73–74% | 1.0–4.6% |

Clean guarded updates made 0 forced calls per 1,000. The forced path made 1,000 world + 1,000 view calls with one parent, and 3,000 world + 1,000 view calls with two. Moved poses matched to `1e-9`. The savings sit well above the unchanged-path gap.

Vitest: `src/flight/hud/flightCompass.test.ts`, 2 passed. ESLint on the two source files reported nothing.
