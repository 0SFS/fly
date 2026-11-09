import { createPropertySampler, type PropertySamplerSdk } from "../jsbsim/propertySampler";

export const HUD_READING_PATHS = [
  "inertia/weight-lbs", "gear/unit[0]/WOW", "gear/unit[1]/WOW", "gear/unit[2]/WOW",
] as const;

/** Native observations for the reading tints and ground-only actions. */
export function createHudReadingSampler(sdk: PropertySamplerSdk, stovlPositionProperty?: string) {
  const paths = stovlPositionProperty !== undefined ? [...HUD_READING_PATHS, stovlPositionProperty] : HUD_READING_PATHS;
  const sampler = createPropertySampler(sdk, paths);
  const carriesWeight = (value: number): boolean => Number.isFinite(value) && value > 0.5;
  return {
    // Read at each consumer's read point, including while paused. A physics
    // step's earlier sample cannot describe later actuator/ground changes.
    read() {
      const values = sampler.read();
      return {
        weightLb: values[0]!,
        onGround: carriesWeight(values[1]!) || carriesWeight(values[2]!) || carriesWeight(values[3]!),
        jetBorne: stovlPositionProperty !== undefined && values[4]! > 0.01,
      };
    },
    dispose: sampler.dispose,
  };
}
