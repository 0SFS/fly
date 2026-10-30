# Network administration

Current flight-wide reference, audited 29 October 2026. See the [resource index](README.md) for audit scope and revisions. Network use includes file and tile downloads, location lookups and live flight connections. Downloading fewer bytes, completing a destination sooner and keeping frames responsive are separate goals.

## Owners and demand

| Consumer | Owner and execution path | When it uses the network |
| --- | --- | --- |
| App code, JSBSim and aircraft/engine assets | Flight [composition](../../src/flight/createFlightSimApp.ts), [mod session](../../src/flight/mods/modSession.ts), and asset-owning packages | Startup, aircraft changes and feature activation. A dynamic import defers a download; its completion still runs application code on the page. |
| Bundled and added mods | Flight session plus [`ModRegistry`](https://github.com/0SFS/mods/blob/main/src/loader.ts) | Bundled manifests are in the build. Added manifests and their dependencies are fetched from their normalized sources; payloads load through their owning feature. |
| Raster imagery, elevation and Google 3D Tiles | FOSS Earth [`browserRuntime`](https://github.com/foss-earth/app/blob/main/src/app/browserRuntime.ts), [`terrainLoader`](https://github.com/foss-earth/engine/blob/main/src/terrain/terrainLoader.ts), imagery and Google runtimes | Selection and destination preparation request coverage around the camera/aircraft. Camera movement, world detail and map changes alter demand. |
| Sky night lights and location/search | Shared sky and engine services | Selected sky content and explicit place/airport lookups. Lookup caching is separate from tile caching. |
| Sound code and DSP | [`createFlightAudio`](https://github.com/0SFS/sound/blob/main/src/createFlightAudio.ts) | Enabling an audible graph loads the worklet and host/voice WASM as needed; compiled modules are retained in a page-local cache. |
| Multiplayer | Flight [lazy feature](../../src/flight/multiplayer/createMultiplayerFeature.ts), [`multiplayer`](https://github.com/0SFS/multiplayer) | Host/Join opens signaling and either WebRTC or a server connection. A mounted tab alone opens no aircraft connection. |
| Phone controller | [`rc`](https://github.com/0SFS/rc), loaded by flight composition | Pairing and a connected control session; signaling/ICE traffic and the live control channel have different roles. |

The default modpack describes what a flight starts with; it does not imply every asset is downloaded immediately. The [mod loader](https://github.com/0SFS/mods/blob/main/src/loader.ts) deduplicates pending/loaded canonical sources, rejects dependency cycles and resolves dependencies sequentially. Its manifest fetch has no application timeout, response-byte cap or shared map-queue admission. Those are current gaps, rather than limits inherited from the map loader. [`githubDiscovery`](https://github.com/0SFS/mods/blob/main/src/githubDiscovery.ts) caches each browse category in session storage for ten minutes, requests up to 30 repositories and reuses ETags; a failed HTTP response may return previously cached results.

## Admission, controls and backpressure

There is no single flight-wide network bandwidth governor. These are different queues, with different limits. Defaults below are catalogue defaults; saved settings and source policy can change the effective values.

| Controls | Default | Meaning and source |
| --- | --- | --- |
| `map.loader.requests`, `.cacheEntries`, `.timeout` | 16 requests, 256 decoded grid entries, 20,000 ms | Elevation download admission, in-memory grid retention and request timeout. Host settings in [`browserPolicy`](https://github.com/foss-earth/app/blob/main/src/app/browserPolicy.ts), defaults in [`terrainLoader`](https://github.com/foss-earth/engine/blob/main/src/terrain/terrainLoader.ts). Cache entries are not a byte budget. |
| `map.imagery.concurrentRequests`, `.queuedRequests` | 16 running, 128 queued | 2D imagery admission; a provider can impose a lower limit. |
| `map.google.downloads`, `.parses` | 25 downloads, 5 parses | Independent Google tile download and mesh-parse queues. Increasing downloads does not increase the parse allowance. |
| `map.cache.httpBytes`, `.httpEntries`, `.maxTileBytes` | 128 MiB, 1,024 entries, 8 MiB per tile | Persistent public-tile cache bounds; see [storage](storage.md). |

The imagery, Google and persistent-cache controls are defined together in the engine's [loading catalogue](https://github.com/foss-earth/engine/blob/main/src/settings/catalogue/loading.ts). Consult the live settings registry for device-derived values and saved overrides rather than treating a preset as an observed limit. Shared image transfer/session admission is injected by [`browserPolicy`](https://github.com/foss-earth/app/blob/main/src/app/browserPolicy.ts); request slots, response-byte limits, decode slots and upload capacity are separate constraints. A download can finish while its content waits for decode, [memory](memory.md), or [GPU upload](gpu.md).

Elevation has a priority queue for neighbors/parents needed by already-started work. Interest claims let navigation withdraw queued tiles: a tile with no remaining claimant can leave before downloading. Already-downloading tiles finish into the cache. Downloads and decodes have bounded overlap, and loader disposal aborts through its controller. Withdrawing a navigation request therefore does not imply all network or CPU work immediately stops. The [terrain loader](https://github.com/foss-earth/engine/blob/main/src/terrain/terrainLoader.ts) is the authoritative contract.

Google queue suspension starts no new download/parse jobs while running jobs finish. The shared [Google runtime](https://github.com/foss-earth/engine/blob/main/src/babylon/createTilesRuntime.ts) owns selection, queue wakeups and disposal. Flight's world-loading hold prevents advancing physics into an unprepared destination; reducing downloads by weakening required ground coverage is a simulation-correctness change.

## Live connections and lifetime

The [multiplayer feature](../../src/flight/multiplayer/createMultiplayerFeature.ts) updates its connected session on a 30 Hz timer, including when local flight is paused; rendering remote aircraft runs from the scene's before-render hook. Pause preserves the connection. Disconnect, aircraft replacement and destruction retire it; disposal clears its timer, hook, transports and remote visuals. [`multiplayer/protocol`](https://github.com/0SFS/multiplayer/blob/main/src/protocol.ts) bounds messages to 1,100 bytes and server capacity to 16 pilots. These bounds are not an observed transfer rate.

Phone [`protocol`](https://github.com/0SFS/rc/blob/main/src/protocol.ts) specifies 60 Hz control cadence, 50 ms heartbeats, a 2,048-byte message limit and stale/connection-loss handling. Its [`peerTransport`](https://github.com/0SFS/rc/blob/main/src/peerTransport.ts) keeps bounded pending priority/normal messages and expires queued messages after 100 ms rather than replaying an arbitrary backlog. Inspect current session diagnostics for actual path, delay, dropped messages and recovery; packet cadence alone does not establish control latency.

Closing a tab UI is not necessarily feature disposal. Follow the feature's host lifetime before assuming its connections or timers have ended. Audio startup invalidates late completions with a generation check; its fetch is not an abortable, flight-wide network job. Application destruction prevents stale publication but does not prove every browser download stopped at that instant.

## Observations and blind spots

Debug → Frame budget's network stream is received bytes per second by owner, while measuring is enabled. [`resourceOwners`](https://github.com/foss-earth/app/blob/main/src/app/resourceOwners.ts) attributes known URLs to map, sky, search and app owners. Most other cross-origin URLs have no assigned owner. The [`network source`](https://github.com/foss-earth/renderer/blob/main/src/profiling/networkSource.ts) combines Resource Timing with explicit streamed-body metering for selected map owners. Metered owners are excluded from the other path to avoid double-counting.

Hidden cross-origin sizes stay unknown. The graph is not total interface traffic: it does not account for every WebRTC/WebTransport payload, signaling byte, protocol overhead, retransmission, upload or browser-internal transfer. Use browser network/connection diagnostics for those questions. CacheStorage hits, HTTP-cache responses and actual wire transfers also need separate interpretation. No network baseline was collected for this documentation.

## Tuning procedure and open opportunities

1. Fix aircraft, map source, route, viewport, world detail, physics rate and cold/warm cache state. Record effective settings and the audited revisions.
2. Enable Frame budget, record tile/loading metrics and inspect browser requests. Identify whether the wait is download, decode, upload, destination readiness or live-connection delay before editing a limit.
3. Change one queue limit. Compare destination-ready wall time, accepted simulation progress, frame-time tails, received bytes and peak memory. More concurrent downloads can increase decode/upload bursts and memory without improving readiness.
4. Repeat with warm caches and with a destination change during loading. Check withdrawal, cancellation, failure recovery and eventual cleanup; preserve required terrain coverage.

Source-backed opportunities are improved attribution of mod/asset and live-connection traffic, bounded manifest fetches, and coordinated admission across currently independent queues. These need implementation and measurements before any savings claim. Use the [frame-time guide](frame-times.md) and [worker guide](cpu-workers.md) when network completions appear as CPU stalls.
