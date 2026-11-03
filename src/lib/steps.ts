import { viewSuffix } from './roles';

export { CAM_MAX, roleLabelForIndex } from './roles';

export const STEPS = [
  'New Session',
  'Pair',
  'Subject',
  'Capture',
  'Review',
  'Pose estimation',
] as const;

/**
 * Screen ids. 0 is Cover (home). 9 is the upload portal.
 * Record steps keep the Open Design ids (no space-calibration step).
 * Upload Review and Pose reuse screens 6 and 7.
 */
export type ScreenId = 0 | 1 | 2 | 4 | 5 | 6 | 7 | 8 | 9;

/** Record path only. Cover and the upload portal are not on this rail. */
export const STEP_SCREENS: ScreenId[] = [1, 2, 4, 5, 6, 7];

/** Upload path. Review and Pose share the record screens. */
export const UPLOAD_STEPS = ['Upload', 'Review', 'Pose'] as const;

export const UPLOAD_STEP_SCREENS: ScreenId[] = [9, 6, 7];

export const VIEW_ROLES = [
  'Frontal View',
  'Lateral View (right)',
  'Additional view',
] as const;

export const CAM_PHONES = ['iPhone 15', 'iPhone 14', 'iPhone 13'] as const;

/** @deprecated Prefer `IMU_SLOTS` / `IMU_SLOT_LABELS` from `./imu`. */
export const IMU_SENSORS = [
  'Femur L',
  'Femur R',
  'Tibia L',
  'Tibia R',
] as const;

export function camViewLabel(camCount: number, index: number): string {
  if (camCount < 2) return `Cam ${index + 1}`;
  return `Cam ${index + 1} · ${VIEW_ROLES[index]}`;
}

export function viewCode(camCount: number, index: number): string {
  return viewSuffix(camCount, index);
}
