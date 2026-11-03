import path from 'node:path';

export type StandingPhotoBuffers = {
  subjectId: string;
  standing: Partial<
    Record<'F' | 'LL' | 'RL', { png?: Uint8Array | null } | undefined>
  >;
};

const STANDING_CODES = ['F', 'LL', 'RL'] as const;

function hasAllPosturePhotos(subject: StandingPhotoBuffers): boolean {
  return STANDING_CODES.every((code) => {
    const png = subject.standing[code]?.png;
    return !!png && png.byteLength > 0;
  });
}

/**
 * Photos are stored under the subject id used when they were captured.
 * Editing the id afterwards must still find those photos.
 * If several other subjects have a full set, do not guess.
 */
export function subjectWithPosturePhotos<T extends StandingPhotoBuffers>(
  subjects: Iterable<T>,
  subjectId: string,
): T | null {
  const list = [...subjects];
  const requested = subjectId.trim();
  const direct = list.find((s) => s.subjectId === requested);
  if (direct && hasAllPosturePhotos(direct)) return direct;
  const ready = list.filter(hasAllPosturePhotos);
  if (ready.length === 1) return ready[0];
  return null;
}

export type OpenFolderDialogResult = {
  canceled: boolean;
  filePaths: string[];
};

/**
 * A macOS directory dialog can hand back a file path when files are also
 * allowed. Use that file's parent folder. A cancelled dialog or an empty
 * selection is no folder.
 */
export function resolveChosenFolder(
  result: OpenFolderDialogResult,
  isDirectory: (candidate: string) => boolean,
): string | null {
  if (result.canceled) return null;
  const picked = result.filePaths.find((p) => p.trim());
  if (!picked) return null;
  if (isDirectory(picked)) return picked;
  const parent = path.dirname(picked);
  if (parent !== picked && isDirectory(parent)) return parent;
  return null;
}
