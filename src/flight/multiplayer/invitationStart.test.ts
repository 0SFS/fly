import { describe, expect, it } from "vitest";
import { invitationLocation, readInvitationStart, withInvitationStart } from "./invitationStart";
import { registerAircraftId, unregisterAircraftId } from "@0sfs/aircraft/aircraftIds";
import { createSettingsRegistry } from "foss-earth/settings";
import { OSFS_PARAMETERS } from "../settings/flightParameters";

const base = `https://example.test/fly/#mp=1&v=1&peer=host&join=${"a".repeat(43)}`;
describe("invitation start", () => {
  it("selects the invited aircraft through normal URL settings at startup", () => {
    const url = new URL(withInvitationStart(base, { aircraftId: "f-35b" }));
    const settings = createSettingsRegistry({ storage: null, searchParams: url.searchParams });
    settings.register(OSFS_PARAMETERS);
    expect(settings.get("osfs.aircraft.id")).toBe("f-35b");
    expect(settings.inspect("osfs.aircraft.id").provenance).toBe("url");
  });
  it("round trips aircraft and a runway arrival without changing the peer credentials", () => {
    const start = { aircraftId: "f-35b" as const, location: { latDeg: 45, lonDeg: -93, altMeters: 800,
      flightPreset: { mode: "arrival" as const, headingDeg: 90, groundElevationMeters: 300, flightPathDeg: -3 } } };
    const url = withInvitationStart(base, start);
    expect(readInvitationStart(url)).toEqual(start);
    const fragment = new URLSearchParams(new URL(url).hash.slice(1));
    expect(fragment.get("peer")).toBe("host"); expect(fragment.get("join")).toBe("a".repeat(43));
    expect(new URL(url).searchParams.get("aircraft")).toBe("f-35b");
    expect(withInvitationStart(url, {})).toBe(base);
  });
  it("supports independent optional fields and strips unrelated location data", () => {
    expect(readInvitationStart(withInvitationStart(base, { aircraftId: "cessna-172" }))).toEqual({ aircraftId: "cessna-172" });
    const location = { latDeg: 0, lonDeg: 0, altMeters: 0, headingDeg: 0, airspeedKts: 0 };
    expect(readInvitationStart(withInvitationStart(base, { location }))).toEqual({ location });
    expect(invitationLocation({ ...location, secret: "unused", hostData: { airport: "unused" } })).toEqual(location);
  });
  it("rejects malformed, nonfinite and out of range destinations", () => {
    for (const value of [null, {}, { latDeg: 91, lonDeg: 0 }, { latDeg: 0, lonDeg: Infinity },
      { latDeg: 0, lonDeg: 0, altMeters: "100" }, { latDeg: 0, lonDeg: 0, flightPreset: { mode: "other" } }]) {
      expect(invitationLocation(value)).toBeUndefined();
    }
    expect(readInvitationStart(`${base}&spawn=invalid-json`)).toEqual({});
    expect(readInvitationStart(base.replace("/fly/", "/fly/?set.osfs.aircraft.id=unknown"))).toEqual({});
  });
  it("reads an older invitation's full setting name and a renamed aircraft's old id", () => {
    expect(readInvitationStart(base.replace("/fly/", "/fly/?set.osfs.aircraft.id=f-35b"))).toEqual({ aircraftId: "f-35b" });
    // A drone's id is known once its mod is installed.
    registerAircraftId("dji-air2s");
    try {
      expect(readInvitationStart(base.replace("/fly/", "/fly/?aircraft=dji-air-2s"))).toEqual({ aircraftId: "dji-air2s" });
    } finally { unregisterAircraftId("dji-air2s"); }
    const older = new URL(base); older.searchParams.set("set.osfs.aircraft.id", "f-35b");
    expect(new URL(withInvitationStart(older.href, { aircraftId: "cessna-172" })).searchParams.has("set.osfs.aircraft.id")).toBe(false);
  });
});
