# F4 — Rendering controls that work on phones (FOSS Earth)

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.
This prompt belongs to the agent that owns FOSS Earth.

**Goal:** dynamic resolution and frame pacing that work on Android WebGL2,
and no blocking GPU readback in a frame. Defaults stay as they are; the 0SFS
phone profile chooses values.

**Owns:** `~/gh/foss-earth/renderer/src/dynamicResolution.ts`,
`renderer/src/babylon/rendererLifecycle.ts`, `renderer/src/renderScheduler.ts`,
the engine's world viewport (`worldViewport.apply()` in
`engine/src/babylon/createGlobeRuntime.ts`), and
`~/gh/foss-earth/sky/src/babylon/createSunLensFlare.ts`.

## Evidence

- `syncGovernor` releases the dynamic-resolution governor whenever
  `canTimeGpuFrames` is false. web3dsurvey reports the WebGL2 timer
  extension on about 0.2–0.4% of Android devices, so on these phones dynamic
  resolution never runs.
- A frame that misses vsync waits for the next one, so a device that cannot
  hold 60 fps shows an uneven mix of 16.7 and 33.3 ms frames.
- The lens flare reads its visibility with `Texture.readPixels`, which on
  WebGL is a blocking `gl.readPixels` (Babylon's `_readTexturePixelsSync`),
  once per pending frame while the flare is on (off by default). The
  ground-light probe already uses the asynchronous `_readPixelsAsync` path.
- `prepareFrame` starts with `worldViewport.apply()`, whose canvas-size read
  forces style and layout when anything is pending: 15.6–16.2 ms/s at 1× on
  the M5 on 22 October, about half of it from the spinning activity outline.
  Caching the size was rejected then because a resize would show one frame
  late.

## Steps

1. **A governor without GPU timers.** When `canTimeGpuFrames` is false, steer
   the scale from the frame interval and the main thread's time per frame
   (`lastCpuMs` is already there): over budget with the main thread well
   under it means the GPU or compositor is the limit, so lower the scale;
   raise it slowly when frames run well under budget. Account for vsync
   quantization (intervals arrive near 16.7 or 33.3 ms), add hysteresis and a
   dwell time, and ignore hidden, resizing and loading frames. Report which
   signal the governor uses.
2. **Even pacing.** A setting that, when the p95 frame interval stays above
   the 60 fps budget for some seconds, caps presentation at exactly half the
   display rate (every second vsync, not a timer), and returns to the full
   rate when frames have room. Check that the existing frame cap skips whole
   vsyncs.
3. **Asynchronous flare readback** on WebGL2, reusing the ground probe's
   path, keeping the flare's one-frame semantics.
4. **Canvas size without a forced layout**, a setting, default today's: take
   the size from a `ResizeObserver` (`devicePixelContentBoxSize` where
   supported) instead of reading it each frame. A resize then shows one frame
   late, which a phone rarely does. Measure forced layouts per frame and
   `applyWorldViewport` time.
5. **Measure the sky's GPU share** on the phone. The "Save battery" preset's
   coarser dome is already a lever; record what it saves.

## Validation

Unit tests of the governor and pacing controllers on recorded interval
traces (steady, GPU-bound, CPU-bound, thermal decline), then a phone run
(0SFS prompt 01's method) with the controls off and on.
