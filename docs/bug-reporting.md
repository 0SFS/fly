# Reporting bugs

Open **Bug report** from the tab strip's **+**, or use the 🐞 icon on the bottom-left
toolbar when it has room. Give the issue a title and describe what
happened, then review the report's file tabs. Use **Download all** to save a standard
`.zip` and open the GitHub issue draft. GitHub handles sign-in if needed. Attach the
downloaded file to the draft and submit the issue in `0SFS/fly`, the repository the build
records. There is no report text to paste.

Bug report, Settings → Diagnostics, loading failures and failed aircraft changes all use
the same FOSS Earth report viewer. Read `index.txt` first: it names the failure as
`file:line` and quotes that line. `index.json` contains the same references and each file's
line count. Every file opens directly in pages of 100 lines. Use **Previous**, **Next**, or
**Go to line** to read it all. Search results highlight their line with surrounding
context. File tabs remember their page positions. **Copy this file** and **Copy all**
are available alongside downloads; reading requires neither downloads nor clipboard access. **Download this file** saves the selected text
file; **Download all** saves every file in a store-method zip. Failed dynamic imports
include a reminder that the dev-server log is outside the report.

The shared FOSS Earth report includes the running build and component revisions, browser,
viewport and device capabilities, requested and active renderer, available GPU details,
effective settings, warnings and errors, retained activity, and the previous visit's trail.
0SFS adds the aircraft and its visual generation and detail, model status, camera view,
simulation state and physics fault, and JSBSim's package and engine/SDK commits. Loading
starts using the same activity capture before the flight module is downloaded. The report
does not switch on flight recording or performance traces.

For a frozen world, the report also includes **Render health**, **Flight progress**
and **Console diagnostics**. Render health records CPU frame starts, scene starts
and completions, frame ends, their ages, the scheduler's current activity and native
WebGPU validation errors. A completed CPU frame does not prove that the GPU presented
it. Flight progress adds the last flight tick's age, native simulation time and physics
time accounting. These observations run on existing frame callbacks; they add no
render loop, GPU fences, readbacks or periodic sampling.

GPU errors are captured directly from the device, including after Babylon stops
printing console warnings. The first error and seven recent distinct errors retain
up to 32,768 characters each, with repeat counts, arrival times and engine frame numbers.
The first warning and seven recent distinct console warnings/errors retain up to
16,384 characters each. Both records count evictions and flag shortened messages. These full
records last for the open visit. The first four distinct GPU errors also write up
to 8,192 characters each into numbered activity lines, so their causes can survive a reload;
normal trail retention still applies. The ordinary short activity line remains
limited to 300 characters.

If the world freezes, open Bug report and download it while the page is still open,
before reloading. The loading snapshot describes startup and stops collecting when
startup finishes; the shared report also includes the current flight observations.

If the flight stops before you can reach Settings, open `/fly/?report` on the same site.
That page reads the previous visit's retained trail and startup checkpoints without
starting or preloading the renderer or flight simulation. The report files named
`latest-*` and `previous-*` belong to the saved startup attempts. Their checkpoint
metadata identifies capture times, outcomes, and every shortened or omitted section.
The recovery page's own build and environment are labeled separately. Opening the
report repeatedly preserves the saved evidence.

Startup capture begins before application modules run. It saves operation starts
before invoking expensive work, including application import, renderer, JSBSim, and
terrain preparation. Renderer and physics may run together: several running
operations do not identify which allocation caused a crash. Loading phases also
record aircraft downloads. Progress snapshots are coalesced to at most one per
second; operation boundaries and failures save immediately. Each attempt is limited
to 512 KiB of serialized browser storage, with two attempts retained per page path.
Capture respects `diagnostics.trail`; disabling it removes those checkpoints.
Unavailable or full storage is reported in the live report.

The files include available JavaScript heap and WASM observations. Missing data
says unavailable; those measurements do not represent total process memory or
Edge's sandbox limit. A browser kill can run no error/unload handler, and can lose
everything since the last saved checkpoint. An unfinished attempt has an unknown
termination reason. On the report-only page, enter the observed browser error code
and refresh the report to annotate it; the site cannot read Edge's crash screen.

