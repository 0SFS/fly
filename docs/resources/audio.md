# Audio administration

Current flight-wide reference, audited 29 October 2026. See the [resource index](README.md) for revisions. Audio has its own render deadline and lifetime: acceptable visual [frame times](frame-times.md) do not establish glitch-free output, and a quiet source is not necessarily a released audio graph.

## Owners and execution

| Work | Execution domain | Owner and reason |
| --- | --- | --- |
| Enable/unlock, settings, graph setup, module fetch/compile, holds and failures | Page/main thread and browser services | [`createFlightAudio`](https://github.com/0SFS/sound/blob/main/src/createFlightAudio.ts) composes one AudioContext and one stereo AudioWorklet. Browser activation and application lifecycle are handled here. |
| Read aircraft/engine state and discrete transitions | Main thread, after accepted physics steps | Flight [composition](../../src/flight/createFlightSimApp.ts), [`jsbsimAudioAdapter`](https://github.com/0SFS/sound/blob/main/src/jsbsimAudioAdapter.ts) and the selected model's audio adapter read authoritative simulation state before SDK disposal. |
| Listener/source pose and velocities | Main thread, per rendered frame | The facade transforms current scene/view information for spatial audio. It updates view data without publishing a physics snapshot of its own. |
| Batch transfer and queue management | Main-thread producer plus audio-thread consumer | [`audioTransport`](https://github.com/0SFS/sound/blob/main/src/audioTransport.ts) bounds lag and preserves transition information; the audio callback must never wait for physics. |
| Synthesis, propagation, spatialization, mixing and limiting | AudioWorklet, host WASM | [`dspProcessor`](https://github.com/0SFS/sound/blob/main/src/dspProcessor.js) moves batches and invokes the shared output core. Per-block synthesis is not a main-thread task. |
| Optional engine voice synthesis | Same AudioWorklet, independent voice WASM | [`engine-sound`](https://github.com/0SFS/engine-sound) owns the voice ABI; [`electric-sound`](https://github.com/0SFS/electric-sound) supplies four independently phased motor/propeller voices for the new electric path. The shared host still owns propagation/mixing/limiting. |

`electric-sound` has four source slots, up to 1,024 frames per block and 32 Float64 input fields per source/frame. The worklet copies bounded inputs/outputs between the independent voice and host linear memories. Its render path does not allocate or grow WASM memory; configuration and initialization are setup work. Its gains and spectra are original approximations, not measured acoustic calibration. It creates no extra AudioContext or settings UI.

## Cadence, buffers and admission

`publishStep()` reads every accepted step while engine sound is active. Discrete combustion/running/starter changes are staged before decimation. Continuous telemetry publishes at most **60 Hz of simulated time** (`PUBLISH_INTERVAL_S = 1/60`), so a 120 Hz flight does not double continuous snapshot traffic; a 30 Hz flight cannot create missing intermediate physics states. Batched catch-up steps can flush together. Render cadence and audio-device sample rate remain independent.

The audio callback reads its actual output block length. Its deadline is `1000 × frames / sampleRate` milliseconds: 128 frames at 48 kHz gives about 2.67 ms, an arithmetic example rather than a measured device budget. The worklet renders from its queued/interpolated timeline and never blocks with `Atomics.wait()`.

The [transport](https://github.com/0SFS/sound/blob/main/src/audioTransport.ts) uses SharedArrayBuffer only when it exists and the actual page is cross-origin isolated; otherwise MessagePort is the supported baseline. Secure HTTPS alone does not establish isolation.

| Buffer policy | Default and saturation behavior |
| --- | --- |
| MessagePort transport | Three transferable batch buffers cycle between producer and consumer; no shared writable ownership. Missing recycled buffers leaves staging to coalesce continuous state. |
| Shared transport | Eight bounded ring slots; full slots are not overwritten. New continuous state coalesces in staging until space is available. |
| Batch layout | Up to eight snapshots and 32 discrete events, defined by [`audioSnapshot`](https://github.com/0SFS/sound/blob/main/src/audioSnapshot.ts). The final event slot can carry RESYNC when overflow occurs. |

Coalescing intentionally replaces stale continuous observations; event overflow is counted and explicitly resynchronizes rather than silently claiming every transition was delivered. Bounded queues prevent unlimited backlog, but the transport's counters do not measure actual output-device latency.

## Controls and overload policy

The Sound tab's [catalogue](https://github.com/0SFS/sound/blob/main/src/settings.ts) owns `osfs.sound.*`. `enabled` defaults to **true**, `quality` to **med**, `engineMuted` to **false**, and `listenerCockpitBlend` to **1** (cockpit). Sound begins when browser activation permits it; a saved explicit Off remains Off. Master/engine/airframe/tire gains and reduced dynamic range serve different mixes. Muting engine leaves airframe/tire paths. Disabling engine sound or selecting quality Off can still leave an independently enabled tire-only output kernel; the facade releases its graph when neither consumer wants it.

Requested quality is saved; effective quality is a runtime result. [`audioQuality`](https://github.com/0SFS/sound/blob/main/src/audioQuality.ts) admits Low/Med/High from concrete AudioWorklet/WASM/renderer capability. Auto chooses the highest supported tier subject to live resource limits and faults; it does not certify the device's performance. Tier-specific source/filter/resource limits are exposed by the catalogue and sent to the DSP. Unsupported requested tiers fall back to an available lower tier.

`TIER_BUDGETS` contains **proposed envelopes, not measurements**: its Low/Med/High per-128-frame p95 values are 0.12/0.25/0.45 ms. The implemented controller can shed one detail stage after two consecutive over-budget two-second windows, up to six stages, then lower a tier. A supplied deadline miss, underrun or fault observation can cause an immediate controller drop. It tracks a 60-second upgrade lockout; it never delays necessary downgrades. The facade feeds output-load observations only to Auto; manual quality holds its selection. Fatal processor errors stop and tear down the graph until explicit retry, for either mode. These runtime results do not overwrite the pilot's persisted requested quality.

The shipping path has **no validated per-block DSP timer or output-underrun counter**. It cannot exercise timing-driven protection on measurements it does not have. Unknown timing, underruns and resident bytes stay unknown in status. `QUALIFIED_PROFILES` is empty; listening acceptance and capability admission do not create performance qualification. No fresh audio benchmark was run for this documentation.

## Holds, switching and destruction

Holds are a set of reasons: pause, background, loading, fault and reset. Releasing one cannot release another. Entering a hold silences output immediately and schedules context suspension after **1,500 ms** by default, avoiding expensive suspend/resume for brief holds. Leaving a hold starts a new audio epoch, clears stale timeline state and resumes the same current context if still appropriate. Tire-only holds can silence just the contact cue while engine sound continues.

Aircraft/renderer changes replace adapters and can rebuild the graph when renderer, voice binary or source configuration changes. A monotonically increasing generation guards pending startup promises: a late module load cannot restart disabled or destroyed sound. This prevents stale publication; the current fetch/compile path does not promise an immediate abort of browser work. Successful compiled modules are cached within the facade's lifetime so graph recreation can reuse them; stopping an audible graph is not proof that cached compiled code disappeared.

Destruction removes visibility/unlock handlers, disposes the native-reading adapter **before its SDK**, retires transport, clears suspension timers, disconnects the node and closes the AudioContext. Context close is asynchronous. A replacement SDK must not inherit property-batch readers from the old one. The [facade](https://github.com/0SFS/sound/blob/main/src/createFlightAudio.ts) and [flight teardown](../../src/flight/createFlightSimApp.ts) define this order.

## Measurement and efficiency procedure

Sound status exposes requested/effective quality, sample rate, transport, graph/hold state, module identity and core timeline counters. Core stats arrive about once per second of rendered audio. Transport coalescing, in-flight batches, event overflow, resyncs and stale fades diagnose producer/consumer gaps; they are not interchangeable with an output underrun count. Main-thread audio snapshot and view work can appear in the flight profiler, while real DSP render cost needs audio-thread evidence. The generic RAM stream does not fully account for audio WASM and browser-native buffers; see [memory](memory.md).

For an investigation, record aircraft/engine and renderer identity, voice/DSP hash, OS/browser, output route, actual sample rate, port/SAB transport, requested/effective quality and holds. Compare the same flight/view with only one quality/resource setting changed. Exercise ignition/shutdown, rapid throttle/load changes, pause/resume, page hide/show, reset and aircraft replacement. Inspect stale/resync/coalescing counters and listen for discontinuities; preserve raw evidence under the owning package's ignored build tree. The canonical [sound design](https://github.com/0SFS/sound/blob/main/docs/sound.md) and [implementation ledger](https://github.com/0SFS/sound/blob/main/docs/validation/audio-implementation-ledger.md) distinguish retained behavior from qualification work.

Priorities for future efficiency work are validated output/dropout observation, full audio memory accounting and paired quality/cost evidence for the electric voice path. Lowering snapshot traffic or moving adapters off the [main thread](main-thread.md) requires preserving per-step discrete transitions and source/view timing. A smaller render FPS limit does not cap the audio callback; background suspension and explicit disable are the relevant lifetime controls.
