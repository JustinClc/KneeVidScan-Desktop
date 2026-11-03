import { viewSuffix } from './roles';

export { CAM_MAX, roleLabelForIndex } from './roles';

export const STEPS = [
  'Health questionnaire',
  'Standing photos',
  'Sit-to-stand Test',
  'Sit-to-stand recording review',
  'Pose estimation',
  'Final report',
] as const;

/** Home is screen 0; the capture workflow uses the remaining screens. */
export type ScreenId = 0 | 1 | 2 | 4 | 5 | 6 | 7 | 8;

export const STEP_SCREENS: ScreenId[] = [1, 4, 5, 6, 7, 8];

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
