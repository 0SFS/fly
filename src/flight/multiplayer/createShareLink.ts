import QRCode from "qrcode";

/** The Google Maps key's URL names; a shared link carries at most the first. */
const GOOGLE_KEY_PARAMS = ["gkey", "key", "googleKey"];

export interface ShareLinkText {
  /** The link's accessible name, such as "Flight invitation". */
  link: string;
  /** The copy button, such as "Copy invitation". */
  copy: string;
  /** The QR code's accessible name, such as "Scan to join this multiplayer flight". */
  qr: string;
  /** What the link is called in fallback messages, such as "invitation link". */
  noun: string;
}

/**
 * A full, copyable link and the matching QR, kept together as the link
 * changes, with an opt-in to add the pilot's Google Maps key to both.
 */
export function createShareLink(text: ShareLinkText) {
  const element = document.createElement("div");
  element.className = "multiplayer-invitation";
  element.hidden = true;
  const link = document.createElement("a");
  link.className = "multiplayer-invitation__link";
  link.setAttribute("aria-label", text.link);
  link.target = "_blank"; link.rel = "noopener noreferrer";
  const copy = document.createElement("button");
  copy.type = "button"; copy.className = "flight-panel__command";
  copy.textContent = text.copy;
  const includeKey = document.createElement("button");
  includeKey.type = "button"; includeKey.className = "flight-panel__command";
  includeKey.title = `Include your configured Google Maps key in the ${text.noun} and QR.`;
  includeKey.hidden = true;
  includeKey.setAttribute("aria-pressed", "false");
  includeKey.textContent = "Include gkey: Off";
  const feedback = document.createElement("p");
  feedback.className = "flight-panel__hint"; feedback.setAttribute("role", "status");
  feedback.hidden = true;
  let url: string | null = null;
  let target: string | null = null;
  let googleKey: string | null = null;
  let sharingKey = false;
  let generation = 0;
  let disposed = false;
  let canvas = document.createElement("canvas");
  canvas.hidden = true;
  element.append(canvas, link, copy, includeKey, feedback);
  function message(value: string) { feedback.textContent = value; feedback.hidden = !value; }
  includeKey.onclick = () => { sharingKey = !sharingKey; render(); };
  copy.onclick = () => {
    if (!url || disposed) return;
    const current = generation;
    if (!navigator.clipboard) { message(`Select the ${text.noun} and copy it.`); return; }
    void navigator.clipboard.writeText(url).then(() => {
      if (!disposed && current === generation) copy.textContent = "Copied";
    }, () => { if (!disposed && current === generation) message(`Select the ${text.noun} and copy it.`); });
  };
  function render() {
    includeKey.hidden = !googleKey;
    includeKey.setAttribute("aria-pressed", String(sharingKey));
    includeKey.textContent = `Include gkey: ${sharingKey ? "On" : "Off"}`;
    let next: string | null = null;
    if (target) {
      const href = new URL(target);
      for (const name of GOOGLE_KEY_PARAMS) href.searchParams.delete(name);
      if (sharingKey && googleKey) href.searchParams.set("gkey", googleKey);
      next = href.href;
    }
    if (disposed || next === url) return;
    url = next;
    const current = ++generation;
    element.hidden = !url;
    canvas.hidden = true;
    link.textContent = url ?? "";
    if (url) link.href = url; else link.removeAttribute("href");
    copy.textContent = text.copy;
    message("");
    if (!url) return;
    const nextCanvas = document.createElement("canvas");
    nextCanvas.className = "multiplayer-invitation__qr";
    nextCanvas.setAttribute("role", "img");
    nextCanvas.setAttribute("aria-label", text.qr);
    // A late render must never reveal a replaced or expired link.
    void QRCode.toCanvas(nextCanvas, url, { width: 280, margin: 3, errorCorrectionLevel: "M" }).then(() => {
      if (disposed || current !== generation) return;
      canvas.replaceWith(nextCanvas);
      canvas = nextCanvas;
    }).catch(() => {
      if (!disposed && current === generation) message(`QR unavailable. Copy the ${text.noun} instead.`);
    });
  }
  return {
    element,
    /** Shows `href`, or nothing for null; `key` is the key the pilot may add. */
    update(href: string | null, key: string | null = null) {
      if (disposed) return;
      target = href;
      googleKey = key?.trim() || null;
      if (!googleKey) sharingKey = false;
      render();
    },
    dispose() { disposed = true; generation++; element.remove(); },
  };
}
