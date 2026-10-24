# World view froze while the attitude indicator kept updating

Recorded from the user's report in the 2026-10-23 session (America/Chicago).
The incident's exact time, duration and build revision were not captured. This is
an investigation handoff; the user requested a record for another agent, not a
fix during the sound work.

## Observed behavior and unknowns

The user reported: “world 3d rendering froze but attitude indicator kept working,
eventually crashed and got ground collision popup”. Treat the crash as the
reported aircraft/ground-collision outcome; a browser or process crash was not
established. The user flagged a possible relationship to the ongoing sound work
and considers this a real bug. No cause or relationship to sound has been proven.

The surrounding sound discussion concerned C172, so that aircraft is plausible,
but the aircraft used during the freeze is **unconfirmed**. Renderer/backend,
camera mode, device/browser, starting position, audio state, preceding actions,
reproducibility and whether the camera or only its presentation stopped are also
unknown. No screenshot, console trace or feedback bundle accompanied the report.
An updating attitude indicator and later collision are evidence to investigate
separate progress of flight/UI and world presentation; they do not prove which
loop stalled or that every simulation/UI update continued normally.

## Local ownership and entry points

- `fly/src/flight/createFlightSimApp.ts`: `runtime.setSimTick`,
  `physicsLoop.update`, `runtime.setSimViewState`, `floatingOrigin.apply`,
  `applyChaseFrame`, HUD/instrument updates, `updateStatusOverlay`, and existing
  `flight/*` frame-profile sections. Follow the imports for the physics loop and
  camera owners rather than assuming Babylon owns every tick.
- `fly/src/flight/hud/flightHud.ts`, `attitudeRenderer.ts`,
  `cameraAttitudeView.ts`, and `FlightStatusOverlay.tsx`: instrument drawing,
  camera-versus-aircraft attitude source, and the reported collision/fault UI.
- `ground-contact/src/visibleMeshCollision.ts`: visible-world contact path;
  follow the actual fault message to its origin before changing collision logic.
- `foss-earth/renderer/src/borrowedFrameClosure.ts` and
  `babylon/rendererLifecycle.ts`: preparation/render/completion, frame-error
  handling, scheduler stop, device loss/restoration and visibility pause.
  `foss-earth/app/src/app/browserRuntime.ts` binds the browser host; trace the
  active scheduler from these owners. World presentation defects belong in FOSS
  Earth; flight camera/physics/HUD integration belongs in 0SFS.

## Next-agent checks

1. Capture the running build/component revisions and reproduce only if the user
   can provide a sequence. Compare advancing simulation time/position, HUD draw
   calls, flight-tick entry, camera pose/view/projection matrices, Babylon frame
   entry/completion and actual canvas presentation. Determine whether the world
   canvas froze, camera state stopped, or a view/projection became invalid while
   flight state continued changing. Check the selected attitude-view source.
2. Inspect retained errors and frame-error paths, including exceptions during
   preparation, scene render and end-frame, WebGL context loss or WebGPU device
   loss, restoration, visibility/page lifecycle, render-request scheduling and
   paused/active transitions. Confirm which path still advances physics after a
   presentation failure; do not infer the answer from the popup alone.
3. Investigate the possible sound interaction with a bounded local comparison:
   audio enabled versus disabled, and the relevant pre-change sound code versus
   current local sound changes, while holding aircraft, renderer, route and
   camera settings constant. Record audio loading/hold/fault state alongside the
   first world-presentation failure. Correlation or a single successful run does
   not establish or exclude a sound regression.
4. Read [bug reporting](../../bug-reporting.md). Download the existing Bug report
   from the tab strip's **+** while the problem remains open. After a reload,
   `/fly/?report` can recover the retained previous-visit trail without starting
   the renderer. Preserve the first exception, renderer/backend, aircraft,
   camera mode, pause/loading/physics-fault state and collision message.
   Flight's existing Test feedback providers are `diagnostics` and `flight`
   (`createFlightSimApp.ts`); use a short checklist and timestamped Save note at
   the freeze, then download the feedback JSON. Shared guidance is
   `foss-earth/docs/docs/test-feedback.md`. Avoid a prolonged performance run
   before the failure mode is established.

No runtime code was changed and no reproduction or performance run was attempted
for this handoff. Keep any later fix local for user testing; do not publish or
push without the user's specific request.
