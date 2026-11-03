import { describe, expect, it } from 'vitest';
import {
  computeSharedStart,
  isWithinSkew,
  maxSkewMs,
  shouldAutoStop,
  TRIAL_MAX_SECONDS,
} from './sync';

describe('shared start sync', () => {
  it('emits a shared start_at with lead time and 3 min max', () => {
    const now = 1_000_000;
    const signal = computeSharedStart('tr_1', 'gait01', now, 400);
    expect(signal.startAtMs).toBe(now + 400);
    expect(signal.maxDurationMs).toBe(TRIAL_MAX_SECONDS * 1000);
  });

  it('allows ≤5 frames skew', () => {
    const start = 5_000;
    const skew = maxSkewMs();
    expect(isWithinSkew(start, start)).toBe(true);
    expect(isWithinSkew(start + Math.floor(skew), start)).toBe(true);
    expect(isWithinSkew(start + Math.ceil(skew) + 1, start)).toBe(false);
  });

  it('auto-stops at 3 minutes', () => {
    expect(shouldAutoStop(179)).toBe(false);
    expect(shouldAutoStop(180)).toBe(true);
  });
});
