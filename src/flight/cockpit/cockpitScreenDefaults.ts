import type { DeviceContext, SettingsRegistry } from "foss-earth/settings";

/** The least a computer reports of itself to draw the world twice: a chase view behind the cockpit screen's interface. */
export const FASTEST_COMPUTER = { threads: 16, memoryGiB: 8 } as const;

/**
 * Why a computer is too slow by default for the chase view behind the cockpit
 * screen's interface, or null for one of the fastest, from what it reports of
 * itself and never its frame time, so the default does not change during a
 * flight: a WebGPU renderer, 16 processor threads or more, the most memory a
 * browser reports (8 GiB), and no touch screen, which a desktop or a large
 * laptop has and a tablet does not.
 */
export function notFastestComputerReason(
  context: Pick<DeviceContext, "rendererMode" | "hardwareConcurrency" | "deviceMemoryGiB" | "touch">,
): string | null {
  if (context.rendererMode !== "webgpu") return "it draws with WebGL";
  if (context.touch) return "it has a touch screen";
  if (context.hardwareConcurrency === null) return "it does not say how many processor threads it has";
  if (context.hardwareConcurrency < FASTEST_COMPUTER.threads) return `it reports ${context.hardwareConcurrency} processor threads, under ${FASTEST_COMPUTER.threads}`;
  if (context.deviceMemoryGiB === null) return "it does not say how much memory it has";
  if (context.deviceMemoryGiB < FASTEST_COMPUTER.memoryGiB) return `it reports ${context.deviceMemoryGiB} GiB of memory, under ${FASTEST_COMPUTER.memoryGiB} GiB`;
  return null;
}

/** On one of the fastest computers, unless the user chose otherwise: the chase view behind the cockpit screen's interface. Call once the renderer has started. */
export function applyFastestComputerCockpitDefaults(settings: SettingsRegistry): void {
  const context = settings.getDeviceContext();
  if (notFastestComputerReason(context) !== null) return;
  settings.setHostDefault("osfs.cockpit.screen.background", "chase",
    `one of the fastest computers: it draws with WebGPU, reports ${context.hardwareConcurrency} processor threads and ${context.deviceMemoryGiB} GiB of memory, and has no touch screen`);
}
