import { Quaternion, NullEngine, Scene, TransformNode, Vector3, type UniversalCamera } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { flightAttitudeToQuaternion } from "@0sfs/ground-contact/ecefBridge";
import { createPlaceholderAircraft } from "@0sfs/aircraft/createPlaceholderAircraft";
import { getAircraftDefinition } from "@0sfs/aircraft/aircraftCatalog";
import { getAppSettings, resetAppSettings } from "foss-earth/settings";
import { registerFlightSettings } from "../settings/registerFlightSettings";
import mini from "../../../../DJI-Mini2/public/0sfs-mod.json";
import air from "../../../../DJI-Air-2S/public/0sfs-mod.json";

describe("aircraft chase camera", () => {
  it.each([mini, air])("uses $name camera dimensions for close inspection", manifest => {
    const engine = new NullEngine(); const scene = new Scene(engine); const parent = new TransformNode("origin", scene);
    const settings = getAppSettings(); const parameters = registerFlightSettings(settings);
    const camera = manifest.aircraft.definitions[0].camera;
    settings.setHostDefault("osfs.camera.chaseDistance", camera.chaseDistanceMeters, manifest.name);
    settings.setHostDefault("osfs.camera.chaseHeight", camera.chaseHeightMeters, manifest.name);
    settings.setHostDefault("osfs.camera.chaseZoomLimits", camera.chaseZoomLimits, manifest.name);
    settings.setHostDefault("osfs.camera.nearClipMeters", camera.nearClipMeters, manifest.name);
    const aircraft = createPlaceholderAircraft(scene, parent, parameters);
    try {
      expect(aircraft.getChaseDistanceMeters()).toBeLessThan(2);
      aircraft.zoomChaseCamera(.001);
      expect(aircraft.getChaseDistanceMeters()).toBeCloseTo(camera.chaseZoomLimits.min);
      expect(aircraft.thirdPersonCamera.minZ).toBeCloseTo(.01);
      expect(aircraft.thirdPersonCamera.position.length()).toBeCloseTo(camera.chaseZoomLimits.min);
    } finally { aircraft.dispose(); scene.dispose(); engine.dispose(); resetAppSettings(); }
  });

  it("orbits and zooms around a declared engine focus without losing its offset", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const origin = new TransformNode("origin", scene);
    const focus = new Vector3(0, 1, -4.5);
    const aircraft = createPlaceholderAircraft(scene, origin, undefined, {
      chaseTargetOffset: focus, chaseDistanceMeters: 6, chaseZoomLimits: () => ({ min: 1, max: 100 }),
    });
    try {
      expect(Vector3.Distance(aircraft.thirdPersonCamera.position, focus)).toBeCloseTo(6);
      aircraft.orbitChaseCamera(0.4, 0.2);
      expect(Vector3.Distance(aircraft.thirdPersonCamera.position, focus)).toBeCloseTo(6);
      aircraft.zoomChaseCamera(0.5);
      expect(Vector3.Distance(aircraft.thirdPersonCamera.position, focus)).toBeCloseTo(3);
      aircraft.zoomChaseCamera(0.01);
      expect(Vector3.Distance(aircraft.thirdPersonCamera.position, focus)).toBeCloseTo(1);
    } finally { aircraft.dispose(); scene.dispose(); engine.dispose(); }
  });
  it.each([0, Math.PI / 2, Math.PI, 3 * Math.PI / 2])("keeps both cameras facing heading %s with east on the correct side", (heading) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const origin = new TransformNode("origin", scene);
    origin.rotationQuaternion = flightAttitudeToQuaternion(0, 0, heading);
    const aircraft = createPlaceholderAircraft(scene, origin);
    const forward = new Vector3(Math.sin(heading), 0, -Math.cos(heading));
    const right = new Vector3(Math.cos(heading), 0, Math.sin(heading));
    for (const camera of [aircraft.firstPersonCamera, aircraft.thirdPersonCamera]) {
      const view = camera.getViewMatrix(true);
      expect(Vector3.TransformNormal(forward, view).z).toBeLessThan(-0.9);
      expect(Vector3.TransformNormal(right, view).x).toBeCloseTo(1, 5);
    }
    aircraft.dispose(); scene.dispose(); engine.dispose();
  });

  it("orbits locally, clamps pitch/distance, and ignores gestures in cockpit view", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const origin = new TransformNode("origin", scene);
    const aircraft = createPlaceholderAircraft(scene, origin);
    const camera = aircraft.thirdPersonCamera;
    aircraft.orbitChaseCamera(Math.PI / 2, 100);
    expect(camera.position.x).toBeGreaterThan(0);
    expect(Math.asin(camera.position.y / camera.position.length())).toBeCloseTo(Math.PI * 0.45);
    aircraft.zoomChaseCamera(1e6);
    expect(camera.position.length()).toBeCloseTo(500);
    aircraft.zoomChaseCamera(1e-6);
    expect(camera.position.length()).toBeCloseTo(8);
    const localPosition = camera.position.clone();
    origin.position.set(10000, 20000, 30000);
    expect(camera.position.equals(localPosition)).toBe(true);
    expect(camera.parent).toBe(aircraft.root);
    aircraft.setViewMode("first");
    aircraft.orbitChaseCamera(1, 1);
    aircraft.zoomChaseCamera(2);
    expect(camera.position.equals(localPosition)).toBe(true);
    expect(scene.activeCamera).toBe(aircraft.firstPersonCamera);
    aircraft.dispose(); scene.dispose(); engine.dispose();
  });

  it("places the F-35B pilot eye in its supplied cockpit and keeps the interior visible", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const origin = new TransformNode("origin", scene);
    const definition = getAircraftDefinition("f-35b");
    const aircraft = createPlaceholderAircraft(scene, origin, undefined, {
      cockpitOffset: definition.cockpitOffset, showModelInCockpit: definition.cockpitMesh,
    });
    aircraft.setModelLoaded(true);
    aircraft.setViewMode("first");
    expect(aircraft.firstPersonCamera.position).toEqual(Vector3.Zero());
    expect(aircraft.cockpit.position).toEqual(new Vector3(
      definition.cockpitOffset!.x, definition.cockpitOffset!.y, definition.cockpitOffset!.z,
    ));
    expect(aircraft.modelRoot.isEnabled()).toBe(true);
    expect(aircraft.firstPersonCamera.minZ).toBeCloseTo(0.05);
    aircraft.setNearClipMeters(0.12);
    expect(aircraft.firstPersonCamera.minZ).toBe(0.12);
    expect(aircraft.thirdPersonCamera.minZ).toBe(0.12);
    aircraft.dispose(); scene.dispose(); engine.dispose();
  });

  it("retains the existing pilot eye and hides exterior-only models in cockpit view", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const origin = new TransformNode("origin", scene);
    const aircraft = createPlaceholderAircraft(scene, origin);
    const eye = aircraft.cockpit.position.add(aircraft.firstPersonCamera.position);
    expect(eye.x).toBe(0);
    expect(eye.y).toBeCloseTo(1.3);
    expect(eye.z).toBeCloseTo(2.4);
    aircraft.setModelLoaded(true);
    aircraft.setViewMode("first");
    expect(aircraft.modelRoot.isEnabled()).toBe(false);
    aircraft.dispose(); scene.dispose(); engine.dispose();
  });

  it.each([true, false])("looks about the pilot eye as a 360 photograph does, in a right-handed scene: %s", (rightHanded) => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.useRightHandedSystem = rightHanded;
    const origin = new TransformNode("origin", scene);
    origin.rotationQuaternion = flightAttitudeToQuaternion(0.2, 0.1, 1.3);
    const aircraft = createPlaceholderAircraft(scene, origin);
    // The camera's own forward, right and up in the world.
    const axes = (camera: UniversalCamera) => {
      const world = camera.getViewMatrix(true).clone().invert();
      const along = (x: number, y: number, z: number) => Vector3.TransformNormal(new Vector3(x, y, z), world).normalize();
      return { forward: along(0, 0, rightHanded ? -1 : 1), right: along(1, 0, 0), up: along(0, 1, 0) };
    };
    const camera = aircraft.firstPersonCamera;
    const ahead = axes(camera);
    const expectAlong = (actual: Vector3, expected: Vector3) => expect(Vector3.Dot(actual, expected.normalizeToNew())).toBeCloseTo(1, 5);

    aircraft.lookFromCockpit({ headingDeg: 0, pitchDeg: 0, verticalFovDeg: 55 });
    expectAlong(axes(camera).forward, ahead.forward);
    expect(camera.fov).toBeCloseTo(55 * Math.PI / 180);

    aircraft.lookFromCockpit({ headingDeg: 90, pitchDeg: 0, verticalFovDeg: 55 });
    expectAlong(axes(camera).forward, ahead.right);
    expectAlong(axes(camera).up, ahead.up);

    aircraft.lookFromCockpit({ headingDeg: 0, pitchDeg: 30, verticalFovDeg: 55 });
    expectAlong(axes(camera).forward, ahead.forward.scale(Math.cos(Math.PI / 6)).add(ahead.up.scale(Math.sin(Math.PI / 6))));
    expectAlong(axes(camera).right, ahead.right);

    // Looking right and up keeps the horizon level: no roll of its own.
    aircraft.lookFromCockpit({ headingDeg: 135, pitchDeg: -40, verticalFovDeg: 100 });
    expect(Vector3.Dot(axes(camera).right, ahead.up)).toBeCloseTo(0, 5);
    expect(camera.fov).toBeCloseTo(100 * Math.PI / 180);

    const turned = camera.rotationQuaternion!.clone();
    aircraft.lookFromCockpit({ headingDeg: Number.NaN, pitchDeg: 0, verticalFovDeg: 60 });
    expect(camera.rotationQuaternion!.equals(turned)).toBe(true);
    expect(camera.fov).toBeCloseTo(100 * Math.PI / 180);
    aircraft.dispose(); scene.dispose(); engine.dispose();
  });
  it.each([true, false])('keeps the actual Momentum camera upright through vertical flight and side orbits (RH %s)', rightHanded => {
    const engine = new NullEngine(), scene = new Scene(engine);
    scene.useRightHandedSystem = rightHanded;
    const origin = new TransformNode('origin', scene);
    origin.rotationQuaternion = flightAttitudeToQuaternion(.4, -.2, 1);
    const aircraft = createPlaceholderAircraft(scene, origin);
    try {
      let yaw = 0;
      for (const orbit of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        aircraft.orbitChaseCamera(orbit - yaw, 0);
        yaw = orbit;
        for (const pitch of [0, 60, 85, -60, -85]) {
          aircraft.setChaseFrame(Quaternion.RotationYawPitchRoll(1.2, -pitch * Math.PI / 180, 0));
          const world = aircraft.thirdPersonCamera.getViewMatrix(true).clone().invert();
          const right = Vector3.TransformNormal(Vector3.Right(), world).normalize();
          const up = Vector3.TransformNormal(Vector3.Up(), world).normalize();
          const forward = Vector3.TransformNormal(new Vector3(0, 0, rightHanded ? -1 : 1), world).normalize();
          expect(right.y).toBeCloseTo(0, 5);
          expect(up.y).toBeGreaterThan(.08);
          expect(Math.abs(Math.asin(forward.y))).toBeLessThanOrEqual(85 * Math.PI / 180 + 1e-6);
        }
      }
      // Returning to Aircraft restores the original body-relative orbit and offset.
      aircraft.setChaseFrame(null);
      expect(aircraft.thirdPersonCamera.parent).toBe(aircraft.root);
      const pitch = Math.asin(aircraft.thirdPersonCamera.position.y / aircraft.thirdPersonCamera.position.length());
      expect(pitch).toBeCloseTo(Math.atan2(2.2, 14));
    } finally { aircraft.dispose(); scene.dispose(); engine.dispose(); }
  });

});
