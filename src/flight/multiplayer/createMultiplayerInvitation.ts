import QRCode from "qrcode";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { InvitationStartControls, type InvitationStartControlsProps } from "./InvitationStartControls";
import { withInvitationStart, type InvitationStart } from "./invitationStart";

/** A full, copyable invitation and the matching QR, kept together as it renews. */
export function createMultiplayerInvitation(options?: Omit<InvitationStartControlsProps, "onChange">) {
  const element = document.createElement("div");
  element.className = "multiplayer-invitation";
  element.hidden = true;
  const link = document.createElement("a");
  link.className = "multiplayer-invitation__link";
  link.setAttribute("aria-label", "Flight invitation");
  link.target = "_blank"; link.rel = "noopener noreferrer";
  const copy = document.createElement("button");
  copy.type = "button"; copy.className = "flight-panel__command";
  copy.textContent = "Copy invitation";
  const includeKey = document.createElement("button");
  includeKey.type = "button"; includeKey.className = "flight-panel__command";
  includeKey.title = "Include your configured Google Maps key in the invitation link and QR.";
  includeKey.hidden = true;
  includeKey.setAttribute("aria-pressed", "false");
  includeKey.textContent = "Include gkey: Off";
  const feedback = document.createElement("p");
  feedback.className = "flight-panel__hint"; feedback.setAttribute("role", "status");
  feedback.hidden = true;
  let url: string | null = null;
  let invitation: string | null = null;
  let googleKey: string | null = null;
  let sharingKey = false;
  let start: InvitationStart = {};
  let generation = 0;
  let disposed = false;
  let canvas = document.createElement("canvas");
  canvas.hidden = true;
  element.append(canvas, link, copy, includeKey, feedback);
  const controlsHost = document.createElement("div");
  const controls = options ? createRoot(controlsHost) : null;
  if (options) {
    element.prepend(controlsHost);
    controls!.render(createElement(InvitationStartControls, { ...options, onChange: next => { start = next; render(); } }));
  }
  function message(text: string) { feedback.textContent = text; feedback.hidden = !text; }
  includeKey.onclick = () => { sharingKey = !sharingKey; render(); };
  copy.onclick = () => {
    if (!url || disposed) return;
    const current = generation;
    if (!navigator.clipboard) { message("Select the invitation link and copy it."); return; }
    void navigator.clipboard.writeText(url).then(() => {
      if (!disposed && current === generation) copy.textContent = "Copied";
    }, () => { if (!disposed && current === generation) message("Select the invitation link and copy it."); });
  };
  function render() {
    includeKey.hidden = !googleKey;
    includeKey.setAttribute("aria-pressed", String(sharingKey));
    includeKey.textContent = `Include gkey: ${sharingKey ? "On" : "Off"}`;
    let next: string | null = null;
    if (invitation) {
      const target = new URL(invitation);
      for (const name of ["gkey", "key", "googleKey"]) target.searchParams.delete(name);
      if (sharingKey && googleKey) target.searchParams.set("gkey", googleKey);
      next = withInvitationStart(target.href, start);
    }
    if (disposed || next === url) return;
    url = next;
    const current = ++generation;
    element.hidden = !url;
    canvas.hidden = true;
    link.textContent = url ?? "";
    if (url) link.href = url; else link.removeAttribute("href");
    copy.textContent = "Copy invitation";
    message("");
    if (!url) return;
    const nextCanvas = document.createElement("canvas");
    nextCanvas.className = "multiplayer-invitation__qr";
    nextCanvas.setAttribute("role", "img");
    nextCanvas.setAttribute("aria-label", "Scan to join this multiplayer flight");
    // A late render must never reveal a replaced or expired invitation.
    void QRCode.toCanvas(nextCanvas, url, { width: 280, margin: 3, errorCorrectionLevel: "M" }).then(() => {
      if (disposed || current !== generation) return;
      canvas.replaceWith(nextCanvas);
      canvas = nextCanvas;
    }).catch(() => {
      if (!disposed && current === generation) message("QR unavailable. Copy the invitation link instead.");
    });
  }
  return {
    element,
    update(next: string | null, key: string | null = null) {
      if (disposed) return;
      invitation = next;
      googleKey = key?.trim() || null;
      if (!googleKey) sharingKey = false;
      render();
    },
    dispose() { disposed = true; generation++; controls?.unmount(); element.remove(); },
  };
}
