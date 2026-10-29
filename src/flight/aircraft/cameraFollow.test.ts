import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from '@babylonjs/core';
import { createCameraFollow, MOMENTUM_PITCH_LIMIT } from '@0sfs/aircraft/cameraFollow';
import { flightAttitudeToQuaternion } from '@0sfs/ground-contact/ecefBridge';
const pose = { headingRad: 0, northVelocityFps: 0, eastVelocityFps: 0, verticalSpeedFps: 0 };
const forward = (q: Quaternion) => new Vector3(0, 0, 1).applyRotationQuaternion(q);
const settle = (track: ReturnType<typeof createCameraFollow>, state: typeof pose) => { let q: Quaternion | null = null; for (let i = 0; i < 120; i++)
    q = track.update('momentum', state, 1 / 60); return q!; };
describe('camera follow frames', () => {
    it('uses aircraft rotation directly and keeps Planet north and level regardless of movement', () => {
        const follow = createCameraFollow();
        expect(follow.update('aircraft', pose, 1 / 60)).toBeNull();
        const q = follow.update('planet', { ...pose, headingRad: 2, eastVelocityFps: 50, verticalSpeedFps: 20 }, 1 / 60)!;
        expect(Math.abs(Quaternion.Dot(q, flightAttitudeToQuaternion(0, 0, 0)))).toBeCloseTo(1);
    });
    it('follows the actual velocity including climb instead of aircraft heading or tilt', () => {
        const follow = createCameraFollow(), q = settle(follow, { ...pose, headingRad: -1, northVelocityFps: 0, eastVelocityFps: 10, verticalSpeedFps: 10 });
        expect(Math.abs(Quaternion.Dot(q, flightAttitudeToQuaternion(0, Math.PI / 4, Math.PI / 2)))).toBeCloseTo(1, 5);
        expect(forward(q).y).toBeGreaterThan(.7);
    });
    it('holds its last course at hover, ignores noise, and keeps heading during vertical flight', () => {
        const follow = createCameraFollow();
        const course = settle(follow, { ...pose, eastVelocityFps: 20 }).clone();
        for (let i = 0; i < 20; i++)
            expect(Math.abs(Quaternion.Dot(follow.update('momentum', { ...pose, headingRad: 2, northVelocityFps: .01 }, 1 / 60)!, course))).toBeCloseTo(1);
        const vertical = settle(follow, { ...pose, headingRad: -2, verticalSpeedFps: 20 });
        const v = forward(vertical);
        expect(v.y).toBeGreaterThan(.99);
        expect(v.x).toBeGreaterThan(0);
    });
    it('smooths direction changes continuously through north and across frame rates', () => {
        const a = createCameraFollow(), b = createCameraFollow();
        a.update('momentum', { ...pose, northVelocityFps: 20 }, 0);
        b.update('momentum', { ...pose, northVelocityFps: 20 }, 0);
        for (let i = 0; i < 60; i++)
            a.update('momentum', { ...pose, eastVelocityFps: 20 }, 1 / 60);
        for (let i = 0; i < 120; i++)
            b.update('momentum', { ...pose, eastVelocityFps: 20 }, 1 / 120);
        expect(Math.abs(Quaternion.Dot(a.update('momentum', pose, 0)!, b.update('momentum', pose, 0)!))).toBeCloseTo(1, 8);
        const north = createCameraFollow();
        const before = north.update('momentum', { ...pose, northVelocityFps: 20, eastVelocityFps: -.1 }, 0)!.clone();
        const after = north.update('momentum', { ...pose, northVelocityFps: 20, eastVelocityFps: .1 }, 1 / 60)!;
        expect(Math.abs(Quaternion.Dot(before, after))).toBeGreaterThan(.999);
    });
    it('never banks while heading and climb direction change together, including vertical reversals', () => {
        const follow = createCameraFollow();
        for (const state of [
            { ...pose, northVelocityFps: 20 },
            { ...pose, eastVelocityFps: 20, verticalSpeedFps: 20 },
            { ...pose, verticalSpeedFps: 20 },
            { ...pose, northVelocityFps: -20, verticalSpeedFps: -20 },
            { ...pose, verticalSpeedFps: -20 },
        ]) {
            for (let i = 0; i < 120; i++) {
                const q = follow.update('momentum', state, 1 / 60)!;
                const right = new Vector3(1, 0, 0).applyRotationQuaternion(q);
                expect(right.y).toBeCloseTo(0, 10);
                expect(new Vector3(0, 1, 0).applyRotationQuaternion(q).y).toBeGreaterThan(0);
                expect(Math.abs(Math.asin(forward(q).y))).toBeLessThanOrEqual(MOMENTUM_PITCH_LIMIT + 1e-10);
            }
        }
        for (const sign of [-1, 1]) {
            const q = settle(follow, { ...pose, verticalSpeedFps: sign * 20 });
            expect(Math.asin(forward(q).y)).toBeCloseTo(sign * MOMENTUM_PITCH_LIMIT, 2);
        }
    });
    it('does not snap into an existing climb on entry and stays still for a zero-dt update', () => {
        const follow = createCameraFollow();
        const q = follow.update('momentum', { ...pose, verticalSpeedFps: 20 }, 0)!;
        expect(forward(q).y).toBeCloseTo(0, 10);
        const next = follow.update('momentum', { ...pose, verticalSpeedFps: 20 }, 1 / 60)!;
        expect(Math.asin(forward(next).y)).toBeGreaterThan(0);
        expect(Math.asin(forward(next).y)).toBeLessThan(.1);
    });
    it('finishes easing to the last reliable direction as speed fades, ignoring a low-speed reversal', () => {
        const a = createCameraFollow(), b = createCameraFollow();
        settle(a, { ...pose, northVelocityFps: 20 });
        settle(b, { ...pose, northVelocityFps: 20 });
        // Begin a real turn, then stop while the camera is still catching up.
        for (let i = 0; i < 5; i++) {
            a.update('momentum', { ...pose, eastVelocityFps: 20, verticalSpeedFps: 10 }, 1 / 60);
            b.update('momentum', { ...pose, eastVelocityFps: 20, verticalSpeedFps: 10 }, 1 / 60);
        }
        const before = a.update('momentum', pose, 0)!.clone();
        for (let i = 0; i < 120; i++) {
            // 2.9 fps is just below the attitude indicator's 3 fps marker cutoff.
            const noise = i % 2
                ? { ...pose, northVelocityFps: -2.8 }
                : { ...pose, northVelocityFps: 1, verticalSpeedFps: -2.7 };
            const qa = a.update('momentum', noise, 1 / 60)!;
            const qb = b.update('momentum', pose, 1 / 60)!;
            expect(Math.abs(Quaternion.Dot(qa, qb))).toBeCloseTo(1, 10);
        }
        const after = a.update('momentum', pose, 0)!;
        expect(Math.abs(Quaternion.Dot(before, after))).toBeLessThan(.99);
        expect(Math.asin(forward(after).y)).toBeCloseTo(Math.atan2(10, 20), 3);
    });

});
