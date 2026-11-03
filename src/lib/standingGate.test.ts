import { describe, expect, it } from 'vitest';
import {
  GUIDE_ASPECT,
  containFit,
  containRect,
  createHoldTimer,
  guideRect,
  guideRectPx,
  reviewWarning,
} from './standingGate';

describe('guide frame', () => {
  it('is 90 % of the image height with a fixed 1 : 2.2 shape, centred', () => {
    const r = guideRect(1920, 1080);
    expect(r.h).toBeCloseTo(0.9);
    expect(r.y).toBeCloseTo(0.05);
    expect((r.w * 1920) / (r.h * 1080)).toBeCloseTo(GUIDE_ASPECT);
    expect(r.x + r.w / 2).toBeCloseTo(0.5);
  });

  it('keeps the same pixel shape in portrait', () => {
    const p = guideRectPx(2160, 3840);
    expect(p.sh).toBe(Math.round(3840 * 0.9));
    expect(p.sw / p.sh).toBeCloseTo(GUIDE_ASPECT, 2);
    expect(Math.abs(2 * p.sx + p.sw - 2160)).toBeLessThanOrEqual(1);
  });

  it('crop rect from a preview and the full-res still covers the same area', () => {
    const preview = guideRect(960, 540);
    const full = guideRect(3840, 2160);
    expect(preview.x).toBeCloseTo(full.x);
    expect(preview.w).toBeCloseTo(full.w);
  });

  it('fits the width instead on extremely tall images', () => {
    const r = guideRect(100, 1000);
    expect(r.w).toBeLessThanOrEqual(1);
    expect(r.h).toBeLessThanOrEqual(0.9);
  });

  it('contain-fits a frame into a box without cropping', () => {
    expect(containFit(1920, 1080, 800, 800)).toEqual({
      width: 800,
      height: 450,
    });
    expect(containFit(1080, 1920, 800, 800)).toEqual({
      width: 450,
      height: 800,
    });
    expect(containFit(0, 0, 800, 800)).toEqual({ width: 0, height: 0 });
  });

  it('letterboxes a portrait frame inside a wider box', () => {
    expect(containRect(1080, 1920, 800, 800)).toEqual({
      x: 175,
      y: 0,
      width: 450,
      height: 800,
    });
    expect(containRect(1920, 1080, 800, 800)).toEqual({
      x: 0,
      y: 175,
      width: 800,
      height: 450,
    });
    expect(containRect(0, 0, 800, 800)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe('approval hold', () => {
  it('passes only after staying ok for the hold time, resets on a miss', () => {
    const hold = createHoldTimer(500, 0);
    expect(hold.update(true, 0)).toBe(false);
    expect(hold.update(true, 499)).toBe(false);
    expect(hold.update(true, 500)).toBe(true);
    expect(hold.update(false, 600)).toBe(false);
    expect(hold.update(true, 700)).toBe(false);
    expect(hold.update(true, 1200)).toBe(true);
  });

  it('ignores a miss shorter than the grace, resets on a longer one', () => {
    const hold = createHoldTimer(500, 150);
    expect(hold.update(true, 0)).toBe(false);
    expect(hold.update(false, 200)).toBe(false);
    expect(hold.update(true, 300)).toBe(false);
    expect(hold.update(true, 500)).toBe(true);
    expect(hold.update(false, 600)).toBe(false);
    expect(hold.missedFor(700)).toBe(100);
    expect(hold.update(false, 800)).toBe(false);
    expect(hold.update(true, 900)).toBe(false);
    expect(hold.update(true, 1400)).toBe(true);
  });
});

describe('review warning', () => {
  it('names undetected parts, none when all found', () => {
    expect(reviewWarning([])).toBeNull();
    expect(reviewWarning(['Left heel'])).toBe('Left heel not detected');
  });
});
