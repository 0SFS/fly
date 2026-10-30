export interface TerrainOverlapNoticeState {
  /** Shown above the message while asking; hidden in the compact status. */
  title?: string;
  message: string;
  /**
   * The pilot already chose to fly on inside the surface: only the status and
   * any recovery move remain, without asking again.
   */
  compact?: boolean;
  onResume(): void;
  /** The resume button's label; "Stay here" by default. */
  resumeLabel?: string;
  /** The caller requests relocation consent before committing this action. */
  onTeleport?: () => void;
  /** The move button's label, such as "Move up". */
  teleportLabel?: string;
}

/** One small card; it never blocks the rest of the interface or moves the aircraft. */
export function createTerrainOverlapNotice(document: Document) {
  const card = document.createElement("section");
  card.className = "flight-terrain-overlap";
  card.setAttribute("aria-label", "Terrain overlap");
  card.hidden = true;
  const title = document.createElement("h2");
  title.className = "flight-loading-status__title";
  title.textContent = "Inside terrain";
  const message = document.createElement("p");
  message.className = "flight-loading-status__detail";
  message.setAttribute("role", "status");
  const actions = document.createElement("div");
  actions.className = "flight-loading-status__actions";
  const resume = document.createElement("button");
  resume.type = "button";
  resume.className = "flight-panel__command";
  resume.textContent = "Stay here";
  const teleport = document.createElement("button");
  teleport.type = "button";
  teleport.className = "flight-panel__command";
  teleport.textContent = "Move up";
  teleport.hidden = true;
  actions.append(resume, teleport);
  card.append(title, message, actions);
  document.body.append(card);
  let state: TerrainOverlapNoticeState | null = null;
  let disposed = false;
  resume.addEventListener("click", () => { state?.onResume(); });
  teleport.addEventListener("click", () => { state?.onTeleport?.(); });
  // Camera gestures stay available everywhere outside this card. Releases
  // still reach the flight's held-input cleanup.
  for (const type of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown"] as const) {
    card.addEventListener(type, event => event.stopPropagation());
  }
  return {
    update(next: TerrainOverlapNoticeState | null): void {
      if (disposed) return;
      state = next;
      card.hidden = next === null;
      const compact = next?.compact === true;
      card.classList.toggle("flight-terrain-overlap--compact", compact);
      title.hidden = compact;
      const heading = next?.title ?? "Inside terrain";
      if (title.textContent !== heading) title.textContent = heading;
      resume.hidden = compact;
      // Keep the same buttons and focus across telemetry/terrain updates.
      if (message.textContent !== (next?.message ?? "")) message.textContent = next?.message ?? "";
      teleport.hidden = !next?.onTeleport;
      const label = next?.teleportLabel ?? "Move up";
      if (teleport.textContent !== label) teleport.textContent = label;
      const resumeLabel = next?.resumeLabel ?? "Stay here";
      if (resume.textContent !== resumeLabel) resume.textContent = resumeLabel;
    },
    /** What the card shows and offers, in one line for a bug report; null while hidden. */
    describe(): string | null {
      if (!state) return null;
      const choices = [resume, teleport].filter(button => !button.hidden).map(button => button.textContent);
      return `${title.hidden ? "" : `${title.textContent}: `}${message.textContent} Choices: ${choices.join(", ") || "none"}.`;
    },
    dispose(): void {
      disposed = true;
      state = null;
      card.remove();
    },
  };
}