`SBOX_FATAL_MEMORY_EXCEEDED` is Chromium exit code 7012, meaning its sandbox job
memory limit was exceeded. The code alone does not identify an allocation or prove
a leak. Do not assume Xbox's physical RAM is the browser's allowed memory.

Run the [desktop console-browser checks](console-browser-testing.md) first; reserve
Xbox testing for final platform confirmation.

For the local Xbox checklist, start `cd ~/gh/0sfs/fly && npm run dev`, then open
`https://localhost:7470/fly/test/xbox-crash-report?report` on the laptop, or the same
path after the network address printed by startup on Xbox. The checklist lives in
`build/test-plans/xbox-crash-report.json`. Try normal `/fly/` first, then return to
the report link after a crash. In **Test**, Finish displays feedback JSON in
**Review file**, even with downloads disabled; the downloadable JSON remains
available in browsers that support it. The custom link requires a server started
with the current configuration.

If loading stops, the log says so in one line: what stopped, and under it what was thrown,
such as `AbortError: Terrain preparation was replaced by another destination.` The visit's
trail keeps that line for the report. **Copy report**, on that line and on the loading
title, copies the shared plain-text report with the failure and loading snapshot.
`window.osfsLoadingDiagnostics()` exposes the loading snapshot in a console.

**View report** opens the shared file tabs, search and text/zip downloads. Close with
Escape or the top-left ×.
The viewer stays usable even while loading has made the application inert.

The report's `loading.txt` includes:

- Each phase's last state and history; phases stopped by a failure say `failed`.
- The thrown error's name, supplied stack (up to 32 KiB), source location, nested
  `cause` chain and aggregate errors. Missing module exports have a structured module
  URL and export name.
- Separate import and initialization operations, with durations and a `callerStack`
  captured **before** awaiting each operation. Some module-link errors have no throw
  stack; `stackUnavailable` explains that absence, and `callerStack` locates the code
  that requested the operation. It is not the location inside the failing dependency.
- Build revision, bundle, browser, page, online/isolation state and controlling service
  worker, plus recent browser errors, resource failures and resource timings/statuses
  when the browser exposes them. Zero transferred bytes or an unavailable status do
  not establish a network failure.

Capture starts when the loading screen is created, before the flight's dynamic import,
and stops on success, failure or destruction. A reset starts a new attempt. The report
retains at most 40 operations, 40 browser events and 80 resources; causes are limited to
six levels and eight aggregate children. Download the shared report while the failed
page is open; `/fly/?report` uses the retained activity trail, which also records the failed startup operation,
its error and its throw/caller stack lines (up to 40 lines per operation, subject to the
trail's own retention settings and limits). Failures that prevent `main.tsx` and its static
dependencies from running still belong to the earlier boot terminal.

Known secret settings, recognized credentials and URL queries/fragments are removed from
every string in the loading report, while stack line and column numbers are retained.
Until 2026-10-08 a failure that both the flight and the page's boot caught printed two
lines, and neither said what was thrown.

Known secret settings, recognized credentials, email addresses, URL queries and fragments
are removed from the public draft. Coordinate settings are omitted. Review the draft and
remove any other personal details before continuing; activity and error messages can
contain information the automatic redactor cannot recognize. The report stays on this
device as a downloadable file. The issue title and description are passed to GitHub when
the draft opens; the report reaches GitHub when you attach the file, and that attachment
is publicly accessible from then on. The issue is published when you submit it.

This flow runs in the static app. FOSS Earth owns the report UI and file generation;
0SFS consumes its public diagnostics and shell exports. The repository recorded by the
build selects the issue destination. The Bug report tab is the form's one home, and the
toolbar icon shows or closes that tab. Interface → Toolbar controls the icon: **Auto**
shows it when its measured width fits beside the flight controls and map attribution,
**On** keeps it visible, and **Off** hides the shortcut. Custom priorities change its
position. The tab stays available under **+**. Settings → Diagnostics keeps the activity
trail settings, **View report** and **Copy report**.

After an issue is filed, give an agent its issue URL, or its repository and issue number,
for example `0SFS/fly#123`. The component revisions and attachment help it investigate the code
that actually ran. The agent still fixes globe defects in FOSS Earth and flight defects in
0SFS, following the [repository boundary](foss-earth-relationship.md).
