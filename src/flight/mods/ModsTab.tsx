import { ModsPanel } from "@0sfs/mods/ModsPanel";
import { useEffect, useSyncExternalStore } from "react";
import { addMod, browseMods, cancelModSearch, confirmPendingMod, dismissPendingMod, ensureModsSession, getModsSession, removeMod, setBrowseKind, setDeveloperUsername, setModSource, setModPlace, subscribeModsSession } from "./modSession";

/** The Mods tab. Its state lives beside the flight snapshot, so a frame does not rebuild this tree. */
export function ModsTab() {
  const state = useSyncExternalStore(subscribeModsSession, getModsSession, getModsSession);
  useEffect(() => { void ensureModsSession(); }, []);
  useEffect(() => {
    if (state.place === "local" || state.source.trim().length === 1) return;
    const timer = setTimeout(() => { void browseMods(); }, state.source.trim() ? 400 : 0);
    return () => { clearTimeout(timer); cancelModSearch(); };
  }, [state.source, state.place, state.browseKind]);
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
      source={state.source}
      onSource={setModSource}
      place={state.place}
      onPlace={setModPlace}
      browseKind={state.browseKind}
      onBrowseKind={setBrowseKind}
      browseResults={state.browseResults}
      browseError={state.browseError}
      browseStatus={state.browseStatus}
      browseRetryAt={state.browseRetryAt}
      onBrowse={() => { void browseMods(); }}
      onInstallResult={(fullName) => { void addMod(fullName); }}
      shareUrl={state.shareUrl}
    />
  );
}
