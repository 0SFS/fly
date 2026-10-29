import { describe, expect, it } from "vitest";
import { AIRCRAFT_IDS } from "@0sfs/aircraft/aircraftCatalog";
import { flapScheduleValue, INSTRUMENT_BANDS, readingTints, type InstrumentReading } from "./instrumentBands";

const C172 = INSTRUMENT_BANDS["cessna-172"];
const SF50 = INSTRUMENT_BANDS["cirrus-vision-jet"];

/** Level at 100 kt, clean, at the C172 band's own weight. */
const reading = (overrides: Partial<InstrumentReading>): InstrumentReading => ({
  iasKt: 100, aoaDeg: null, g: null, vsFpm: 0, flaps: 0, weightLb: 1880, onGround: false, jetBorne: false, ...overrides,
});

describe("instrument bands", () => {
  it("keeps a mod aircraft without declared limits untinted", () => {
    expect(readingTints(undefined, reading({ iasKt: 1, aoaDeg: 90, g: 5, vsFpm: 2500 })))
      .toEqual({ ias: null, aoa: null, g: null, vs: null });
  });

  it("has a band for every aircraft, green before red", () => {
    for (const id of AIRCRAFT_IDS) {
      const bands = INSTRUMENT_BANDS[id];
      for (const flaps of [0, 0.25, 0.5, 0.75, 1]) {
        const stall = flapScheduleValue(bands.ias.stall.kt, flaps);
        expect(stall * 1.3).toBeLessThan(bands.ias.green);
        expect(flapScheduleValue(bands.aoa.green, flaps)).toBeLessThan(flapScheduleValue(bands.aoa.red, flaps));
      }
      expect(bands.ias.green).toBeLessThan(bands.ias.red);
      expect(bands.g.min).toBeLessThan(1);
      expect(bands.g.max).toBeGreaterThan(1);
      expect(bands.vs.full).toBeGreaterThan(0);
    }
  });

  it("reads a flap schedule between its points and holds its ends", () => {
    const schedule = [[0, 86], [0.5, 77], [1, 67]] as const;
    expect(flapScheduleValue(schedule, 0)).toBe(86);
    expect(flapScheduleValue(schedule, 0.25)).toBeCloseTo(81.5);
    expect(flapScheduleValue(schedule, 0.75)).toBeCloseTo(72);
    expect(flapScheduleValue(schedule, -0.1)).toBe(86);
    expect(flapScheduleValue(schedule, 1.2)).toBe(67);
    expect(flapScheduleValue(schedule, Number.NaN)).toBe(86);
    expect(flapScheduleValue(12, 0.5)).toBe(12);
  });

  it("is red at the stall, green from 1.3 times it to Vno, and red from Vne", () => {
    const ias = (iasKt: number, more: Partial<InstrumentReading> = {}) => readingTints(C172, reading({ iasKt, ...more })).ias;
    expect(ias(45)).toBe(1);
    expect(ias(47)).toBe(1);
    expect(ias(47 * 1.15)).toBeCloseTo(0.5);
    expect(ias(47 * 1.3)).toBeCloseTo(0);
    expect(ias(100)).toBe(0);
    expect(ias(146)).toBeCloseTo(0.5);
    expect(ias(190)).toBe(1);
    // Full flaps stall slower.
    expect(ias(44, { flaps: 1 })).toBeLessThan(ias(44));
    expect(ias(42, { flaps: 1 })).toBe(1);
  });

  it("moves the stall speed with the square root of the weight", () => {
    // 4,550 lb: the AFM's clean 86 kt at 6,000 lb is 74.9 kt.
    const ias = (iasKt: number) => readingTints(SF50, reading({ iasKt, weightLb: 4550 })).ias;
    expect(ias(75.5)).toBeGreaterThan(0.9);
    expect(ias(86)).toBeLessThan(0.75);
    expect(readingTints(SF50, reading({ iasKt: 86, weightLb: 6000 })).ias).toBe(1);
    expect(readingTints(SF50, reading({ iasKt: 86, weightLb: Number.NaN })).ias).toBe(1);
  });

  it("does not tint the stall end on the ground or held up by the lift system", () => {
    expect(readingTints(C172, reading({ iasKt: 0, onGround: true })).ias).toBe(0);
    expect(readingTints(C172, reading({ iasKt: 40, onGround: true })).ias).toBe(0);
    expect(readingTints(C172, reading({ iasKt: 40, jetBorne: true })).ias).toBe(0);
    expect(readingTints(C172, reading({ iasKt: 190, onGround: true })).ias).toBe(1);
  });

  it("is green at 1 g and red at either load limit", () => {
    const g = (value: number) => readingTints(C172, reading({ g: value })).g;
    expect(g(1)).toBe(0);
    expect(g(2.4)).toBeCloseTo(0.5);
    expect(g(3.8)).toBe(1);
    expect(g(-0.26)).toBeCloseTo(0.5);
    expect(g(-1.52)).toBe(1);
    expect(g(Number.NaN)).toBeNull();
  });

  it("is red at the stall angle of attack, following the flaps", () => {
    const aoa = (aoaDeg: number, more: Partial<InstrumentReading> = {}) => readingTints(C172, reading({ iasKt: 80, aoaDeg, ...more })).aoa;
    expect(aoa(4)).toBe(0);
    expect(aoa(10.5)).toBeCloseTo(0.5);
    expect(aoa(15)).toBe(1);
    expect(aoa(-8)).toBe(0);
    // The SF50's pusher fires at 10.34° with half flaps and 12.5° with full.
    const sf50 = (aoaDeg: number, flaps: number) => readingTints(SF50, reading({ iasKt: 90, aoaDeg, flaps })).aoa;
    expect(sf50(10.34, 0.5)).toBe(1);
    expect(sf50(10.34, 1)).toBeLessThan(1);
    expect(sf50(12.5, 1)).toBe(1);
  });

  it("does not tint the angle of attack on the ground, at a hover, or when there is none", () => {
    expect(readingTints(C172, reading({ iasKt: 50, aoaDeg: 15, onGround: true })).aoa).toBeNull();
    expect(readingTints(C172, reading({ iasKt: 5, aoaDeg: 40 })).aoa).toBeNull();
    expect(readingTints(C172, reading({ aoaDeg: null })).aoa).toBeNull();
  });

  it("runs vertical speed from descending to climbing across the aircraft's scale", () => {
    const vs = (vsFpm: number) => readingTints(C172, reading({ vsFpm })).vs;
    expect(vs(0)).toBe(0);
    expect(vs(500)).toBeCloseTo(0.5);
    expect(vs(-500)).toBeCloseTo(-0.5);
    expect(vs(4000)).toBe(1);
    expect(vs(-4000)).toBe(-1);
    expect(vs(Number.NaN)).toBeNull();
    expect(readingTints(SF50, reading({ vsFpm: 1500 })).vs).toBeCloseTo(0.5);
  });
});
