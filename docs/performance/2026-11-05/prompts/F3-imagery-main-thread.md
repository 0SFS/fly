# F3 — Imagery selection off the main thread (FOSS Earth)

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.
This prompt belongs to the agent that owns FOSS Earth. It is a design task
first: write the proposal, then build the measured prototype.

**Goal:** most of the map's main-thread time during a streaming flight,
about 27.5 ms a frame on an SD835 (estimate), leaves the page or is not
repeated.

**Owns:** `~/gh/foss-earth/engine/src/terrain/imagery/` (selector, binding,
residency, geometry), `src/babylon/imagery/createImageryRuntime.ts`, and a
proposal in `~/gh/foss-earth/docs/docs/proposals/`.

## Evidence

On 22 October the imagery selector was the largest self time on the
flight's main thread (53 ms/s at 1× on the M5), with binding 28, runtime 18
and residency 9.6 ms/s. Selection is a budgeted quadtree traversal that
restarts at most every 100 ms while the view moves, with a 2 ms budget per
update and two updates per flight frame (F1). The loaded-detail refresh and
distribution measure the view again (backlog C12).

## Directions, cheapest first

1. **Cadence on slow devices.** A setting to measure loaded detail at the
   selector's cadence instead of every publish (C12), default today's.
2. **Start from the previous cut.** The camera moves a little per frame, so
   most nodes keep their level. A split/merge traversal that starts from the
   last plan and revisits only nodes whose footprint can have crossed a
   threshold does O(changes) work instead of O(nodes). A conservative bound
   decides which nodes can change: a node's projected footprint scales with
   the inverse of its distance, so after the eye moves by Δ, a node at
   distance d changes by a factor within [d/(d+Δ), d/(d−Δ)], before
   rotation and clipping effects, which need their own bound. Budgets and
   page limits make the plan depend on the global order of nodes, so state
   exactly when the incremental plan equals the full one, and keep the full
   traversal as the reference the identity digests check.
3. **Selection in a worker.** The selector reads the view, surface heights
   and residency. On an isolated page the heights can be shared through
   `SharedArrayBuffer` (already used for decoded heights). A worker plan one
   frame old changes when detail appears, so it is a setting, default off,
   with a Rust core admitted against the TypeScript reference as the other
   cores are.

## Deliverable

The proposal with the exactness argument for each direction, then a
prototype of the chosen one measured with interleaved flight runs at 1× and
4× CPU: main-thread time, frames per second, and time for detail to arrive.
