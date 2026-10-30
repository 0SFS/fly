# Placement consent and aircraft-local streaming

Aircraft switches and saved flights preserve absolute geodetic pose. Terrain
preparation does not raise aircraft to clear nearby hills or preserve AGL against
a newly sampled ground height. Every nonphysical relocation needs a fresh Yes/No
confirmation showing destination, altitude and reason. Native physics/contact
motion and floating-origin coordinate changes are separate operations.

`createFlightPlacementCoordinator` owns confirmation lifetime and focus;
`createFlightRegionPreparation` owns one cancellable region demand through
preparation and subsequent flight. The engine's additive `prepareTerrainRegion`
API supplies local minimum/final readiness, ground evidence and estimated remaining
work independently of the render camera. Other Earth consumers retain their
existing `prepareTerrain` behavior.

## Loading regions

Two tunable profiles live in Map → Detail. Drones use a sphere with a 15 m base,
body-size scaling and 1.5 seconds of travel, capped at 100 m. Planes use a 200 m
base sphere, scaled by body size and capped at 1,000 m. Their cone follows actual
3D ground velocity above 0.5 m/s, with a 15° half-angle and five-second horizon,
capped at 10 km. The sphere has first priority, followed by forward cone distance.
Loaded body bounds can enlarge a preparation before its readiness is accepted.

Google minimum/final geometric-error targets are 8/1 m for drones and 32/8 m for
planes. Raster terrain zoom targets are 14/16 and 12/14 respectively. These are
initial tuning values, not measured physical safety guarantees. Where the map
has nothing finer than a target, its finest detail is ready: a Google tile with
no finer children, or raster elevation at the finest level the map shows or its
source has (zoom 15 for the default source). A spawn waits only for detail the
map has and has not yet drawn inside the region, never for detail that does not
exist. A separate minimum-detail column discovers center ground height for new
AGL starts even when the formal sphere is high above terrain.

Regions follow the aircraft during flight without a map-readiness pause. A sphere
is a streaming volume, not an empty bubble that must fit above every surface.
Deprecated low-spawn parameters remain registered for preference compatibility;
they no longer change the World-detail rail or impose the old global hold.

Map → Detail → Show loading region draws the region in the world: the sphere as a
faint cyan shell with rings, the cone as cyan rings and lines, the ground inside
them tinted red, deepest where it meets their boundary, and an amber box around
each map tile the region still waits for. While preparing (the default) shows it
while the loading card waits and hides it when the aircraft starts; Always keeps
it during flight, following the aircraft; Off never shows it. Amber boxes are why
a spawn waits; red ground with no amber box is ready.

## Controls and recovery

The central loading card is nonmodal. Initialized UI and camera controls remain
available while physics waits. Spawn now anyway is offered only once the aircraft
and its physics exist; it cannot bypass their initialization, and it waives only
this operation's map wait. It never samples a new height: an absolute
destination, switch or saved flight keeps its altitude, and a new above-ground
start keeps the aircraft's own altitude until its ground is known, then the
ground-relative altitude the card shows. The card states that altitude and how
far it is above or below the ground loaded so far. Teleport above ground appears
only when that ground is known and the aircraft is lower than standing on it; it asks, through
the usual question, to raise the aircraft to stand just above it. No keeps the
card. Downloads continue afterward.

Terrain that appears through an aircraft creates a proposal, not an altitude
write. It offers Resume flight here or Teleport above ground. Pausing and
resuming does not answer it. An aircraft standing on its ground (its lowest
contact within 2 cm of JSBSim's floor, or pressed into it) keeps that floor and
keeps flying while asked: its props keep turning and nothing drops it. Any other
aircraft is held, with native support withheld, until the pilot answers.

Resume flight here acknowledges the current overlap and gives the aircraft back
the floor it had: the one it stands on, or the last one under a flying aircraft,
so it can still land where the ground was. Containing-world collision hits are
withheld until the overlap ends: the aircraft's complete contact/hull footprint
clears the real surface, or the surface under the aircraft comes back down to
that floor. An aircraft without a trusted floor, such as one placed below its
support, flies on with native support withheld. Tile revisions do not reset this
acknowledgement. Meanwhile a compact status says contact resumes once the
aircraft is clear, and still offers Teleport above ground; No keeps the status
and the position. Ordinary collision behavior resumes after exit. Actual terrain
remains visible and available to readiness/HUD diagnostics.

A finer surface under an aircraft standing on its ground is a "surface
refinement" proposal, asked even for small changes. A drone hovering a few
centimetres up to land is flying, not standing, so a finer map under it is not
asked about unless it comes up through its legs. Accepting a refinement moves
only the aircraft's height by the difference, from where it is now: velocities,
gear compression and integrator history carry on. Other accepted moves
reinitialize JSBSim at the new height, keeping lateral motion and removing only
downward velocity. Declining a lower surface leaves the aircraft to settle onto
it under physics.

Placement is judged by the contacts too. After a reset, an aircraft standing on
the ground under it is not asked to move, even when its nominal stance is
higher than where its springs actually settle it.

JSBSim is never initialized on a floor above the aircraft's support. Its
initial-condition run settles the contacts and seeds the integrators, so a floor
above the gear would launch the aircraft on the first step. A location reset or
saved flight that starts more than 1 mm below its support (ground plus the
stance's clearance at its roll and pitch) gives JSBSim ground 10 km below
instead, and the terrain contact then asks about placement. The engine test stand
is the exception: it is held down, so it is always placed standing on its gear.

The camera begins overhead for world entry and approved destination moves, starts
an eased approach at minimum readiness, and aims to arrive 0.5 seconds before the
estimated final detail. Without an estimate it uses a three-second approach.
Early completion shortens the remaining transition smoothly; late completion
waits at the destination. Camera gestures hold the view where the pilot puts it
while the map loads. Once the map is ready and the pilot has let go (no drag,
swipe, stick, phone pad or gliding orbit for 0.6 seconds), the camera comes
down from there in 1.5 seconds, and the aircraft starts once it arrives;
another gesture holds it again. Explicit view selection returns to the normal aircraft camera.
Reduced motion uses that camera immediately. Aircraft switches retain their
existing view.

## Verification

Focused tests cover absolute-altitude restoration, fresh consent and cancellation,
loading overrides, local region readiness, off-camera coverage, cone direction,
camera timing/takeover, underground contact/collision restoration, refinement
acceptance and initial terrain below the support.
`src/flight/drone/droneLanding.integration.test.ts` lands the Mini 2 and Air 2S
on real JSBSim while the map sharpens and drops out under them, with a pilot who
answers each question after 1.5 s, and checks physics never pauses and the drone
never loses the ground it stands on. Other physics tests that build a
terrain contact answer Yes to every proposal at once
(`src/flight/testing/acceptTerrainRelocations.ts`), as a pilot who always accepts. The offline
aircraft-switch check uses actual physics and models, and explicitly clicks Spawn
now anyway because its fallback globe does not validate live map coverage.

For local testing run `cd ~/gh/0sfs/fly && npm run dev` and open
`https://localhost:7470/fly/test/spawn-loading`, the task's Test-tab checklist
(`build/test-plans/spawn-loading.json`); Finish → Download feedback exports the
selected diagnostic snapshots and observations. In addition
to switching Mini2 → Air2S near ground, try delayed loading, looking away during
preparation, moving the camera before the map is ready, declining a teleport,
and resuming inside coarse terrain. Screenshot
fixtures demonstrate UI layout; live map quality and timing still need manual
evaluation on the intended device/network.
