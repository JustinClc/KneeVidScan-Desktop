import { describe, expect, it, vi } from 'vitest';
import { drawLandmarks, LIVE_POSE_CONNECTIONS } from './livePose';

describe('livePose', () => {
  it('draws connected landmarks and skips low-visibility points', () => {
    const ctx = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const pts = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      visibility: 1,
    }));
    pts[0] = { x: 0.5, y: 0.1, visibility: 0.1 };

    drawLandmarks(ctx, pts, 320, 240);

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 320, 240);
    // Connections touching the hidden nose (0) are skipped.
    const withNose = LIVE_POSE_CONNECTIONS.filter(
      ([a, b]) => a === 0 || b === 0,
    ).length;
    expect(ctx.stroke).toHaveBeenCalledTimes(
      LIVE_POSE_CONNECTIONS.length - withNose,
    );
    expect(ctx.fill).toHaveBeenCalledTimes(32);
    expect(ctx.arc).toHaveBeenCalledWith(
      160,
      120,
      expect.any(Number),
      0,
      Math.PI * 2,
    );
  });

  it('draws into the contained video rect, not the letterbox', () => {
    const ctx = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const pts = Array.from({ length: 33 }, () => ({
      x: 0,
      y: 0.5,
      visibility: 1,
    }));

    drawLandmarks(ctx, pts, 800, 800, '#2F6FE0', {
      x: 175,
      y: 0,
      width: 450,
      height: 800,
    });

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 800, 800);
    expect(ctx.moveTo).toHaveBeenCalledWith(175, 400);
    expect(ctx.arc).toHaveBeenCalledWith(
      175,
      400,
      expect.any(Number),
      0,
      Math.PI * 2,
    );
  });
});
