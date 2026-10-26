/** Capture and remove credentials before diagnostics or any async feature load. */
export function captureMultiplayerInvitation(location: Pick<Location, "href">, history: Pick<History, "replaceState" | "state">): string | null {
  const url = new URL(location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (!fragment.has("mp")) return null;
  const invitation = url.href;
  url.hash = "";
  history.replaceState(history.state, "", url.href);
  return invitation;
}

let pending: string | null = null;
/** Run after a possible isolation reload, before the page starts diagnostics. */
export function capturePendingMultiplayerInvitation(): void {
  pending = captureMultiplayerInvitation(window.location, window.history);
}
export function takeMultiplayerInvitation(): string | null {
  const invitation = pending;
  pending = null;
  return invitation;
}
