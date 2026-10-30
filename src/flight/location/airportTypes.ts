import type { Airport, AirportRunway, GeodeticLocation } from "foss-earth/windowing";

export type { Airport, AirportRunway };
export type AirportMode = "departure" | "arrival";
/** FOSS Earth's `AirportPoint`, which no compat route exports; structurally the same. */
export interface AirportPoint { latDeg: number; lonDeg: number }

/** Aircraft-specific speed and configuration come from the aircraft's runway presets. */
export interface AirportFlightPreset {
  mode: AirportMode;
  headingDeg: number;
  groundElevationMeters: number;
  flightPathDeg: number;
}

/** Where the Location tab sends the aircraft: coordinates, or a runway preset. */
export interface FlightLocation extends GeodeticLocation {
  flightPreset?: AirportFlightPreset;
  /** A multiplayer arrival may match its host without selecting a runway preset. */
  headingDeg?: number;
  airspeedKts?: number;
  /** A shared flight's attitude: the nose above the horizon, without a runway preset. */
  pitchDeg?: number;
  /** A shared flight's path above the horizon, without a runway preset; level when absent. */
  flightPathDeg?: number;
}

/**
 * The flight's Location contribution: on a search result, the runway data and
 * the Departure/Arrival a search asked for; in the editor, the selected airport
 * with its chosen position and runway direction.
 */
export interface FlightLocationHostData {
  airport?: Airport;
  airportMode?: AirportMode;
  runwayId?: string;
}
