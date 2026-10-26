import { getAppSettings, resetAppSettings } from "foss-earth/settings";
import { afterEach, describe, expect, it } from "vitest";
import { REARM_GROUND_ONLY, setRearmRule } from "./rearmRule";

afterEach(() => resetAppSettings());

describe("rearm rule", () => {
  it("defaults to the pilot's setting, off, and lets a session hold it on with a reason until it hands it back", () => {
    const settings = getAppSettings();
    setRearmRule("pilot", { settings });
    expect(settings.get(REARM_GROUND_ONLY)).toBe(false);
    settings.set(REARM_GROUND_ONLY, true);
    setRearmRule(undefined, { settings });
    expect(settings.get(REARM_GROUND_ONLY)).toBe(true);
    settings.set(REARM_GROUND_ONLY, false);

    setRearmRule("ground-only", { settings, reason: "This server rearms on the ground only." });
    setRearmRule("ground-only", { settings, reason: "This server rearms on the ground only." });
    expect(settings.get(REARM_GROUND_ONLY)).toBe(true);
    expect(settings.inspect(REARM_GROUND_ONLY)).toMatchObject({
      provenance: "host", layers: { forced: { value: true, reason: "This server rearms on the ground only." } },
    });
    expect(settings.set(REARM_GROUND_ONLY, false).ok).toBe(true);
    expect(settings.get(REARM_GROUND_ONLY)).toBe(true);

    // One call releases it, however often it was held; the pilot's own choice returns.
    setRearmRule("pilot", { settings });
    expect(settings.get(REARM_GROUND_ONLY)).toBe(false);
  });
});
