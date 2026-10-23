# Cockpit screen

The touchscreen across an aircraft's instrument panel shows the flight's own
interface: the instruments, the toolbar and the windows, as the chase view
shows them, and they can be pressed there. Code:
`src/flight/cockpit/cockpitScreen.ts`. Settings: Aircraft → Cockpit screen
(`osfs.cockpit.screen.*` in `src/flight/settings/flightParameters.ts`).

Only the F-35B has a screen so far: AF267's `panel` material, 0.54 m by
0.23 m (`screenMaterialNames` in `src/flight/aircraft/fleet.ts`). In an
aircraft without one, the interface stays where it is without a cockpit: over
the view, or in a headset, around the head.

## What it shows

| Setting | Choices | Default |
| --- | --- | --- |
| Screen shows (`content`) | the flight interface; the aircraft's displays | the flight interface |
| Background (`background`) | black; the chase view | black, or the chase view on the fastest computers |
| Instruments, Toolbar, Windows | Screen; HUD | Screen |
| Screen refresh rate | 1–60 Hz | 30 Hz |
| Screen resolution | the texture's width, 256–2560 px | 1280 px |

- **The aircraft's displays** is the model's own picture, unchanged: a
  stand-in until the aircraft's real displays are made. Choosing it leaves
  every part of the interface to the HUD.
- **The flight interface** is a copy of the page (`createDomMirror` from
  `@foss-earth/ui`), drawn into a texture on a transparent face 1 mm in front
  of the model's screen. The page's 3D view and what acts on the pilot's eyes
  are never on it. A copy takes at most 5% of the main thread, so a slower
  device copies less often and keeps its frames.
- **Behind the interface** the model's screen is black. It costs nothing.
  The chase view draws the world a second time, at half the texture's
  resolution each way and at the screen's refresh rate. It is the default only
  on a computer that reports WebGPU, 16 processor threads or more, 8 GiB of
  memory and no touch screen (`src/flight/cockpit/cockpitScreenDefaults.ts`).
  The default never changes during a flight, since it doesn't come from frame
  times.
- **Each part's place.** On a flat display, a part on the Screen is on the
  screen and also in the HUD over the view, while a part in the HUD is only
  there. In a headset a part is in one place: on the screen, or on a panel
  around the head (`foss-earth/immersive`).

## Pressing it

On a flat display a tap on the screen presses what is there on the page. A tap
is a press that moves under 6 px and lasts under 600 ms, so a drag still turns
the view. In a headset, a hand within 5 m that points at the screen plays the
mouse on the page there: the trigger presses and the thumbstick scrolls.

The headset's session sees the screen as a surface, `cockpit-screen`. `hit`
gives the page point under a ray, and `locate` gives the point in the world
where a page point shows. Through `locate`, a test aims at an element on the
screen by its selector:
`__fossEarthHeadset.tap(".foss-earth-panel-launcher-button")`, as in
[Testing as an agent](https://github.com/foss-earth/docs/blob/main/docs/agent-testing.md).

## Still to do

- **The aircraft's real displays.** They are opt-in through the Screen shows
  choice, and they show the model's picture until they are made.
- **Do not draw the world the cockpit covers.** See `../docs/TODO.md` →
  performance.
- **The headset's controllers fly nothing yet.** A keyboard, a game controller
  or a paired phone flies the aircraft while in VR.
