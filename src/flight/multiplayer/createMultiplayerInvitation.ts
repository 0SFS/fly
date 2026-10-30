import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createShareLink } from "./createShareLink";
import { InvitationStartControls, type InvitationStartControlsProps } from "./InvitationStartControls";
import { withInvitationStart, type InvitationStart } from "./invitationStart";

/** A full, copyable invitation and the matching QR, kept together as it renews. */
export function createMultiplayerInvitation(options?: Omit<InvitationStartControlsProps, "onChange">) {
  const share = createShareLink({
    link: "Flight invitation",
    copy: "Copy invitation",
    qr: "Scan to join this multiplayer flight",
    noun: "invitation link",
  });
  const element = share.element;
  let invitation: string | null = null;
  let googleKey: string | null = null;
  let start: InvitationStart = {};
  let disposed = false;
  const controlsHost = document.createElement("div");
  const controls = options ? createRoot(controlsHost) : null;
  if (options) {
    element.prepend(controlsHost);
    controls!.render(createElement(InvitationStartControls, { ...options, onChange: next => { start = next; render(); } }));
  }
  function render() {
    if (!disposed) share.update(invitation ? withInvitationStart(invitation, start) : null, googleKey);
  }
  return {
    element,
    update(next: string | null, key: string | null = null) {
      invitation = next;
      googleKey = key;
      render();
    },
    dispose() { disposed = true; controls?.unmount(); share.dispose(); },
  };
}
