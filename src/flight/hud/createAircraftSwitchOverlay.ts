export interface AircraftSwitchOverlay {
  show(label: string, position?: { x: number; y: number }): void;
  progress(value: number | null, detail?: string): void;
  fail(report: string): void;
  hide(): void;
  dispose(): void;
}

/** Kept outside a flight session so loading and failure survive replacing its UI. */
export function createAircraftSwitchOverlay(container: HTMLElement): AircraftSwitchOverlay {
  const document = container.ownerDocument;
  const host = document.createElement("div");
  host.className = "flight-aircraft-switch";
  host.hidden = true;
  const indicator = document.createElement("div");
  indicator.className = "flight-aircraft-switch__indicator";
  const progress = document.createElement("div");
  progress.className = "flight-aircraft-switch__progress";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", "Loading aircraft");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");
  const text = document.createElement("p");
  text.className = "flight-aircraft-switch__label";
  text.setAttribute("role", "status");
  indicator.append(progress, text);
  host.append(indicator);

  const dialog = document.createElement("dialog");
  dialog.className = "flight-panel__aircraft-dialog";
  dialog.setAttribute("aria-label", "Aircraft switch failed");
  dialog.addEventListener("keydown", event => event.stopPropagation());
  const content = document.createElement("div");
  content.className = "flight-panel__aircraft-dialog-content";
  const title = document.createElement("h2");
  title.textContent = "Could not switch aircraft";
  const explanation = document.createElement("p");
  explanation.textContent = "The simulation remains paused. The error report below describes what failed.";
  const report = document.createElement("pre");
  report.className = "flight-panel__aircraft-error-report";
  report.tabIndex = 0;
  const close = document.createElement("button");
  close.className = "flight-panel__command";
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => dialog.close());
  content.append(title, explanation, report, close);
  dialog.append(content);
  container.append(host, dialog);

  return {
    show(label, position) {
      if (dialog.open) dialog.close();
      text.textContent = `Loading ${label}…`;
      indicator.style.left = position ? `${position.x}px` : "50%";
      indicator.style.top = position ? `${position.y}px` : "55%";
      progress.removeAttribute("aria-valuenow");
      progress.style.removeProperty("--aircraft-load-progress");
      host.hidden = false;
    },
    progress(value, detail) {
      if (value === null) {
        progress.removeAttribute("aria-valuenow");
        progress.style.removeProperty("--aircraft-load-progress");
      } else {
        const percent = Math.max(0, Math.min(100, value));
        progress.setAttribute("aria-valuenow", String(percent));
        progress.style.setProperty("--aircraft-load-progress", `${percent}%`);
      }
      if (detail !== undefined) text.textContent = detail;
    },
    fail(errorReport) {
      host.hidden = true;
      report.textContent = errorReport;
      dialog.showModal();
      close.focus();
    },
    hide() { host.hidden = true; },
    dispose() {
      if (dialog.open) dialog.close();
      host.remove();
      dialog.remove();
    },
  };
}
