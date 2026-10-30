import { createGameLog, type GameLog, type GameLogEntry, type GameLogLine } from "foss-earth/shell";
import type { TerrainPreparationProgress } from "foss-earth/runtime";
import { createLoadingDiagnostics, describeLoadingCause, redactLoadingText } from "./loadingDiagnostics";
import { createLoadingReportViewer } from "./createLoadingReportViewer";

export type FlightLoadingPhase = "app" | "world" | "flight" | "assets" | "terrain";

export interface FlightLoadingPhaseUpdate {
  state: "waiting" | "loading" | "ready";
  detail?: string;
  /** Measured completion from 0 to 1. Omit when the total is unknown. */
  progress?: number | null;
  terrain?: TerrainPreparationProgress;
}

export interface FlightLoadingFailure {
  /** Offered as "Try again"; without it the button reloads the page. */
  retry?: () => void;
  /** What was thrown: its line and the loading report give it, with secrets removed. */
  cause?: unknown;
  /** Recovery choices that remain usable while flight input is held. */
  actions?: GameLogEntry["actions"];
}

export interface FlightSpawnOverride {
  label?: string;
  detail?: string;
  onClick(): void;
  /** Only offered when a finite local ground height is known; the caller confirms the move. */
  aboveGround?: { onClick(): void };
}

export interface FlightLoadingScreen {
  /** A one-use bypass of this operation's map readiness wait. */
  setSpawnOverride?(action: FlightSpawnOverride | null): void;
  show(options?: { title?: string; detail?: string; reset?: boolean }): void;
  setPhase(phase: FlightLoadingPhase, update: FlightLoadingPhaseUpdate): void;
  hide(): void;
  /** Records the async boundary and its caller before module loading can lose the throw stack. */
  trace?<T>(operation: string, run: () => Promise<T>): Promise<T>;
  /**
   * Stops loading with one line saying why. Until the next `show()`, a further call, such as
   * the boot's own catch hearing of a failure the flight already reported, prints nothing:
   * the first line names what failed, and the call only gives it a cause it did not have.
   */
  fail(message: string, options?: FlightLoadingFailure): void;
  destroy(): void;
}

const PHASE_LABELS: Record<FlightLoadingPhase, string> = {
  app: "Application",
  world: "World renderer",
  flight: "Flight simulation",
  assets: "Aircraft",
  terrain: "Terrain",
};

const DEFAULT_TITLE = "Preparing your flight";

/**
 * Retained for controls shared with older hosts. Loading now keeps all UI
 * and camera controls usable; the simulation owns its independent pause gate.
 */
export const LOADING_LIVE_ATTRIBUTE = "data-loading-live";

interface PhaseLine {
  line: GameLogLine;
  startedAt: number;
  ready: boolean;
}

declare global {
  interface Window {
    /** Always available while this loading screen exists; no debug URL flag. */
    osfsLoadingDiagnostics?: () => unknown;
  }
}

function describeTerrain(progress: TerrainPreparationProgress | undefined): string {
  const diagnostic = progress?.diagnostics;
  if (!progress || !diagnostic) return "";
  const seconds = Math.floor(diagnostic.elapsedMs / 1000);
  const lines = [
    `${diagnostic.provider} | ${seconds}s elapsed`,
    diagnostic.activeElevationRequests === null
      ? `Map tiles visible: ${diagnostic.visibleTiles}`
      : `Elevation loads: ${diagnostic.activeElevationRequests} active, ${diagnostic.queuedElevationRequests ?? 0} queued`,
    `Ground checks ready: ${progress.readySamples} of ${progress.totalSamples}`,
  ];
  if (diagnostic.pendingTiles !== null) {
    lines.push(`Map tiles: ${diagnostic.visibleTiles} visible, ${diagnostic.pendingTiles} still loading`);
  }
  if (diagnostic.status === "stalled") {
    const remaining = Math.max(0, Math.ceil((diagnostic.timeoutMs - diagnostic.elapsedMs) / 1000));
    lines.push(`No usable terrain improvement for ${Math.floor(diagnostic.stalledForMs / 1000)}s. Startup timeout in ${remaining}s.`);
  }
  if (diagnostic.lastError) lines.push(`Latest error: ${diagnostic.lastError}`);
  return "\n" + lines.join("\n");
}

/**
 * Central, nonmodal loading status over a visible world, with a persistent
 * diagnostic trail in the game log. Holding physics never locks the app UI.
 */
