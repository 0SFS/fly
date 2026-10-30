# Desktop checks before Xbox testing

Run the desktop checks first. Use Xbox only for final platform confirmation after
these checks pass and any startup memory problems are understood.

```sh
cd ~/gh/0sfs/fly
npm run check:console-browser
```

The command builds the current production app, serves it on a temporary loopback
server, and runs two checks in isolated browser profiles. It uses installed Edge
when found, otherwise installed Chrome/Chromium, and records the actual browser.
It never downloads a browser. Use `--binary=/path/to/executable` to select one.
The server, test browser, and profiles are closed on completion. It leaves other
browsers and dev servers alone.

- **Startup:** load the real app, apply a critical memory-pressure notification,
  and require finished startup and rendered content, without unhandled exceptions
  or fallback assets, inside the selected resource budget. Stay ready for 20 seconds.
- **Recovery:** hold the real JSBSim WASM request after startup has recorded its
  operation, then abruptly terminate the attributed page renderer, verified against
  process IDs reported by the test's browser. Open `/fly/?report` in the same profile and verify the original attempt
  ID, every file's last line, and that no simulator runtime or modules start.
  Downloads are denied by browser policy and clipboard writes are blocked.

Recovery success is independent of startup fitting the budget. A failing startup
and passing recovery still produce a failing overall check. The recovery check
uses real application checkpoints, with no seeded report fixture.

## Synthetic constraints

These defaults are chosen stress-test conditions, **not measured Xbox specs**:
1920 × 1080 viewport, device pixel ratio 1, WebGL2, 2× CPU slowdown, four reported
CPU threads when CDP supports that override, a 256 MiB V8 old-space cap, and a
768 MiB page renderer budget. Each scenario has a 45-second timeout.
A sampled budget excess triggers abrupt renderer termination and recovery.

The selected memory counter is explicit in the report:

- macOS defaults to **process footprint**, queried through `proc_pid_rusage` by
  a Python 3 standard-library helper. It counts dirty/compressed process memory.
- Linux defaults to **RSS**. `--memory-metric=rss` also selects the original,
  stricter RSS stress check on macOS. Footprint is currently macOS-only; requesting
  an unsupported or unavailable counter fails the check.

