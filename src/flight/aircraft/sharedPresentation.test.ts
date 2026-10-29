import { describe, it, expect } from 'vitest';
import { NullEngine, Scene, TransformNode, UniversalCamera, Vector3, Quaternion } from '@babylonjs/core';
import { createCameraGimbal, poseVisualGimbal, stabilizeGimbal, slewGimbal } from '@0sfs/camera-gimbal';
import { flightAttitudeToQuaternion } from '@0sfs/ground-contact/ecefBridge';
describe('shared presentation components', () => {
    it('cancels combined body roll and pitch, then looks through the commanded gimbal pitch', () => {
        const roll = .4, pitch = -.3, heading = 1.2, local = Quaternion.Identity(), gimbal = Quaternion.Identity();
        stabilizeGimbal(local, gimbal, { rollRad: roll, pitchRad: pitch }, .2);
        const result = flightAttitudeToQuaternion(roll, pitch, heading).multiply(local);
        expect(Math.abs(Quaternion.Dot(result, flightAttitudeToQuaternion(0, 0, heading)))).toBeCloseTo(1);
        expect(slewGimbal(0, 100, 1 / 120, -90, 20, 180)).toBe(1.5);
        expect(slewGimbal(19, 100, 1, -90, 20, 180)).toBe(20);
    });
    it('restores an adopted camera parent, position and rotation on view change and disposal', () => {
        const engine = new NullEngine(), scene = new Scene(engine), parent = new TransformNode('home', scene), eye = new UniversalCamera('cockpit-camera', new Vector3(1, 2, 3), scene);
        eye.parent = parent;
        eye.rotationQuaternion = Quaternion.RotationYawPitchRoll(.1, .2, .3);
        const rest = eye.rotationQuaternion.clone();
        const rig = createCameraGimbal(scene, { name: 'test', offset: { x: 0, y: 0, z: 0 }, vfovRad: 1 });
        rig.followView(eye);
        expect(eye.parent).toBe(rig.pitch);
        rig.followView(null);
        expect(eye.parent).toBe(parent);
        expect(eye.position.asArray()).toEqual([1, 2, 3]);
        expect(eye.rotationQuaternion!.equals(rest)).toBe(true);
        rig.followView(eye);
        rig.dispose();
        expect(eye.parent).toBe(parent);
        scene.dispose();
        engine.dispose();
    });
    it('poses declared visual gimbal nodes with the same stabilization as the sensor', () => {
        const engine = new NullEngine(), scene = new Scene(engine), base = new TransformNode('base', scene), pitch = new TransformNode('pitch', scene);
        const body = { rollRad: .3, pitchRad: .2 };
        poseVisualGimbal(base, pitch, body, -45);
        const expectedBase = Quaternion.Identity(), expectedPitch = Quaternion.Identity();
        stabilizeGimbal(expectedBase, expectedPitch, body, -Math.PI / 4);
        expect(Math.abs(Quaternion.Dot(base.rotationQuaternion!, expectedBase))).toBeCloseTo(1);
        expect(Math.abs(Quaternion.Dot(pitch.rotationQuaternion!, expectedPitch))).toBeCloseTo(1);
        scene.dispose();
        engine.dispose();
    });
});
