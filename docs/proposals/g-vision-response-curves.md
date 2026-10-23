# G-response models: realism, time, and resource budgets

Status: implemented 2026-10-21, not deployed. Supersedes the earlier power-curve-only proposal. Curve, Exposure and Perfusion are retained behind G-forces → Pilot → Response; Reference is not built (CGEM's licence and source are unknown). The pilot now follows each accepted physics step rather than each frame. Curve stays the default with its existing settings; Exposure is the proposed default and is not selected. Decision record: [g-forces/docs/g-response-comparison.md](../../../g-forces/docs/g-response-comparison.md).

Method: [Choosing the useful peaks of realism and cost](../../../docs/realism-cost.md) explains the reusable rationale for comparing and retaining multiple implementations. This proposal applies that approach to G response.

## Goal and proposed choices

Compare several editable implementations of the pilot's response to G, including temporal physiology, and retain the ones that provide the most demonstrated realism for their CPU and memory cost. A logarithmic visual curve is one tuning option; it is not the assumed physiological model.

The proposed useful choices are **Exposure** for a very small model and **Perfusion** for a more explanatory model. Keep **Curve** as a compatibility/control case and evaluate **Reference** to establish whether further detail is worth shipping. These are alternative implementations of the same pilot-model interface, not effects to stack on top of one another.

The likely gains are, in order: consume the actual load history; retain incomplete recovery between maneuvers; separate visual impairment from consciousness; model compensation and recovery; then refine physiology only when validation rewards it. That ordering is a design hypothesis to test.

The budgets below are **proposed ceilings, not benchmark results or proven Pareto knees**. Choose the actual knees after paired timing and independent validation. If Perfusion fits the smallest budget and matches or beats Exposure's accuracy, collapse the tiers instead of manufacturing a performance distinction.

## Current implementation and shared correction

Verified code paths:

- `../g-forces/src/gForce.ts`: `gVisionTarget()` maps two thresholds linearly to closure. `stepGVision()` follows the target with first-order onset/recovery. `stepPilot()` ties unconsciousness to full internal blackout and uses a randomly drawn time out.
- `src/flight/settings/flightParameters.ts`: +5/+9 g blackout, -2/-3 g redout, 5 s onset and 2 s recovery are current defaults. Onset/recovery specify approximately 95% settling. Full-load pass-out happens after about 3.07 onset times because of a numerical settling tolerance.
- `src/flight/physics/fixedStepLoop.ts`: accepted physics steps run at 120 Hz, with at most six accepted steps per `update()` call. Faulted/rejected candidates do not call `onStep`.
- `src/flight/createFlightSimApp.ts`: `onStep` accumulates elapsed time, but the rendered-frame path reads only the last pilot G and applies it to that entire interval. This loses the order and duration of loads within the frame.
- `../g-forces/src/gVisionOverlay.ts`: presentation is quantized to 0.001, with unchanged DOM writes suppressed. The CSS vignette is already nonlinear in its screen geometry.

For new temporal models, advance the pilot once for **each accepted physics step**, using that step's pilot G and simulated duration. Cache the last reading for the frame's meter. Prefer an already available native read; otherwise one property read per active accepted step is justified and must be included in timing. Do not reconstruct history by averaging G: nonlinear response and recovery make order matter.

Keep an explicitly named legacy path if exact old replay behavior is needed. The corrected step-driven path must be the comparison basis for all new models, so a model does not gain apparent accuracy merely from better sampling.

## Physics-rate policy for implementation

Use **60 Hz as the new default**, offer **30 Hz as a lower-cost option after validation**, and make **120 Hz explicit opt-in**. This replaces the proposal's earlier assumption that all new models would run at 120 Hz. The verified current-code inventory above remains a description of today's runtime. Render FPS is independent; interpolate the display at its own cadence. See the [shared rate-selection rationale](../../../docs/realism-cost.md#choose-physics-frequency-separately-from-render-fps).

Implement rate selection as a coordinated timing change, not a one-line constant edit:

- Add a saved, validated `Physics [30 / 60 / 120] Hz ?` setting through the shared settings registry. Use 60 when no explicit value exists. Apply changes on a new flight/reset; no mid-flight timestep switch or automatic upgrade to 120. Preserve a genuinely explicit saved choice of 120.
- Supply one selected `dt = 1 / physicsHz` to the loop, native-model initialization/reset, controls/autopilot, auto-trim, wheel/feedback cues, pilot model, recorders and benchmark time accounting. `bootstrapC172.ts` currently applies `FIXED_DT`; `FlightModelDriver` takes `fixedDtSec` and checks it against native `getDeltaT()`. Keep all those values consistent and verify native elapsed time independently.
- Preserve the current approximate 50 ms catch-up horizon instead of retaining six steps at every frequency. For example, use `maxSteps = ceil(0.05 * physicsHz)` with a corresponding whole-step backlog cap: 2 steps/66.7 ms at 30 Hz, 3/50 ms at 60 Hz, 6/50 ms at 120 Hz. Specify discarded-time handling and never charge discarded time as pilot exposure. These are proposed limits to validate, not claims that a rate change is already implemented.
- Validate contact/suspension behavior, fast controls, interpolation/input latency, and short G pulses at each rate. Compare whole physical scenarios, including pulses shifted relative to step boundaries. Substeps inside the pilot model cannot reconstruct a G spike never sampled by the native physics.
- Allow local solver substeps when justified, count their CPU cost, and keep them separate from the selected native aircraft update rate. Do not hide a complete 120 Hz native loop behind a 60 Hz label. Leave historical 120 Hz evidence/fixtures labeled and explicitly configured at their original rate.

Start the rate change with focused scheduler/native-time tests and matched aircraft scenarios. A broad change to physics frequency requires more than the G-model unit tests; do not claim 30 or 60 Hz is validated solely because those tests pass.

## Evidence that should constrain the alternatives

These sources guide calibration, not hardcoded guarantees for every pilot:

- The 2013 analysis of 888 G-LOC episodes reports strong dependence on exposure profile and a rapid-onset plateau: mean induction times around 9–10 s once severe stress is reached. The dataset mixes protection conditions. Its gradual-ramp times include the ramp from the starting load; they are not constant-load endurance times. Preserve finite physiological buffers and do not force time to LOC toward zero as G increases. [Whinnery and Forster, 2013](https://link.springer.com/article/10.1186/2046-7648-2-19).
- Recovery data from 760 episodes relate return of consciousness to the unloading profile. The reported overall mean is 10.4 ± 5.1 s, with substantial variation. This motivates recovery state, rather than a load-independent random countdown, in the advanced models. [Whinnery, Forster and Rogers, 2014](https://link.springer.com/article/10.1186/2046-7648-3-9).
- The published CGEM model combines perfusion, resource reserves, pilot parameters and countermeasures, and reports comparisons against centrifuge data. It is a useful reference candidate, not ground truth or proof that our reduction is valid. [Copeland and Whinnery, 2023](https://www.faa.gov/sites/faa.gov/files/OAM202306.pdf).
- CGEM's guide describes separate visual/consciousness reserves, temporal compensation and negative-to-positive exposure memory. It also notes that redout physiology is poorly understood. Positive-G mechanisms should not simply be mirrored to invent a validated negative-G model. [CGEM User's Guide](https://rosap.ntl.bts.gov/view/dot/66372/dot_66372_DS1.pdf).
- A tilt-table experiment demonstrates transient cerebral hypoperfusion during a simulated push–pull transition. It supports testing history dependence, but its tilt protocol and lack of reported visual/LOC events do not calibrate a fighter pilot's redout or LOC thresholds. [Xing et al., 2021](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2021.672351/full).

Consequently, +9 and +15 g producing similar LOC times is not automatically a bug. The current model's limitation is that its plateau is imposed by a visual clamp and a generic lag, rather than emerging from a calibrated supply/reserve mechanism.

## Provisional budget tiers

All ceilings are for **one active pilot, at 1× simulated speed**. CPU includes model evaluation and its incremental input/adapter work; report the native G read separately as well. Excludes the existing renderer and DOM overlay. Memory includes mutable state, compiled profile and lookup tables; report JavaScript object overhead separately from numeric payload. Shared assets count once; per-pilot state counts for every pilot.

| Candidate / proposed knee | CPU ceiling per accepted step | CPU per simulated second at 60 Hz default | Numeric mutable state | Total retained numeric data |
| --- | ---: | ---: | ---: | ---: |
| A. Curve, control case | Measure baseline | Measure baseline | About 2 levels + legacy state | ≤1 KiB |
| B. Exposure, first candidate knee | 10 µs | 0.6 ms, 0.06% of one core | ≤128 B | ≤1 KiB |
| C. Perfusion, second candidate knee | 50 µs | 3 ms, 0.3% of one core | ≤256 B | ≤4 KiB |
| D. Reference, exploratory ceiling | 250 µs | 15 ms, 1.5% of one core | Target ≤512 B | Target ≤16 KiB |

These are envelopes, not expected consumption. With 60 Hz physics and 60 rendered frames/s, the three new-model ceilings cost an average of 0.01 / 0.05 / 0.25 ms per frame. A three-step catch-up costs at most 0.03 / 0.15 / 0.75 ms if those step ceilings hold. At the same per-step ceiling, 30 Hz uses half the per-second allowance and opt-in 120 Hz uses twice it. Internal substep counts can change the actual per-step cost; measure each rate rather than assuming all work scales linearly. Measure tails and adapter cost rather than inferring a frame-time guarantee from batch averages.

Why these candidates: B spends a few scalar states on load history, where a static curve has no representation. C spends several more on causes and independently observable effects. D tests whether reference fidelity adds useful predictive accuracy beyond C. Extra memory alone has no established realism benefit for a single pilot; do not allocate a large history buffer to fill a budget.

## A. Curve: nonlinear amplitude with simple temporal response

Purpose: retain the existing behavior as a control and offer editable static shaping. This is the smallest implementation, but not the realism target.

```text
x = normalized load between clear and full thresholds, clamped to [0, 1]
target = x ** exponent
level' = target + (level - target) * exp(-dt / tau)
```

Blackout and redout have independent exponents. Keep exact endpoints and the equal-threshold step behavior. Exponent 1 reproduces the current linear amplitude; 0.5 rises early; 2 rises late. Use `tau = onsetSeconds / 3` or `recoverySeconds / 3` to preserve current setting semantics.

For an optional intermediate experiment, make attack time an editable bounded function of load while retaining the same state structure. Label that variant **Curve with variable onset** in evaluation. A shorter attack at increasing stress must approach a finite calibrated floor; visual smoothing and brain-reserve time are not interchangeable.

Compute: two levels, up to two powers and two exponentials per step, with linear/end-point fast paths. No history storage.

What it can represent: a nonlinear settled appearance, attack/release asymmetry, and filtering of a short pulse. What it lacks: separate consciousness, depletion/repayment of physiological reserves, meaningful compensation, and push–pull susceptibility. Retain its old LOC rule only for compatibility; do not claim the numerical snap tolerance models a physiological event.

## B. Exposure: bounded depletion and recovery

Purpose: the first likely realism/compute knee. Keep a small amount of history, with empirical rate curves fitted to complete load profiles.

Suggested state: retinal debt `Dr`, consciousness debt `Db`, negative-G visual state `N`, compensation `A`, negative-to-positive memory `M`, plus a consciousness enum and a short recovery/dwell state. Debts and memory are normalized to [0, 1]. This should fit within 128 B of numeric state without a ring buffer.

The following is a **proposed simulator reduction**, not an equation claimed by the cited studies:

```text
A tends toward bounded compensationTarget(g) with separate rise/fall constants
M tends toward negativeExposureTarget(g) and clears with its own recovery constant

effectiveStress = boundedStress(g, A, M, pilotProfile, protection)
for each positive-G debt D in {Dr, Db}:
    dD/dt = u(effectiveStress) - r(effectiveStress) * D

N follows an independently calibrated negative-G target and recovery
```

`u` has units of debt/s; `r` has units of 1/s. Both are nonnegative. At normal load, `u=0` and `r>0`; severe stress has bounded `u>0` and little recovery. Moderate-load settings may have equilibrium debt below the impairment/LOC threshold. Compensation reduces effective positive stress; negative exposure memory can delay or reduce that compensation on a following pull. Avoid counting the same penalty in both places.

For coefficients frozen over a step, update a debt analytically:

```text
if r > 0:
    Dnext = D * exp(-r*dt) + (u/r) * (1 - exp(-r*dt))
else:
    Dnext = D + u*dt
```

Use a stable small-argument form such as `expm1`, and clamp physical state. Locate an LOC threshold crossing within the step if event timing requires it. Evolving `A` and `M` means this is not a claim of exact frame-partition invariance for the whole coupled model; measure integration convergence.

Map retinal debt to peripheral loss, then full visual loss, using an editable monotonic response. Trigger LOC from `Db`, not from the rounded vignette. Continue advancing all debts while unconscious. Wake only after sufficient debt repayment plus a calibrated recovery/dwell condition, with distinct entry/exit thresholds to prevent chatter. The dwell is a documented modeling parameter; it must not be a second arbitrary random countdown hidden behind the reserve model.

Use bounded depletion rates to obtain a finite minimum induction time from a rested state. Repeated pulls before complete recovery retain debt and can impair the pilot earlier than an isolated pull. Do not impose a fresh full buffer each time the load crosses a threshold. Variation, if wanted, samples a stable pilot profile once per flight from a seeded distribution.

Editable inputs: positive/negative threshold shapes; depletion versus load; recovery versus load; compensation capacity and rise/fall times; push–pull magnitude/decay; retinal and consciousness thresholds; wake hysteresis. Begin with a compact parameterized family; support monotonic knot curves only where profile fitting demonstrates a need.

Cost: roughly 5–10 scalar state values and a handful of curve evaluations/exponentials. Precompute fixed-step lag coefficients for constant time settings. No online fitting, random draws per step, sorted arrays or sample history.

Realism gain: duration, incomplete recovery, distinct visual/LOC timing, ramp sensitivity through compensation, and an explicitly empirical push–pull effect. Limitation: parameters can match outcomes without representing actual blood pressure; transfer to different protection/seat configurations is uncertain. Never substitute `1 / publishedRampTime(g)` for a local depletion rate: those observed times include different prior exposure histories.

## C. Perfusion: reduced pressure, flow, and reserve dynamics

Purpose: the second likely knee and preferred production candidate **if independent validation supports it**. Retain only physiology that changes modeled flight outcomes, using a small deterministic state system.

Suggested dynamic quantities: heart-level pressure or its compensation state; bounded vascular response; suit pressure if equipment is enabled; negative-exposure memory; peripheral-retina reserve; central-retina reserve; cerebral-function reserve; redout/congestion state; consciousness/recovery state. Optional straining fatigue adds a state only when it has independent calibration. Target 8–16 scalar slots, not a heartbeat-resolved circulation simulation.

A proposed reduction uses this pressure/flow structure, consistent with the general framework described in the [CGEM guide](https://rosap.ntl.bts.gov/view/dot/66372/dot_66372_DS1.pdf):

```text
Psite = Pheart - Ksite * signedPilotG
perfusionPressure = max(Psite - surroundingPressure, 0)
resourceSupply = oxygenAvailability * perfusionPressure / vascularResistance

for each functional reserve V:
    dV/dt = (normalizedSupply - maintenanceDemand) / reserveCapacity
    keep V within [0, 1]
```

Here `Ksite` is compiled from the heart-to-site geometry and unit conversion, in mmHg/g. `reserveCapacity` has units of seconds of baseline resource flow; normalized supply and demand use the same baseline. This is an implementation skeleton: the exact control laws and parameter values must be specified, versioned and fitted before it becomes a model.

Requirements for the reduction:

- Heart/vascular compensation is delayed, limited and stateful. A slow ramp can recruit it differently from a rapid pull. Do not let compensation grow without limit.
- Supply can recover independently of visible symptoms. Reserve repayment, distinct visual/consciousness thresholds and wake hysteresis determine functional recovery. Normal-load supply must exceed maintenance enough to refill depleted reserves; a normalized equilibrium of exactly zero refill would prevent recovery forever.
- Separate peripheral and central retinal reserves can produce narrowing before complete visual loss. Cerebral state determines consciousness independently; a rapid onset need not guarantee a prolonged visual warning.
- Continue supply, reserve and protection dynamics while unconscious. Rising G during recovery can prevent a return of function; the model must not wake solely because a timer expired.
- Incorporate suit/strain effects through a documented pressure/flow mechanism. Do not add several overlapping protection bonuses. Suit pressure has onset/deflation dynamics if equipment data justify them. Automatic strain behavior is explicit and distinct from equipment capability.
- Treat redout/congestion as a separate, lower-confidence branch. Do not apply the positive-G hydrostatic equation to negative G and interpret unlimited computed flow as either infinite protection or validated redout severity. Preserve negative-exposure memory for the following pull.
- Pilot G is proper load with +1 in level flight. Do not add gravity again. Compile organ geometry in the pilot/seat frame, and make any scalar-Gz limitation explicit. Camera pose is not a physiological input. Additional acceleration axes require a deliberate native-input/geometry extension.

Integration: start at the selected accepted physics rate, 60 Hz by default, and evaluate 30 and opt-in 120 Hz as separate numerical candidates. Use stable exponential updates for simple lags and a bounded second-order method for coupled reserve/control equations. Preallocate intermediate state. Check against a smaller offline step before adding local runtime substeps; do not spend Reference's budget on an integration error that is already below data uncertainty.

Editable inputs: pilot baseline/maximum pressure, response times, effective organ heights, flow/resistance limits, resource capacities/demands, protection dynamics and symptom transfer curves. Give controls units and profile provenance. Keep ordinary tuning to a few interpretable controls; expose full values in advanced settings with `?` help.

Realism gain over B: more defensible parameter changes for geometry/protection; separate retinal and cerebral behavior; compensation and recovery emerge from the supply/reserve balance. Limitations: low-order physiology and uncertain inputs can still fit worse than a well-calibrated empirical model. Additional equations do not count as demonstrated accuracy.

## D. Reference: published model and numerical fidelity

Purpose: an offline comparison implementation first, and a runtime option only if it earns a distinct place on the measured frontier.

Use a pinned CGEM software release or an independently reviewed reconstruction with a documented equation/parameter inventory. The report identifies a software DOI, but this proposal has not obtained or checked that software. Do not call a reconstruction a faithful port until source availability, reuse terms, units and golden output traces are verified. [CGEM report and software pointers](https://www.faa.gov/sites/faa.gov/files/OAM202306.pdf).

Preserve the reference's reserve allocation and compensation/protection assumptions for source-fidelity comparisons; document any omitted non-gameplay physiology. The published reference includes separate retinal and brain banks. It is not a requirement to add injury/death gameplay. The [guide](https://rosap.ntl.bts.gov/view/dot/66372/dot_66372_DS1.pdf) describes millisecond-resolution profiles: test reference-like substeps up to 1 ms, with an exact accounted remainder at each accepted physics boundary.

With internal steps no larger than 1 ms, one outer interval needs up to about 17 steps at the 60 Hz default, 34 at 30 Hz, or 9 at opt-in 120 Hz. This keeps internal work per simulated second roughly similar across outer rates. These steps consume the available load trace; they do not create extra native information or justify 1,000 SDK reads/s. Use the same sample/hold or documented interpolation convention across candidates. Offline reference traces may have finer input resolution, which must be reported rather than credited to model equations.

Cost target: the exploratory 250 µs / 16 KiB envelope above. Actual reference state and operation count remain unverified. Do not replace the source model with an invented large ODE solely to fill the budget. A complete reference may fit a lower tier; a reconstruction with unsupported detail may have no place in the product.

Realism gain to establish: independently better symptom/LOC/recovery predictions or reliable behavior under protection changes that C misses. Smaller integration steps and more parameters alone do not establish this. If C reproduces the reference within useful tolerance, keep D in development tooling.

## Memory versus computation

Use fixed scalar state as the first implementation for B and C. Compile bounds, units, polynomial segments and constant-step lag coefficients when settings change. Direct pressure arithmetic may be cheaper than table interpolation; measure before replacing it.

An optional compiled implementation may tabulate expensive **memoryless transfer functions inside the state model**. It must retain all dynamic states. A table of steady G → darkness cannot replace exposure history, compensation or reserve recovery.

For scale, one 65×33 Float32 table costs 8,580 B and already exceeds C's total numeric budget; a 257×129 table costs 132,612 B. A 1D table of 129 Float32 values costs 516 B before other state/configuration. Tables multiply rapidly as profile dimensions are added. Report their bytes explicitly, share immutable tables across pilots, and invalidate them on every relevant edit. Do not introduce multidimensional tables unless they improve measured cost enough to justify their approximation error and retained memory.

Keep reserve/event state in Float64 initially. Quantize only presentation or validated coefficient tables. Table interpolation must not move a consciousness threshold or turn an interior visual value into an unintended full-blackout event.

No model may allocate per accepted step, retain an unbounded load history, invoke a worker round trip per step, or ask the globe for a render. Do not add WASM/GPU infrastructure for a handful of scalar states without a measured need.

## Common integration and editing contract

Put the pure model implementations and profile compiler in `g-forces`; keep native sampling, controls and presentation adaptation in `fly`. A suitable interface is:

```ts
interface PilotResponseModel {
  // All state and output storage is allocated by construction.
  step(pilotG: number, simulatedSeconds: number): void;
  // A stable view; consumers must not retain it as a historical snapshot.
  readonly output: {
    peripheralLoss: number;
    centralLoss: number;
    redout: number;
    conscious: boolean;
  };
  reset(): void;
}
```

This is an interface sketch, not a required object layout. Give reset/configuration an explicit lifecycle; do not hide settings reads inside `step()`. Reference/protection extensions may use a preallocated input structure if one scalar G is insufficient.

- Initialize model state before the physics callback can run. Update only on accepted steps; pause, load, rejected/faulted steps and discarded wall time contribute no exposure. Do not advance it again in the rendered-frame path.
- A LOC event from one accepted step must affect pilot-held controls on the next step, including multiple steps inside one rendered frame. Continue existing throttle/trim/autopilot policies. Batch or emit logs only on transitions, not every step.
- Separate physiological output from presentation. Vignette strength, layer and camera view must not change reserve state or LOC. Pass-out remains opt-in; switching that option off releases control inhibition using the existing user-facing policy. Internal modeling can continue for vision.
- If both vision and pass-out are disabled, keep the current explicit opt-out/reset semantics rather than spending CPU invisibly. Panel visibility alone must not pause physiology. Re-enabling/reset behavior must be documented and covered by tests.
- Map peripheral/central output to the existing overlay first. If a new spatial/gray-out rendering is proposed, assess it separately: improved physiology does not require extra full-screen passes. Keep the 0.001 presentation quantization and unchanged DOM suppression.
- Preserve unrelated uncommitted work. Candidate model selection can apply on the next flight; do not switch architectures automatically under frame load. They have incompatible internal states. Live parameter edits within a model preserve normalized reserve/debt fractions and consciousness state; recompilation does not grant instant recovery. A profile change that cannot preserve state must be explicit and applied on reset.

Editing requirements:

1. Use a compact `Response [Curve / Exposure / Perfusion] ?` choice once the retained models are known. Keep Reference in evaluation tooling unless it earns a production tier. Do not expose CPU ceilings as physiological settings or label the biggest budget “most realistic” before validation.
2. Every retained model supports settings persistence, reset, import/export and parameter provenance through the existing registry. Existing settings continue to work in Curve. Do not silently reinterpret old +5/+9 thresholds as measured pressure/reserve values for Perfusion. Store a versioned model/profile identifier and provide an explicit recommended preset for new models.
3. Use normal parameter controls for scalar values. For fitted curves, support 3–8 editable knots with units and validated domain constraints, numeric/keyboard editing, reset, and a shape-preserving interpolator. Compile segments on edit; avoid overshoot or a generic free-form spline. The registry currently has no array-valued parameter kind: choose a small versioned profile serializer/adapter, or a justified shared extension; do not silently encode mutable arrays as unvalidated text. Ordinary tuning need not show all knots.
4. Show a static shape preview **and a temporal preview**: input G versus time, peripheral/central loss and redout, with LOC/recovery markers. Provide Step, Ramp, Repeated pull, Push–pull and Unload protocols. For stateful models, annotate the starting pilot state and protocol; there is no unique G-only response curve independent of history.
5. Generate previews with a private model instance and the same solver used in flight. Regenerate only after relevant edits/protocol selection. Cancel stale work and slice any expensive preview into short tasks (target ≤4 ms each). Never run the preview every flight frame or alter the real pilot. Unmounted/collapsed previews must release their subscriptions and scheduled work.
6. Follow compact grouped controls and final `?` help conventions. Advanced values show units, source/assumption status and validation coverage. Different appearance tuning must not be presented as a validated physiology change.

## Validation: measure realism before choosing the knees

Build a deterministic trace harness before the full editor. At each tested physics rate, feed the same accepted G trace to every model candidate, and record symptom onset, complete visual loss, LOC, return of vision/consciousness, residual reserve/debt and predicted pressure/flow where present. Use 60 Hz as the default evaluation, with matched physical protocols at 30 and opt-in 120 Hz. Keep rate-induced sampling differences separate from differences between model equations.

Use two distinct test sets:

- **Evidence fixtures:** reconstruct published protocols with starting load, ramp/hold/unload, protection, posture and outcome definitions. Store source/page/table, uncertainty, digitization method and missing metadata beside each fixture. Fit on one subset and hold out whole protocols/studies where possible. Aggregated mean curves are not individual pilot traces. If metadata prevent a defensible reconstruction, mark the fixture unresolved rather than inventing it.
- **Synthetic mechanism checks:** fixed traces testing invariants and history dependence. These establish software behavior, not physiological validation. Agreement with CGEM golden traces separately establishes source fidelity, not agreement with humans.

Minimum synthetic families (the amplitudes/durations here define test inputs, not measured tolerance):

| Family | Example input | What it tests |
| --- | --- | --- |
| Rest | +1 g for 120 s, including a previously impaired start | Stable rest and eventual recovery |
| Brief pulse | +1 → +9 for 0.05 / 0.25 / 1 s → +1 | Finite reserve and duration sensitivity |
| Sustained load | +4 / +6 / +9 / +12 for up to 60 s, each from rest | Threshold behavior and a possible severe-load plateau |
| Ramp | +1 → +9 at 0.1 / 0.5 / 3 g/s, then hold | Compensation and correct inclusion of ramp exposure |
| Repeated pull | +6 for 5 s, +1 for 1 / 5 / 20 s, repeat | Incomplete recovery and repayment |
| Push–pull | -1 for 3 s, then +6; compare +1 for 3 s then +6 | Negative-exposure memory, tested within each profile's scope |
| Unload after LOC | Same initial exposure; return to +1 quickly versus slowly | Recovery depends on restored supply/history |
| Continued stress | Continue high G or pull again during recovery | No timer-only awakening or reserve reset |
| Protection/geometry | Repeat matched traces with specified profile changes | Mechanistic transfer and absence of double-counted bonuses |
| Scheduling | Same accepted trace packed into 30 / 60 / 120 Hz rendered frames | Identical outcomes independent of render grouping |
| Physics frequency | Matched physical protocol at 30 / 60 / 120 Hz physics, including pulse phase shifts | Rate-dependent sampling/integration error, cost and stability |

Do not require +12 to cause earlier LOC than +9 when both already exhaust supply; require a finite buffer and compare the plateau with appropriate evidence. Do not require all configured pilots to pass out at an arbitrary test amplitude. Negative-G tests must expose the lower confidence of that branch.

Numerical checks: finite bounded state; no evolution at zero simulated time; sign/unit correctness; event hysteresis; stable profile compilation; reset/switch/edit behavior; no advancement on rejected physics steps. At each selected rate, compare integration with finer offline runs of the same input convention. Target event-time discrepancy ≤ one selected physics step and closure discrepancy ≤0.005; report the rate and millisecond tolerance explicitly. These are engineering tolerances, not human-data precision. Test loss from coarse native sampling separately; use local substeps only where integration convergence fails or evidence requires them.

For evidence fixtures, report per-family event errors in seconds/G and, where available, normalized by published uncertainty. Report missing events and false LOC separately. Give each family equal influence so many easy rest samples cannot hide a failure on recovery or push–pull. Compare supported outcomes only; missing data cannot become a zero error or an invented success score. Keep unvalidated negative-G/protection behavior visible in the result.

Select the frontier this way:

1. Reject numerically unstable models and candidates outside their chosen resource envelope.
2. Discard a model when another is no worse on supported accuracy/coverage and uses no more CPU/memory, allowing a measured noise margin. Include implementation complexity and calibration uncertainty in the review.
3. Propose B as the first knee only if it substantially improves temporal outcomes over corrected A. Propose C as a second knee only if it adds validated behavior/transfer or clearly lowers held-out error without a material regression elsewhere.
4. Use a provisional 15% reduction in balanced normalized held-out error as an engineering review trigger, not a scientific significance threshold. Also inspect uncertainty and each family; a small average gain must not excuse qualitatively wrong recovery. If data do not support that calculation, report the limitation instead of a score.
5. Retain D at runtime only if it produces a meaningful independent improvement over C. Otherwise keep it as an oracle. If all useful models fit the cheapest envelope, publish the measured result and choose on accuracy/maintainability.

Produce an actual error-versus-CPU plot with memory labels **after measurements**. Do not draw a fictitious numerical Pareto frontier in advance.

## Performance measurement and implementation handoff

First deliver the pure A/B/C prototypes, shared trace harness, documented parameter sets and a concise comparison. Bring D into that harness when a usable reference is available. Do not build four complete settings panels before identifying the useful models. The recommendation to try C first for production remains conditional on that comparison.

One short local benchmark should include warmup, paired/interleaved candidate order, a consumed output checksum and deterministic traces. Measure the pure solver separately from accepted-step/native sampling integration. Report median and spread of batch-normalized step cost; use coarse sampled timings for tails to avoid timing calls dominating microsecond work. Measure native getter calls and allocations independently. Do not claim a per-step worst case from a median batch time.

Exercise active high load, mixed signs, compensation, unconscious recovery, normal rest and disabled operation. Include catch-up bursts at the selected rate: proposed maxima of 2 / 3 / 6 steps at 30 / 60 / 120 Hz. Record runtime/browser version, device, actual physics rate/native elapsed time, iterations and profile/state/table bytes. Add one brief browser integration check with the existing profiler; do not infer WebGPU/DOM frame effects from Node-only timing. Keep local timing runs around 30 seconds and total sessions brief; move parameter searches and large fixture sweeps to a documented cloud handoff.

Suggested ownership:

- `g-forces/src/`: model interface, Curve/Exposure/Perfusion implementations, profile compilation, deterministic replay helpers.
- `g-forces/tests/`: equation/units, trace behavior, integration convergence and event tests.
- `fly/src/flight/createFlightSimApp.ts`: accepted-step sampling/lifecycle and presentation/control adapter; no model equations here.
- `fly/src/flight/settings/flightParameters.ts` and the G-forces panel: registered settings, profile selection and retained-model editors/previews.
- Versioned fixture/profile data and a short evidence manifest in an appropriate tracked package directory. Scratch sweeps, timing results and screenshots go in ignored `build/`.

Start verification from `fly/` with focused tests, adding the new candidate suites as they exist:

```sh
node node_modules/vitest/vitest.mjs run --configLoader native --maxWorkers=1 ../g-forces/tests/gForce.test.ts ../g-forces/tests/gVisionOverlay.test.ts src/flight/physics/fixedStepLoop.test.ts src/flight/settings/flightParameters.test.ts
node node_modules/vitest/vitest.mjs run --configLoader native --maxWorkers=1 src/flight/createFlightSimApp.test.ts -t G-forces
npm run typecheck
```

Use the repository screenshot workflow after visible UI changes, with one list covering desktop/narrow layouts and temporal previews. Inspect changed images and provide them or `build/shots/index.html`. Manual review should compare a short pulse, a repeated pull, a slow ramp, a push–pull transition and unloading after LOC with the selected model's diagnostics.

The final implementation report must identify which models survived, actual resource use, independent validation results, unresolved physiology/fixture gaps, editor screenshots and the proposed physiological model default. Preserve compatibility for existing physiology settings until a new model default is justified and explicitly selected. The separately requested physics-rate default is 60 Hz, with 30 Hz evaluated as the lower-cost option and 120 Hz explicit opt-in; ship that coordinated change after its rate-specific checks. Do not deploy as part of this work.
