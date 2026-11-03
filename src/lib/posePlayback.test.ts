import { describe, expect, it } from 'vitest';
import { frameIndexAtTime } from './posePlayback';

describe('frameIndexAtTime', () => {
  const frames = [
    { time_s: 0 },
    { time_s: 1 / 12 },
    { time_s: 2 / 12 },
    { time_s: 3 / 12 },
  ];

  it('returns the last frame whose timestamp is at or before the playhead', () => {
    expect(frameIndexAtTime(frames, 0)).toBe(0);
    expect(frameIndexAtTime(frames, 0.05)).toBe(0);
    expect(frameIndexAtTime(frames, 1 / 12)).toBe(1);
    expect(frameIndexAtTime(frames, 0.2)).toBe(2);
    expect(frameIndexAtTime(frames, 10)).toBe(3);
  });

  it('returns 0 when there are no frames', () => {
    expect(frameIndexAtTime([], 1)).toBe(0);
  });
});
