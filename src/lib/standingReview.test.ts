import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  reviewFaceRegion,
  reviewJointChains,
  standingReviewUrl,
} from './standingReview';
import type { LandmarkPoint } from './posture';

afterEach(() => vi.restoreAllMocks());
const points = (): LandmarkPoint[] =>
  Array.from({ length: 33 }, (_, i) => ({
    x: 0.4 + (i % 2) * 0.1,
    y: 0.1 + i * 0.02,
    visibility: 1,
  }));
describe('standing review privacy and joints', () => {
  it('uses anatomical left/right chains and only adjacent hip–knee–ankle edges', () => {
    expect(reviewJointChains(false)).toEqual([
      [23, 25, 27],
      [24, 26, 28],
    ]);
    expect(reviewJointChains('L')).toEqual([[23, 25, 27]]);
    expect(reviewJointChains('R')).toEqual([[24, 26, 28]]);
  });
  it('does not blur when facial landmarks are missing or unreliable', () => {
    expect(reviewFaceRegion(null)).toBeNull();
    expect(
      reviewFaceRegion(
        points().map((point) => ({ ...point, visibility: 0.1 })),
      ),
    ).toBeNull();
    expect(reviewFaceRegion(points())).toMatchObject({
      x: expect.any(Number),
      width: expect.any(Number),
    });
  });
  it('draws effects on a separate canvas, omits undetected joints and never changes the source', () => {
    const source = document.createElement('canvas');
    source.width = 600;
    source.height = 900;
    const ctx = {
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      filter: 'none',
    };
    const contexts: HTMLCanvasElement[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      function (this: HTMLCanvasElement) {
        contexts.push(this);
        return ctx as unknown as CanvasRenderingContext2D;
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,review',
    );
    const landmarks = points();
    expect(standingReviewUrl(source, landmarks, 'L')).toBe(
      'data:image/png;base64,review',
    );
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).not.toBe(source);
    expect(ctx.filter).toContain('blur(');
    expect(ctx.arc).toHaveBeenCalledTimes(3);
    expect(ctx.lineTo).toHaveBeenCalledTimes(2);
    ctx.arc.mockClear();
    ctx.lineTo.mockClear();
    ctx.clip.mockClear();
    ctx.filter = 'none';
    landmarks.forEach((point, i) => {
      if (i < 11 || i === 25) point.visibility = 0;
    });
    standingReviewUrl(source, landmarks, 'L');
    expect(ctx.clip).toHaveBeenCalledOnce();
    expect(ctx.rect).toHaveBeenLastCalledWith(0, 0, 600, 900);
    expect(ctx.filter).toContain('blur(');
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    expect(ctx.lineTo).not.toHaveBeenCalled();
    expect(source.width).toBe(600);
    expect(source.height).toBe(900);
  });
});
