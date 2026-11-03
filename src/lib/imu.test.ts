import { describe, expect, it } from 'vitest';
import {
  IMU_SLOT_IDS,
  imuChannelNames,
  imuCsvHeaderColumns,
  imuLabelsForSlots,
  toggleImuSlot,
} from './imu';
import { imuCsvFileName } from './naming';

describe('imu UI slots + future CSV naming', () => {
  it('exposes four Open Design slots in order', () => {
    expect(IMU_SLOT_IDS).toEqual(['femurL', 'femurR', 'tibiaL', 'tibiaR']);
    expect(imuLabelsForSlots([...IMU_SLOT_IDS])).toEqual([
      'Femur L',
      'Femur R',
      'Tibia L',
      'Tibia R',
    ]);
  });

  it('supports any subset and preserves canonical order', () => {
    expect(imuLabelsForSlots(['tibiaR', 'femurL'])).toEqual([
      'Femur L',
      'Tibia R',
    ]);
    expect(toggleImuSlot([], 'femurL')).toEqual(['femurL']);
    expect(toggleImuSlot(['femurL', 'tibiaL'], 'femurL')).toEqual(['tibiaL']);
    expect(toggleImuSlot(['femurL'], 'tibiaR')).toEqual(['femurL', 'tibiaR']);
  });

  it('builds _IMU.csv channel names: timestamp then connected axes', () => {
    expect(imuCsvFileName('UG0001', 'Chan Tai Man', 'gait01')).toBe(
      'UG0001_Chan-Tai-Man_gait01_IMU.csv',
    );
    expect(imuChannelNames(['femurL', 'tibiaR'])).toEqual([
      'FemurL_ax',
      'FemurL_ay',
      'FemurL_az',
      'FemurL_gx',
      'FemurL_gy',
      'FemurL_gz',
      'TibiaR_ax',
      'TibiaR_ay',
      'TibiaR_az',
      'TibiaR_gx',
      'TibiaR_gy',
      'TibiaR_gz',
    ]);
    expect(imuCsvHeaderColumns(['femurL'])).toEqual([
      'timestamp',
      'FemurL_ax',
      'FemurL_ay',
      'FemurL_az',
      'FemurL_gx',
      'FemurL_gy',
      'FemurL_gz',
    ]);
    // Empty subset → header is timestamp only (no channels to write yet).
    expect(imuCsvHeaderColumns([])).toEqual(['timestamp']);
  });
});
