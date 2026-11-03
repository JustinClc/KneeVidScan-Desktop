import type { ImuSlotId } from '../lib/imu';
import { imuLabelsForSlots } from '../lib/imu';
import { t } from '../lib/locale';
import { useLocale } from '../lib/useLocale';

type Props = {
  /** Connected IMU slots only — empty chrome, no fake traces. */
  slots: readonly ImuSlotId[];
};

/** Empty live IMU charts for Capture — no fake waveforms until backend. */
export function EmptyImuLive({ slots }: Props) {
  useLocale();
  const labels = imuLabelsForSlots(slots);
  if (labels.length === 0) return null;
  return (
    <>
      {labels.map((name) => (
        <div className="imu-sensor" key={name} data-testid="imu-live-empty">
          <h3>{t(name)}</h3>
          <div
            className="imu-chart imu-chart-empty"
            style={{
              minHeight: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
              fontSize: 12,
              border: '1px dashed var(--border)',
              borderRadius: 8,
            }}
          >
            {t('No signal yet · backend later')}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Empty Review IMU traces for connected slots only.
 * No parked playhead / fake scrubbed waveforms on empty panels.
 */
export function EmptyImuTraces({ slots }: Props) {
  useLocale();
  const labels = imuLabelsForSlots(slots);
  if (labels.length === 0) return null;
  return (
    <>
      {labels.map((name) => (
        <div className="imu-trace" key={name} data-testid="imu-trace-empty">
          <span className="trace-tag">{t(name)}</span>
          <div
            className="trace-canvas"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
              fontSize: 12,
              height: '100%',
            }}
          >
            {t('No recording yet')}
          </div>
          {/* Playhead omitted until IMU backend — parked % looks fake. */}
        </div>
      ))}
    </>
  );
}
