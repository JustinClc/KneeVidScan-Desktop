import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveChosenFolder, subjectWithPosturePhotos } from './saveFolder';

const dirs = new Set(['/data/Chan', '/data']);

describe('resolveChosenFolder', () => {
  const isDirectory = (candidate: string) => dirs.has(candidate);

  it('uses a chosen directory as the folder', () => {
    expect(
      resolveChosenFolder(
        { canceled: false, filePaths: ['/data/Chan'] },
        isDirectory,
      ),
    ).toBe('/data/Chan');
  });

  it('uses the parent when the dialog returns a file', () => {
    expect(
      resolveChosenFolder(
        { canceled: false, filePaths: ['/data/Chan/photo.png'] },
        isDirectory,
      ),
    ).toBe('/data/Chan');
  });

  it('returns null when the dialog is cancelled or empty', () => {
    expect(
      resolveChosenFolder(
        { canceled: true, filePaths: ['/data/Chan'] },
        isDirectory,
      ),
    ).toBeNull();
    expect(
      resolveChosenFolder({ canceled: false, filePaths: [] }, isDirectory),
    ).toBeNull();
    expect(
      resolveChosenFolder(
        { canceled: false, filePaths: [path.join('missing', 'file.png')] },
        isDirectory,
      ),
    ).toBeNull();
  });
});

const png = (n: number) => new Uint8Array(n);

describe('subjectWithPosturePhotos', () => {
  it('uses the subject id the photos were stored under when the form id has none', () => {
    const stored = {
      subjectId: 'UG0001',
      standing: {
        F: { png: png(8) },
        LL: { png: png(8) },
        RL: { png: png(8) },
      },
    };
    const edited = {
      subjectId: 'UG0002',
      standing: {},
    };
    expect(subjectWithPosturePhotos([edited, stored], 'UG0002')).toBe(stored);
  });

  it('keeps the requested subject when that id already has the three photos', () => {
    const stored = {
      subjectId: 'UG0001',
      standing: {
        F: { png: png(8) },
        LL: { png: png(8) },
        RL: { png: png(8) },
      },
    };
    expect(subjectWithPosturePhotos([stored], 'UG0001')).toBe(stored);
  });

  it('does not guess when two other subjects both have photos', () => {
    const a = {
      subjectId: 'UG0001',
      standing: {
        F: { png: png(4) },
        LL: { png: png(4) },
        RL: { png: png(4) },
      },
    };
    const b = {
      subjectId: 'UG0003',
      standing: {
        F: { png: png(4) },
        LL: { png: png(4) },
        RL: { png: png(4) },
      },
    };
    expect(subjectWithPosturePhotos([a, b], 'UG0002')).toBeNull();
  });

  it('returns null when no subject has all three photos', () => {
    expect(
      subjectWithPosturePhotos(
        [{ subjectId: 'UG0001', standing: { F: { png: png(8) } } }],
        'UG0002',
      ),
    ).toBeNull();
  });
});
