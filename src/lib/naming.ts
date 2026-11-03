/**
 * File naming helpers — spaces → hyphens; non-ASCII kept as typed.
 * Single-cam: no view suffix. Multi-cam: _F / _L / _O.
 * Standing posture PNGs: …_standing_F / _LL / _RL.png
 */
import { viewSuffix } from './roles';

export type StandingCode = 'F' | 'LL' | 'RL';

/** Locked capture order for standing posture (frontal cam only). */
export const STANDING_SEQUENCE: readonly StandingCode[] = [
  'F',
  'LL',
  'RL',
] as const;

export function hyphenateName(name: string): string {
  return name.trim().replace(/\s+/g, '-');
}

export function subjectBase(subjectId: string, displayName: string): string {
  const id = subjectId.trim() || 'NOID';
  return `${id}_${hyphenateName(displayName)}`;
}

/** Subject info written beside the posture photos. */
export function subjectInfoFileName(
  subjectId: string,
  displayName: string,
): string {
  return `${subjectBase(subjectId, displayName)}_subject.csv`;
}

/**
 * One path segment for a trial subfolder.
 * Spaces become hyphens. Slashes are removed so the name cannot escape the subject folder.
 */
/**
 * Next capture name after "Record another video".
 * A trailing trial counter increments by 1 and keeps its zero-padding
 * (`Gait01` → `Gait02`, `Trial009` → `Trial010`). Names with no trailing
 * digits stay as typed (`walk`, `Gait01-left`).
 */
export function incrementTrialName(name: string): string {
  const trimmed = name.trim();
  const match = /^(.*?)(\d+)$/.exec(trimmed);
  if (!match) return name;
  const prefix = match[1] ?? '';
  const digits = match[2] ?? '';
  const next = (BigInt(digits) + 1n).toString();
  const padded =
    next.length < digits.length ? next.padStart(digits.length, '0') : next;
  return `${prefix}${padded}`;
}

export function trialFolderSlug(trialName: string): string {
  const slug = trialName.trim().replace(/\s+/g, '-').replace(/[\\/]/g, '');
  if (!slug || slug === '.' || slug === '..') return 'gait01';
  return slug;
}

/** Subject folder plus one trial subfolder. Separator follows the root path. */
export function joinSaveFolder(root: string, child: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const base = root.replace(/[\\/]+$/, '');
  return `${base}${sep}${child}`;
}

export function standingFileName(
  subjectId: string,
  displayName: string,
  code: StandingCode,
): string {
  return `${subjectBase(subjectId, displayName)}_standing_${code}.png`;
}

/** Uncropped original kept beside the guide-frame crop. */
export function standingFullFileName(
  subjectId: string,
  displayName: string,
  code: StandingCode,
): string {
  return `${subjectBase(subjectId, displayName)}_standing_${code}_full.png`;
}

export function recordingFileBase(
  subjectId: string,
  displayName: string,
  trialName: string,
  camCount: number,
  camIndex: number,
): string {
  const view = viewSuffix(camCount, camIndex);
  return `${subjectBase(subjectId, displayName)}_${trialName.trim() || 'gait01'}${view}`;
}

/** Original video filename (no overlay). Single-cam has no view suffix. */
export function recordingVideoFileName(
  subjectId: string,
  displayName: string,
  trialName: string,
  camCount: number,
  camIndex: number,
): string {
  return `${recordingFileBase(subjectId, displayName, trialName, camCount, camIndex)}.mp4`;
}

/**
 * IMU CSV filename — only written when an IMU backend exists.
 * Columns (future): `timestamp`, then connected channels via
 * `imuCsvHeaderColumns` in `./imu` (e.g. `FemurL_ax` … `TibiaR_gz`).
 */
export function imuCsvFileName(
  subjectId: string,
  displayName: string,
  trialName: string,
): string {
  return `${subjectBase(subjectId, displayName)}_${trialName.trim() || 'gait01'}_IMU.csv`;
}

export type PoseFileFormat = 'csv2d' | 'csv3d' | 'trc' | 'json';

/** Pose export basename. Overlay is never applied. */
export function poseExportFileName(
  subjectId: string,
  displayName: string,
  trialName: string,
  camCount: number,
  camIndex: number,
  format: PoseFileFormat,
): string {
  const base = recordingFileBase(
    subjectId,
    displayName,
    trialName,
    camCount,
    camIndex,
  );
  if (format === 'csv2d') return `${base}_pose2d.csv`;
  if (format === 'csv3d') return `${base}_pose3d.csv`;
  if (format === 'trc') return `${base}_pose3d.trc`;
  return `${base}_pose.json`;
}
