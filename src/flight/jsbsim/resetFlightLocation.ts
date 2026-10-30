import type { JSBSimSdk } from "@felipegalind0/jsbsim";
import type { FlightLocation } from "../location/flightLocation";
import type { AircraftId } from "@0sfs/aircraft/aircraftIds";
import { readFlightState } from "@0sfs/ground-contact/ecefBridge";
import type { FlightState } from "@0sfs/ground-contact/flightState";
import { EMPTY_FLIGHT_STATE } from "@0sfs/ground-contact/flightState";
import { captureSimulation, initialTerrainElevationMeters, restoreEngineThermalState, validFlightState } from "@0sfs/ground-contact/safeFlightState";
import { isPersistedStoreProperty } from "@0sfs/stores/persistedStores";
import { getFdmProfile } from "./fdmProfiles";
import { fuelTankContentsPath, fuelTankIndices } from "@0sfs/fuel/fuelTanks";

export interface ResetFlightLocationOptions {
  /** Static engine fixture: use runway geometry without applying flight controls. */
  holdDown?: boolean;
  /** Host has already shown and confirmed this exact absolute altitude. */
  preserveRequestedAltitude?: boolean;
}

/** Apply coordinates or a runway preset to the selected aircraft model. */
export function resetFlightLocation(
  sdk: JSBSimSdk,
  location: FlightLocation,
  terrainHeightMeters?: number,
  aircraftId: AircraftId = "cessna-172",
  options: ResetFlightLocationOptions = {},
): FlightState {
  if (!Number.isFinite(location.latDeg) || Math.abs(location.latDeg) > 90
    || !Number.isFinite(location.lonDeg) || Math.abs(location.lonDeg) > 180
    || (location.altMeters !== undefined && !Number.isFinite(location.altMeters))
    || (location.headingDeg !== undefined && !Number.isFinite(location.headingDeg))
    || (location.airspeedKts !== undefined && (!Number.isFinite(location.airspeedKts) || location.airspeedKts < 0))
    || (location.pitchDeg !== undefined && !(Math.abs(location.pitchDeg) <= 90))
    || (location.flightPathDeg !== undefined && !(Math.abs(location.flightPathDeg) <= 90))) {
    throw new Error("Invalid geodetic location.");
  }
  const preset = location.flightPreset;
  if (preset && (!Number.isFinite(preset.headingDeg) || !Number.isFinite(preset.groundElevationMeters)
    || !Number.isFinite(preset.flightPathDeg) || !["departure", "arrival"].includes(preset.mode)
    || location.altMeters === undefined)) throw new Error("Invalid airport flight preset.");
  if (terrainHeightMeters !== undefined && !Number.isFinite(terrainHeightMeters)) throw new Error("Invalid terrain height");
  const profile = getFdmProfile(aircraftId);
  const held = options.holdDown === true;
  // A runway selection can orient a static fixture without starting its engine
  // or replacing the throttle, conversion and other test controls.
  const runway = preset && !held ? profile.runwayPresets[preset.mode] : null;
  const rawState = readFlightState(sdk);
  const state = validFlightState(rawState)
    ? rawState
    : { ...EMPTY_FLIGHT_STATE, altMeters: 1000, airspeedKts: 100, throttleNorm: profile.initialThrottleNorm };
  const saved = captureSimulation(sdk);
  const controlEntries = Object.entries(saved.controls).filter(([property, value]) => Number.isFinite(value)
    && !/^propulsion\/engine(?:\[\d+\])?\/thermal\//.test(property));
  const keptStores = Object.entries(saved.controls).filter(([property, value]) =>
    isPersistedStoreProperty(property) && Number.isFinite(value));
  const restoreStoreAttachments = (): void => {
    // Runway presets replace flight controls, but keep the aircraft's stores.
    // Replay the native catalogue spelling (index zero may omit brackets).
    for (const [property, value] of keptStores) sdk.setPropertyValue(property, value);
  };
  const flapPosition = sdk.getPropertyValue(profile.flapPosition.property);
  const conversion = profile.stovl ? {
    command: sdk.getPropertyValue(profile.stovl.commandProperty),
    position: sdk.getPropertyValue(profile.stovl.positionProperty),
  } : undefined;
  const restoreConversion = (): void => {
    if (!profile.stovl || !conversion) return;
    sdk.setPropertyValue(profile.stovl.commandProperty, runway ? 0 : conversion.command);
    sdk.setPropertyValue(profile.stovl.positionProperty, runway ? 0 : conversion.position);
  };
  const controlLawMode = profile.controlLaw ? sdk.getPropertyValue(profile.controlLaw.commandProperty) : undefined;
  const restoreControlLaw = (): void => {
    if (profile.controlLaw && controlLawMode !== undefined) sdk.setPropertyValue(profile.controlLaw.commandProperty, controlLawMode);
  };
  const departure = !held && preset?.mode === "departure";
  sdk.resetToInitialConditions(2);
  if (held) sdk.setHoldDown(true);
  // Moving the same aircraft does not make its nozzle metal cold. Restore
  // native wall state before RunIC/InitRunning can seed a new warm engine,
  // including runway presets which replace the pilot controls below.
  restoreEngineThermalState(sdk, saved.controls);
  restoreStoreAttachments();
  const terrain = terrainHeightMeters ?? preset?.groundElevationMeters;
  // Preserve the model's static CG-to-ground height and a small settling
  // margin instead of assuming the C172's stance for every airframe.
  const clearanceMeters = profile.stance.staticMeters + 0.17;
  const requested = options.preserveRequestedAltitude && location.altMeters !== undefined ? location.altMeters : preset?.mode === "departure"
    ? (terrain ?? preset.groundElevationMeters) + clearanceMeters
    : location.altMeters ?? state.altMeters;
  // Preparation may propose another altitude, but only the host's confirmed
  // destination may change this pose. Ordinary placement never raises it; the
  // static engine stand is a fixture that stands on its gear.
  const altitude = held && terrain !== undefined ? Math.max(requested, terrain + clearanceMeters) : requested;
  // A shared flight's attitude and path; a runway preset or static fixture sets its own.
  const sharedPitchDeg = held || preset ? undefined : location.pitchDeg;
  const pitchDeg = held ? 0 : runway?.pitchDeg ?? sharedPitchDeg ?? profile.initialPitchDeg ?? profile.stance.staticPitchRad * 180 / Math.PI;
  // Unknown destination terrain must not inherit the previous airport's floor,
  // and known terrain above the aircraft's support must not start it on
  // compressed contacts. Physics waits for a surface query before stepping,
  // and the terrain contact then asks before moving the aircraft.
  sdk.setPropertyValue("ic/terrain-elevation-ft", (terrain === undefined ? -10000
    : initialTerrainElevationMeters(profile.stance, altitude, terrain, 0, pitchDeg * Math.PI / 180)) / 0.3048);
  sdk.setPropertyValue("ic/h-sl-ft", altitude / 0.3048);
  // Geodetic, not geocentric latitude: the ECEF/ENU bridge uses WGS84.
  sdk.setPropertyValue("ic/lat-geod-deg", location.latDeg);
  sdk.setPropertyValue("ic/long-gc-deg", location.lonDeg);
  sdk.setPropertyValue("ic/psi-true-deg", preset?.headingDeg ?? location.headingDeg ?? state.headingRad * 180 / Math.PI);
  const flightPathDeg = held ? 0 : preset?.flightPathDeg ?? location.flightPathDeg ?? 0;
  sdk.setPropertyValue("ic/theta-deg", pitchDeg);
  sdk.setPropertyValue("ic/phi-deg", 0);
  sdk.setPropertyValue("ic/vc-kts", held ? 0 : runway?.airspeedKts ?? location.airspeedKts ?? state.airspeedKts);
  sdk.setPropertyValue("ic/gamma-deg", flightPathDeg);
  if (held) sdk.setPropertyValue("ic/alpha-deg", 0);
  else if (preset?.mode === "arrival") sdk.setPropertyValue("ic/alpha-deg", 6);
  // Pitch is the path plus the wing's angle to the air: alpha keeps the path and sets pitch.
  else if (sharedPitchDeg !== undefined) sdk.setPropertyValue("ic/alpha-deg", sharedPitchDeg - flightPathDeg);
  else if (!runway && profile.initialPitchDeg !== undefined) sdk.setPropertyValue("ic/alpha-deg", pitchDeg);
  // Without airspeed there is no angle to the air: set the attitude itself.
  if (sharedPitchDeg !== undefined) sdk.setPropertyValue("ic/theta-deg", sharedPitchDeg);
  if (departure || held) sdk.setPropertyValue("ic/vg-fps", 0);
  if (runway) {
    sdk.setPropertyValue("fcs/elevator-cmd-norm", 0);
    sdk.setPropertyValue("fcs/aileron-cmd-norm", 0);
    sdk.setPropertyValue("fcs/rudder-cmd-norm", 0);
    sdk.setPropertyValue("fcs/pitch-trim-cmd-norm", 0);
    sdk.setPropertyValue("fcs/roll-trim-cmd-norm", 0);
    sdk.setPropertyValue("gear/gear-cmd-norm", 1);
    sdk.setPropertyValue("gear/gear-pos-norm", 1);
    sdk.setPropertyValue("fcs/flap-cmd-norm", runway.flapsNorm);
    sdk.setPropertyValue(profile.flapPosition.property, runway.flapsNorm * profile.flapPosition.fullTravel);
    sdk.setPropertyValue("fcs/brake-cmd-norm", departure ? 1 : 0);
    sdk.setPropertyValue("fcs/left-brake-cmd-norm", departure ? 1 : 0);
    sdk.setPropertyValue("fcs/right-brake-cmd-norm", departure ? 1 : 0);
    // The fuel the pilot loaded goes with them to the runway.
    for (const index of fuelTankIndices(sdk)) {
      const path = fuelTankContentsPath(index);
      const contents = saved.controls[path];
      if (contents !== undefined && Number.isFinite(contents)) sdk.setPropertyValue(path, contents);
    }
  } else {
    for (const [property, value] of controlEntries) sdk.setPropertyValue(property, value);
    if (Number.isFinite(flapPosition)) sdk.setPropertyValue(profile.flapPosition.property, flapPosition);
  }
  restoreConversion();
  restoreControlLaw();
  restoreStoreAttachments();
  sdk.setPropertyValue("fcs/throttle-cmd-norm", runway?.throttleNorm ?? state.throttleNorm);
  if (!sdk.runIc()) throw new Error("JSBSim could not apply the location.");
  const unpowered = profile.engine === "none" || profile.kinematic === "drone-pgps";
  if (!unpowered) {
    if (runway || saved.running) sdk.setPropertyValue("propulsion/set-running", -1);
    else sdk.setPropertyValue("propulsion/engine/set-running", 0);
  }
  if (!runway) {
    // Reapply after native initialization, including a partially moved gear.
    for (const [property, value] of controlEntries) sdk.setPropertyValue(property, value);
    if (Number.isFinite(flapPosition)) sdk.setPropertyValue(profile.flapPosition.property, flapPosition);
  } else if (!unpowered) {
    if (profile.engine === "piston") {
      sdk.setPropertyValue("propulsion/magneto_cmd", 3);
      sdk.setPropertyValue("fcs/mixture-cmd-norm", Math.min(1, Math.max(0, Math.pow(Math.max(0, 1 - 6.87535e-6 * altitude / 0.3048), 5.2561) * 1.3)));
    }
  }
  restoreConversion();
  restoreControlLaw();
  restoreStoreAttachments();
  sdk.setPropertyValue("fcs/throttle-cmd-norm", runway?.throttleNorm ?? state.throttleNorm);
  // Engine startup evaluates full power. Re-evaluate the restored commands
  // at zero time before the caller samples the newly placed aircraft.
  if (!sdk.runIc()) throw new Error("JSBSim could not initialize engines at the new location.");
  if (!runway) {
    // RunIC also evaluates actuator nodes. Keep the saved physical positions
    // and controls intact until the first normal simulation step.
    for (const [property, value] of controlEntries) sdk.setPropertyValue(property, value);
    if (Number.isFinite(flapPosition)) sdk.setPropertyValue(profile.flapPosition.property, flapPosition);
  }
  restoreConversion();
  restoreControlLaw();
  restoreStoreAttachments();
  return readFlightState(sdk);
}
