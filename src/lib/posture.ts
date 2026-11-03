/**
 * Standing posture sequence + near-side landmark quality rules.
 * Landmark indices match MediaPipe Pose (33 landmarks).
 */

import {
  STANDING_SEQUENCE,
  type StandingCode,
  standingFileName,
} from './naming';

export type PostureSide = false | 'L' | 'R';

export type PostureStep = {
  code: StandingCode;
  name: string;
  msg: string;
  sub: string;
  side: PostureSide;
};

export const POSTURE_STEPS: readonly PostureStep[] = [
  {
    code: 'F',
    name: 'Frontal',
    msg: 'Stand naturally, facing the frontal camera.',
    sub: 'Keep your head, shoulders, hips, knees, ankles and toes inside the frame.',
    side: false,
  },
  {
    code: 'LL',
    name: 'Left lateral',
    msg: 'Turn 90° to your right.',
    sub: 'The camera now sees your left side. Stay inside the frame.',
    side: 'L',
  },
  {
    code: 'RL',
    name: 'Right lateral',
    msg: 'Turn around to face the other way.',
    sub: 'The camera now sees your right side. Stay inside the frame.',
    side: 'R',
  },
] as const;

export const FACE_FRONTAL_AGAIN =
  'Face the frontal camera again, then continue to Capture.';

/** MediaPipe Pose landmark indices used for the standing gate. */
export const MP = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export type LandmarkPoint = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export type RequiredPart = {
  label: string;
  indices: number[];
};

export function requiredParts(side: PostureSide): RequiredPart[] {
  if (!side) {
    return [
      { label: 'Eyes', indices: [MP.leftEye, MP.rightEye] },
      { label: 'Shoulders', indices: [MP.leftShoulder, MP.rightShoulder] },
      { label: 'Hips', indices: [MP.leftHip, MP.rightHip] },
      { label: 'Knees', indices: [MP.leftKnee, MP.rightKnee] },
      { label: 'Ankles', indices: [MP.leftAnkle, MP.rightAnkle] },
      { label: 'Toes', indices: [MP.leftFootIndex, MP.rightFootIndex] },
    ];
  }
  if (side === 'L') {
    // Near-side only — subject's left faces the frontal camera after 90° right turn.
    return [
      { label: 'Left ear', indices: [MP.leftEar] },
      { label: 'Left shoulder', indices: [MP.leftShoulder] },
      { label: 'Left hip', indices: [MP.leftHip] },
      { label: 'Left knee', indices: [MP.leftKnee] },
      { label: 'Left ankle', indices: [MP.leftAnkle] },
      { label: 'Left heel', indices: [MP.leftHeel] },
    ];
  }
  return [
    { label: 'Right ear', indices: [MP.rightEar] },
    { label: 'Right shoulder', indices: [MP.rightShoulder] },
    { label: 'Right hip', indices: [MP.rightHip] },
    { label: 'Right knee', indices: [MP.rightKnee] },
    { label: 'Right ankle', indices: [MP.rightAnkle] },
    { label: 'Right heel', indices: [MP.rightHeel] },
  ];
}

const VIS_OK = 0.5;
/** Slack around the region, as a fraction of the region's width / height. */
const IN_FRAME_MARGIN = 0.02;

/** Normalised (0–1) region in image coordinates; landmarks must sit inside it. */
export type NormRect = { x: number; y: number; w: number; h: number };

const WHOLE_IMAGE: NormRect = { x: 0, y: 0, w: 1, h: 1 };

function landmarkOk(lm: LandmarkPoint | undefined, region: NormRect): boolean {
  if (!lm) return false;
  if ((lm.visibility ?? 1) < VIS_OK) return false;
  const mx = region.w * IN_FRAME_MARGIN;
  const my = region.h * IN_FRAME_MARGIN;
  if (lm.x < region.x - mx || lm.x > region.x + region.w + mx) return false;
  if (lm.y < region.y - my || lm.y > region.y + region.h + my) return false;
  return true;
}

export type PoseQuality = {
  ok: boolean;
  /** Human-readable missing part, e.g. "Left ankle not in frame". */
  missHint: string | null;
  /** Which required part labels are currently satisfied. */
  present: string[];
  missing: string[];
};

/**
 * Near-side / frontal standing quality check.
 * Side postures only inspect landmarks facing the camera — checking the far
 * side would never pass a true lateral view. `region` defaults to the whole
 * image; the live gate passes the guide frame so the crop never cuts a part.
 */
export function evaluateStandingLandmarks(
  side: PostureSide,
  landmarks: LandmarkPoint[] | null | undefined,
  region: NormRect = WHOLE_IMAGE,
): PoseQuality {
  const parts = requiredParts(side);
  if (!landmarks || landmarks.length === 0) {
    const missing = parts.map((p) => p.label);
    return {
      ok: false,
      missHint: `${missing[0]} not in frame`,
      present: [],
      missing,
    };
  }

  const present: string[] = [];
  const missing: string[] = [];
  for (const part of parts) {
    const ok = part.indices.every((i) => landmarkOk(landmarks[i], region));
    if (ok) present.push(part.label);
    else missing.push(part.label);
  }

  return {
    ok: missing.length === 0,
    missHint: missing.length ? `${missing[0]} not in frame` : null,
    present,
    missing,
  };
}

/** Sequence helpers for tests and UI. */
export function nextStandingCode(
  captured: readonly StandingCode[],
): StandingCode | null {
  for (const code of STANDING_SEQUENCE) {
    if (!captured.includes(code)) return code;
  }
  return null;
}

export function standingComplete(captured: readonly StandingCode[]): boolean {
  return STANDING_SEQUENCE.every((c) => captured.includes(c));
}

/** Height and weight must be numbers greater than zero before a photo or save. */
export function positiveBodyMeasure(value: string): boolean {
  const n = Number(value);
  return value.trim() !== '' && Number.isFinite(n) && n > 0;
}

export function canContinueSubject(
  subjectId: string,
  captured: readonly StandingCode[],
): boolean {
  return Boolean(subjectId.trim()) && standingComplete(captured);
}

export function standingNamesForSubject(
  subjectId: string,
  displayName: string,
): string[] {
  return STANDING_SEQUENCE.map((c) =>
    standingFileName(subjectId, displayName, c),
  );
}

export { STANDING_SEQUENCE, standingFileName };
