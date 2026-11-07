# Aircraft switch failure reported on 6 November 2026

The report was captured at 00:05:31 UTC on 6 November (the evening of 5 November,
local time) in Firefox 159 on macOS, using WebGPU and the 1 November build
`db0f134d9751-dirty` (bundle `index-H5H6XKry.js`). The pilot had crashed an
F-35B, then tried to switch to the DJI Air 2S, and the switch did not work. The
report was made from the next visit, after a reload.

## What the report shows

Three visits are involved.

- **Visit A** ended without being closed. The report keeps only its last step,
  12 s or more after it opened: "terrain: Terrain height available again;
  physics resuming."
- **Visit B** opened at 00:04:45.910 UTC. It resumed the F-35B flight saved at
  1:44:20 PM, paused. Terrain was established at 7.8 s. At 22.3 s the aircraft
  setting (id and generation) changed to DJI Air 2S. Nothing more was recorded,
  and the visit ended without being closed.
- **Visit C**, the report's own visit, resumed "the flight saved 11/5/2026,
  6:05:08 PM, paused" in the F-35B, with `osfs.aircraft.id` = F-35B saved on
  this device. Its trail has no aircraft setting change.

6:05:08 PM local is 00:05:08 UTC, 22.3 s after visit B opened. The flight was
saved at the moment of the switch, with the F-35B.

## What follows from it

1. **The switch got as far as taking down the F-35B session.** Visit C started
   with the F-35B saved, so the switch's failure handling set the choice back.
   Every setting change is recorded, but this one was not, so the visit's
   record had already stopped. In this build the only thing that stopped it
   mid-visit was the F-35B session's `destroy()`, which shut down the page's
   diagnostics along with the session, unconditionally. `destroy(true)` had
   therefore run at least that far.
2. **No Air 2S session started its diagnostics.** In this build a switched
   session opened its own visit record as one of its first steps. That record
   would have been the most recent unclosed one, and visit C would have
   reported it as the visit before instead of visit B. Visit C reported visit
   B. The only code that runs before that step sets boot marks and reads or
   registers settings.
3. **The most likely failure is an exception in the rest of the F-35B
   teardown.** That means one of the roughly 35 disposals that run after the
   diagnostics shut down: map panels, instruments, audio, aircraft visuals, the
   floating origin, or JSBSim. It could also be the diagnostics' own cleanup,
   which can throw an `AggregateError` after its record has stopped. It is
   specific to Firefox, or to this flight's state, since the same switch works
   in Chrome. The less likely alternative is that the Air 2S session failed in
   its first lines. The report cannot name the call: nothing was being recorded
   by then.
4. **What the pilot saw.** On that path the switch's failure handling called
   `finishSwitch()` on the half-taken-down F-35B session. A unit test with one
   failing teardown step shows that this call throws ("Cannot update an
   unmounted root") and escapes the handler. The "Switching aircraft" screen
   stays up, the controls are gone, and no failure report is shown or kept.
   That matches "it would not work".
5. Visit B was never marked closed because its close-on-pagehide listener
   belonged to the diagnostics that the teardown shut down. This report does
   not explain visit A's unclosed ending.

## Reproduction attempts

Headless Chrome was run against an exact copy of the deployed build. An ordinary
F-35B → Air 2S switch succeeded, and so did a switch from a flight started
inside terrain (5 m above ground, pitched −60°). Logpoints in the switch's
failure paths printed nothing. Headless Firefox on the development machine is
killed about 30 s after launch, even on `about:blank`, so the Firefox path could
not be exercised. A search of the teardown code for browser APIs that Firefox
lacks found only gamepad rumble, which is already guarded.

## Gaps in the report

1. A session's `destroy()` shut down the page's diagnostics. Nothing after it
   was recorded: the rest of the teardown, the switch's error, the rollback, or
   the new session. The visit could not be marked closed either.
2. A switched session opened a second visit record. Its previous-visit lookup
   would have found the page's own live record, deleted it after 400 ms, and
   printed a false "The last visit stopped without being closed". The
   Diagnostics panel's previous visit would then have been the page itself.
3. Switch stages and failures were neither recorded nor checkpointed. A failure
   report shown on screen was lost on reload.
4. A drone switch without the drone's mod left the switching screen up and the
   drone saved as the aircraft choice.
5. A session's report lines (Aircraft, Flight, Ground contacts, JSBSim and the
   rest) were never removed. With shared diagnostics they would have described
   a destroyed aircraft.
6. After any switch, the `main.tsx` loading screen's report would have failed
   with "Diagnostics is disposed".

## Changes

In `src/flight/createFlightSimApp.ts`:

- `createFlightSimApp` owns one diagnostics for the page and gives it to every
  session. That is the one `main.tsx` passes in, or one it creates itself. A
  session destroys diagnostics only if it created them, and removes its report
  lines when it is destroyed.
- The switch records its stages in the activity trail:
  "Aircraft switch f-35b → dji-air2s: started", "…: physics ready; taking down
  the f-35b session" and "…: done". A failure records the stage, the error and
  its first stack frames, including an `AggregateError`'s causes, and saves
  them as the `aircraft-switch.txt` startup checkpoint. The failure report names
  the stage.
- A switch whose old session stopped partway through its teardown is recovered
  the same way as a failure after replacement: the previous aircraft is rebuilt,
  paused, and the failure report is shown.
- The missing-mod drone path puts the previous aircraft choice back and hides
  the switching screen.

FOSS Earth's `addState` already returns a remover, although its `AppDiagnostics`
type says `void`; the session checks for it at run time.

Three new tests in `createFlightSimApp.test.ts` cover these cases: one visit
record across a switch, a failing teardown recorded and recovered, and the
missing-mod drone path. Each fails on the previous code. The 133 tests in the
flight app's five related test files pass. They were run with a temporary alias
for `@0sfs/space`, which in-progress space work imports but which is not yet
installed in `node_modules`.

## Next capture

With these changes deployed, or running locally, switch from an F-35B to the
Air 2S in Firefox as before. If it fails, make the bug report: from the same
visit if the page still responds, otherwise after reloading. The activity trail
then shows "Aircraft switch … failed while <stage>: <error>" and "Aircraft
switch stack" lines naming the failing call. Fix that call; do not change the
teardown order before then.
