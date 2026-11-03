import { describe, expect, it } from 'vitest';
import { transferPercent } from './uploadStatus';

describe('transferPercent', () => {
  it('splits WebM between upload (80%) and MP4 conversion (20%)', () => {
    expect(
      transferPercent({
        status: 'uploading',
        bytes: 50,
        totalBytes: 100,
        filename: 'a.webm',
      }),
    ).toBe(40);
    expect(
      transferPercent({
        status: 'converting',
        bytes: 100,
        convertProgress: 0.5,
        filename: 'a.webm',
      }),
    ).toBe(90);
  });

  it('gives an MP4 upload the whole bar', () => {
    expect(
      transferPercent({
        status: 'uploading',
        bytes: 50,
        totalBytes: 100,
        filename: 'a.mp4',
      }),
    ).toBe(50);
  });

  it('stays below 100% until ready, and is unknown without a size', () => {
    expect(
      transferPercent({
        status: 'uploading',
        bytes: 100,
        totalBytes: 100,
        filename: 'a.mp4',
      }),
    ).toBe(99);
    expect(
      transferPercent({ status: 'uploading', bytes: 5, filename: 'a.mp4' }),
    ).toBeNull();
    expect(
      transferPercent({ status: 'recording', bytes: 0, filename: '' }),
    ).toBe(0);
    expect(
      transferPercent({ status: 'ready', bytes: 9, filename: 'a.mp4' }),
    ).toBe(100);
    expect(
      transferPercent({ status: 'failed', bytes: 0, filename: 'a.mp4' }),
    ).toBeNull();
    expect(transferPercent(undefined)).toBeNull();
  });
});