export function createFlightLoadingScreen(sharedLog?: GameLog, report?: () => Promise<string>, checkpoint?: (snapshot: unknown, urgent: boolean, outcome?: "loading" | "ready" | "failed") => void): FlightLoadingScreen {
  const log = sharedLog ?? createGameLog();
  const root = document.getElementById("root");
  const phases = new Map<FlightLoadingPhase, PhaseLine>();
  let failure: { line: GameLogLine; entry: GameLogEntry } | null = null;
  let previousBusy: string | null = null;
  let visible = false;
  let destroyed = false;
  let sessionStartedAt = performance.now();
  let stoppedAt: number | null = null;
  let failureMessage: string | null = null;
  let failureCause: ReturnType<typeof describeLoadingCause> | null = null;
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
  const saveCheckpoint = (urgent: boolean, outcome?: "loading" | "ready" | "failed"): void => {
    if (!checkpoint) return;
    if (urgent) {
      clearTimeout(checkpointTimer); checkpointTimer = undefined;
      checkpoint(getReport(), true, outcome);
    } else checkpointTimer ??= setTimeout(() => {
      checkpointTimer = undefined;
      if (!destroyed) checkpoint(getReport(), true);
    }, 1000);
  };
  const diagnostics = createLoadingDiagnostics(saveCheckpoint);
  const observations = new Map<FlightLoadingPhase, { update: FlightLoadingPhaseUpdate; recordedAt: number }>();
  const history: Array<{ elapsedMs: number; phase: FlightLoadingPhase; update: FlightLoadingPhaseUpdate }> = [];
  const getReport = () => JSON.parse(JSON.stringify({
    version: 2,
    capturedAt: new Date().toISOString(),
    outcome: failureMessage ? "failed" : visible ? "loading" : "ready",
    elapsedMs: (stoppedAt ?? performance.now()) - sessionStartedAt,
    failure: failureMessage,
    cause: failureCause,
    phases: Object.fromEntries(Object.keys(PHASE_LABELS).map(key => {
      const phase = key as FlightLoadingPhase;
      const update = observations.get(phase)?.update ?? { state: "waiting" };
      return [phase, failureMessage && update.state === "loading" ? { ...update, state: "failed" } : update];
    })),
    history: history.slice(),
    ...diagnostics.snapshot(),
  }, (_key, value: unknown) => typeof value === "string" ? redactLoadingText(value) : value));
  const previousReport = window.osfsLoadingDiagnostics;
  window.osfsLoadingDiagnostics = getReport;
  let reportViewer: ReturnType<typeof createLoadingReportViewer> | null = null;
  const readReport = async (): Promise<string> => redactLoadingText([
    ...(failureMessage ? [failureMessage] : []),
    ...(failureCause ? [failureCause.stack ?? failureCause.message] : []),
    await report?.() ?? "",
  ].filter(Boolean).join("\n"));
  const openReport = (text: string): void => {
    if (destroyed) return;
    reportViewer ??= createLoadingReportViewer();
    reportViewer.show(text);
  };
  const viewReportAction = { label: "View report", onClick: () => {
    void readReport().then(openReport, () => log.print({ text: "The report could not be prepared. Try View report again.", tone: "warning" }));
  } };
  const copyReport = async (): Promise<void> => {
    try {
      const text = await readReport();
      try {
        await navigator.clipboard.writeText(text);
        log.print({ text: "Report copied.", tone: "success" });
      } catch {
        openReport(text);
        log.print({ text: "Clipboard unavailable. Download the report files from the report viewer." });
      }
    } catch {
      log.print({ text: "The report could not be prepared. Try View report again.", tone: "warning" });
    }
  };
  const reportAction = { label: "Copy report", onClick: () => { void copyReport(); } };

  const status = document.createElement("section");
  status.className = "flight-loading-status";
  status.setAttribute("aria-label", "Flight loading");
  status.hidden = true;
  const titleElement = document.createElement("h2");
  titleElement.className = "flight-loading-status__title";
  titleElement.textContent = DEFAULT_TITLE;
  const indicator = document.createElement("div");
  indicator.className = "flight-loading-status__progress";
  indicator.setAttribute("role", "progressbar");
  indicator.setAttribute("aria-label", "Preparing flight");
  indicator.setAttribute("aria-valuemin", "0");
  indicator.setAttribute("aria-valuemax", "100");
  const detailElement = document.createElement("p");
  detailElement.className = "flight-loading-status__detail";
  detailElement.setAttribute("role", "status");
  const overrideDetail = document.createElement("p");
  overrideDetail.className = "flight-loading-status__override-detail";
  overrideDetail.hidden = true;
  const overrideButton = document.createElement("button");
  overrideButton.type = "button";
  overrideButton.className = "flight-panel__command";
  overrideButton.hidden = true;
  const aboveGroundButton = document.createElement("button");
  aboveGroundButton.type = "button";
  aboveGroundButton.className = "flight-panel__command";
  aboveGroundButton.textContent = "Teleport above ground";
  aboveGroundButton.hidden = true;
  const recoveryButtons = document.createElement("div");
  recoveryButtons.className = "flight-loading-status__actions";
  status.append(indicator, titleElement, detailElement, overrideDetail, overrideButton, aboveGroundButton, recoveryButtons);
  document.body.append(status);
  let spawnOverride: FlightSpawnOverride | null = null;
  const setSpawnOverride = (action: FlightSpawnOverride | null): void => {
    spawnOverride = action;
    overrideButton.hidden = !action;
    overrideButton.disabled = false;
    aboveGroundButton.hidden = !action?.aboveGround;
    aboveGroundButton.disabled = false;
    overrideButton.textContent = action?.label ?? "Spawn now anyway";
    overrideDetail.textContent = action?.detail ?? "Map detail is still loading.";
    overrideDetail.hidden = !action;
  };
  overrideButton.addEventListener("click", () => {
    const action = spawnOverride;
    if (!action || overrideButton.disabled) return;
    spawnOverride = null;
    overrideButton.disabled = true;
    aboveGroundButton.disabled = true;
    action.onClick();
  });
  aboveGroundButton.addEventListener("click", () => {
    const action = spawnOverride?.aboveGround;
    if (!action || aboveGroundButton.disabled) return;
    // The consent popup owns cancellation and duplicate proposal handling.
    action.onClick();
  });
  // The card owns only its pointer interaction; the rest of the world stays usable.
  for (const type of ["pointerdown", "pointermove", "pointerup", "wheel"] as const) {
    status.addEventListener(type, event => event.stopPropagation());
  }
  const refreshStatus = (): void => {
    if (failureMessage) return;
    const active = [...observations].filter(([, value]) => value.update.state === "loading");
    const current = active.find(([phase]) => phase === "terrain") ?? active.at(-1);
    if (!current) { detailElement.textContent = "Preparing your flight…"; return; }
    const [phase, { update }] = current;
    detailElement.textContent = update.detail ?? `Preparing ${PHASE_LABELS[phase].toLowerCase()}…`;
    // A geometry coverage fraction is not a download-completion prediction.
    const progress = phase !== "terrain" && typeof update.progress === "number" && Number.isFinite(update.progress)
      ? Math.max(0, Math.min(1, update.progress)) : null;
    if (progress === null) indicator.removeAttribute("aria-valuenow");
    else indicator.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
  };
  const holdRoot = (): void => {
    if (visible) return;
    previousBusy = root?.getAttribute("aria-busy") ?? null;
    root?.setAttribute("aria-busy", "true");
    visible = true;
    status.hidden = false;
    log.element.setAttribute("data-loading-details", "");
    log.setBusy(true);
  };

  const setPhase = (phase: FlightLoadingPhase, update: FlightLoadingPhaseUpdate): void => {
    if (destroyed || update.state === "waiting") return;
    const now = performance.now();
    const previous = observations.get(phase);
    const record = !previous || previous.update.state !== update.state
      || previous.update.detail !== update.detail || now - previous.recordedAt >= 5000;
    observations.set(phase, { update: { ...update }, recordedAt: record ? now : previous.recordedAt });
    refreshStatus();
    if (record) {
      history.push({ elapsedMs: now - sessionStartedAt, phase, update: { ...update } });
      if (history.length > 120) history.shift();
    }
    saveCheckpoint(!previous || previous.update.state !== update.state);
    const label = PHASE_LABELS[phase];
    const current = phases.get(phase);
    if (update.state === "ready") {
      // A phase never seen loading (a teleport keeps the aircraft and physics)
      // has nothing worth announcing unless it carries a note.
      if (current?.ready || (!current && !update.detail)) return;
      const seconds = current ? ` · ${((performance.now() - current.startedAt) / 1000).toFixed(1)} s` : "";
      const entry: GameLogEntry = { text: `${update.detail ? `${label}: ${update.detail}` : `${label} ready`}${seconds}`, tone: "success" };
      if (current) {
        current.line.update(entry);
        current.ready = true;
      } else {
        phases.set(phase, { line: log.print(entry), startedAt: performance.now(), ready: true });
      }
      return;
    }
    const entry: GameLogEntry = {
      text: (update.detail ? `${label}: ${update.detail}` : label) + describeTerrain(update.terrain),
      tone: update.terrain?.diagnostics?.status === "failed" ? "error" : "progress",
      // Terrain coverage is not a download total. Show actual work and the
      // blocking condition instead of presenting a heuristic as a percentage.
      progress: phase === "terrain" ? undefined : typeof update.progress === "number" ? update.progress : null,
    };
    if (current && !current.ready) current.line.update(entry);
    else phases.set(phase, { line: log.print(entry), startedAt: performance.now(), ready: false });
  };

  const hide = (completed = true): void => {
    if (!visible) return;
    visible = false;
    stoppedAt ??= performance.now();
    diagnostics.stop();
    if (completed) saveCheckpoint(true, failureMessage ? "failed" : "ready");
    log.element.removeAttribute("data-loading-details");
    status.hidden = true;
    setSpawnOverride(null);
    if (root) {
      if (previousBusy === null) root.removeAttribute("aria-busy");
      else root.setAttribute("aria-busy", previousBusy);
    }
    log.setBusy(false);
  };

  const show: FlightLoadingScreen["show"] = (options = {}) => {
    if (destroyed) return;
    reportViewer?.close();
    recoveryButtons.replaceChildren();
    indicator.hidden = false;
    titleElement.textContent = options.title ?? DEFAULT_TITLE;
    detailElement.textContent = options.detail ?? "Preparing your flight…";
    // Keep a failure in the history, without its now-stale button.
    failure?.line.update({ ...failure.entry, actions: [] });
    failure = null;
    failureMessage = null;
    failureCause = null;
    stoppedAt = null;
    if (options.reset) {
      setSpawnOverride(null);
      phases.clear();
      observations.clear();
      history.length = 0;
      sessionStartedAt = performance.now();
      diagnostics.reset();
    }
    diagnostics.start();
    if (!visible || options.title !== undefined) {
      const title = options.title ?? DEFAULT_TITLE;
      log.print({ text: options.detail ? `${title}: ${options.detail}` : title, actions: [viewReportAction, reportAction] });
    }
    holdRoot();
    saveCheckpoint(true, "loading");
  };

  show();
  return {
    show,
    setPhase,
    setSpawnOverride,
    hide,
    trace: diagnostics.trace,
    fail(message, { retry: onRetry, cause, actions = [] } = {}) {
      if (destroyed) return;
      if (failure) {
        if (failureCause === null && cause !== undefined) {
          failureCause = describeLoadingCause(cause);
          failure.entry = { ...failure.entry, text: `${failure.entry.text}\n${failureCause.message}` };
          failure.line.update(failure.entry);
        }
        return;
      }
      message = redactLoadingText(message);
      failureMessage = message;
      failureCause = cause === undefined ? null : describeLoadingCause(cause);
      stoppedAt = performance.now();
      diagnostics.stop();
      saveCheckpoint(true, "failed");
      holdRoot();
      titleElement.textContent = "Flight paused";
      detailElement.textContent = message;
      indicator.hidden = true;
      // Preserve the last measured state, but do not leave a stale loading
      // indicator suggesting that a failed or cancelled request is running.
      for (const [phase, current] of phases) {
        if (current.ready) continue;
        const update = observations.get(phase)?.update;
        current.line.update({
          text: `${PHASE_LABELS[phase]}: stopped.` + (update?.detail ? `\n${update.detail}` : "") + describeTerrain(update?.terrain),
          tone: "error",
        });
      }
      const label = onRetry ? "Try again" : "Reload and try again";
      let recoveryUsed = false;
      const disableRecovery = (): void => {
        recoveryUsed = true;
        for (const button of recoveryButtons.querySelectorAll<HTMLButtonElement>("[data-recovery]")) button.disabled = true;
        if (failure) failure.line.update({ ...failure.entry, actions: failure.entry.actions?.map(action =>
          action === viewReportAction || action === reportAction ? action : { ...action, disabled: true }) });
      };
      const retry = (): void => {
        if (recoveryUsed) return;
        disableRecovery();
        if (onRetry) onRetry();
        else window.location.reload();
      };
      const entry: GameLogEntry = {
        text: `Flight paused. ${message}` + (failureCause ? `\n${failureCause.message}` : ""),
        tone: "error",
        actions: [{ label, onClick: retry }, ...actions.map(action => ({ ...action, onClick() {
          if (recoveryUsed) return;
          disableRecovery(); action.onClick();
        } })), viewReportAction, reportAction],
      };
      failure = { line: log.print(entry), entry };
      for (const action of entry.actions ?? []) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "flight-panel__command";
        button.textContent = action.label;
        button.disabled = action.disabled ?? false;
        if (action !== viewReportAction && action !== reportAction) button.dataset.recovery = "";
        button.addEventListener("click", action.onClick);
        recoveryButtons.append(button);
      }
      failure.line.focusAction();
    },
    destroy() {
      hide(false);
      clearTimeout(checkpointTimer);
      diagnostics.stop();
      reportViewer?.destroy();
      status.remove();
      destroyed = true;
      if (window.osfsLoadingDiagnostics === getReport) {
        if (previousReport) window.osfsLoadingDiagnostics = previousReport;
        else delete window.osfsLoadingDiagnostics;
      }
      if (!sharedLog) log.destroy();
    },
  };
}
