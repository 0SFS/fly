# F-35B model performance work specification

Status: specification only, 2026-10-21. The current performance work must not
change aircraft geometry, textures, authored poses, model selection or visible
detail. Implement this as a separately reviewed task.

## Problem and measured baseline

The F-35B currently has one exterior level, selected by Auto at every distance.
It loads the AF267 airframe and the installed F135 export. Reducing polygon count
alone will miss much of its CPU cost: the assets have many independently drawn
pieces and material bindings.

Direct GLB JSON counts, measured from the files currently served by `fly/public`:

| Asset | Triangles | glTF mesh objects | Primitives | Nodes | Materials |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cessna 172 LOD3 | 1,016 | 23 | 24 | 24 | 6 |
| F-35B AF267 airframe | 11,467 | 85 | 114 | 86 | 18 |
| Installed F135 | 12,592 | 145 | 145 | 263 | 7 |
| F-35B combined | 24,059 | 230 | 259 | 349 | 25 |

These are source asset counts, not GPU draw-call counts. Babylon splits glTF
primitives and adds roots; the current full application diagnostic has 281 scene
meshes for the F-35B and 31 for the Cessna. That count includes scenery and
effects. The F135 aperture alone has 112 moving transform bindings, seven roles
around sixteen segments; removing those bindings indiscriminately breaks the
rigid nozzle mechanism.

An eight-second headless WebGL2 flight capture at 1280×800, DPR 1, using offline
flat terrain, measured mean render work around 10.47 ms for F-35B versus 0.70 ms
for Cessna. F-35B main drawing accounted for about 7.36 ms, render targets 0.95 ms
and active-mesh evaluation 0.41 ms. This is a diagnostic on one machine, not the
user's live Google-terrain FPS or an isolated estimate of model cost. Material
invalidation and other runtime defects must be fixed before attributing all of
this gap to geometry.

Local evidence is in `build/perf-20261021/aircraft/2026-10-21_123950/report.json`
and the corresponding CPU profiles. `build/perf-20261021/render-audit-report.json`
contains a separate NullEngine probe; it does not measure browser/GPU FPS.

## Deliverables

1. A reproducible build-time export pipeline producing an exterior LOD ladder
   from retained originals. Preserve the current detailed assets as a selectable
   reference and for close inspection. Do not manually edit deployed GLBs.
2. A part/material/primitive inventory and before/after manifest for every
   exported level, including triangles, vertices, primitives, imported Babylon
   meshes, transform nodes, materials, textures, decoded texture bytes, file
   bytes, hashes and generation commands.
3. A binding contract manifest preserving each required runtime node name,
   hierarchy, local origin, axes, scale and attachment transform. Keep logical
   attachment nodes even when render geometry is merged beneath them.
4. Automated pose checks, repeatable visual comparisons and browser performance
   results for both WebGL2 and WebGPU where supported.

Prioritize merging static opaque pieces that share material and move together,
removing duplicate materials, atlasing compatible surface regions, and reducing
exporter-created primitives. Merge only within the same motion and visibility
group. A merged mesh with many material submeshes does not by itself reduce
draws. Reuse repeated nozzle geometry through an explicitly validated instancing
path where it preserves independent rigid poses, material response and depth.
Perform texture baking and decimation at build time.

Provisional engineering targets, to be accepted or revised using the baseline
camera matrix and visual review:

| Exterior level | Triangle target, including engine | Color-pass draw target for aircraft | Intended use |
| --- | ---: | ---: | --- |
| Detailed reference | Current 24,059 retained | Report current count | Close inspection/manual choice |
| Near | ≤12,000 | ≤80 | Normal close chase |
| Medium | ≤5,000 | ≤40 | Aircraft occupies a modest screen area |
| Far | ≤1,500 | ≤20 | Silhouette and broad motion |
| Distant | ≤400 | ≤8 | Small on-screen silhouette |

The draw budgets apply with gear stowed and ordinary combined exhaust enabled;
report gear-down, STOVL and engine-inspection counts separately. Do not satisfy a
budget by hiding visible hardware or dropping animations. Treat these as proposed
targets rather than an assertion that these visual and mechanical constraints
already fit those numbers. Choose Auto thresholds from projected screen error,
viewport resolution and field of view; record any distance-based approximation
in the catalog. Avoid rapid oscillation and visible blank frames at transitions.

