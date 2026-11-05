# 11 — HUD compositing over the moving canvas

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** measure, and if it pays, remove the backdrop blurs the HUD draws
over the 3D view every frame.

**Owns:** `~/gh/0sfs/fly/src/styles/flight.css` (lines 370–378, 1406) and
`fly/src/styles/globe.css` (lines 93–104). FOSS Earth's toolbar styles are
not in scope.

## Evidence

The toolbar instrument pills (load, gear and autopilot in the default
compact layout; the tapes in the classic one), the circle buttons and the
status card use `backdrop-filter: blur(3–8px)` with large shadows over a
canvas that changes every frame. The compositor must blur what lies behind
each of them every frame. Their fill is already 76% opaque. Not measured.

## Steps

1. On the phone (prompt 01's method) and with Chrome's 4× CPU throttle on the
   desktop, measure frame time and GPU or compositor time with the blurs and
   with `backdrop-filter: none` and the fill raised to about 85% opacity.
   DevTools' Rendering panel (layer borders, paint flashing) shows the layers
   involved.
2. If it pays, show the user both versions at the same view; the change is
   visible and needs their approval.
3. Optional, a setting, default off: update the HUD's numeric readouts at
   20 Hz on phones. Digits changing faster are not readable, and each change
   costs a layout.

## Report

Frame-time pairs, screenshots, and the decision.
