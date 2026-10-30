# Persistent storage administration

Current flight-wide reference, audited 29 October 2026. The [resource index](README.md) records scope and revisions. Persistent storage keeps preferences and reusable downloads between visits; it is distinct from live [memory](memory.md), and retaining files does not guarantee offline startup or a particular browser quota.

## Owners and retained data

| Data | Owner and storage | Lifetime and release |
| --- | --- | --- |
| Settings, keys and saved layout | Shared settings registry and windowing, browser local storage | Device/site preferences survive reload. Defaults, saved values and per-visit overrides have separate provenance. Browser data review can clear the site's record. |
| Flight recovery | Flight [`savedFlight`](../../src/flight/jsbsim/savedFlight.ts), local-storage key `osfs.saved-flight.v1` | One versioned snapshot replaces the previous one. New flight or disabling resume clears it. |
| Added mods and confirmations | Flight [`modSession`](../../src/flight/mods/modSession.ts), `osfs.mods.added` and `osfs.mods.confirmed` in local storage | Remembers sources and explicit confirmations; startup reinstalls saved sources. These lists are not an offline copy of all mod payloads. |
| Mod browse results | [`githubDiscovery`](https://github.com/0SFS/mods/blob/main/src/githubDiscovery.ts), session storage by browse category | Ten-minute freshness with ETag reuse; session storage survives reload within that session, not as a permanent installation. |
| Public map tiles | Engine [`mapCache`](https://github.com/foss-earth/engine/blob/main/src/browser/mapCache.ts), CacheStorage bodies plus index | Bounded by bytes, entries, per-tile size and HTTP freshness; access updates eviction order. |
| Google 3D Tiles | Browser HTTP cache | Deliberately outside the application's persistent map cache. Browser policy controls reuse/eviction. |
| App files | Shared [`appFiles`](https://github.com/foss-earth/app/blob/main/src/app/appFiles.ts) and kept-files service worker | Production build's eligible content-addressed files are kept on demand. Off removes kept files; version changes retire obsolete files through the shared keeper. |
| Location/search state and results | Shared location UI and [`lookup catalogue`](https://github.com/foss-earth/engine/blob/main/src/settings/catalogue/locationLookup.ts) | UI state restoration does not itself repeat a search or relocate the aircraft. Response cache has separate freshness, entry and timeout controls under Interface → Search. |
| Visit/error and startup recovery records | Shared diagnostics and [`browserData`](https://github.com/foss-earth/ui/blob/main/src/browser/browserData.ts) | Records support crash review; clearing site data removes them too. Download a needed report before clearing. |

The shared registry's storage key and migration behavior live in [`appSettings`](https://github.com/foss-earth/app/blob/main/src/settings/appSettings.ts). Do not add a second flight-local store for a preference already administered there. A missing or refused browser store is a supported condition, not permission to overwrite another site's or package's records.

## Flight snapshot policy

The [flight composition](../../src/flight/createFlightSimApp.ts) saves at `osfs.start.saveInterval` (default **5 seconds**, range 1–600 seconds), on pause, after a placement, and on page hide/leave. `osfs.start.resume` defaults to **true**. The [flight parameter catalogue](../../src/flight/settings/flightParameters.ts) owns these values; the interval is a save policy, not a real-time durability guarantee during a blocked frame or abrupt process termination.

The snapshot includes aircraft identity, position, attitude, velocities, controls, fuel/engine recovery state and pause. Invalid/non-finite captures, world-loading or faulted states are skipped so the prior recoverable save stands. Benchmark-route and engine-test visits do not save a normal flight. Explicit start coordinates and other addressed starts can bypass resume. Weather atmosphere controls are intentionally session state and are not restored from the saved controls.

The store validates version and data on read, returns no save for malformed/incompatible data and tolerates unavailable or quota-refused storage. A refused write is reported without stopping physics; it cannot promise the latest flight will resume. Aircraft selection has its own save/error handling, so a selected model in UI is not evidence a successful recovery snapshot was written. Inspect the saved-flight and selection status separately.

## Cache admission and freshness

| Control | Default | Applies to |
| --- | --- | --- |
| `map.cache.httpBytes` | 128 MiB | Total retained public-tile payload allowance |
| `map.cache.httpEntries` | 1,024 | Maximum retained public-tile entries |
| `map.cache.maxTileBytes` | 8 MiB | Largest individual saved tile |
| `app.keepFiles` | true | Keeping the app's own eligible files in builds with a generated service worker |

The engine's [loading catalogue](https://github.com/foss-earth/engine/blob/main/src/settings/catalogue/loading.ts) and app's [interface catalogue](https://github.com/foss-earth/app/blob/main/src/settings/catalogue/interface.ts) define those defaults. They are application allowances, not guaranteed disk reservations. The browser can reject writes or evict storage independently. There is no global quota allocator dividing storage between app files, maps, settings and other features.

The [map cache](https://github.com/foss-earth/engine/blob/main/src/browser/mapCache.ts) admits recognized public tile URLs and eligible GET requests. It honors HTTP cache-control, freshness age and Vary; it does not invent a TTL or extend an aged response. Google requests, credentialed/non-public requests and unsuitable responses use their appropriate fetch/browser path. Stale or oversized content is not a persistent-cache hit. The cache prunes expired/old entries to its byte and count limits, cleans orphaned payloads, and handles interrupted/quota-failed writes. At most eight cache writes are pending; persistence work is not a new network concurrency allowance. Changing limits triggers pruning through cache operations; it does not release corresponding live decoded/GPU content.

App-file keeping is separate. Development builds without a generated worker report it unavailable. A service worker being installed, controlling this page, and having a file already stored are separate observations. Keeping a compiled chunk does not keep every remote aircraft asset or map tile. Follow the canonical [app-files guide](https://github.com/foss-earth/ui/blob/main/docs/app-files.md) for the shared build and update policy.

## Clearing, failure and destruction

Use **+ → Browser data** for the existing review. **Keep API keys** starts checked. The review describes that clearing affects the entire website origin, including other apps there; it removes local/session storage, accessible IndexedDB databases, CacheStorage and service-worker registrations. It preserves selected readable API keys only when requested and reports incomplete cleanup. The page cannot clear the browser's HTTP cache or cookies hidden from JavaScript; browser site settings own those. Downloaded files outside browser storage remain on the device.

After repeated failed or stalled starts, shared recovery can offer this review before the app bundle succeeds. Offering the review does not automatically delete anything. Account sign-in is cleared rather than restored as an API key. The exact behavior is in [`browserData`](https://github.com/foss-earth/ui/blob/main/src/browser/browserData.ts).

Ordinary pause or destruction does not clear preferences, installed-source lists or persistent caches. Stopping a cache client or service-worker observation also does not mean browser-managed data was removed. A cache clear during in-flight work must invalidate that work's generation so stale completions cannot silently repopulate the cleared application cache; this is part of the map-cache contract.

## Measurement and tuning

Map cache inspection reports retained tile bytes/entries, hits and provider request counts. App files report kept file count/bytes, installed/controller state and unavailability. These are payload/accounting views, not a complete physical disk figure: indexes, browser databases, HTTP cache, filesystem overhead and other origins are separate. Frame budget RAM/VRAM graphs do not measure persistent disk usage. No new storage measurements were taken for this guide.

For a repeatable check, record the origin and effective settings, inspect each cache, reload once warm, and compare requests with a clearly labeled cold run. Verify that expired responses revalidate/refetch, a lowered allowance evicts appropriately, and a refused write leaves the flight usable. For saved-flight checks, pause, reload and verify state; then use New flight and verify the previous save is not resumed. Keep these operations separate from broad site clearing, which would erase the evidence and unrelated preferences.

Efficiency opportunities are better total-storage attribution, evidence-based allocation between persistent stores and ensuring newly added asset types have explicit retention policy. They are open work. Increasing disk retention can save [network](network.md) traffic while adding write/index work; it does not by itself reduce decode, [worker CPU](cpu-workers.md) or GPU allocations on the next visit.
