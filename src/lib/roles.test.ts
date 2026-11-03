import { describe, expect, it } from 'vitest';
import {
  CAM_MAX,
  canPairMore,
  nextPairingSlot,
  roleLabelForIndex,
  viewCodeForIndex,
  viewSuffix,
} from './roles';

describe('roles', () => {
  it('enforces max 3 cameras', () => {
    expect(canPairMore(0)).toBe(true);
    expect(canPairMore(2)).toBe(true);
    expect(canPairMore(3)).toBe(false);
    expect(nextPairingSlot(3)).toBeNull();
    expect(CAM_MAX).toBe(3);
  });

  it('assigns F/L/O for multi-cam and null for single-cam', () => {
    expect(viewCodeForIndex(1, 0)).toBeNull();
    expect(viewSuffix(1, 0)).toBe('');
    expect(viewCodeForIndex(2, 0)).toBe('F');
    expect(viewCodeForIndex(2, 1)).toBe('L');
    expect(viewCodeForIndex(3, 2)).toBe('O');
    expect(viewSuffix(3, 0)).toBe('_F');
    expect(viewSuffix(3, 1)).toBe('_L');
    expect(viewSuffix(3, 2)).toBe('_O');
  });

  it('labels Cam2 as lateral right', () => {
    expect(roleLabelForIndex(2, 1)).toContain('right');
    expect(roleLabelForIndex(1, 0)).toContain('single camera');
  });
});
