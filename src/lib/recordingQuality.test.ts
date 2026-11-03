import { describe, expect, it } from 'vitest';
import {
  RECORDING_PRESETS,
  TARGET_MIN_FPS,
  estimateFps,
  recommendPreset,
  resolvePreset,
  type LinkProbeSample,
} from './recordingQuality';

const strong: LinkProbeSample = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  uploadBytesPerSec: 2_000_000,
};
const weak: LinkProbeSample = {
  width: 1920,
  height: 1080,
  frameRate: 24,
  uploadBytesPerSec: 80_000,
};

describe('recordingQuality', () => {
  it('defines paired bitrates for each preset', () => {
    expect(RECORDING_PRESETS['1080p'].videoBitsPerSecond).toBe(6_000_000);
    expect(RECORDING_PRESETS['720p'].videoBitsPerSecond).toBe(3_500_000);
    expect(RECORDING_PRESETS['480p'].videoBitsPerSecond).toBe(1_750_000);
  });

  it('estimates higher fps for lower presets on a weak link', () => {
    expect(estimateFps('480p', weak)).toBeGreaterThan(
      estimateFps('1080p', weak),
    );
  });

  it('recommends the highest preset that clears TARGET_MIN_FPS for every phone', () => {
    expect(recommendPreset([strong])).toBe('1080p');
    expect(recommendPreset([strong, weak])).toBe('480p');
    expect(recommendPreset([])).toBe('720p');
  });

  it('keeps the highest preset when a <30 fps camera caps every preset equally', () => {
    const cam24: LinkProbeSample = { ...strong, frameRate: 24 };
    expect(estimateFps('1080p', cam24)).toBe(24);
    expect(estimateFps('480p', cam24)).toBe(24);
    expect(recommendPreset([cam24])).toBe('1080p');
  });

  it('drops resolution below the target only when it buys frames', () => {
    expect(recommendPreset([weak])).toBe('480p');
  });

  it('resolvePreset honors explicit mode over auto', () => {
    expect(resolvePreset('480p', [strong])).toBe('480p');
    expect(resolvePreset('auto', [strong])).toBe(recommendPreset([strong]));
  });

  it('keeps TARGET_MIN_FPS at 30', () => {
    expect(TARGET_MIN_FPS).toBe(30);
  });
});
