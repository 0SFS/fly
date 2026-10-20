# W0 flight routes

Open `/fly/?dev=1&route=cruise&flightPerf=1` or
`/fly/?dev=1&route=low&flightPerf=1`. Without `dev=1`, `route` is ignored.
The route enables `flightPerf` recording even when that flag is omitted.

Both candidates start at **37.91° N, 121.285° W**, over southern Stockton,
California, heading **000° true** at **110 kt** in the **Cessna 172**. Cruise
starts 1,500 m above the initially prepared ground; low starts 150 m above it.
The autopilot holds that fixed MSL altitude (initial ground plus clearance),
heading and airspeed. A route-only outer altitude controller supplies pitch
targets to the existing attitude autopilot. It pauses after exactly 21,600
accepted 120 Hz physics steps (180 simulated seconds). Loading, terrain holds
and pauses do not advance this clock; the wall duration may be longer.

The start, aircraft, autopilot axes and initial throttle (0.65) are forced for
the visit. Saved-flight resume and saving are disabled for this visit; stored
preferences and the previous saved flight are retained. Google is the required
map source. Other effective settings are recorded beside the flight, so a
renderer or detail comparison can be reproduced.

These coordinates are a **candidate flat-ground track**, not verified Google
coverage. A live flight must confirm both Google tiles and terrain over the
whole actual path before this becomes a W0 baseline. The roughly 10 km northward
track is an estimate at 110 kt in still air. Inspect the recorded ground heights,
missing terrain, screenshots, heading and altitude errors. `coverageValidation`
stays `unverified`; the harness does not turn sampled heights into a coverage
claim.

`window.osfsFlightRoute.snapshot()` returns the route, aircraft, fixed MSL
target, actual 1 Hz coordinates/heights/headings, effective non-sensitive
settings, accepted simulation time, maximum tracking errors, and completion or
failure. `window.osfsFlightPerformance` retains up to 65,536 frame samples for a
route; normal flight keeps its existing capacity. The route's frame profiler
uses the same larger window.

Run `node scripts/profile-flight.mjs --route=low --runs=webgpu-webgpu` for a
headed 1280×720 CSS-pixel measurement at the display's pixel ratio. Repeat with
`--route=cruise`. Each configuration gets a fresh profile in the output's
gitignored `build/` tree, deleted on exit. The key is read only from
`FOSS_EARTH_GOOGLE_KEY`, then that named variable in `.env.local` under
`~/gh/foss-earth/app`, `~/gh/UMN-VR/tour`, or `~/gh/0sfs/fly`. It is inserted into
local storage before app startup and excluded from output. `--headless` is an
explicit diagnostic override; those results are labelled ineligible as a
headed baseline. `--timeout=600` bounds the route's wall-clock wait.

Frame timings belong to a power-adapter run. Power runs require the user to
unplug, enable Low Power Mode and fix brightness; the W0 battery harness records
that state and subtracts idle power. This runner does not change system power
settings. No qualified flight or power baseline has been established.

Build before collecting battery data, using an unused output directory:

```sh
node scripts/profile-flight.mjs --route=low --runs=webgpu-webgpu \
  --build-only --out=build/benchmarks/flight-low
```

After preparing an idle baseline with the research battery harness, its flight
wrapper launches this prebuilt directory with `--no-build --headed`. Run that
command from the research checkout, with the same fixed brightness label:

```sh
node scripts/benchmarks/power/flight.mjs --fly=../../0sfs/fly \
  --out=../../0sfs/fly/build/benchmarks/flight-low \
  --baseline=build/benchmarks/power/<idle-run>/power.json \
  --brightness=<fixed-setting> --route=low
```

The wrapper's power window runs from the first accepted simulation step to the
last, with valid battery samples bracketing both boundaries. Building and
initial loading are outside that window; terrain holds during the route remain
in its wall time. A failed route or missing power evidence cannot qualify.
Whole-route map coverage still needs review.

The report flags tracking outside 20 m of target MSL altitude or 5° of target
heading. These are diagnostic tolerances set before live measurement; a
completed route outside them still needs controller tuning and a new run.
Missing or failed Google startup is an error, rather than a fallback baseline.

The first live low-route diagnostic completed all steps but reached 35.14 m
altitude error, exceeding the 20 m limit. Its recording is not a baseline.
The route-only controller now corrects the placement attitude's initial climb
sooner, learns the level-flight bias faster, and prevents integral windup at
the existing ±12° pitch limit. The 20 m altitude and 5° heading limits remain
unchanged. Installed-JSBSim tests reproduce the original low failure exactly,
then check all 21,600 steps through the actual autopilot and control boundary:

| Route / initial airspeed | Maximum altitude error after tuning |
| --- | ---: |
| low / 110 kt | 13.97 m |
| cruise / 110 kt | 13.36 m |
| low / 100 kt | 14.42 m |
| low / 120 kt | 12.25 m |

These are flight correctness simulations without a renderer, network or timing
benchmark. Live tracking and whole-route coverage still need verification in
the user's next agreed exclusive window. Cruise is not yet measured live.
