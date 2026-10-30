import { describe, expect, it } from "vitest";
import { createFireControl, type FireControlInput } from "./fireControl";

function load(stations: Record<number, string>): (string | null)[] {
  const result = Array<string | null>(12).fill(null);
  for (const [station, key] of Object.entries(stations)) result[Number(station)] = key;
  return result;
}

function input(patch: Partial<FireControlInput> = {}): FireControlInput {
  return {
    dt: 0.1, held: false, armed: true, paused: false, rounds: 220, gunPod: true,
    load: load({ 1: "aim-9x", 4: "aim-120", 6: "gau-22-pod", 7: "aim-120", 11: "aim-9x" }),
    bayPos: [0, 0], selectedWeaponKey: "aim-9x", shooterId: "local",
    kinematics: {
      latDeg: 45, lonDeg: -93, altMeters: 1000, tMs: 100,
      northMps: 100, eastMps: 0, upMps: 0, rollRad: 0, pitchRad: 0, headingRad: 0,
    },
    target: null, missileSpeedMps: 0,
    ...patch,
  };
}

describe("exclusive armament trigger", () => {
  it("fires only the selected gun and flushes its spent rounds on release", () => {
    const control = createFireControl();
    const firing = control.step(input({ selectedWeaponKey: "gau-22-pod", held: true }));
    expect(firing.firing).toBe(true);
    expect(firing.rounds).toBe(215);
    expect(firing.selectedStation).toBe(6);
    expect(firing.launches).toEqual([]);
    expect(firing.door).toBeNull();
    const released = control.step(input({ selectedWeaponKey: "gau-22-pod", rounds: firing.rounds }));
    expect(released.firing).toBe(false);
    expect(released.bursts).toHaveLength(1);
    expect(released.bursts[0]?.count).toBe(5);
  });

  it("launches only the selected missile once per hold and advances within its type", () => {
    const control = createFireControl();
    const first = control.step(input({ held: true }));
    expect(first.launches).toHaveLength(1);
    expect(first.consumedStation).toBe(1);
    expect(first.rounds).toBe(220);
    expect(first.firing).toBe(false);
    expect(first.bursts).toEqual([]);
    const remaining = load({ 4: "aim-120", 6: "gau-22-pod", 11: "aim-9x" });
    const held = control.step(input({ held: true, load: remaining }));
    expect(held.selectedStation).toBe(11);
    expect(held.launches).toEqual([]);
    control.step(input({ load: remaining }));
    const second = control.step(input({ held: true, load: remaining }));
    expect(second.consumedStation).toBe(11);
    expect(second.launches).toHaveLength(1);
  });

  it.each(["asraam", "gbu-32", null])("never falls through from %s to another weapon", selectedWeaponKey => {
    const output = createFireControl().step(input({ selectedWeaponKey, held: true, pressed: true }));
    expect(output.selectedStation).toBeNull();
    expect(output.launches).toEqual([]);
    expect(output.rounds).toBe(220);
    expect(output.firing).toBe(false);
    expect(output.door).toBeNull();
  });

  it.each([
    { rounds: 0 },
    { gunPod: false },
    { load: load({ 1: "aim-9x" }) },
  ])("does not fire an unavailable selected gun: %j", patch => {
    const command = input({ selectedWeaponKey: "gau-22-pod", held: true, ...patch });
    const output = createFireControl().step(command);
    expect(output.rounds).toBe(command.rounds);
    expect(output.firing).toBe(false);
    expect(output.launches).toEqual([]);
  });

  it.each([
    { armed: false }, { paused: true }, { kinematics: null }, { dt: -0.1 },
  ])("blocks both weapon paths when firing is unavailable: %j", patch => {
    for (const selectedWeaponKey of ["aim-9x", "gau-22-pod"]) {
      const output = createFireControl().step(input({ selectedWeaponKey, held: true, pressed: true, ...patch }));
      expect(output.launches).toEqual([]);
      expect(output.rounds).toBe(220);
      expect(output.firing).toBe(false);
    }
  });

  it("accepts a complete UI tap between ticks and combines it with the same held edge", () => {
    const tapped = createFireControl().step(input({ pressed: true }));
    expect(tapped.launches).toHaveLength(1);
    const control = createFireControl();
    const heldTap = control.step(input({ pressed: true, held: true }));
    expect(heldTap.launches).toHaveLength(1);
    expect(control.step(input({ held: true })).launches).toEqual([]);
    expect(createFireControl().step(input({ selectedWeaponKey: "gau-22-pod", pressed: true })).rounds).toBe(220);
  });

  it("waits for an internal bay, launches after release and then closes it", () => {
    const control = createFireControl();
    const queued = control.step(input({ selectedWeaponKey: "aim-120", pressed: true }));
    expect(queued.selectedStation).toBe(4);
    expect(queued.pendingStation).toBe(4);
    expect(queued.door).toEqual({ bay: 0, open: true });
    expect(queued.launches).toEqual([]);
    expect(control.getPending()).toEqual({ station: 4, key: "aim-120", bay: 0 });
    const waiting = control.step(input({ selectedWeaponKey: "aim-120", bayPos: [0.94, 0] }));
    expect(waiting.pendingStation).toBe(4);
    expect(waiting.launches).toEqual([]);
    const launched = control.step(input({ selectedWeaponKey: "aim-120", bayPos: [0.95, 0] }));
    expect(launched.launches).toHaveLength(1);
    expect(launched.consumedStation).toBe(4);
    expect(launched.pendingStation).toBeNull();
    expect(launched.door).toEqual({ bay: 0, open: false });
    expect(control.getPending()).toBeNull();
  });

  it("holds only one queued missile and does not chain a second launch on a held trigger", () => {
    const control = createFireControl();
    control.step(input({ selectedWeaponKey: "aim-120", held: true }));
    const repeated = control.step(input({ selectedWeaponKey: "aim-120", held: true, pressed: true }));
    expect(repeated.pendingStation).toBe(4);
    expect(repeated.door).toBeNull();
    const launched = control.step(input({ selectedWeaponKey: "aim-120", held: true, bayPos: [1, 1] }));
    expect(launched.consumedStation).toBe(4);
    const next = control.step(input({
      selectedWeaponKey: "aim-120", held: true, bayPos: [1, 1], load: load({ 7: "aim-120" }),
    }));
    expect(next.selectedStation).toBe(7);
    expect(next.launches).toEqual([]);
    expect(next.pendingStation).toBeNull();
  });

  it("launches immediately from an already open bay without closing a manual opening", () => {
    const control = createFireControl();
    const output = control.step(input({ selectedWeaponKey: "aim-120", held: true, bayPos: [1, 0] }));
    expect(output.launches).toHaveLength(1);
    expect(output.pendingStation).toBeNull();
    expect(output.door).toBeNull();
    expect(control.cancel()).toBeNull();
  });

  it.each([
    { armed: false },
    { paused: true },
    { kinematics: null },
    { selectedWeaponKey: "aim-9x" },
    { load: load({ 4: "gbu-32", 7: "aim-120" }) },
    { load: load({ 7: "aim-120" }) },
  ])("cancels a queued shot when its original command becomes invalid: %j", patch => {
    const control = createFireControl();
    control.step(input({ selectedWeaponKey: "aim-120", pressed: true }));
    const canceled = control.step(input({ selectedWeaponKey: "aim-120", bayPos: [1, 1], ...patch }));
    expect(canceled.launches).toEqual([]);
    expect(canceled.pendingStation).toBeNull();
    expect(canceled.door).toEqual({ bay: 0, open: false });
    expect(control.getPending()).toBeNull();
    const later = control.step(input({ selectedWeaponKey: "aim-120", bayPos: [1, 1] }));
    expect(later.launches).toEqual([]);
  });

  it("cancels synchronously, closes its requested bay and returns a defensive pending snapshot", () => {
    const control = createFireControl();
    control.step(input({ selectedWeaponKey: "aim-120", pressed: true }));
    const snapshot = control.getPending()!;
    snapshot.station = 8;
    expect(control.getPending()?.station).toBe(4);
    expect(control.cancel()).toEqual({ bay: 0, open: false });
    expect(control.getPending()).toBeNull();
    expect(control.cancel()).toBeNull();
    expect(control.step(input({ selectedWeaponKey: "aim-120", bayPos: [1, 1] })).launches).toEqual([]);
  });

  it("preserves already spent gun rounds for a flush after cancellation and clears fractional credit", () => {
    const control = createFireControl();
    const firing = control.step(input({ selectedWeaponKey: "gau-22-pod", held: true, dt: 0.03 }));
    expect(firing.rounds).toBe(219);
    expect(firing.bursts).toEqual([]);
    expect(control.cancel()).toBeNull();
    const stopped = control.step(input({ selectedWeaponKey: "gau-22-pod", rounds: 219, paused: true }));
    expect(stopped.bursts[0]?.count).toBe(1);
    expect(stopped.firing).toBe(false);
    const fresh = control.step(input({ selectedWeaponKey: "gau-22-pod", rounds: 219, held: true, dt: 0.01 }));
    expect(fresh.rounds).toBe(219);
  });

  it("flushes a canceled burst before spending new rounds at a different pose", () => {
    const control = createFireControl();
    const original = input({ selectedWeaponKey: "gau-22-pod", held: true, dt: 0.02 });
    control.step(original);
    control.cancel();
    const moved = { ...original.kinematics!, latDeg: 46, tMs: 5000 };
    const fresh = control.step(input({
      selectedWeaponKey: "gau-22-pod", held: true, rounds: 219, dt: 0.02, kinematics: moved,
    }));
    expect(fresh.bursts).toHaveLength(1);
    expect(fresh.bursts[0]).toMatchObject({ count: 1, latDeg: 45, tMs: 100 });
    expect(fresh.rounds).toBe(218);
    const released = control.step(input({ selectedWeaponKey: "gau-22-pod", rounds: 218, kinematics: moved }));
    expect(released.bursts).toHaveLength(1);
    expect(released.bursts[0]).toMatchObject({ count: 1, latDeg: 46, tMs: 5000 });
  });
});
