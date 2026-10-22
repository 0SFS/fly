# Sky direction indicators

0SFS uses the same N/E/S/W horizon letters as the UMN tour: red N, white E/S/W, with a dark
outline. FOSS Earth's engine owns their textures, placement, apparent size and rendering.
`src/flight/hud/flightCompass.ts` adapts the public `foss-earth/runtime` export of
`createOrbitCompass` to the flight scene. It updates after the floating origin and chase frame,
using the active cockpit or chase camera, and is destroyed with the flight session.

## Coordinate and distance rules

The flight scene is east/up/south at the aircraft; the shared compass takes an ECEF camera
position. Refresh the camera's parents and its view matrix before reading `globalPosition`, or a
turn made after the last render can leave its position stale. The transpose of the floating
frame's orthonormal rotation maps that position back into ECEF; add the origin in double
precision. `ecefToScene` then maps each shared letter placement into the current flight frame.
Use `getWorldFromEcef()` for this calculation rather than a rounded render matrix.

Do not parent the billboard meshes to the rotated ECEF world shift. Babylon's default billboard
placement ignores parent rotation. Convert their positions into scene space instead. The
conversion must run even for a stationary ECEF camera when its local frame changes.

Flight cameras have a 250,000 m far clip, closer than many geometric horizons. The adapter's
`horizonMaxDistanceMeters` getter supplies 80% of the active camera's far clip. The shared
placement core keeps the horizon bearing and reduces drawing distance and letter size together,
so altitude does not clip the letters or change their apparent size. The tour's default placement
is unchanged when these optional host ports are absent. The full shared contract is in
[`engine/docs/compass.md`](../../../foss-earth/engine/docs/compass.md).

## Verification

Run the focused flight test from `fly`:

```sh
node node_modules/vitest/vitest.mjs run --configLoader native src/flight/hud/flightCompass.test.ts --maxWorkers=1
```

It covers an uninitialized origin, round-trip coordinates, a moved origin, a parented camera's
translation and rotation, the far clip allowance, a missing camera, and disposal. Existing flight
app tests mock this separately tested renderer at the composition boundary.

From the sibling `foss-earth/engine` checkout, run:

```sh
node ../app/node_modules/vitest/vitest.mjs run tests/spritesCompass.test.ts tests/visualizationCore.test.ts --maxWorkers=1
npm run typecheck
npm run lint
```

The shared tests cover a stationary ECEF eye in a moving scene frame and preservation of bearing
and apparent size when drawing inside a nearer far clip. Also run `npm run typecheck` and
`npm run lint` in `fly` when integrating changes to the engine.

The October 21, 2026 visual review used the actual flight compass and floating origin in an
isolated Babylon scene, with each cardinal view at 1,500 m and north at 25,000 m. It did not
capture a complete running simulator. Its local, ignored artifacts are
`build/sky-indicators/index.html`, `build/sky-indicators/shots.mjs` and
`build/shots/sky-indicators/`; `build/shots/index.html` is the review page. With a local server on
port 7470, the retained shot list can be rerun with:

```sh
node ../../foss-earth/browser-testing/scripts/shots.mjs build/sky-indicators/shots.mjs
```
