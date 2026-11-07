import type { ReplayHost } from "@0sfs/replay/replayHost";
import { createFlightUiHost } from "../flight/earthUiHost";
import { createFlightHudBar } from "../flight/hud/createFlightHudBar";
import { navigatorDeviceHints } from "../flight/worldDetail";

/**
 * What /fly/ lends /replay/: the flight's own toolbar, without the controls
 * above it, the ports FOSS Earth's panels take, and the device's hints for
 * World detail. The bar is the one the flight uses, so the pages share it.
 */
export const replayHost: ReplayHost = {
  createToolbar(parent, options) {
    const { runtime } = options;
    const root = parent.ownerDocument.createElement("div");
    root.className = "flight-shell-root";
    parent.append(root);
    const bar = createFlightHudBar(root, {
      label: "Replay controls",
      pauseTitles: { pause: "Pause the replay", resume: "Play the replay" },
      tabNames: options.tabNames,
      renderActivity: runtime,
      rendererMode: runtime.renderer.mode,
      runtimeStatus: runtime.status,
      mapDetail: options.mapDetail,
      seaLevel: options.seaLevel,
      // The replay's camera reads the input method and its sensitivity as it moves.
      onInputModeChange: () => {},
      onInputSensitivityChange: () => {},
      onPausedChange: paused => options.onPlayingChange(!paused),
      onDebugClick: options.toggle.fps,
      onRendererClick: options.toggle.renderer,
      onMapClick: options.toggle.basemap,
      onStatusClick: options.toggle.position,
      onInputMethodClick: options.toggle.inputMethod,
    });
    return {
      update(reading, fps, playing, groundHeightMeters) {
        // With no flight open there is no position to give: the bar keeps its dashes.
        if (reading) bar.update(reading, runtime.status, fps, !playing, groundHeightMeters);
      },
      mountInputMethod: container => bar.mountInputMethod(container),
      top() {
        const rect = root.querySelector(".hud-bar")?.getBoundingClientRect();
        return rect && rect.height > 0 ? rect.top : null;
      },
      destroy() {
        bar.destroy();
        root.remove();
      },
    };
  },
  createUiHost: createFlightUiHost,
  deviceHints: navigatorDeviceHints,
};
