# 09 — Fewer and cheaper F-35B draws

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** cut the F-35B's render CPU (2.2 ms on the M5 against the C172's
0.36 ms, about 22 ms a frame on an SD835) without changing the picture.

**Owns:** `~/gh/0sfs/aircraft/src/createAircraftModel.ts`,
`~/gh/0sfs/engines/src/engineNozzleRig.ts`, the F-35B and F135 asset
pipelines per `~/gh/0sfs/fly/docs/performance/2026-10-21/f35-model-lod.md`.
Coordinate with prompt 08 (`engineExhaustDepth.ts` also reads these meshes).

## Evidence

The airframe and installed F135 are 259 primitives and 349 nodes for about
25,000 triangles. The nozzle aperture is 7 flap roles × 16 identical
segments: 112 moving meshes. Babylon tests each part against the frustum
every frame.

## 1. Exact: optimistic-inclusion culling for aircraft parts

Set `mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_OPTIMISTIC_INCLUSION`
on the aircraft's parts. Babylon then reports a mesh visible as soon as its
bounding-sphere centre is inside the frustum, before the sphere and box tests
(`Culling/boundingInfo.js`, `isInFrustum`). The sphere's centre is the box's
centre, so the standard test would also report it visible: the culled set is
identical and most parts skip the box test. `createAircraftModel.ts` saves
and restores `alwaysSelectAsActiveMesh` during warm-up (around line 278);
leave that logic intact. Verify that the active-mesh list is identical frame
by frame over a recorded flight with chase, cockpit and orbit views.

## 2. Instanced nozzle flaps

Draw each flap role as one mesh with 16 thin instances whose matrices come
from the rig's existing transform nodes, keeping those nodes as the logical
attachment points. 112 draws become 7, in the colour pass and the exhaust's
depth pass. Check `engineExhaustDepth.ts`: it treats instanced meshes as
deformed and keeps them as candidates, which stays correct. Validate with the
F135 rig tests (aperture, bearings, vectoring), pose checks and image
comparisons at closed, open, vectored and STOVL positions.

## 3. The model specification

Merge static opaque parts that share material and motion group, and leave
the engine's interior parts out of exterior views, exactly as
`f35-model-lod.md` specifies, with its manifests, pose checks and visual
review. That is an asset task with its own acceptance; do it after 1 and 2.

## Measure

Draw calls and `render`, `render/draw`, `render/active meshes` in Debug →
Frame budget on the F-35B, interleaved, WebGL2 on the desktop, then on the
phone.
