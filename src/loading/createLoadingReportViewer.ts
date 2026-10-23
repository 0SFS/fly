import { createIconButton } from "@foss-earth/ui/browser";
import "./loadingReportViewer.css";

/** Colour JSON without interpreting any report text as HTML. */
function highlightJson(code: HTMLElement, text: string): void {
  const fragment = code.ownerDocument.createDocumentFragment();
  const tokens = /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    fragment.append(text.slice(end, match.index));
    const token = match[0];
    const span = code.ownerDocument.createElement("span");
    const kind = token.startsWith('"')
      ? /^\s*:/.test(text.slice(match.index + token.length)) ? "key" : "string"
      : /^(true|false|null)$/.test(token) ? "literal" : "number";
    span.className = `osfs-loading-report__${kind}`;
    span.textContent = token;
    fragment.append(span);
    end = match.index + token.length;
  }
  fragment.append(text.slice(end));
  code.replaceChildren(fragment);
}

/** Lives outside the inert application root, including when boot fails. */
export function createLoadingReportViewer(document: Document = window.document) {
  const dialog = document.createElement("dialog");
  dialog.className = "osfs-loading-report";
  dialog.setAttribute("aria-label", "Loading report");
  const header = document.createElement("header");
  header.className = "osfs-loading-report__header";
  const close = createIconButton(document, { icon: "close", label: "Close report" });
  const title = document.createElement("h2");
  title.textContent = "Loading report";
  const actions = document.createElement("div");
  actions.className = "osfs-loading-report__actions";
  const copy = createIconButton(document, { icon: "copy", label: "Copy report" });
  const download = createIconButton(document, { icon: "download", label: "Download report", tag: "a" });
  download.download = "osfs-loading-report.json";
  actions.append(copy, download);
  header.append(close, title, actions);
  const status = document.createElement("p");
  status.className = "osfs-loading-report__status";
  status.setAttribute("role", "status");
  const pre = document.createElement("pre");
  pre.className = "osfs-loading-report__content";
  pre.tabIndex = 0;
  pre.setAttribute("aria-label", "Loading report JSON");
  const code = document.createElement("code");
  pre.append(code);
  dialog.append(header, status, pre);
  document.body.append(dialog);
  let reportText = "";
  let objectUrl: string | null = null;
  let opener: HTMLElement | null = null;
  let destroyed = false;
  const releaseDownload = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    download.removeAttribute("href");
  };
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (dialog.open) return; // Ignore a queued close event after an immediate reopen.
    releaseDownload();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });
  // Escape still performs the dialog's native close; flight bindings never see it.
  dialog.addEventListener("keydown", event => event.stopPropagation());
  copy.addEventListener("click", () => {
    const snapshot = reportText;
    status.textContent = "Copying…";
    void (async () => {
      try {
        await navigator.clipboard.writeText(snapshot);
        if (!destroyed && dialog.open && reportText === snapshot) status.textContent = "Copied.";
      } catch {
        if (destroyed || !dialog.open || reportText !== snapshot) return;
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        status.textContent = "Clipboard unavailable. Copy the selected text or download the file.";
      }
    })();
  });
  return {
    show(text: string) {
      if (destroyed) return;
      releaseDownload();
      reportText = text;
      highlightJson(code, text);
      status.textContent = "";
      objectUrl = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
      download.href = objectUrl;
      if (!dialog.open) {
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
      pre.scrollTop = 0;
      pre.focus();
    },
    close() { if (dialog.open) dialog.close(); },
    destroy() {
      destroyed = true;
      if (dialog.open) dialog.close();
      releaseDownload();
      dialog.remove();
    },
  };
}
