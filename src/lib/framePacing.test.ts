import { describe, expect, it } from 'vitest';
import {
  CAPTURE_DETECT_GAP_MS,
  POSTURE_DETECT_GAP_MS,
  createFpsMeter,
  detectGapMs,
} from './framePacing';

describe('fps meter', () => {
  it('counts frames in the last second', () => {
    const m = createFpsMeter(1000);
    for (let t = 0; t < 1000; t += 50) m.tick(t);
    expect(m.fps(1000)).toBe(20);
    expect(m.fps(2500)).toBe(0);
  });
});

describe('detection gap', () => {
  it('keeps the target when detection is fast', () => {
    expect(detectGapMs(CAPTURE_DETECT_GAP_MS, 10, 2)).toBe(66);
    expect(detectGapMs(POSTURE_DETECT_GAP_MS, 40, 1)).toBe(100);
  });

  it('spaces detections out when they are slow or shared', () => {
    expect(detectGapMs(CAPTURE_DETECT_GAP_MS, 35, 2)).toBe(105);
    expect(detectGapMs(POSTURE_DETECT_GAP_MS, 90, 1)).toBe(135);
  });
});
