/**
 * Body axes in the local north-east-down frame.
 *
 * JSBSim body +X is forward. Roll does not move that axis; the gun and the
 * rails use it as the boresight.
 */

export interface NedVector { north: number; east: number; down: number }

export interface BodyAxes {
  forward: NedVector;
  right: NedVector;
  down: NedVector;
}

export function bodyAxes(rollRad: number, pitchRad: number, headingRad: number): BodyAxes {
  const cp = Math.cos(pitchRad);
  const sp = Math.sin(pitchRad);
  const ch = Math.cos(headingRad);
  const sh = Math.sin(headingRad);
  const cr = Math.cos(rollRad);
  const sr = Math.sin(rollRad);
  return {
    forward: { north: cp * ch, east: cp * sh, down: -sp },
    right: { north: sr * sp * ch - cr * sh, east: sr * sp * sh + cr * ch, down: sr * cp },
    down: { north: cr * sp * ch + sr * sh, east: cr * sp * sh - sr * ch, down: cr * cp },
  };
}