Both are sampled once per second. Raw RSS remains recorded in footprint runs;
`rssStressBudgetExceeded` preserves whether the separate RSS criterion failed.
The [Windows job limit](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)
behind the sandbox error concerns committed memory. RSS also includes resident
shared code/libraries, so it is not that limit. Apple's
[footprint accounting](https://developer.apple.com/videos/play/wwdc2022/10106/)
is a useful desktop allocation proxy, **not Windows committed memory or a measured
Xbox allowance**. A footprint pass is not an RSS pass.

A short, bounded HTML-parse trace identifies the renderer of the navigated main
frame. Only that process counts toward the budget. Chrome UI, extension and spare
renderers are recorded separately, including their diagnostic sum. Counting all
of them as flight memory incorrectly charges unrelated browser overhead to the app.
The page renderer's own RSS still includes shared libraries and resident mapped code.
This observation is neither exact committed memory nor the Xbox sandbox's job
memory accounting. The V8 limit covers part of JavaScript memory, not WASM,
native allocations, textures or total process memory. A memory-pressure
notification is also not a memory cap. GPU memory is not fully measured.
Network URL events use a 4 KiB DevTools payload buffer; response bodies are not
needed by this test and must not accumulate in its instrumentation.

The test keeps the actual desktop browser identity; changing its user agent would
not reproduce Xbox's OS, Edge build, GPU/driver, WebGPU capabilities or sandbox
limits. A pass narrows the remaining hardware checks; it does not certify Xbox
compatibility. The fresh profile uses public default terrain without account
credentials or Google keys. It does not establish behavior of a Google 3D scene.

Examples:

```sh
npm run check:console-browser -- --renderer=auto --width=3840 --height=2160
npm run check:console-browser -- --heap-mib=128 --renderer-budget-mib=512
npm run check:console-browser -- --scenarios=recovery
npm run check:console-browser -- --memory-metric=rss
```

Changing budgets explores sensitivity; raising a budget to obtain a pass is not
an Xbox memory fix. To reuse a build without rebuilding:

```sh
node scripts/check-console-browser.mjs --dist=build/console-browser/dist
node scripts/check-console-browser.mjs --scenarios=startup --profile-allocations=1
```

Results, real startup checkpoint JSON and recovery screenshots are retained under
`build/console-browser/runs/<timestamp>/`. `report.json` records assumptions,
browser version, sampled memory timeline, operation states, crash evidence,
recovery results and cleanup failures. The command exits nonzero if any selected
scenario fails. A timeout or unsupported observation is not a successful startup.
Successful startup also saves `startup.png`. Allocation profiling adds JS/native
samples, terrain resource estimates and heap backing-storage observations; macOS
also attempts a native `vmmap` summary. Profiling affects allocations and timing,
so use an ordinary run for acceptance. Profiling also observes exposed worker
heaps and page WASM memory sizes without assuming they represent total memory.

For an equivalent-counter comparison, this build removes only the flight host
resource overrides, retaining the current report and kernel fixes:

```sh
npx vite build --configLoader native --config scripts/console-browser-baseline.vite.mjs --outDir build/console-browser/baseline-dist
node scripts/check-console-browser.mjs --dist=build/console-browser/baseline-dist --scenarios=startup --memory-metric=footprint
```

The inherited-default comparison exceeded the 768 MiB footprint limit at 867 MiB
on 30 October 2026 (Chrome 156, Apple M5, the constraints above). The final flight
defaults completed startup and 20 seconds of ready flight at 678 MiB peak sampled
footprint, with successful forced-crash recovery and all retained files readable.
Its 881 MiB sampled RSS still exceeds the separate 768 MiB RSS stress criterion.
These are local observations; neither result certifies Xbox or Google 3D scenes.

## Flight resource defaults

The flight uses host defaults independent of reported physical RAM: AWS
Terrarium elevation (256-pixel tiles instead of Mapterhorn's 512), a 32 MiB
imagery GPU budget, 256 terrain patches, 32 historical cached patches, 32 mesh
segments per tile, six preparation workers with one sky thread, two simultaneous
elevation downloads, and 32 elevation-loader cache entries. Required/displayed
terrain and its ancestors remain protected beyond the historical cache limit.
The terrain core uses its recorded Auto implementation to avoid keeping duplicate
height grids in mesh workers. Explicit saved settings keep their precedence,
including a different elevation provider or larger budgets.

The smaller provider tiles use one quarter of the decoded float32 storage per
grid. Provider height data/resolution differ; no numeric rounding mode or physics
rate changes. Smaller patch and imagery budgets can show coarser distant terrain
and retain less imagery. The generic globe app's defaults are unchanged.

`flight-resources.txt` records effective values. `terrain-region.txt` records
readiness and the current target alongside the existing loading and WASM files.
Regional preparation is scheduled before optional visual refinement. Height
bounds exclude terrain provably below an airborne loading volume;
placeholder globe heights are never evidence for this exclusion. Center-height
discovery remains active independently of an empty airborne volume.

The native elevation decoder reuses one cleared canvas and consumes its owned
RGBA readback as float32 height storage, avoiding a second full-size page buffer.
The default public decoder API still preserves caller input. Opt-in storage
consumption is checked against the Rust/WASM twin for identical height bytes.
Resource captures distinguish loader-cache bytes from unique elevation buffers
retained by terrain records and their neighbors; those estimates overlap and
must not be added together. Exposed local worker heaps are diagnostic samples;
missing worker targets do not establish zero worker memory.

After reviewing and committing only the task's changes, the affected source
repositories have these push commands:

```sh
git -C ~/gh/foss-earth/ui push origin main
git -C ~/gh/foss-earth/engine push origin main
git -C ~/gh/foss-earth/app push origin main
git -C ~/gh/0sfs/fly push origin main
```

The interactive report/checklist from [bug reporting](bug-reporting.md) remains
available for the eventual Xbox confirmation. It is not required to run these
local automated checks.
