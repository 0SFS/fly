# F1 — One raster update per flight frame (FOSS Earth)

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.
This prompt belongs to the agent that owns FOSS Earth.

**Goal:** let a sim host run one raster-tiles update per frame instead of
two, behind a setting that defaults to today's behaviour.

**Owns:** `~/gh/foss-earth/engine/src/babylon/createGlobeRuntime.ts` and the
engine's settings catalogue.

## Evidence

`prepareFrame` runs `rasterTilesRuntime?.update()` (line 747). During the
flight's simulation tick, `setExternalViewState` runs it again (line 2187),
reading the same camera, so a flight frame pays twice for publication,
loaded-detail refresh, feedback and a canvas-size read, plus a second
budgeted selection step. On 22 October, removing the second call measured
26.5–28 → 36–37 fps at 4× CPU, p95 50 → 33 ms, at the cost of a third less
imagery-selection time per second on a starved CPU
(`~/gh/0sfs/fly/docs/performance/2026-10-22/flight-frame.md`, "one raster
update per frame"). That note also measured a middle course: one update with
doubled selection, upload and rebuild budgets.

## Steps

1. Add a setting, for example `map.raster.updateFromSimView`, default true
   (two updates, today). When false, `setExternalViewState` updates only
   while the simulation is not running, so startup placement and relocation
   still load at once:

   ```ts
   simViewState = { ...current, ...partial };
   if (updateFromSimView || !simRunning) rasterTilesRuntime?.update();
   ```

2. Optionally a second setting that doubles the per-update budgets when the
   second update is off, as in the measured middle course.
3. Tests: with the setting off, one update per running frame and an
   immediate update while stopped; with it on, today's behaviour.

## Measure and decide

Paired runs at 1× and 4× CPU: frames per second, p95, raster update time,
imagery selection time per second, and how long detail takes to arrive after
a turn. The 0SFS phone profile will set it off if the user accepts the
slower detail arrival.
