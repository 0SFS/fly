# Aircraft switching: implementation and retained decisions

Recorded 2026-10-21. This is the handoff for the aircraft-switching fix and
Aircraft tab changes. The detailed UI behavior and acceptance evidence are in
[`aircraft/docs/validation/aircraft-selection-ui.md`](../../aircraft/docs/validation/aircraft-selection-ui.md).

## Why choosing another aircraft returned to the C172

The shared Earth `getAppSettings()` initialized before the flight registered its
`osfs.*` parameters. Its global `dropStale()` removed those saved values as
unregistered settings. The former Apply/reload flow therefore saved a choice,
reloaded, and booted the default C172. Legacy-key migration masked the problem in
some tests.

The registry now accepts `ownedPrefixes`. Earth's shared registry prunes its own
catalogue namespaces, preserving host parameters that register later. This also
applies to registry storage reloads. The regression in
`src/flight/settings/flightParameters.test.ts` saves a G2+ HD choice, recreates
Earth settings before flight registration, reloads storage, then verifies the
complete choice survives. It failed as C172/Auto before the fix.

## An aircraft a mod adds, asked for at startup

A link such as `?aircraft=dji-mini2`, short for `?set.osfs.aircraft.id=dji-mini2`,
names an aircraft that joins the catalogue only once its mod loads. Invitations
and shared flights write the short form. Ids that were renamed, such as
`dji-mini-2` and `dji-air-2s`, still open the aircraft from saved settings, saved
flights and older links (`src/flight/aircraft/aircraftAddress.ts`). The registry holds a URL's dynamic choice
until its option exists, as it holds a saved one. The flight installs the default
modpack behind the loading screen before reading the choice, so a fresh browser
flies the drone. When nothing installed supplies the asked-for aircraft, loading
stops with **Fly the Cessna 172 instead** (or the aircraft otherwise in use)
beside the reload button. The flight never switches unasked, and the choice
replaces the request, so a mod that arrives later does not switch the aircraft.
`unavailableAircraftRequest` (`src/flight/unavailableAircraft.ts`) names it.

## Complete aircraft activation

- `createFlightSimApp` coordinates flight sessions around one Babylon runtime,
  canvas and streamed world. A switch prepares the target JSBSim runtime and
  rebuilds aircraft-owned physics consumers, controls, instruments, visuals and
  audio together. Changing only the mesh would leave the old flight model active.
- Suspend the current flight and hide its aircraft before loading. Place the
  circular indicator at the old aircraft's projected position, or use its central
  fallback when that position is outside the viewport. Keep location, weather
  and camera mode across replacement.
- Resume remains blocked through keyboard, gamepad, phone and both pause
  buttons until target terrain/session setup and the actual model are ready.
  Completion stays paused and saves the new aircraft's flight state.
- Capture the accepted selection so a preset/import during loading cannot pair
  prepared physics with a different aircraft's mesh. Direct registry changes
  use the same complete-activation coordinator.
- An early physics failure retains the original aircraft. A later mesh/setup
  failure rebuilds it paused. Report failures in a fullscreen dialog; the body
  overlay survives disposal of the old React panel. Reports use the shared
  redaction utilities. Recovery failure is included in the report.
- `floatingOrigin.dispose()` must detach renderer-owned world content before
  disposing the flight transform. Otherwise Babylon recursively disposes the
  retained map.
- `markParametersApplied` updates the UI baseline for parameters consumed by an
  in-place restart. Applying a new profile's start speed/throttle must not leave
  a false Apply & reload banner or clear unrelated pending settings.
- Modal dialogs must isolate flight hotkeys, including capture listeners. Let
  key releases through so a held input cannot remain stuck when a dialog opens.

## UX requirements to preserve

Edit mode has the loaded family's thumbnail, exact loaded name and **Switch**
inside one visible rounded enclosure. Switch mode hides this summary and the
editing controls; the gallery already owns the aircraft image and title.

The current aircraft's entire gallery card is one native **Edit** button. Its
image, name, status, background and compact bottom-right Edit label all open
settings without switching, confirmation or reloading. Enter and Space work
through the native button. Other cards request a switch. Do not nest a second
button inside the card or disable it just because it is current.

Confirm a different aircraft in a fullscreen warning, with the persisted
**Don't show again** choice. Confirm activates directly; there is no staged
Apply/reload step. Model detail applies directly; a generation selecting another
runtime uses the same confirmation flow. G2+ currently shares the G2 runtime.
Mesh inspection stays collapsed at the end of editing. The four redundant
airspeed/altitude/heading/throttle tiles are absent from the Aircraft tab.

These defaults are retained in both organizations' shared `AGENTS.md` files and
FOSS Earth's `docs/docs/ui-layout.md`: ownership uses nested rounded enclosures;
reuse an existing gallery identity; a card's primary action covers the whole
card, including when the item is already selected.

## Ownership and checks

Changes span the `aircraft`, `fly`, `controls`, Earth `ui` and `app` repositories,
plus the organizations' guidance and shared UI specification. They use the
existing family thumbnails; no new artwork or aircraft-performance claims were
introduced.

From `fly/`, use the focused React suites for UI changes:

```sh
npm test -- src/flight/hud/AircraftSelectionPanel.test.tsx src/flight/hud/FlightControlPanel.aircraft.test.tsx
npm run typecheck
npm run lint
npm run check:aircraft-ui
```

The final whole-card change passed 31 focused tests and the three viewport
checks. The UI check is a controlled snapshot/promise fixture, not proof that
physics or a mesh activated. Runtime/lifecycle changes additionally need:

```sh
npm run check:aircraft-switch
```

That check uses real JSBSim/WASM, aircraft data and GLBs with an offline fallback
globe. It verifies C172, Vision G1/G2/G3 and F-35B, ready models and matching
physics identities, retained document/canvas/runtime/world, a held-download
pause gate, missing-airframe failure/recovery/retry, and saved selection after
an intentional reload. It does not qualify live map streaming or flight
performance. Evidence locations and the scope of each recorded run are in the
aircraft validation notes. Screenshots and reports stay gitignored under build/.

All implementation work was saved locally; publishing was not requested.
Other conversations' performance/native-batching and reset-badge changes in
these shared checkouts are separate work and must not be swept into the
aircraft-switching commits.
