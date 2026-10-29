import type { AircraftId } from "@0sfs/aircraft/aircraftCatalog";

/**
 * A value that follows the flaps: one number, or points of [flap position,
 * value], flap position 0 up to 1 full, read between them in a straight line.
 */
export type FlapSchedule = number | readonly (readonly [flaps: number, value: number])[];

/**
 * The ranges the HUD tints its readings across, per aircraft. Airspeed, angle
 * of attack and load run green, through yellow, to red; vertical speed runs
 * dark brown descending, through white level, to dark blue climbing.
 */
export interface InstrumentBands {
  ias: {
    /**
     * The 1 g stall speed, KCAS, at `weightLb`. The reading is red at it and
     * green from 1.3 times it, the margin an approach is flown at. It scales
     * with the square root of the weight.
     */
    stall: { kt: FlapSchedule; weightLb: number };
    /** Green up to here, kt. */
    green: number;
    /** Red from here, kt. */
    red: number;
  };
  /** Angle of attack, degrees: green up to `green`, about 1.3 times the stall speed; red at the stall. */
  aoa: { green: FlapSchedule; red: FlapSchedule };
  /** Load factor limits, g. */
  g: { max: number; min: number };
  /** The vertical speed the tint is darkest at, fpm, either way. */
  vs: { full: number };
}

/** The Vision Jet variants share the SF50's limits. */
const SF50: InstrumentBands = {
  ias: {
    // AFM Section 5 stall speeds at 6,000 lb: the pusher's, which the model
    // fires within a knot of (sf50-propulsion-drag-calibration-2026-09-14).
    stall: { kt: [[0, 86], [0.5, 77], [1, 67]], weightLb: 6000 },
    // VMO 250 KIAS (docs/old/sf50-flight-model.md); green ends 20 kt short of it.
    green: 230, red: 250,
  },
  aoa: {
    // 1 g trim at 1.3 times the stall speed.
    green: [[0, 5.4], [0.5, 3.4], [1, 2.6]],
    // The stick pusher's thresholds (sf50.xml, Stall Protection).
    red: [[0, 11.1], [0.5, 10.34], [1, 12.5]],
  },
  // Part 23 normal category at 6,000 lb: n = 2.1 + 24,000 / (W + 10,000), capped at 3.8; −0.4 n.
  g: { max: 3.6, min: -1.44 },
  vs: { full: 3000 },
};

export const INSTRUMENT_BANDS: Readonly<Record<AircraftId, InstrumentBands>> = {
  "cessna-172": {
    ias: {
      // The c172p model's own: 1 g trim reaches 15° at these speeds, flaps 0°, 10°, 20° and 30°.
      stall: { kt: [[0, 47], [1 / 3, 44], [2 / 3, 43], [1, 42]], weightLb: 1880 },
      // C172S POH: Vno 129 KIAS, Vne 163 KIAS.
      green: 129, red: 163,
    },
    // Lift peaks at 16° (0.28 rad) and 1 g trim fails past 15°, at every flap
    // setting; 1.3 times the stall speed trims at 5° to 6°.
    aoa: { green: 6, red: 15 },
    // Normal category.
    g: { max: 3.8, min: -1.52 },
    vs: { full: 1000 },
  },
  "cirrus-vision-jet": SF50,
  "cirrus-vision-jet-g2": SF50,
  "cirrus-vision-jet-g3": SF50,
  "f-35b": {
    ias: {
      // Wing-borne only: the slowest 1 g trim of the model at 37,600 lb. Its
      // flight control system holds the angle of attack down, so this is the
      // slowest it will hold level, not a published stall speed.
      stall: { kt: 110, weightLb: 37600 },
      // Estimates: no published limit is modelled.
      green: 600, red: 700,
    },
    // 1 g trim at 1.3 times that speed; lift peaks at 30° to 35°.
    aoa: { green: 9, red: 30 },
    // The flight control system's load table tops out at 7 g.
    g: { max: 7, min: -3 },
    vs: { full: 10000 },
  },
};

export function flapScheduleValue(schedule: FlapSchedule, flaps: number): number {
  if (typeof schedule === "number") return schedule;
  const first = schedule[0];
  const last = schedule[schedule.length - 1];
  if (!Number.isFinite(flaps) || flaps <= first[0]) return first[1];
  if (flaps >= last[0]) return last[1];
  const upper = schedule.findIndex(([at]) => at >= flaps);
  const [lowFlaps, lowValue] = schedule[upper - 1];
  const [highFlaps, highValue] = schedule[upper];
  return lowValue + (highValue - lowValue) * (flaps - lowFlaps) / (highFlaps - lowFlaps);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** 0 at `green`, 1 at `red`, either way round. */
const ramp = (value: number, green: number, red: number) => clamp((value - green) / (red - green), 0, 1);

/** 0 green to 1 red, or null when there is no reading to tint. */
export type ReadingTint = number | null;

export interface ReadingTints {
  ias: ReadingTint;
  aoa: ReadingTint;
  g: ReadingTint;
  /** −1 dark brown descending, 0 white level, 1 dark blue climbing. */
  vs: ReadingTint;
}

export interface InstrumentReading {
  iasKt: number;
  aoaDeg: number | null;
  g: number | null;
  vsFpm: number;
  /** Flap position, 0 up to 1 full. */
  flaps: number;
  weightLb: number;
  onGround: boolean;
  /** Held up by the lift system rather than the wing, as the F-35B in STOVL mode. */
  jetBorne: boolean;
}

/** Below this airspeed the angle of attack means nothing, so it is not tinted. */
export const AOA_TINT_MIN_IAS_KT = 20;

/** Approach speed over stall speed: the stall end of airspeed is green from here. */
export const STALL_MARGIN = 1.3;

/**
 * The stall ends follow the flaps, and the stall speed the weight. Neither is
 * tinted on the ground, nor the stall speed while the lift system holds the
 * aircraft up; the angle of attack is not tinted at a hover.
 * Aircraft without declared bands keep their readings untinted.
 */
export function readingTints(bands: InstrumentBands | undefined, reading: InstrumentReading): ReadingTints {
  if (!bands) return { ias: null, aoa: null, g: null, vs: null };
  const { iasKt, aoaDeg, g, vsFpm, flaps, weightLb, onGround, jetBorne } = reading;
  let ias: ReadingTint = null;
  if (Number.isFinite(iasKt)) {
    ias = ramp(iasKt, bands.ias.green, bands.ias.red);
    if (!onGround && !jetBorne) {
      const weightRatio = Number.isFinite(weightLb) && weightLb > 0 ? weightLb / bands.ias.stall.weightLb : 1;
      const stallKt = flapScheduleValue(bands.ias.stall.kt, flaps) * Math.sqrt(weightRatio);
      ias = Math.max(ias, ramp(iasKt, STALL_MARGIN * stallKt, stallKt));
    }
  }
  return {
    ias,
    aoa: aoaDeg !== null && Number.isFinite(aoaDeg) && !onGround && iasKt >= AOA_TINT_MIN_IAS_KT
      ? ramp(aoaDeg, flapScheduleValue(bands.aoa.green, flaps), flapScheduleValue(bands.aoa.red, flaps)) : null,
    g: g === null || !Number.isFinite(g) ? null
      : g >= 1 ? clamp((g - 1) / (bands.g.max - 1), 0, 1) : clamp((1 - g) / (1 - bands.g.min), 0, 1),
    vs: Number.isFinite(vsFpm) ? clamp(vsFpm / bands.vs.full, -1, 1) : null,
  };
}
