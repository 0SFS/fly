# 12 — Frame-locked physics steps (low priority)

Read the [common brief](README.md#common-brief--applies-to-every-prompt) first.

**Goal:** with a 60 Hz display and 60 Hz physics, run exactly one step in
almost every frame, so a frame never pays for two F-35B steps because of
vsync jitter.

**Owns:** `~/gh/0sfs/fly/src/flight/physics/fixedStepLoop.ts` and its tests.
Check with the user who owns physics before starting; this file has had an
owner of its own.

## Evidence

The model below, with Gaussian vsync jitter, gives 1.3–5% of frames with 0 or
2 steps. Snapping the accumulator to exactly one step when it lies within
1 ms of the step boundary cuts that to under 0.1% at 0.3 ms jitter and to
about 3% at 1 ms, with simulated time drifting from wall time by under 0.1%. A second
F-35B step costs 1.7–3.5 ms on an SD835, so this affects the slowest frames,
not the average. The figures are a model, not a phone trace; prompt 01's
capture of steps per frame decides whether to do this.

```python
import random
random.seed(1)
DT = 1 / 60
def run(display_hz, jitter_ms, snap_ms, frames=200_000):
    acc, warp, off = 0.37 * DT, 0.0, 0
    for _ in range(frames):
        acc += max(0.0, 1 / display_hz + random.gauss(0, jitter_ms / 1000))
        if snap_ms is not None and abs(acc - DT) < snap_ms / 1000:
            warp += DT - acc
            acc = DT
        steps = min(3, int(acc / DT + 1e-12))
        acc -= steps * DT
        off += steps != 1
    return off / frames, warp / (frames / display_hz)
for hz in (60.0, 59.94):
    for jitter in (0.3, 1.0):
        print(hz, jitter, run(hz, jitter, None)[0], run(hz, jitter, 1.0))
```

## Design constraints

- A setting, default off; the phone profile may enable it.
- Snap only while the display interval is close to the physics step; never
  on 90 or 120 Hz displays or below 60 fps.
- Keep the loop's accounting closed: add a warped-time term so that
  `receivedSeconds = simulatedSeconds + discardedSeconds + pendingSeconds +
  warpedSeconds`, report it, and bound the total drift.
- Interpolation, the catch-up cap, pause, rest and faults behave as today.

## Validation

Accounting tests (the identity holds, drift stays bounded), the existing
fixed-step tests, and a steps-per-frame histogram from the flight capture on
the phone with the setting off and on.
