// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { JSBSimSdk } from "@felipegalind0/jsbsim";
import { wasmBinaryUrl, wasmModuleUrl } from "@felipegalind0/jsbsim/wasm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AVAILABILITY } from "@0sfs/sound/audioSnapshot";
import { getAircraftAudioInstallation, resolveAircraftAudioInstallation } from "@0sfs/sound/aircraftAudioProfiles";
import { IO320_DEFINITION } from "../../../../sound/tests/fixtures/engineProfiles";
import { rms, TIER } from "@0sfs/sound/dspHarness";
import { createReferenceHarness as createDspHarness } from "../../../../sound/tests/fixtures/engineProfiles";
import { createJsbsimAudioAdapter, toSnapshot, type AudioAdapter } from "@0sfs/sound/jsbsimAudioAdapter";
import { bootstrapAircraft } from "../jsbsim/bootstrapC172";
import { getFdmProfile } from "../jsbsim/fdmProfiles";
import { resolveAircraftDataFiles } from "../jsbsim/hydrateJsbsimData";
import { LEGACY_PHYSICS_HZ_120 } from "../physics/physicsRate";

const instances: JSBSimSdk[] = [];
const adapters: AudioAdapter[] = [];
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.dispose();
  for (const sdk of instances.splice(0)) sdk.destroy();
  vi.restoreAllMocks();
});

async function boot(throttleNorm = 0.5, airspeedKts = 90) {
  const sdk = await JSBSimSdk.create({
    moduleUrl: wasmModuleUrl, wasmUrl: wasmBinaryUrl,
    persistence: { enabled: false }, log: { console: false },
  });
  instances.push(sdk);
  const manifest: unknown = JSON.parse(readFileSync("public/jsbsim-data/manifest.json", "utf8"));
  for (const file of resolveAircraftDataFiles(manifest, "cessna-172")) {
    sdk.writeDataFile(file, readFileSync("public/jsbsim-data/" + file, "utf8"));
  }
  await bootstrapAircraft(sdk, "cessna-172", LEGACY_PHYSICS_HZ_120, {
    throttleNorm, engineRunning: true, altFt: 1000, airspeedKts, holdDown: true,
  });
  const admission = resolveAircraftAudioInstallation(getAircraftAudioInstallation("cessna-172"));
  if (!admission.supported) throw new Error(admission.reason);
  const adapter = createJsbsimAudioAdapter(sdk, {
    gearHeightMetres: getFdmProfile("cessna-172").stance.staticMeters, source: admission.source,
  });
  adapters.push(adapter);
  return { sdk, adapter };
}

function run(sdk: JSBSimSdk, seconds: number): void {
  for (let step = 0; step < Math.round(seconds * 120); step++) {
    if (!sdk.run()) throw new Error("C172 JSBSim step failed");
  }
}

const pose = {
  sequence: 1, epoch: 1, source: [0, 0, -4] as const,
  sourceVelocity: [0, 0, 0] as const, listenerVelocity: [0, 0, 0] as const,
  exterior: 1, groundReflectionM: -1, poseValid: true,
};
const pistonBits = AVAILABILITY.ENGINE_RPM | AVAILABILITY.PROPELLER_RPM | AVAILABILITY.SHAFT_POWER;

