export interface FlightPlacementProposal {
  /** A human-readable place and altitude; the caller owns the proposed pose. */
  destination: string;
  reason: string;
  signal?: AbortSignal;
}

export interface FlightPlacementCoordinator {
  /** Only grants consent for this proposal. The caller checks cancellation before committing. */
  request(proposal: FlightPlacementProposal): Promise<boolean>;
  cancel(): void;
  dispose(): void;
}

let nextDialogId = 0;

/** Every nonphysical relocation asks afresh; this object never moves the aircraft. */
export function createFlightPlacementCoordinator(document: Document): FlightPlacementCoordinator {
  const dialog = document.createElement("dialog");
  dialog.className = "flight-panel__aircraft-dialog flight-placement-dialog";
  dialog.setAttribute("aria-label", "Confirm teleport");
  const content = document.createElement("div");
  content.className = "flight-panel__aircraft-dialog-content";
  const title = document.createElement("h2");
  const reason = document.createElement("p");
  reason.id = `flight-placement-reason-${++nextDialogId}`;
  dialog.setAttribute("aria-describedby", reason.id);
  const actions = document.createElement("div");
  actions.className = "flight-panel__aircraft-dialog-actions";
  const no = document.createElement("button");
  no.type = "button";
  no.className = "flight-panel__command";
  no.textContent = "No";
  no.autofocus = true;
  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "flight-panel__command";
  yes.textContent = "Yes";
  actions.append(no, yes);
  content.append(title, reason, actions);
  dialog.append(content);
  document.body.append(dialog);

  let disposed = false;
  let pending: { resolve(accepted: boolean): void; abort(): void; signal?: AbortSignal; focus: Element | null } | null = null;
  const settle = (accepted: boolean): void => {
    const previous = pending;
    if (!previous) return;
    pending = null;
    previous.signal?.removeEventListener("abort", previous.abort);
    if (dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    if (previous.focus?.isConnected && "focus" in previous.focus) (previous.focus as HTMLElement).focus();
    previous.resolve(accepted && !disposed && !previous.signal?.aborted);
  };
  no.addEventListener("click", () => settle(false));
  yes.addEventListener("click", () => settle(true));
  dialog.addEventListener("cancel", event => { event.preventDefault(); settle(false); });
  // A queued close from the preceding proposal must not cancel its replacement.
  dialog.addEventListener("close", () => { if (!dialog.open) settle(false); });
  dialog.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); settle(false); }
  });
  // Keep dialog interaction out of the camera. Key releases still reach held-input cleanup.
  for (const type of ["pointerdown", "pointermove", "pointerup", "wheel"] as const) {
    dialog.addEventListener(type, event => event.stopPropagation());
  }

  return {
    request(proposal) {
      settle(false);
      if (disposed || proposal.signal?.aborted) return Promise.resolve(false);
      title.textContent = `Teleport to ${proposal.destination}?`;
      reason.textContent = proposal.reason;
      return new Promise(resolve => {
        const abort = (): void => settle(false);
        pending = { resolve, abort, signal: proposal.signal, focus: document.activeElement };
        proposal.signal?.addEventListener("abort", abort, { once: true });
        if (proposal.signal?.aborted) { settle(false); return; }
        try {
          if (typeof dialog.showModal === "function") dialog.showModal();
          else dialog.setAttribute("open", "");
          no.focus();
        } catch {
          // A detached document or unavailable modal must never imply consent.
          settle(false);
        }
      });
    },
    cancel() { settle(false); },
    dispose() {
      if (disposed) return;
      disposed = true;
      settle(false);
      dialog.remove();
    },
  };
}
