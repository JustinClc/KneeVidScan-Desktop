import { describe, expect, it } from 'vitest';
import type { PoseFrame } from './fullResPose';
import { smoothPoseFrames, type SmoothParams } from './poseSmoothing';

function frame(t: number, x: number, vis = 1): PoseFrame {
  const landmarks3d = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: vis,
  }));
  landmarks3d[0] = { x, y: 0, z: 0, visibility: vis };
  const landmarks2d = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: vis,
  }));
  landmarks2d[0] = { x, y: 0.5, visibility: vis };
  return { frame: 0, time_s: t, landmarks2d, landmarks3d };
}

const strong: SmoothParams = {
  landmarkSmoothing: true,
  landmarkStrength: 1,
  temporalFilter: false,
  filterStrength: 0,
};

describe('poseSmoothing', () => {
  it('strong landmark smoothing reduces jitter', () => {
    const frames = Array.from({ length: 40 }, (_, i) =>
      frame(i / 15, i % 2 === 0 ? 1 : -1),
    );
    const out = smoothPoseFrames(frames, strong, 15);
    const tail = out.slice(10).map((f) => Math.abs(f.landmarks3d[0].x));
    expect(Math.max(...tail)).toBeLessThan(0.35);
  });

  it('strength 0 leaves a smooth signal almost unchanged', () => {
    const frames = Array.from({ length: 20 }, (_, i) =>
      frame(i / 15, i * 0.01),
    );
    const out = smoothPoseFrames(
      frames,
      { ...strong, landmarkStrength: 0 },
      15,
    );
    const diffs = out.map((f, i) =>
      Math.abs(f.landmarks3d[0].x - frames[i].landmarks3d[0].x),
    );
    expect(Math.max(...diffs)).toBeLessThan(0.02);
  });

  it('resets across a gap and does not mutate the input', () => {
    const frames = [
      frame(0, 0),
      frame(1 / 15, 0),
      { ...frame(2 / 15, 0), landmarks2d: [], landmarks3d: [] },
      frame(3 / 15, 5),
      frame(4 / 15, 5),
    ];
    const before = JSON.parse(JSON.stringify(frames));
    const out = smoothPoseFrames(
      frames,
      { ...strong, temporalFilter: true, filterStrength: 1 },
      15,
    );
    expect(frames).toEqual(before);
    expect(out[2].landmarks3d).toEqual([]);
    expect(out[3].landmarks3d[0].x).toBeCloseTo(5, 1);
  });

  it('temporal filter removes alternating jitter without a startup bias', () => {
    const frames = Array.from({ length: 40 }, (_, i) =>
      frame(i / 15, i % 2 === 0 ? 1 : -1),
    );
    const out = smoothPoseFrames(
      frames,
      {
        landmarkSmoothing: false,
        landmarkStrength: 0,
        temporalFilter: true,
        filterStrength: 1,
      },
      15,
    );
    const mid = out.slice(15, 25).map((f) => f.landmarks3d[0].x);
    expect(Math.max(...mid.map((x) => Math.abs(x)))).toBeLessThan(0.15);
  });

  it('does not blend across a low-visibility sample', () => {
    const frames = [frame(0, 0), frame(1 / 15, 0, 0.1), frame(2 / 15, 4)];
    const out = smoothPoseFrames(
      frames,
      { ...strong, temporalFilter: true, filterStrength: 1 },
      15,
    );
    expect(out[2].landmarks3d[0].x).toBeCloseTo(4, 1);
  });
});
