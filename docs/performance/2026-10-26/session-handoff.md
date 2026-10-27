# Performance continuation — October 26, 2026

Historical preparation checkpoint. The [October 27 final handoff](../2026-10-27/session-handoff.md) supersedes the lock, approval, candidate and process states below.

This continuation recovered the October 22 handoff and found three subsequent
October 24 engine optimizations already committed: display-tree lookup
(`5931043`), loaded-page scanning (`89f265f`) and narrow height keys (`7e61c70`).
Their reports are under `foss-earth/engine/docs/performance/2026-10-24/`.
Engine is now at `006034f`; exhaust is at `6a9bd23`. Fresh status at entry showed
both clean. Fly has preexisting dirty phone/HUD/settings/app work; preserve it.

Four new candidates were prepared in ignored scratch, without changing tracked
runtime source or starting measurements:

| Scope | Scratch relative to target repo | Report relative to target repo |
| --- | --- | --- |
| Selector: fast path for already cached surface samples | engine `build/perf-selector-20261026/` | engine `docs/performance/2026-10-26/selector.md` |
| Heights: compact sorted duplicate keys before emission | engine `build/perf-heights-20261026/` | engine `docs/performance/2026-10-26/heights.md` |
| Binding: compare larger tables as four-byte cells | engine `build/perf-binding-20261026/` | engine `docs/performance/2026-10-26/binding.md` |
| Depth: reuse projection result storage within one pass | exhaust `build/perf-depth-20261026/` | exhaust `docs/performance/2026-10-26/depth.md` |

All are unvalidated hypotheses. No improvement is claimed. No commit, push,
deployment, server, benchmark or browser run was made in this continuation.

The shared `fly/build/perf-exclusive.lock/owner.txt` still names the October 24
`perf-oct24` session and legacy shell PID 69184. That PID is absent and the
measurement-process status reports none. The newer
`foss-earth/research/scripts/benchmarks/startup-audit/perf-lock.mjs` explicitly
requires asking before removing another session's lock. The user was asked to
approve clearing this lock; the answer is pending. The lock is untouched.

Next, resolve that pending approval. Inspect processes again, preserve the old
owner record if removal is approved, and acquire the shared lock under the new
session's own name. Serialize validation in this order: heights, selector,
depth, then binding. Commands and captured baselines are in each report. Keep
checks short and stop candidates once evidence is clear.

Use current baselines in the prepared harnesses; never rediscover the already
shipped October 24 work. Preserve exact result bits, callback semantics and
selection identities. Retain only demonstrated improvements; keep negative
results in the reports. The prior October 22 isolation, cleanup, ownership,
credential and no-push rules still apply. Browser comparisons need frozen arm
sources, the same snapshot and matching source maps; no other load may overlap.
