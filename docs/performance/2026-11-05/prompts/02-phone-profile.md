# 02 — A phone profile from settings that already exist

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** one action that sets the flight up for an old phone, offered when
the device looks slow, using only settings that exist today.

**Owns:** fly's settings and flight UI (`src/flight/settings/`, the flight's
tabs). Uses FOSS Earth setting IDs without editing FOSS Earth.

## Values

| Setting | Default | Phone | Why |
| --- | --- | --- | --- |
| `renderer.resolutionScale` | 1 | ≈1.25 ÷ devicePixelRatio | About 0.65 instead of 2.6 megapixels at DPR 2.6 |
| `renderer.antialias` | on | off, if prompt 01 shows MSAA costs on the device | Applies after reload |
| `osfs.exhaust.sampleCount` | 32 | 10 | Plume ray-march samples per pixel |
| `osfs.exhaust.depthResolutionScale` | 1 | 0.5 | The opaque-depth pre-pass |
| `osfs.exhaust.axialFieldSamples`, `osfs.exhaust.radialFieldSamples` | 64, 32 | 32, 16 | CPU gas field and its upload |
| `osfs.exhaust.light.enabled` | on | off | A real point light on lit materials |
| `osfs.exhaust.smoke.maxParticles` | 64 | 24 | Particles and blended overdraw |
| `osfs.engine.model` (F-35B) | plant | empirical | 86–90 instead of 341–373 µs per physics step |
| `osfs.cockpit.screen.refreshRate` | 30 | 15 | The cockpit view's page mirror |
| `osfs.cockpit.screen.background` | black except on fast computers | black | Chase draws the view twice |
| `interface.toolbar.activityOutline` | spinning | still | Restyle every frame while tiles stream |
| Sky and map detail | defaults | the "Save battery" preset's values without its 30 fps cap | Coarser sky and map |

Leave `renderer.dynamicResolution` out until FOSS Earth's F4 gives it a
fallback without GPU timers; today it switches itself off on these phones.

## Steps

1. Find how a host can contribute a preset. FOSS Earth's built-in presets
   are JSON files in `~/gh/foss-earth/app/src/settings/presets/`. If the app
   lets a host add presets, add a fly preset named for what it does ("Older
   phone"). If it does not, add an action in the flight's existing Settings
   tab that applies the values and is undone by the existing "This device"
   preset, and record the FOSS Earth hand-off that would make it a preset.
2. Detection for the offer: WebGL2 renderer (no WebGPU), a mobile user agent,
   `navigator.hardwareConcurrency <= 8`, `navigator.deviceMemory <= 4`, or a
   frame interval averaging over 20 ms in the first 10 s of flight. Offer the
   profile in an existing tab or status area; never switch silently, never
   add an overlay without the user's approval of the placement.
3. Store the choice so the offer does not repeat after it was declined.
4. Tests: the values applied, the offer's conditions, declining, and undo.

## Validation

Run prompt 01's scenarios 1 and 3 on the phone with and without the profile,
interleaved. Show the user before/after screenshots of the exhaust and the
map at the same view; the exhaust and resolution changes are visible by
design and need their approval.
