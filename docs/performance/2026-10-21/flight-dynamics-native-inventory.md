# Flight dynamics: native SDK readers and writers

Step 1 of [flight-dynamics-worker.md](flight-dynamics-worker.md). This lists
every place the live flight reads or writes the JSBSim SDK. It is grouped by
when the access runs, because that decides what a dynamics worker would have to
carry across the boundary and how often. Source as of 2026-10-21, including the
uncommitted aircraft-switch work in `createFlightSimApp.ts`. Paths are relative
to the `0sfs/` workspace.

`createFlightSimApp.ts` uses `jsbsim.sdk` 74 times. The SDK reaches 25 further
modules typed against `JSBSimSdk`, plus several that accept a structural reader
(`getPropertyValue`, catalogue queries). No presentation module keeps a native
property node or WASM heap view between frames. The native batches
(`createPropertyBatch`) live inside `ecefBridge`, `safeFlightState`,
`jsbsimAudioAdapter`, `createAircraftEngineVisuals` and `aircraftForces`, and
are released before `sdk.destroy()`.

## Per attempted fixed step (120 Hz, up to six per frame)

Order inside `physicsLoop.update` → `applyInputs` →
`fly/src/flight/physics/fixedStepLoop.ts`. Everything here runs against the
exact pre-step state, so it must stay in one ordered transaction.

| Order | Consumer | Native access | Main-thread dependency |
| --- | --- | --- | --- |
| 1 | `terrainContact.update` (`ground-contact/src/terrainContact.ts`) | 9 reads, 2 writes (`position/terrain-elevation-asl-ft`, placement); may `captureSimulation`/`restoreSimulation` for a correction | `SurfaceQuery.sample` at the exact current lat/lon, and at the previous anchor when the hit's revision changed |
| 2 | `visibleMeshCollision.update` (`ground-contact/src/visibleMeshCollision.ts`) | `readFlightState`, 3 reads; restore with bounced velocity on impact | `sample` for support, then one `raycast` per body probe from the previous to the current state when low |
| 3 | `phoneSession.beforeStep(controls)` (`rc/src/createPhoneControlSession.ts`) | none | Phone lease, freshness and ownership; must follow 1–2 |
| 4 | `controlBlend.step`, pilot-out, flap revision tracking | none | Input manager state |
| 5 | `syncArbiter` → `readArbiterFlight` (`createFlightSimApp.ts`) | 3 WOW reads, 7 attitude/rate/airspeed reads; benchmark route reads `readFlightState` | Autopilot arbiter state, route targets |
| 6 | `engineControl.step` (`engines/src/engineControl.ts`) | 2 reads, up to 4 writes (starter, cutoff, throttle hold); catalogue checks at creation | Starter hold from local or phone |
| 7 | Auto trims, control-law and pusher reads (`createFlightSimApp.ts`) | up to 10 reads: `aero/qbar-psf`, `velocities/vt-fps`, control-law enabled, `fcs/pusher-cmd-norm`, `accelerations/qdot`, `q`, `pdot`, `p`, `velocities/vc-kts` | Trim state, input manager trim replacement |
| 8 | `applyFlightControls` (`controls/src/applyFlightControls.ts`) | 15 writes (surfaces, throttle, mixture, gear, flaps, trims, STOVL, control law, native auto flaps, full-stick roll rate) | none |
| 9 | Fixed step: `readFlightState` (batch, 11 values), envelope guards, `position/terrain-elevation-asl-ft`, `groundContactClearanceMeters` (8 reads), `captureSimulation` (batch), `sdk.run()`, `readFlightState` | 1 native run, 2 batch reads, snapshot batch, ~10 scalar reads | none |
| 9f | Fault only: `readContactDiagnostics` (3 reads), `restoreSimulation` (7 writes + batch restore, `RunIC` ×2, clock, thermal, plant commit) | | none |

## Per accepted step (fixed-step `onStep`)

| Consumer | Native access | Notes |
| --- | --- | --- |
| `benchmarkRouteRun.acceptStep` | state only | Calls `runtime.surface.sample` once per sampled second, so it is also a main-thread scene query |
| `flightAudio.publishStep` → `jsbsimAudioAdapter.read` (`sound/src/jsbsimAudioAdapter.ts`) | 1 batch read; catalogue queries at creation | Posts ordered snapshots to the AudioWorklet (shared-memory bridge when isolated) |
| `wheelSpin.step` (`ground-contact/src/createWheelSpinExperiment.ts`) | per-wheel gear reads | Force-adjacent state; cues feed haptics and tire audio |
| `wheelCues.publish` | none | Main-thread subscribers (haptics, tire audio) |

