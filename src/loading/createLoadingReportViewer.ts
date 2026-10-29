import { createIconButton } from "@foss-earth/ui/browser";
import { createIssueReportView, type IssueReportViewHandle } from "@foss-earth/ui/diagnostics";
import "./loadingReportViewer.css";

/** The loading screen hosts the shared report outside the inert application root. */
export function createLoadingReportViewer(document: Document = window.document) {
  const dialog = document.createElement("dialog");
  dialog.className = "osfs-loading-report";
  dialog.setAttribute("aria-label", "Loading report");
  const header = document.createElement("header");
  header.className = "osfs-loading-report__header";
  const close = createIconButton(document, { icon: "close", label: "Close report" });
  const title = document.createElement("h2");
  title.textContent = "Loading report";
  header.append(close, title);
  const content = document.createElement("div");
  content.className = "osfs-loading-report__content";
  dialog.append(header, content);
  document.body.append(dialog);
  let viewer: IssueReportViewHandle | null = null;
  let opener: HTMLElement | null = null;
  let destroyed = false;
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });
  dialog.addEventListener("keydown", event => event.stopPropagation());
  return {
    show(text: string) {
      if (destroyed) return;
      if (viewer) viewer.setReport(text);
      else {
        viewer = createIssueReportView(text, { document });
        content.append(viewer.element);
      }
      if (!dialog.open) {
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
      close.focus();
    },
    close() { if (dialog.open) dialog.close(); },
    destroy() {
      destroyed = true;
      if (dialog.open) dialog.close();
      viewer?.destroy();
      viewer = null;
      dialog.remove();
    },
  };
}
