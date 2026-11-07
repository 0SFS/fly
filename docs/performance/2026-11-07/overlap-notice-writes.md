# The terrain overlap notice without per-frame restyles — 7 November 2026

Ledger: P-124. Fly `45ccca2`; baseline fly `75b4ce0`. Not an item of the
5 November audit. It came from a style and layout trace of the flight in
Chrome.

## What it was

The flight updates the terrain overlap notice every frame
(`updateTerrainOverlap`, in the frame's terrain section). Nearly always
there is nothing to show, so the update is `update(null)`.

Each update set the `hidden` flag of the card, its title and its two
buttons, whether or not the flag changed. Writing `hidden = true` on an
element already hidden still sets the attribute, so Chrome puts the page's
style out of date. The next read of the canvas's size then restyles the page
before the frame can go on.

In a trace of fly in flight, the notice put style out of date 0.86 and 0.87
times a frame, more than any other script. The map's `readImageryView`,
which reads the canvas's size during the map update, restyled the page once
every frame.

## What changed

`src/flight/placement/createTerrainOverlapNotice.ts` writes each `hidden`
flag only when it differs (`setHidden`). The text and labels were already
written only when they changed, and `classList.toggle` with a force changes
nothing when the class already matches.

## Why it is exact

The notice's state is only its DOM. A skipped write would have set an
attribute to the value it already had. Nothing in the notice reads the
mutation records, and nothing else on the page watches the card.

## Proof

- **Differential harness** (`build/overlap-notice/diff.test.ts`, jsdom).
  - The notice at HEAD (`before.ts`) and the working tree, each in its own
    document, go through the same 60 seeded runs: 84,204 updates in runs of
    one to six repeats, as per-frame updates come. The states cover nothing to
    show, asking, the compact status with and without a move, a moved ground,
    a hard impact and an empty message.
  - After every update it compares the card's whole markup and `describe()`.
    Every seventh step it clicks both buttons and compares which callbacks
    ran. After disposal it compares the documents.
  - All identical. The A/A run (`AA=1`) passes.
  - Mutation records: 182,650 before, 66,809 after. Writes of `hidden` that
    left it as it was: 115,841 before, none after.
- **`createTerrainOverlapNotice.test.ts`**: a new test. For five states, it
  checks that the update coming from a different state changes the page, and
  that repeating it twice changes nothing.
- **Mutants** (`build/overlap-notice/mutants.py`): 10 of 10 caught.
  - Caught by the tests only, because they change no state:
    - HEAD itself;
    - each of the four flags written always;
    - the helper writing always.
  - Caught by the tests and the harness:
    - the helper's comparison inverted;
    - the helper writing the opposite;
    - the card shown when there is nothing to show;
    - the move button never hidden.
- `npm run typecheck` passes. The placement tests (12) and
  `createFlightSimApp.test.ts` (87) pass.

## Measured

Chrome on the M5. Fly was built twice from `75b4ce0` with only this file
different, both with the uncommitted work in the checkouts. Headless,
Metal, the default start, interleaved before, after, after, before, under
the perf lock. The tool was research's `profile.mjs --layout`, which traces
each style recalculation and layout and names the script that forced it and
the script that put it out of date. Each run was 10 s, with the CPU profiler
on.

| Run | Style recalcs a frame | Style ms/s | Layouts a frame | Forced in `readImageryView` | Notice's invalidations a frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| before 1 | 2.65 | 6.0 | 1.13 | 1.00 a frame, 1.9 ms/s | 0.87 |
| after 1 | 1.79 | 5.5 | 1.12 | 0.14 a frame, 0.5 ms/s | none |
| after 2 | 1.79 | 5.6 | 1.11 | 0.13 a frame, 0.4 ms/s | none |
| before 2 | 2.67 | 6.0 | 1.13 | 1.00 a frame, 1.9 ms/s | 0.86 |

Builds and harness: `build/overlap-notice/`. Profiles and traces:
`research/build/benchmarks/startup-audit/profile-fly-on-*/`.

The page restyles about one time fewer a frame. The restyles removed were
small ones, so style time went down by only 0.4 to 0.5 ms/s. Main-thread
time (35 and 35 %, then 36 and 36 %) and frame rate (58.8 to 59.0 fps) did
not move beyond the runs' noise. Nothing was measured on a phone.

## Left

- The engine's `applyWorldViewport` reads the canvas's CSS size twice a
  frame: once when the frame is prepared, and once just before the render.
  Before the render, the HUD has changed its readouts' text, so the read
  forces a restyle (1.62 a frame, 6.2 to 6.6 ms/s) and a layout (1.01 a
  frame, 5.7 to 5.8 ms/s).
  - The layout would happen anyway before the frame is painted. Forcing it
    puts it inside the frame's script, ahead of the render.
  - Not reading the size there would need a cached size, which can be one
    frame late after a resize. That changes behavior, so it is not done
    here.
- Style also goes out of date 0.94 times a frame with no script behind it.
  The source is not found yet.
