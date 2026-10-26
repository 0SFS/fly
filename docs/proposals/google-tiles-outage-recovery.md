# Google 3D Tiles outage recovery

The reported top-down view is consistent with the destination-preparation
camera: flight waits for ground before revealing the aircraft. It does not
establish that the key itself expired. Google documents permission, quota and
other failures in its [Map Tiles error guide](https://developers.google.com/maps/documentation/tile/error_handling).

Two gaps in the current startup path explain how that view can strand a pilot:

1. Google load errors select the configured raster backup, but the preparation
   against Google rejects when its provider changes. The flight treated that as
   a terminal startup failure instead of preparing the backup surface.
2. Google's startup watchdog stops after any visible tile. Coarse parent tiles
   can be visible without usable local ground; destination preparation otherwise
   permits a 120-second wait. More requests and changing tile counts do not prove
   that the aircraft has ground beneath it.

## Local implementation

`src/flight/terrainRecovery.ts` owns one Google attempt and one backup attempt.
It follows lazy Google initialization, reports an early runtime fallback, and
restarts preparation when a Google failure has changed the map. The active
preparation owns that transition; the status subscriber does not start a second
teleport while loading is already in progress.

For Google preparation, an interval without an increase in ready ground samples
or center quality selects the backup. It uses Basemap → Loading's existing
`map.preparation.stalledAfter` setting, 15 seconds by default. Tile counts and
queue activity cannot keep that interval alive. The runtime's total preparation
timeout still bounds a slow load that continues to make progress.

The backup must pass the usual terrain checks. Physics remains held until it
does; the plain fallback sphere is never accepted as recovery terrain. Cancelling
a destination or destroying the app cancels its attempt and timer. Google-only
benchmark routes retain their original failure behavior.

Automatic recovery does not save a different map selection or erase a key. The
log says which backup is being prepared and which is in use. Basemap shows the active
provider, and selecting Google there retries it even when the saved preference
already says Google. There is no automatic switch back during flight.

If both providers fail, startup stops with the loading report, retry and an
explicit **Use OpenStreetMap** choice. This is an alternative imagery provider;
it still needs working elevation and network access. It cannot make an offline
flight safe. At initial startup that action reloads with an explicit map URL;
during destination loading it retries that destination in place.

## Reproduce without changing a real key

Run `cd ~/gh/0sfs/fly && npm run dev`, then open one of these links:

| Scenario | Local address |
| --- | --- |
| Reproduce the original failure path | <https://localhost:7470/fly/?mapSource=google&googleTilesFault=403&mapRecovery=off> |
| Same permission failure, with recovery | <https://localhost:7470/fly/?mapSource=google&googleTilesFault=403> |
| Quota failure | <https://localhost:7470/fly/?mapSource=google&googleTilesFault=429> |
| Service failure | <https://localhost:7470/fly/?mapSource=google&googleTilesFault=503> |
| Network rejection | <https://localhost:7470/fly/?mapSource=google&googleTilesFault=offline> |
| A request that never completes | <https://localhost:7470/fly/?mapSource=google&googleTilesFault=timeout> |

These switches work only on a development server. The page announces the
simulation. Only `tile.googleapis.com/v1/3dtiles/` fetches are intercepted,
including authentication retries, without contacting Google or using a real key.
HTTP/network faults wait one second so preparation can enter its active loading
state before the failure. Backup imagery, elevation and aircraft use their real
network paths. Remove `googleTilesFault` and reload to restore normal requests.
Keep `mapSource=google` on the link so a saved raster choice does not bypass the
scenario. `mapRecovery=off` is also ignored in deployed builds.
It disables terrain recovery for comparison; the repaired error-message
visibility remains enabled.

The automated tests additionally model visible parent tiles with continuously
changing queues but no usable ground, early and late provider changes,
cancellation, real ground progress, backup failure, preference preservation and
retrying Google. The partial-coverage case uses deterministic runtime telemetry;
the browser outage links do not invent Google geometry.

```sh
cd ~/gh/0sfs/fly
npm run test -- src/flight/terrainRecovery.test.ts src/flight/testing/googleTilesOutage.test.ts src/flight/createFlightSimApp.test.ts src/loading/createFlightLoadingScreen.test.ts src/main.test.ts
```

## UX decision to validate

Prefer automatic recovery on confirmed provider failure or a bounded lack of
usable-ground improvement, with a short explanation and an explicit retry. Keep
the pilot's provider preference separate from what this flight can currently
display. Repeated reloads or deleting site data should never be the recovery
instruction.

Check the 15-second interval on a slow phone before release: progress should
extend loading, while a dead provider should promptly give way to the backup.
Mid-flight recovery policy and a short session cooldown across reloads are
separate follow-ups. This change repairs startup and destination preparation;
it does not add a new in-flight outage monitor or periodic Google probes.

Startup must also print its failure actions before disposing diagnostics: the
diagnostic log stops accepting entries when destroyed. Otherwise the report can
say failed while the pilot never sees the error or its buttons.

## Local validation, 2026-10-25

The seven relevant flight, loading, entry-point and fault-simulation test files
passed all 141 tests. Lint, TypeScript and `git diff --check` passed. Chrome
reproduced the failed-start path with recovery disabled, then reached real
Mapterhorn terrain on the configured USGS Imagery Topo backup with recovery
enabled. Explicitly retrying Google during the simulated outage also returned
to that backup. A hanging Google request recovered with an accelerated 1.5-second
stall interval. The feedback checklist produced a downloadable JSON bundle with
flight and diagnostic captures and no capture errors.

A separate forced 1 ms preparation deadline exercised double failure and showed
the retry, report and OpenStreetMap actions. That unusually early teardown also
exposed a Babylon RGBD texture/shader callback running after scene disposal
(`postProcessManager` or shader `program` was null). The recovery controls stayed
visible. This renderer cleanup issue is recorded as a follow-up; the browser
failure run is not a claim of an exception-free teardown. Normal permission and
timeout recovery checks reached flight readiness.
