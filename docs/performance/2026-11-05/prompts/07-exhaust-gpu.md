# 07 — Cheaper exhaust plume on the GPU

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** fewer plume fragment evaluations on a phone GPU, with an image no
worse than today's default.

**Owns:** `~/gh/0sfs/exhaust/src/createEngineExhaust.ts` (its GLSL and WGSL
shaders), `exhaust/src/engineGasSupportShader.ts`, and fly settings for any new
option (`~/gh/0sfs/fly/src/flight/settings/flightParameters.ts`).

## What the shader does

The plume is a box proxy ray-marched per pixel. Every ray takes
`osfs.exhaust.sampleCount` samples (default 32) over its span inside the box,
whatever that span is. On the flow-support path each sample calls
`gasCoordinates` before learning whether it is inside the gas. Rays through
the box's empty corners run the full loop (an estimated 20–30% of covered
pixels). There is no early exit. The material disables depth writes, but the
shader writes `gl_FragDepthEXT` for the depth test, and on Adreno 5xx and
later a fragment-depth write turns off low-resolution Z culling.

## Changes, in order of certainty

1. **No depth write while depth occlusion is active.** With
   `osfs.exhaust.depthOcclusionEnabled` on and its depth map ready, rays are
   already clipped against opaque depth and fully hidden fragments discard.
   The box's rasterized depth test rejects only fragments the shader would
   discard, so a shader variant without the depth write should draw the same
   image. Prove it with image comparisons on WebGL2 and WebGPU; boundary
   pixels may differ through depth precision.
2. **Clip each ray to the plume's envelope** instead of the box, with a
   conservative envelope for both field paths (the radial-fraction cone of
   the profile path, a bound of the gas supports on the flow path), and
   discard rays that miss it before the loop.
3. **Samples proportional to the span through the envelope**, between a
   minimum and today's maximum, so short chords are not sampled as finely as
   the longest.
4. **Half-resolution plume** in its own target with a depth-aware upsample.

Items 2–4 change the quadrature, so each goes behind a setting whose default
is today's behaviour. Later, if the GPU time still matters: `mediump` for the
plume's colour accumulation (Adreno 5xx runs half precision at twice the
rate), judged by the same error metric.

## Acceptance

Build a fixed set of views (side, rear, three-quarter, cockpit; dry,
afterburner, STOVL) and render a 128-sample, full-resolution reference for
each. Measure each variant's error against it (for example mean and 99th
percentile of relative radiance error, and the alpha error). A variant passes
only if its error is no worse than today's 32-sample default. Measure GPU
time with WebGPU timestamps on the desktop (paired), and frame time on the
phone (prompt 01's method).