## Per rendered frame (presentation)

| Section | Consumer | Native access |
| --- | --- | --- |
| `flight/view` | `readExternalFuelTanks` (`fuel/src/externalFuelTanks.ts`) | 2 reads |
| `flight/view` | `engineVisuals.read` (`aircraft/src/createAircraftEngineVisuals.ts`) | 1 batch read |
| `flight/view` | `readControlSurfaceState` (`aircraft/src/aircraftAnimation.ts`) | ~15 scalar reads |
| `flight/view` | Debug overlays when enabled: forces (`aircraft/src/aircraftForces.ts`, batch), collision (3), wheel spin (2) | reads |
| `flight/hud` | `readActualFlaps` | 1 read |
| `flight/instruments` | `flightRecorder.sample` (`logging/src/flightRecorder.ts`) | 3 reads + catalogue |
| `flight/instruments` | `evaluationInstruments.update` (`fly/src/flight/hud/evaluationInstruments.ts`) | 3 reads + catalogue |
| `flight/instruments` | `readPilotG` (`g-forces/src/gForce.ts`) | 2 reads |
| `flight/instruments` | `engineMonitor.update` (`engines/src/engineMonitor.ts`, `engineMonitorModel.ts`, `engineLiveData.ts`, `engineHistory.ts`, `engineVariables.ts`) | a catalogue-dependent set of reads (engine sample, live data, history), cached per frame; catalogue discovery once per model |
| control panel, settings readings | `vtolConversion.getPositionNorm`, control-law reading source | 1 read each, when displayed |

## Every 100 ms

| Consumer | Native access |
| --- | --- |
| `createPanelSnapshot` → `readFuelTanks` (`fuel/src/fuelTanks.ts`), sound status, engine | 10 reads + catalogue |

## On command or setting change

| Command | Consumer | Native access |
| --- | --- | --- |
| Startup | `bootstrapAircraft` (`fly/src/flight/jsbsim/bootstrapC172.ts`) | 21 writes, `RunIC` |
| Startup | `applySavedControls`, input manager initial values (`createFlightSimApp.ts:739`, `:825`–`:851`) | 1 write path, 8 reads |
| Startup / resume | `restoreSavedFlight` (`fly/src/flight/jsbsim/savedFlight.ts`), restored flap read | writes, `RunIC` |
| Save, suspend | `captureSavedFlight` | reads |
| Teleport, reposition | `resetFlightLocation` (`fly/src/flight/jsbsim/resetFlightLocation.ts`) | 4 reads, 41 writes, 5 `RunIC`/run calls |
| Weather | `applyWeather` | 2 writes (`atmosphere/wind-north-fps`, `wind-east-fps`) |
| Fuel panel | `writeFuelTanks` | 4 writes |
| External stores | `setExternalFuelTankAttached` | 4 writes |
| Control law setting | `followControlLaw` | 1 write |
| Auto flaps setting | `syncNativeAutoFlaps` | 1 write |
| Engine plant settings | `applyEnginePlantSettings` (`fly/src/flight/jsbsim/enginePlantSettings.ts`) | 5 reads, 5 writes |
| Pause | `engineMonitor.update(…, held)` | reads |
| Capability probes | `probeWheelContactCapability`, `createWheelSpinExperiment`, `createEngineControl`, `createJsbsimAudioAdapter` | catalogue queries |
| Dispose | `releaseFlightStateReads`, `releaseSimulationCapture`, audio adapter and visuals batches, `sdk.destroy()` | releases |

## What this means for a worker boundary

- Steps 1–2 of every attempted step need main-thread scene queries against
  the exact pre-step state, and step 3 needs main-thread phone authority after
  them. A worker step therefore needs a main-thread round trip before it can run
  the native step. If a terrain correction changes the state, the queries must
  run again on the corrected state.
- Steps 5–8 read native values between the scene queries and the native step.
  They would move with the SDK, together with the arbiter, trim and assist
  state they update. The input manager's trim, throttle and lever replacements
  would come back as acknowledgements.
- Every per-frame presentation read becomes a field of a copied observation.
  There are about 45 scalar values per frame plus the engine-monitor catalogue,
  and the fuel and panel readings are needed at 10 Hz.
- Every command writer becomes an explicit, validated, ordered command. None
  needs a general property proxy.
