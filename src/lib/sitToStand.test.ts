import { describe, it, expect } from 'vitest';
import { checkSitting } from './sitToStand';
import { MP, type LandmarkPoint } from './posture';

function seated(side: 'left' | 'right' = 'left', w = 600, h = 900) {
  const points: LandmarkPoint[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 0,
  }));
  const ids =
    side === 'left'
      ? [MP.leftEar, MP.leftShoulder, MP.leftHip, MP.leftKnee, MP.leftAnkle]
      : [
          MP.rightEar,
          MP.rightShoulder,
          MP.rightHip,
          MP.rightKnee,
          MP.rightAnkle,
        ];
  // Source pixel coordinates form two exact 90° angles.
  const coords = [
    [220, 180],
    [220, 280],
    [220, 480],
    [380, 480],
    [380, 700],
  ];
  ids.forEach((id, i) => {
    points[id] = { x: coords[i][0] / w, y: coords[i][1] / h, visibility: 0.95 };
  });
  return points;
}

describe('sit-to-stand readiness', () => {
  it.each(['left', 'right'] as const)(
    'accepts a visible seated %s side',
    (side) => {
      expect(checkSitting(seated(side), 600, 900)).toMatchObject({
        ready: true,
        side,
        hipAngle: 90,
        kneeAngle: 90,
      });
    },
  );
  it('rejects missing, uncertain, non-finite or out-of-frame landmarks', () => {
    expect(checkSitting(null, 600, 900).ready).toBe(false);
    for (const patch of [{ visibility: 0.2 }, { x: 0.01 }, { x: NaN }]) {
      const points = seated();
      Object.assign(points[MP.leftEar], patch);
      expect(checkSitting(points, 600, 900).ready).toBe(false);
    }
  });
  it('rejects standing and a knee outside the specified angle range', () => {
    const standing = seated();
    standing[MP.leftKnee].x = standing[MP.leftHip].x;
    standing[MP.leftKnee].y = 0.65;
    expect(checkSitting(standing, 600, 900).ready).toBe(false);
    const extended = seated();
    extended[MP.leftAnkle] = { x: 0.7, y: 0.55, visibility: 0.95 };
    expect(checkSitting(extended, 600, 900).ready).toBe(false);
  });
  it('rejects a frontal pose even when leg angles are seated', () => {
    const points = seated();
    points[MP.rightShoulder] = {
      x: 0.65,
      y: points[MP.leftShoulder].y,
      visibility: 0.95,
    };
    points[MP.rightHip] = {
      x: 0.65,
      y: points[MP.leftHip].y,
      visibility: 0.95,
    };
    expect(checkSitting(points, 600, 900)).toMatchObject({
      ready: false,
      message: 'Turn so your left or right side faces the camera.',
    });
  });
  it('corrects angles for non-square source images', () => {
    const points = seated();
    points[MP.leftShoulder] = { x: 240 / 600, y: 300 / 900, visibility: 0.95 };
    points[MP.leftHip] = { x: 300 / 600, y: 420 / 900, visibility: 0.95 };
    points[MP.leftKnee] = { x: 420 / 600, y: 360 / 900, visibility: 0.95 };
    const check = checkSitting(points, 600, 900);
    expect(check.hipAngle).toBeCloseTo(90);
  });
});
