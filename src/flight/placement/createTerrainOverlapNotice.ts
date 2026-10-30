export interface TerrainOverlapNoticeState {
  message: string;
  /**
   * The pilot already chose to fly on inside the surface: only the status and
   * any recovery move remain, without asking again.
   */
  compact?: boolean;
  onResume(): void;
  /** The caller requests relocation consent before committing this action. */
  onTeleport?: () => void;
}

/** An advisory card; it never blocks the rest of the interface or moves the aircraft. */
export function createTerrainOverlapNotice(document: Document) {
  const card = document.createElement("section");
  card.className = "flight-terrain-overlap";
  card.setAttribute("aria-label", "Terrain overlap");
  card.hidden = true;
  const title = document.createElement("h2");
  title.className = "flight-loading-status__title";
  title.textContent = "Terrain overlaps your aircraft";
  const message = document.createElement("p");
  message.className = "flight-loading-status__detail";
  message.setAttribute("role", "status");
  const explanation = document.createElement("p");
  explanation.className = "flight-loading-status__override-detail";
  explanation.textContent = "Available terrain may change as map detail loads. You can keep flying here, including below the current surface.";
  const actions = document.createElement("div");
  actions.className = "flight-loading-status__actions";
  const resume = document.createElement("button");
  resume.type = "button";
  resume.className = "flight-panel__command";
  resume.textContent = "Resume flight here";
  const teleport = document.createElement("button");
  teleport.type = "button";
  teleport.className = "flight-panel__command";
  teleport.textContent = "Teleport above ground";
  teleport.hidden = true;
  actions.append(resume, teleport);
  card.append(title, message, explanation, actions);
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
      explanation.hidden = compact;
      resume.hidden = compact;
      // Keep the same buttons and focus across telemetry/terrain updates.
      if (message.textContent !== (next?.message ?? "")) message.textContent = next?.message ?? "";
      teleport.hidden = !next?.onTeleport;
    },
    dispose(): void {
      disposed = true;
      state = null;
      card.remove();
    },
  };
}
