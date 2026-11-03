import { useLocale } from '../lib/useLocale';
import { useSession } from '../state/SessionContext';
import { LeaveButton } from './LeaveButton';

/** One consistent camera-settings entry point, including the guarded capture exit. */
export function CameraPairingButton({
  testId,
  className = 'btn btn-secondary',
  busy = false,
  confirmText = '',
  beforeLeave,
  disabled = false,
}: {
  testId: string;
  className?: string;
  busy?: boolean;
  confirmText?: string;
  beforeLeave?: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const { camCount } = useSession();
  const { t } = useLocale();
  return (
    <LeaveButton
      label={t('Pair cameras')}
      target={2}
      testId={testId}
      className={`${className} camera-pairing-button`}
      busy={busy}
      confirmText={confirmText}
      beforeLeave={beforeLeave}
      disabled={disabled}
      suffix={
        camCount === 0 ? (
          <span className="camera-warning" title={t('No camera paired')}>
            <span className="camera-warning-icon" aria-hidden="true">
              !
            </span>
            <span>{t('No camera paired')}</span>
          </span>
        ) : undefined
      }
    />
  );
}
