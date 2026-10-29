import { describe, expect, it } from "vitest";
import { MOTOR_POSITIONS, droneMotorDirection, droneMotorPosition } from "./droneMotorTelemetry";
import { droneMotorTelemetry, noteActiveAircraft, setDroneMotorTelemetry } from "./droneGate";

describe("quadcopter motor telemetry", () => {
  it("identifies physical corners independently of asset rotor order", () => {
    expect([droneMotorPosition(1, 1), droneMotorPosition(-1, 1), droneMotorPosition(1, -1), droneMotorPosition(-1, -1)])
      .toEqual(MOTOR_POSITIONS);
    expect(MOTOR_POSITIONS.map(droneMotorDirection)).toEqual([1, -1, -1, 1]);
  });
  it("retains simulated RPM, physical direction and maximum speed until the aircraft changes", () => {
    noteActiveAircraft("dji-mini-2");
    const telemetry = { aircraftId: "dji-mini-2", label: "Mini 2", source: "simulated" as const,
      hoverRpm: 9000, maxRpm: 13300, simTimeS: 1,
      motors: MOTOR_POSITIONS.map((position, index) => ({ position, rpm: 8800 + index * 100, direction: droneMotorDirection(position) })) };
    try {
      setDroneMotorTelemetry(telemetry);
      noteActiveAircraft("dji-mini-2");
      expect(droneMotorTelemetry()).toBe(telemetry);
      noteActiveAircraft("cessna-172");
      expect(droneMotorTelemetry()).toBeNull();
    } finally { setDroneMotorTelemetry(null); }
  });
});
