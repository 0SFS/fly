import type { DroneMotorPosition } from "./droneGate";

export const MOTOR_POSITIONS: readonly DroneMotorPosition[] = ["front-left", "front-right", "rear-left", "rear-right"];

/** The visual frame is left (+X), up (+Y), forward (+Z). */
export function droneMotorPosition(leftM: number, forwardM: number): DroneMotorPosition {
  return `${forwardM >= 0 ? "front" : "rear"}-${leftM > 0 ? "left" : "right"}`;
}

/** Opposite corners spin together; adjacent corners counter-rotate. */
export function droneMotorDirection(position: DroneMotorPosition): 1 | -1 {
  return position === "front-left" || position === "rear-right" ? 1 : -1;
}