## Required behavior

Exterior identity and close-view quality must survive: silhouette, canopy and
cockpit view through it, intake and exhaust openings, markings, surface normals,
material roughness/metal response, transparent order, and the current engine's
visible articulated geometry. Preserve wingspan, position relative to the flight
datum, model yaw/offset, cockpit eye and engine-test focus values. A pilot-view
cockpit can use a separate high-detail representation, but entering or leaving
it must preserve the current view and must not reveal a missing cockpit through
the exterior canopy. Never replace a visible cockpit with a flat opaque pane to
hit a budget.

Keep all currently active bindings in `aircraft/src/aircraftAnimation.ts`,
`fly/src/flight/aircraft/fleet.ts` and
`engines/src/engineNozzleRig.ts`. In particular:

- Left/right elevators, flaperons and canted rudders keep their authored axes and
  native observation-driven deflections.
- Gear, pistons, wheel/strut children and bay doors retain their sequenced travel,
  pivots, rolling behavior and fully stowed visibility groups. Hidden gear and
  first extension retain color/depth pipeline warmup behavior.
- Lift doors, engine doors and exhaust doors retain STOVL motion and independent
  pivots. Nozzle pitch/yaw and aperture remain native-driven rigid transforms;
  pausing must hold every actuator instead of introducing a display-time clock.
- `F135_Engine`, `F135_Bearing1/2/3`, `F135_Nozzle`, `F135_Exhaust` and every
  declared aperture part keep equivalent physical coordinates and hierarchy.
  Preserve metre scale, the hot-surface material regions and the engine-only
  assembly selection.
- Gas support sections, aperture exit/throat geometry, depth clipping, hot solid
  emission, gas emission, nearby light exclusion and smoke attachment remain
  physically aligned through straight flight, nozzle vectoring and aperture
  motion. A low-detail shell must not occlude gas with a cap across its opening.

Visual LOD must remain independent of physics and collision. Aircraft render
meshes stay non-pickable; the flight's terrain probes must not begin hitting its
own model. Do not derive JSBSim geometry, ground-contact locations or aerodynamic
coefficients from a decimated visual asset. Keep collision/debug overlays and
external tanks correctly aligned, with their existing ownership and visibility.

## Acceptance

Use the same aircraft state, camera, renderer, resolution and scene content in
paired before/after runs. Capture color and opaque-depth images from front,
rear, both sides, quarter views, above/below, cockpit and engine inspection.
Exercise gear at 0, intermediate positions and 1; STOVL at 0, intermediate
positions and 1; both yaw signs; straight and near-vertical nozzle pitch; aperture
at 0, 0.5 and 1. Include native cold/dry/afterburning engine states and partial
door travel where gaps or intersections are easiest to see.

For Auto transitions, compare from matched cameras on both sides of each
threshold and while crossing repeatedly. Establish screen-space silhouette and
surface error tolerances using retained reference images before accepting a
level. No visible silhouette pops, missing surfaces, clipping, material changes
or animation regressions at intended viewing distances. Keep manually chosen
detailed view available. Preserve loading progress, errors, cancellation,
switching and no-incomplete-frame reveal behavior.

Record median and p95 main-thread render time, main pass and depth draw counts,
active meshes, frame duration, GPU time where available, shader/effect preparation,
memory and download size. Require a repeatable improvement beyond run-to-run
noise; the normal chase level should reduce aircraft color-pass draws by at
least half relative to the corrected current detailed runtime and materially
reduce main-thread render time. Report the complete scene separately from
aircraft-only measurements. No savings can come from lowering viewport quality,
terrain detail, simulation rate, exhaust quality or changing native flight state.

Retain the original AF267 Blender source and textures, attribution, CC BY 4.0
license/link and provenance. Retain the separately authored F135 engine source,
AGPL-3.0-only ownership and generated asset manifests. Record each derivative,
source hash, generator/tool version and export transformation. Do not overwrite
source evidence or claim a simplified derivative is the unmodified original.
