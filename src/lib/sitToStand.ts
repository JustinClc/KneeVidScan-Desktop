import { MP, type LandmarkPoint, type NormRect } from './posture';

export const SIT_TO_STAND_SECONDS = 20;
export const SIT_TO_STAND_COUNTDOWN_MS = 5000;
export const POSE_FRESH_MS = 1200;

/** Centered guide occupying half the video width and 90% of its height. */
export const SITTING_GUIDE_RECT: Readonly<NormRect> = {
  x: 0.25,
  y: 0.05,
  w: 0.5,
  h: 0.9,
};

export type SittingCheck = {
  ready: boolean;
  message: string;
  side?: 'left' | 'right';
  hipAngle?: number;
  kneeAngle?: number;
};

function angle(
  a: LandmarkPoint,
  b: LandmarkPoint,
  c: LandmarkPoint,
  w: number,
  h: number,
) {
  const ax = (a.x - b.x) * w;
  const ay = (a.y - b.y) * h;
  const cx = (c.x - b.x) * w;
  const cy = (c.y - b.y) * h;
  const length = Math.hypot(ax, ay) * Math.hypot(cx, cy);
  return length > 0
    ? (Math.acos(Math.max(-1, Math.min(1, (ax * cx + ay * cy) / length))) *
        180) /
        Math.PI
    : NaN;
}

/** Image-space angles must account for the source image's aspect ratio. */
export function checkSitting(
  points: LandmarkPoint[] | null,
  width: number,
  height: number,
): SittingCheck {
  const fail = (message: string): SittingCheck => ({ ready: false, message });
  if (!points || width <= 0 || height <= 0)
    return fail('Waiting for a clear side view of your seated posture.');
  const visible = (p: LandmarkPoint | undefined): p is LandmarkPoint =>
    !!p &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    (p.visibility ?? 0) >= 0.6;
  const rect = SITTING_GUIDE_RECT;
  const sides = [
    {
      side: 'left' as const,
      indices: [
        MP.leftEar,
        MP.leftShoulder,
        MP.leftHip,
        MP.leftKnee,
        MP.leftAnkle,
      ],
    },
    {
      side: 'right' as const,
      indices: [
        MP.rightEar,
        MP.rightShoulder,
        MP.rightHip,
        MP.rightKnee,
        MP.rightAnkle,
      ],
    },
  ].sort(
    (a, b) =>
      b.indices.reduce((s, i) => s + (points[i]?.visibility ?? 0), 0) -
      a.indices.reduce((s, i) => s + (points[i]?.visibility ?? 0), 0),
  );
  // Projected shoulder/hip width relative to torso length rejects frontal views.
  const ls = points[MP.leftShoulder],
    rs = points[MP.rightShoulder];
  const lh = points[MP.leftHip],
    rh = points[MP.rightHip];
  const distance = (a: LandmarkPoint, b: LandmarkPoint) =>
    Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
  if (visible(ls) && visible(rs) && visible(lh) && visible(rh)) {
    const torso = (distance(ls, lh) + distance(rs, rh)) / 2;
    if (!torso || Math.max(distance(ls, rs), distance(lh, rh)) > torso * 0.45)
      return fail('Turn so your left or right side faces the camera.');
  }
  let result = fail(
    'Keep your ear, shoulder, hip, knee and ankle visible inside the frame.',
  );
  for (const { side, indices } of sides) {
    const body = indices.map((i) => points[i]);
    if (!body.every(visible)) continue;
    if (
      !body.every(
        (p) =>
          p.x >= rect.x &&
          p.x <= rect.x + rect.w &&
          p.y >= rect.y &&
          p.y <= rect.y + rect.h,
      )
    )
      continue;
    const [, shoulder, hip, knee, ankle] = body;
    const hipAngle = angle(shoulder, hip, knee, width, height);
    const kneeAngle = angle(hip, knee, ankle, width, height);
    const ready =
      hipAngle >= 70 && hipAngle <= 120 && kneeAngle >= 70 && kneeAngle <= 110;
    result = {
      ready,
      side,
      hipAngle,
      kneeAngle,
      message: ready
        ? 'Position ready. Hold still until recording starts.'
        : 'Sit on the chair with your hip at 70–120° and knee at 70–110°.',
    };
    if (ready) return result;
  }
  return result;
}
