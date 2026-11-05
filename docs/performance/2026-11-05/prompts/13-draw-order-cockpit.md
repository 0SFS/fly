# 13 — Draw order and the cockpit view

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** stop shading map pixels that the aircraft or the cockpit hides,
which matters most on a tile GPU such as the Adreno 540.

**Owns:** the flight's scene setup in `~/gh/0sfs/fly/src/flight/` and
`fly/src/flight/cockpit/cockpitScreen.ts`. The scene's rendering groups are
shared with FOSS Earth: agree any change to them with its owner (F4).

## Evidence

Babylon draws a rendering group's opaque meshes in `PainterSortCompare`
order, by material ID, to save state changes (`Rendering/renderingGroup.js`),
and nothing in fly, the renderer or the engine sets another order. So the
terrain can be shaded first and the aircraft drawn over it. In the cockpit
view the panel covers a large part of the screen, and
`cockpitScreen.ts` records the TODO "Do not draw the world the cockpit
covers". Adreno 5xx rejects hidden fragments early through low-resolution Z
only when the near surfaces were drawn first.

## Steps

1. **Front-to-back opaque order.** Try
   `scene.setRenderingOrder(group, RenderingGroup.frontToBackSortCompare)` for
   the group holding the aircraft and the map. The final image is the same
   for opaque surfaces with a depth test, except where two surfaces lie in
   one plane; compare images at a set of views (chase, cockpit, low over
   terrain, Google 3D tiles) and look for coplanar differences. More material
   switches cost CPU, so measure both GPU time and `render/draw` on the
   desktop (paired) and on the phone, and keep it only where the GPU saving
   wins.
2. **Cockpit first.** In the cockpit view, draw the cockpit's opaque parts
   before the world, so the depth test rejects what they cover. Rendering
   group order or a depth pre-pass of the cockpit alone both work; the
   cockpit's own transparent parts (canopy, screen overlay) must keep their
   current order and blending.
3. **Measure the cockpit screen.** Its page mirror refreshes at
   `osfs.cockpit.screen.refreshRate` (30 Hz). Record its cost on the phone so
   the phone profile can choose 15 Hz with evidence.

## Validation

Image comparisons per view with the user's review of any difference, and
paired frame and GPU times. Report a no-gain result if the extra state
changes cost more than the overdraw saves.
