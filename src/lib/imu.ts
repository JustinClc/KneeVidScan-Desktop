/**
 * IMU UI slots + future `_IMU.csv` naming helpers.
 *
 * Phase 5 is UI-only: operators can “pair” any subset of 1–4 slots in the
 * session. BLE, clock sync, resample, CSV write, and playback are deferred.
 *
 * When a backend lands, Save writes one CSV:
 *   `[subjectID]_[subject-name]_[recording]_IMU.csv`
 * with `timestamp` first, then all connected sensors’ channels
 * (e.g. `FemurL_ax` … `TibiaR_gz`).
 */

export const IMU_SLOT_IDS = [
  'femurL',
  'femurR',
  'tibiaL',
  'tibiaR',
] as const;

export type ImuSlotId = (typeof IMU_SLOT_IDS)[number];

/** Display labels (Open Design parity). */
export const IMU_SLOT_LABELS: Record<ImuSlotId, string> = {
  femurL: 'Femur L',
  femurR: 'Femur R',
  tibiaL: 'Tibia L',
  tibiaR: 'Tibia R',
};

/** Channel prefix used in `_IMU.csv` column names. */
export const IMU_CHANNEL_PREFIX: Record<ImuSlotId, string> = {
  femurL: 'FemurL',
  femurR: 'FemurR',
  tibiaL: 'TibiaL',
  tibiaR: 'TibiaR',
};

/** Accel + gyro axes per sensor (future CSV columns after timestamp). */
export const IMU_AXES = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'] as const;
export type ImuAxis = (typeof IMU_AXES)[number];

export type ImuSlot = {
  id: ImuSlotId;
  label: string;
  channelPrefix: string;
};

export const IMU_SLOTS: readonly ImuSlot[] = IMU_SLOT_IDS.map((id) => ({
  id,
  label: IMU_SLOT_LABELS[id],
  channelPrefix: IMU_CHANNEL_PREFIX[id],
}));

/** Ordered labels for the given connected subset (UI chrome). */
export function imuLabelsForSlots(
  slots: readonly ImuSlotId[],
): readonly string[] {
  return IMU_SLOTS.filter((s) => slots.includes(s.id)).map((s) => s.label);
}

/** Channel names for connected slots only — e.g. `FemurL_ax`, `TibiaR_gz`. */
export function imuChannelNames(slots: readonly ImuSlotId[]): string[] {
  const ordered = IMU_SLOT_IDS.filter((id) => slots.includes(id));
  const names: string[] = [];
  for (const id of ordered) {
    const prefix = IMU_CHANNEL_PREFIX[id];
    for (const axis of IMU_AXES) {
      names.push(`${prefix}_${axis}`);
    }
  }
  return names;
}

/**
 * Future `_IMU.csv` header: timestamp first, then connected channels.
 * Naming only — do not write this file until the IMU backend exists.
 */
export function imuCsvHeaderColumns(slots: readonly ImuSlotId[]): string[] {
  return ['timestamp', ...imuChannelNames(slots)];
}

export function isImuSlotId(value: string): value is ImuSlotId {
  return (IMU_SLOT_IDS as readonly string[]).includes(value);
}

export function toggleImuSlot(
  current: readonly ImuSlotId[],
  id: ImuSlotId,
): ImuSlotId[] {
  if (current.includes(id)) {
    return IMU_SLOT_IDS.filter((s) => s !== id && current.includes(s));
  }
  return IMU_SLOT_IDS.filter((s) => s === id || current.includes(s));
}
