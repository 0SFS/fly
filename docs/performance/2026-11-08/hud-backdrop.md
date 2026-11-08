# HUD backgrounds without backdrop blur, behind a setting — 8 November 2026

[Prompt 11](../2026-11-05/prompts/11-hud-compositing.md) of fly's 5 November
phone audit. Ledger: P-143. Baseline: fly `15330a3^`.

Commit: fly `15330a3` (already pushed and deployed, together with the attitude
painter changes of [P-144](attitude-mirrored-sky.md)). This note adds the
proof it did not have.

**Status:**

- A setting: **Interface → Flight instruments → Backgrounds over the view**
  (`osfs.hud.backdrop`), Blurred or Flat.
- The default, Blurred, styles the page exactly as before. Proven below.
- Flat is not measured yet. Whether it pays on a phone, and whether to make it
  the phone's default, is the user's decision after prompt 01's phone run.

## What changed

- `src/flight/hud/hudBackdrop.ts`: `watchHudBackdrop` marks the flight's root
  (`.flight-app`) with `data-hud-backdrop="flat"` while the setting is Flat,
  and removes the mark otherwise. It applies live.
- `src/styles/flight.css`: five rules, each needing that mark:
  - `backdrop-filter: none` on the toolbar's load (G meter), gear and
    autopilot, and on the status card (paused or fault).
  - The see-through fills a little more opaque, so about as much of the view
    shows through, only sharp:

| Fill | Blurred | Flat |
| --- | ---: | ---: |
| Dark, unlit | 76 % | 85 % |
| Tinted reading (the G meter's green) | 75 % | 85 % |
| Light theme, unlit | 82 % | 89 % |
| Lit gear or autopilot | its own | its own (unchanged) |
| Status card | 90 % | 90 % (only the blur goes) |

The circle buttons' blur in `globe.css` (prompt 11 names it) is not used by
the flight page today: no element of it has a backdrop filter other than the
three above.

## Exactness of the default

**Unit tests** (`src/flight/hud/hudBackdrop.test.ts`, in `15330a3`):

- The default is Blurred, and the root then has no attributes at all.
- Flat marks the root live; Blurred, a reset and the watch's stop unmark or
  leave it.
- Every rule in `flight.css` that names the mark requires
  `.flight-app[data-hud-backdrop="flat"]` in each of its selectors. The blurs
  of today are exactly the toolbar's and the status card's, and Flat turns
  off each of them.

**In the browser** (`build/hud-compositing/probe.mjs`, headless Chrome on
the M5, the dev server at fly `e2a1ce5`, under the perf lock):

- At the default the root carries no mark.
- Every computed property of all 439 elements of the flight page is the same
  with the five rules in the page as with them deleted from the style sheets.
- For the toolbar's instruments and the status overlay (8 elements), the same
  holds in all 16 combinations of dark and light theme, gear down or up,
  autopilot on or off, and a tinted or plain reading.
- A mutant, the blur rule without the mark, is caught by the same comparison.
- Loaded with `?set.osfs.hud.backdrop=flat`, the root is marked and no element
  of the page has a backdrop filter.

**What Flat changes** (same page; the root marked, all computed properties
compared), in both themes:

- `backdrop-filter: blur(8px) → none` on the G meter, the gear and the
  autopilot.
- The fills as in the table above (`rgba(12, 67, 10, 0.75) → 0.85`,
  `rgba(10, 14, 22, 0.76) → 0.85`, light `rgba(248, 250, 252, 0.82) → 0.89`).
- Nothing else on the page.

## Screenshots

In `build/hud-compositing/` (not committed): `crop0-blurred.png` and
`crop0-flat.png` (the instruments at twice the size), and `full-*.png`.

- Over the default start's view, the two crops are hard to tell apart:
  4,991 pixels differ, by at most 17 of 255 in a channel, all inside the
  three pills. Flat's fills are a shade darker, and the view behind them is
  sharp rather than soft.
- Over a busy view (city, clouds), the difference would show more: the
  blurred pills soften what is behind them; Flat ones show it sharp, letting
  through about 5/8 as much of it (15 % rather than 24 % in the dark theme).
- The full screenshots also differ in the view itself, which moved between
  them; they are not a comparison.
- The paused card was not on screen in this run, so it has no screenshot.

## Left

- Step 1, the measurement: frame time and compositor or GPU time, Blurred
  against Flat, on the SD835 phone (prompt 01's method) and with Chrome's
  4× CPU throttle on the desktop. Not done.
- Step 2: show the user both looks at the same view, over a busy scene, and
  decide.
- Step 3 (optional, a setting, default off): numeric readouts at 20 Hz on
  phones. Not started.

## Measurement plan

Under the perf lock, the built app, interleaved Blurred, Flat, Flat,
Blurred, in flight over a city with the default compact toolbar:

```sh
node ~/gh/0sfs/fly/build/perf-lock-wait.mjs acquire --agent <name> --task "HUD backdrop P-143 timing"
cd ~/gh/foss-earth/research
for s in blurred flat flat blurred; do
  node scripts/benchmarks/startup-audit/profile.mjs --target fly --root ~/gh/0sfs/fly/dist \
    --rates 1,4 --seconds 10 --cold-only --label "hud-backdrop-$s" \
    --query "flightPerf=1&set.osfs.hud.backdrop=$s"
done
node scripts/benchmarks/startup-audit/perf-lock.mjs release --agent <name>
~/gh/foss-earth/browser-testing/scripts/chrome-clones.sh --clean
```

Build `dist` first (`cd ~/gh/0sfs/fly && npm run build`, about a minute).
About a minute a run: one stretch at full speed and one with the CPU
slowed 4×. Read the frame time and the GPU process's share; the blur's cost
is in the compositor, not the page's main thread. Then the phone over USB.
