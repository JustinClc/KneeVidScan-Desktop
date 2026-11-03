import { describe, expect, it } from 'vitest';
import { stubLandmarksInFrame } from './poseCheck';
import {
  POSTURE_STEPS,
  STANDING_SEQUENCE,
  canContinueSubject,
  evaluateStandingLandmarks,
  nextStandingCode,
  positiveBodyMeasure,
  requiredParts,
  standingComplete,
  standingNamesForSubject,
} from './posture';
import { loadExistingSubject, DEMO_SUBJECT } from './subjects';

describe('standing posture sequence', () => {
  it('orders Frontal → Left lateral → Right lateral (F → LL → RL)', () => {
    expect(POSTURE_STEPS.map((s) => s.code)).toEqual(['F', 'LL', 'RL']);
    expect(STANDING_SEQUENCE).toEqual(['F', 'LL', 'RL']);
    expect(POSTURE_STEPS[1].msg).toMatch(/Turn 90° to your right/);
    expect(POSTURE_STEPS[2].msg).toMatch(/Turn around/);
  });

  it('advances nextStandingCode in order and gates Continue', () => {
    expect(nextStandingCode([])).toBe('F');
    expect(nextStandingCode(['F'])).toBe('LL');
    expect(nextStandingCode(['F', 'LL'])).toBe('RL');
    expect(nextStandingCode(['F', 'LL', 'RL'])).toBeNull();
    expect(standingComplete(['F', 'LL'])).toBe(false);
    expect(standingComplete(['F', 'LL', 'RL'])).toBe(true);
    expect(canContinueSubject('', ['F', 'LL', 'RL'])).toBe(false);
    expect(canContinueSubject('UG0001', ['F', 'LL'])).toBe(false);
    expect(canContinueSubject('UG0001', ['F', 'LL', 'RL'])).toBe(true);
  });

  it('builds standing PNG names for a subject', () => {
    expect(standingNamesForSubject('UG0001', 'Chan Tai Man')).toEqual([
      'UG0001_Chan-Tai-Man_standing_F_annotated.png',
      'UG0001_Chan-Tai-Man_standing_LL_annotated.png',
      'UG0001_Chan-Tai-Man_standing_RL_annotated.png',
    ]);
  });
});

describe('near-side landmark rules', () => {
  it('names the missing part when landmarks are absent', () => {
    expect(evaluateStandingLandmarks(false, null).missHint).toBe(
      'Eyes not in frame',
    );
    const q = evaluateStandingLandmarks('L', null);
    expect(q.ok).toBe(false);
    expect(q.missHint).toBe('Left ear not in frame');
  });

  it('uses eyes…toes for frontal and ear…heel for each lateral side', () => {
    expect(requiredParts(false)).toEqual([
      { label: 'Eyes', indices: [2, 5] },
      { label: 'Shoulders', indices: [11, 12] },
      { label: 'Hips', indices: [23, 24] },
      { label: 'Knees', indices: [25, 26] },
      { label: 'Ankles', indices: [27, 28] },
      { label: 'Toes', indices: [31, 32] },
    ]);
    expect(requiredParts('L').flatMap((p) => p.indices)).toEqual([
      7, 11, 23, 25, 27, 29,
    ]);
    expect(requiredParts('R').flatMap((p) => p.indices)).toEqual([
      8, 12, 24, 26, 28, 30,
    ]);
  });

  it('on LL only requires left-side landmarks (near-side)', () => {
    const pts = stubLandmarksInFrame();
    // Hide right heel — must still pass for left lateral.
    pts[30] = { x: 0.6, y: 0.9, visibility: 0.1 };
    expect(evaluateStandingLandmarks('L', pts).ok).toBe(true);

    // Hide left heel — must fail and name it.
    pts[29] = { x: 0.38, y: 0.9, visibility: 0.1 };
    const q = evaluateStandingLandmarks('L', pts);
    expect(q.ok).toBe(false);
    expect(q.missHint).toBe('Left heel not in frame');
  });

  it('on RL only requires right-side landmarks', () => {
    const pts = stubLandmarksInFrame();
    pts[7] = { x: 0.44, y: 0.11, visibility: 0.05 };
    expect(evaluateStandingLandmarks('R', pts).ok).toBe(true);
    pts[8] = { x: 0.56, y: 0.11, visibility: 0.05 };
    expect(evaluateStandingLandmarks('R', pts).missHint).toBe(
      'Right ear not in frame',
    );
  });

  it('frontal requires both sides', () => {
    const pts = stubLandmarksInFrame();
    expect(evaluateStandingLandmarks(false, pts).ok).toBe(true);
    pts[27] = { x: 0.38, y: 0.9, visibility: 0.1 };
    expect(evaluateStandingLandmarks(false, pts).ok).toBe(false);
  });

  it('fails a visible landmark that sits outside the given region', () => {
    const pts = stubLandmarksInFrame();
    const region = { x: 0.3, y: 0.05, w: 0.4, h: 0.9 };
    expect(evaluateStandingLandmarks(false, pts, region).ok).toBe(true);
    // Toe just past the right edge, beyond the 2 % margin.
    pts[32] = { x: 0.72, y: 0.96, visibility: 1 };
    const q = evaluateStandingLandmarks(false, pts, region);
    expect(q.ok).toBe(false);
    expect(q.missing).toEqual(['Toes']);
    // Within the margin still counts as inside.
    pts[32] = { x: 0.705, y: 0.96, visibility: 1 };
    expect(evaluateStandingLandmarks(false, pts, region).ok).toBe(true);
  });
});

describe('positive body measure', () => {
  it('accepts only a number greater than zero', () => {
    expect(positiveBodyMeasure('172')).toBe(true);
    expect(positiveBodyMeasure('68.5')).toBe(true);
    expect(positiveBodyMeasure('')).toBe(false);
    expect(positiveBodyMeasure(' ')).toBe(false);
    expect(positiveBodyMeasure('0')).toBe(false);
    expect(positiveBodyMeasure('-3')).toBe(false);
    expect(positiveBodyMeasure('tall')).toBe(false);
  });
});

describe('load existing subject', () => {
  it('reuses info but forces posture retake', () => {
    const loaded = loadExistingSubject({
      ...DEMO_SUBJECT,
      standingFiles: {
        F: 'old_standing_F_annotated.png',
        LL: 'old_standing_LL_annotated.png',
        RL: 'old_standing_RL_annotated.png',
      },
    });
    expect(loaded.profile.subjectId).toBe('UG0001');
    expect(loaded.profile.subjectName).toBe('Chan Tai Man');
    expect(loaded.retakePostures).toBe(true);
    expect(loaded.postureDone).toBe(false);
    expect(loaded.capturedStanding).toEqual([]);
    expect(loaded.profile.standingFiles).toBeUndefined();
  });
});
