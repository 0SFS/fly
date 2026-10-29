import { ModsPanel } from "@0sfs/mods/ModsPanel";
import { useEffect, useSyncExternalStore } from "react";
import { addMod, browseMods, confirmPendingMod, dismissPendingMod, ensureModsSession, getModsSession, removeMod, setBrowseKind, setDeveloperUsername, subscribeModsSession } from "./modSession";

/** The Mods tab. Its state lives beside the flight snapshot, so a frame does not rebuild this tree. */
export function ModsTab() {
  const state = useSyncExternalStore(subscribeModsSession, getModsSession, getModsSession);
  useEffect(() => { void ensureModsSession(); }, []);
  return (
    <ModsPanel
      installed={state.installed}
      developerUsername={state.developerUsername}
      onDeveloperUsername={setDeveloperUsername}
      allowLocal={import.meta.env.DEV}
      onAdd={(source) => { void addMod(source); }}
      onRemove={(source) => { void removeMod(source); }}
      notice={state.notice}
      pendingWarning={state.pendingWarning}
      onConfirmWarning={() => { void confirmPendingMod(); }}
      onDismissWarning={dismissPendingMod}
      browseKind={state.browseKind}
      onBrowseKind={setBrowseKind}
      browseResults={state.browseResults}
      browseError={state.browseError}
      onBrowse={() => { void browseMods(); }}
      onInstallResult={(fullName) => { void addMod(fullName); }}
      shareUrl={state.shareUrl}
    />
  );
}
