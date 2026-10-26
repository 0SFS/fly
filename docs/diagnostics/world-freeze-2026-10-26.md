# World freeze reported on 26 October 2026

The supplied report was captured at 19:11:02 UTC in Firefox 158 on macOS,
using WebGPU and the 25 October build `3cae916ac7c5-dirty`. The world and
aircraft froze while the attitude indicator continued working.

The strongest recorded lead is a WebGPU queue submission validation error at
25.7 seconds, Babylon frame 945. Its draw referenced a buffer labelled
`4699-engine-exhaust-sce…`. The exhaust's point light is named
`engine-exhaust-scene-light`, so its uniform buffer is a candidate. The report
truncated the warning at 300 characters before WebGPU's actual reason.
It does not establish whether the buffer was destroyed, bound incorrectly or
rejected for another reason. There was no recorded context loss or unhandled
JavaScript error.

The saved Google basemap preference was not the active map: this visit logged
that no API key was available and loaded USGS imagery instead. Its imagery
budget warning explains reduced tile detail, not an established render freeze.
`Scene: none` means no scene manifest; it does not mean the Babylon scene was
missing. Null frame observations in compute scheduling were disabled
observations, not proof of a stopped renderer. The pause at 34.7 seconds was
recorded after the GPU warning and must not be assumed to have caused it.

The startup diagnostic snapshot stopped at readiness, about 2.4 seconds after
navigation. It cannot locate a later failure. The current report lacks frame
ages and the native error's complete cause. Rendering behavior is therefore
unchanged pending a capture with the new diagnostics described in
[bug reporting](../bug-reporting.md).

An isolated Chrome WebGPU scene was checked with a PBR scenery mesh and an
exhaust-named point light. Disposing the light and disabling it each produced
zero validation errors over the short check. This does not reproduce or rule
out the reported Firefox flight failure. No fix is claimed from that check.

For the next capture, use the same Firefox and ordinary flight settings. Save
the full report before reloading. Compare `Render health.gpu.errors` with its
frame counts/ages and `Flight progress`. GPU errors alongside advancing CPU
frames identify rejected GPU work; old frame ages identify a stopped CPU loop.
Inspect the full error before changing resource lifetime, shader binding or
renderer recovery behavior.

The native error capture was also checked in Chrome using a deliberately
destroyed test buffer and a label longer than the old activity-line limit.
The observer retained the complete native validation reason and label. This
checks the logging path; the induced error is separate from the flight failure.

## Local changes and source pushes

The changes are in `foss-earth/renderer` (frame and native GPU observations),
`foss-earth/ui` (bounded full console records), `foss-earth/app` (report and
persistent-trail integration), and `0SFS/fly` (flight progress and documentation).
Rendering behavior is unchanged. Each observer is removed on replacement or
destruction, including rebinding the GPU listener after device restoration.

All four repositories use `main` and their own GitHub `origin`. No source was
committed or pushed. The app and flight repositories already contained unrelated
changes; review and commit only this task's changes before using these source
push commands. They do not deploy the website:

```sh
git -C ~/gh/foss-earth/renderer push origin main
git -C ~/gh/foss-earth/ui push origin main
git -C ~/gh/foss-earth/app push origin main
git -C ~/gh/0sfs/fly push origin main
```
