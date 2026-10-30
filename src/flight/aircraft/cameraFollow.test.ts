import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from '@babylonjs/core';
import { createCameraFollow, MOMENTUM_PITCH_LIMIT } from '@0sfs/aircraft/cameraFollow';
import { flightAttitudeToQuaternion } from '@0sfs/ground-contact/ecefBridge';
const pose = { headingRad: 0, northVelocityFps: 0, eastVelocityFps: 0, verticalSpeedFps: 0 };
const forward = (q: Quaternion) => new Vector3(0, 0, 1).applyRotationQuaternion(q);
const settle = (track: ReturnType<typeof createCameraFollow>, state: typeof pose) => { let q: Quaternion | null = null; for (let i = 0; i < 120; i++)
    q = track.update('momentum', state, 1 / 60); return q!; };
const DEG = Math.PI / 180;
/** Compass heading of the view, radians: north 0, east positive. */
const heading = (q: Quaternion) => Math.atan2(forward(q).x, -forward(q).z);
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
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
    it('holds its last course at a hover without turning, ignores noise, and keeps it in vertical flight', () => {
        const follow = createCameraFollow();
        const course = settle(follow, { ...pose, eastVelocityFps: 20 }).clone();
        for (let i = 0; i < 20; i++)
            expect(Math.abs(Quaternion.Dot(follow.update('momentum', { ...pose, northVelocityFps: .01 }, 1 / 60)!, course))).toBeCloseTo(1);
        const vertical = settle(follow, { ...pose, verticalSpeedFps: 20 });
        const v = forward(vertical);
        expect(v.y).toBeGreaterThan(.99);
        expect(v.x).toBeGreaterThan(0);
    });
    it('turns with the aircraft yawing in place, so flying off along the new heading does not swing the view', () => {
        const follow = createCameraFollow();
        settle(follow, { ...pose, northVelocityFps: 30 });
        settle(follow, pose);
        // Stopped, yaw left through north to west at 60 degrees a second;
        // the flight model reports heading from 0 to 360 degrees.
        for (let i = 1; i <= 90; i++)
            follow.update('momentum', { ...pose, headingRad: (360 - i) * DEG }, 1 / 60);
        const west = { ...pose, headingRad: 270 * DEG };
        const turned = heading(settle(follow, west));
        // Fly off west, to three metres a second in two seconds.
        let swing = 0;
        for (let i = 1; i <= 120; i++)
            swing = Math.max(swing, Math.abs(wrap(heading(follow.update('momentum', { ...west, eastVelocityFps: -i / 40 / .3048 }, 1 / 60)!) - turned)));
        expect.soft(Math.abs(wrap(turned + 90 * DEG)) / DEG, "view off the aircraft's heading after turning in place, degrees").toBeLessThan(1);
        expect.soft(swing / DEG, 'view swing while flying off, degrees').toBeLessThan(10);
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

describe('Yaw spring', () => {
    it('starts at the aircraft heading and catches a turn without bouncing', () => {
        const follow = createCameraFollow();
        expect(heading(follow.update('yaw', pose, 0)!)).toBeCloseTo(0);
        expect(follow.isActive()).toBe(false);
        const turned = { ...pose, headingRad: Math.PI / 2 };
        let previous = 0;
        for (let i = 0; i < 180; i++) {
            const actual = heading(follow.update('yaw', turned, 1 / 60)!);
            expect(actual).toBeGreaterThanOrEqual(previous - 1e-10);
            expect(actual).toBeLessThanOrEqual(turned.headingRad + 1e-10);
            if (i === 0) {
                expect(actual).toBeGreaterThan(0);
                expect(actual).toBeLessThan(.02);
                expect(follow.isActive()).toBe(true);
            }
            if (i === 33) expect(actual).toBeCloseTo(turned.headingRad * .95, 2);
            previous = actual;
        }
        expect(previous).toBeCloseTo(turned.headingRad, 10);
        expect(follow.isActive()).toBe(false);
    });

    it('wraps through north and follows repeated complete turns continuously', () => {
        const follow = createCameraFollow();
        let previous = heading(follow.update('yaw', { ...pose, headingRad: 359 * DEG }, 0)!);
        const first = heading(follow.update('yaw', { ...pose, headingRad: DEG }, 1 / 60)!);
        expect(wrap(first - previous)).toBeGreaterThan(0);
        expect(wrap(first - previous)).toBeLessThan(2 * DEG);
        previous = first;
        for (let i = 0; i <= 720; i++) {
            const actual = heading(follow.update('yaw', { ...pose, headingRad: (i % 360) * DEG }, 1 / 60)!);
            expect(Math.abs(wrap(actual - previous))).toBeLessThan(1.1 * DEG);
            previous = actual;
        }
        expect(Math.abs(wrap(previous))).toBeLessThan(15 * DEG);
    });

    it('uses only heading, keeping its frame level during sliding, climbing and banking', () => {
        const a = createCameraFollow(), b = createCameraFollow();
        a.update('yaw', pose, 0);
        b.update('yaw', pose, 0);
        for (let i = 0; i < 120; i++) {
            const state = { ...pose, headingRad: i * DEG };
            const noisy = { ...state, northVelocityFps: -200, eastVelocityFps: 300, verticalSpeedFps: -400, rollRad: 1, pitchRad: 1 };
            const qa = a.update('yaw', state, 1 / 60)!;
            const qb = b.update('yaw', noisy, 1 / 60)!;
            expect(Math.abs(Quaternion.Dot(qa, qb))).toBeCloseTo(1, 12);
            expect(forward(qa).y).toBeCloseTo(0, 12);
            expect(new Vector3(0, 1, 0).applyRotationQuaternion(qa).y).toBeCloseTo(1, 12);
        }
    });

    it('agrees across frame rates and does not advance on zero or invalid elapsed time', () => {
        const frames = [30, 60, 120].map(fps => {
            const follow = createCameraFollow();
            follow.update('yaw', pose, 0);
            for (let i = 0; i < fps / 2; i++) follow.update('yaw', { ...pose, headingRad: 1 }, 1 / fps);
            const before = follow.update('yaw', pose, 0)!.clone();
            for (const dt of [0, -1, NaN]) expect(Math.abs(Quaternion.Dot(before, follow.update('yaw', pose, dt)!))).toBeCloseTo(1, 12);
            return before;
        });
        for (const q of frames) expect(Math.abs(Quaternion.Dot(q, frames[0]))).toBeCloseTo(1, 12);
    });

    it('applies spring time live, supports immediate follow and holds through invalid heading', () => {
        const slow = createCameraFollow(), fast = createCameraFollow();
        slow.update('yaw', pose, 0);
        fast.update('yaw', pose, 0);
        const turned = { ...pose, headingRad: 1 };
        expect(heading(slow.update('yaw', turned, 1 / 60, .5)!)).toBeLessThan(heading(fast.update('yaw', turned, 1 / 60, .05)!));
        expect(heading(slow.update('yaw', turned, 1 / 60, 0)!)).toBeCloseTo(1, 12);
        expect(slow.isActive()).toBe(false);
        expect(heading(slow.update('yaw', { ...pose, headingRad: NaN }, 1 / 60)!)).toBeCloseTo(1, 12);
    });

    it('enters from the previous follow heading and clears spring activity on exit', () => {
        const follow = createCameraFollow();
        const travelling = settle(follow, { ...pose, eastVelocityFps: 20 }).clone();
        const start = follow.update('yaw', pose, 0)!;
        expect(heading(start)).toBeCloseTo(heading(travelling), 12);
        expect(follow.isActive()).toBe(true);
        follow.update('planet', pose, 0);
        expect(follow.isActive()).toBe(false);
        expect(heading(follow.update('yaw', { ...pose, headingRad: 1 }, 0)!)).toBeCloseTo(0, 12);
        follow.update('aircraft', pose, 0);
        expect(heading(follow.update('yaw', { ...pose, headingRad: 1 }, 0)!)).toBeCloseTo(1, 12);
    });
});