describe("C172 piston audio from the packaged native model and shipped DSP", () => {
  it("reads native piston shafts and power without inventing turbine percentages", async () => {
    const { sdk, adapter } = await boot();
    run(sdk, 0.25);
    const reading = adapter.read();
    expect(adapter.diagnostics.profile).toBe(IO320_DEFINITION);
    expect(IO320_DEFINITION).toMatchObject({ engineClass: "piston", rendererId: "procedural-piston-v1" });
    expect(adapter.diagnostics.telemetryAvailable).toBe(true);
    expect(adapter.diagnostics.combustionSource).toBe("running-only");
    for (const [field, property] of [["engineRpm", "engine-rpm"], ["propellerRpm", "propeller-rpm"],
      ["shaftPowerHp", "power-hp"], ["fuelFlowPps", "fuel-flow-rate-pps"]] as const) {
      expect(reading[field]).toBe(sdk.getPropertyValue(`propulsion/engine[0]/${property}`));
      expect(reading[field]).toBeGreaterThan(0);
    }
    expect(reading).toMatchObject({ combustion: true, running: true, throttleNorm: 0.5 });
    expect(reading.availability & pistonBits).toBe(pistonBits);
    expect(reading.availability & (AVAILABILITY.N1 | AVAILABILITY.N2)).toBe(0);
    expect(Number.isNaN(reading.n1Pct)).toBe(true);
    expect(Number.isNaN(reading.n2Pct)).toBe(true);
    expect(toSnapshot(reading, pose)).toMatchObject({
      engineRpm: reading.engineRpm, propellerRpm: reading.propellerRpm, shaftPowerHp: reading.shaftPowerHp,
    });
  });

  it("follows native throttle load and stops firing with ignition off while shafts still turn", async () => {
    const { sdk, adapter } = await boot(0.15, 0);
    run(sdk, 1);
    const idle = { ...adapter.read() };
    sdk.setPropertyValue("fcs/throttle-cmd-norm", 0.9);
    run(sdk, 2);
    const powered = { ...adapter.read() };
    expect(powered.engineRpm!).toBeGreaterThan(idle.engineRpm! + 100);
    expect(powered.shaftPowerHp!).toBeGreaterThan(idle.shaftPowerHp! + 20);
    sdk.setPropertyValue("propulsion/magneto_cmd", 0);
    run(sdk, 0.25);
    const windmilling = adapter.read();
    expect(windmilling).toMatchObject({ running: false, combustion: false });
    expect(windmilling.engineRpm).toBeGreaterThan(0);
    expect(windmilling.propellerRpm).toBeGreaterThan(0);
    // Native fuel delivery can persist with spark off; it must not assert firing.
    expect(windmilling.fuelFlowPps).toBeGreaterThan(0);
    expect(windmilling.fuelFlowPps).toBe(sdk.getPropertyValue("propulsion/engine[0]/fuel-flow-rate-pps"));
  });

  it("marks later invalid native piston observations unavailable and recovers on a valid read", async () => {
    const { sdk } = await boot();
    const create = vi.spyOn(sdk, "createPropertyBatch");
    const admission = resolveAircraftAudioInstallation(getAircraftAudioInstallation("cessna-172"));
    if (!admission.supported) throw new Error(admission.reason);
    const adapter = createJsbsimAudioAdapter(sdk, {
      gearHeightMetres: getFdmProfile("cessna-172").stance.staticMeters, source: admission.source,
    });
    adapters.push(adapter);
    const batch = create.mock.results[0].value as ReturnType<JSBSimSdk["createPropertyBatch"]>;
    const nativeRead = batch.read.bind(batch);
    const paths = create.mock.calls[0][0];
    const slots = ["engine-rpm", "propeller-rpm", "power-hp"].map(property =>
      paths.indexOf(`propulsion/engine[0]/${property}`));
    let invalid = true;
    vi.spyOn(batch, "read").mockImplementation(target => {
      const values = nativeRead(target);
      if (invalid) for (const slot of slots) values[slot] = Number.NaN;
      return values;
    });
    const reading = adapter.read();
    expect(adapter.diagnostics.telemetryAvailable).toBe(false);
    expect(reading.availability & pistonBits).toBe(0);
    expect([reading.engineRpm, reading.propellerRpm, reading.shaftPowerHp].every(Number.isNaN)).toBe(true);
    const snapshot = toSnapshot(reading, pose);
    expect(snapshot.availability & pistonBits).toBe(0);
    expect([snapshot.engineRpm, snapshot.propellerRpm, snapshot.shaftPowerHp].every(Number.isNaN)).toBe(true);
    invalid = false;
    expect(adapter.read().availability & pistonBits).toBe(pistonBits);
    expect(adapter.diagnostics.telemetryAvailable).toBe(true);
  });

  it.each([TIER.low, TIER.med, TIER.high])("renders finite audible piston sound at tier %s", async tier => {
    const { sdk, adapter } = await boot(0.7);
    const core = await createDspHarness();
    core.setProfile(IO320_DEFINITION);
    core.exports.osfs_audio_set_tier(tier);
    core.exports.osfs_audio_set_gains(1, 1, 0, 0, 0);
    const start = adapter.read().simTimeS;
    core.anchor(1, start);
    let nextTelemetry = 0, sequence = 0;
    const output = core.renderSeconds(0.8, frame => {
      const time = frame / core.sampleRate;
      if (time + 1e-9 < nextTelemetry) return;
      while (sdk.getSimTime() - start < time - 1e-9) {
        if (!sdk.run()) throw new Error("C172 JSBSim step failed");
      }
      core.pushSnapshot(toSnapshot(adapter.read(), { ...pose, sequence: sequence++ }));
      nextTelemetry += 1 / 60;
    });
    expect(output.left.every(Number.isFinite)).toBe(true);
    expect(output.right.every(Number.isFinite)).toBe(true);
    expect(rms(output.left, core.sampleRate / 2)).toBeGreaterThan(1e-4);
    expect(rms(output.right, core.sampleRate / 2)).toBeGreaterThan(1e-4);
    expect(core.stats()).toMatchObject({ tier, nonFinite: 0, staleFades: 0, activeGrains: 0 });
  });
});
