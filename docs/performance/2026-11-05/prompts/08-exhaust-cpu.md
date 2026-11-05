# 08 — Exhaust main-thread work

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** take most of the exhaust's 33–55 ms per second of M5 main thread
(5–9 ms a frame on an SD835, F-35B only) off the frame, exactly.

**Owns:** `~/gh/0sfs/exhaust/src/engineExhaustDepth.ts`,
`exhaust/src/engineGasOptics.ts`, its integration in
`exhaust/src/createEngineExhaust.ts`, and a new `exhaust/wasm/` twin.

## 1. Exact pre-test for depth candidates (start here)

`pendingNow()` walks every mesh in the scene (terrain and Google tiles
included) and projects all eight corners of each world bounding box against
the plume's screen rectangle, retaining any mesh with a corner behind the
camera. Put a cheaper test in front of it: the mesh's world bounding sphere
against the plume's sub-frustum, whose side planes come from the plume's
projected rectangle expanded by the same two-texel margin, plus the depth
test against the plume's farthest point. Reject a mesh early only when its
sphere lies wholly in front of the near plane (`w > 1e-6` for the whole
sphere) and wholly outside one side plane or behind the plume. Every mesh
the pre-test rejects is then one the corner test rejects, so the candidate
list must stay identical in content and order.

Prove it with a differential test over random and recorded scenes (meshes
crossing the near plane, at the margin, behind the plume, orthographic
cameras) comparing candidate lists with the old code, and a mutant without
the near-plane rule that the test catches. Before reading a sphere, bring the
mesh's world matrix up to date exactly as `projectedBounds` does
(`refreshChangedWorldMatrix` or `computeWorldMatrix`), or the pre-test reads
a stale sphere. The projection part cost 7.8–14.6 ms/s on the M5 on
22 October.

## 2. The gas optics in Rust, in a worker

Follow the existing specification,
`~/gh/0sfs/fly/docs/performance/2026-10-21/exhaust-wasm-worker.md`: a Rust
twin of `engineGasOptics.ts` in `exhaust/wasm/`, admitted only after
bit-identical parity, measured synchronously first, moved to a worker only
when its whole cost beats the synchronous path. The field changes slowly, so
a field one frame old is a candidate for a setting, default off.

## 3. Optional, a setting: field cadence

Recompute the gas field at most every N ms and blend the two latest fields in
the shader. Not exact; default every frame; the phone profile may choose
otherwise after a visual review.

## Measure

The exhaust sections and `render targets` in Debug → Frame budget on the
F-35B, interleaved, at 1× and 4× CPU throttle on the desktop, then on the
phone.
