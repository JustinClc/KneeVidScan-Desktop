import { describe, expect, it } from 'vitest';
import {
  MIN_TRIM_SEC,
  moveTrimEnd,
  moveTrimStart,
  overlapDuration,
  resolveTrimWindow,
  timeAtClientX,
  trimChangesMedia,
} from './trimWindow';

describe('overlapDuration', () => {
  it('uses the shortest loaded view so every camera covers the bar', () => {
    expect(overlapDuration([10, 10.2, 10.05])).toBe(10);
  });

  it('ignores views that have not reported a duration', () => {
    expect(overlapDuration([Number.NaN, 0, 8])).toBe(8);
    expect(overlapDuration([])).toBeNull();
    expect(overlapDuration([Number.NaN, 0])).toBeNull();
  });
});

describe('resolveTrimWindow', () => {
  it('keeps one window inside every view', () => {
    expect(resolveTrimWindow([10, 10.2], 0.5, 9)).toEqual({
      startSec: 0.5,
      endSec: 9,
    });
  });

  it('pulls the end back when metadata is only a few milliseconds long', () => {
    expect(resolveTrimWindow([10, 9.98], 0, 10)).toEqual({
      startSec: 0,
      endSec: 9.98,
    });
  });

  it('rejects a window that runs past the shortest view', () => {
    expect(() => resolveTrimWindow([10, 8], 0, 9)).toThrow(/shortest view/);
  });

  it('rejects a window shorter than one step', () => {
    expect(() => resolveTrimWindow([10], 1, 1 + MIN_TRIM_SEC / 2)).toThrow(
      /too short/,
    );
  });
});

describe('trim handles', () => {
  it('cannot cross or leave the overlap', () => {
    expect(moveTrimStart(10, 9.95, 10)).toEqual({ startSec: 9.9, endSec: 10 });
    expect(moveTrimEnd(10, 0, 0.01)).toEqual({
      startSec: 0,
      endSec: MIN_TRIM_SEC,
    });
    expect(moveTrimEnd(10, 2, 1)).toEqual({ startSec: 2, endSec: 2.1 });
  });

  it('maps a pointer on the bar to a shared time', () => {
    expect(timeAtClientX(150, 100, 200, 10)).toBeCloseTo(2.5);
    expect(timeAtClientX(-10, 0, 100, 10)).toBe(0);
    expect(timeAtClientX(1000, 0, 100, 10)).toBe(10);
    expect(timeAtClientX(50, 0, 0, 10)).toBe(0);
  });

  it('treats a full overlap as unchanged and a real cut as a trim', () => {
    expect(trimChangesMedia(10, { startSec: 0, endSec: 10 })).toBe(false);
    expect(trimChangesMedia(10, { startSec: 0.04, endSec: 10 })).toBe(false);
    expect(trimChangesMedia(10, { startSec: 0, endSec: 9.9 })).toBe(true);
    expect(trimChangesMedia(10, { startSec: 0.1, endSec: 10 })).toBe(true);
  });
});
