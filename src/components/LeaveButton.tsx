import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ScreenId } from '../lib/steps';
import { useLocale } from '../lib/useLocale';
import { useSession } from '../state/SessionContext';

type LeaveGroupValue = {
  openId: string | null;
  setOpenId: (id: string | null) => void;
};

const LeaveGroupContext = createContext<LeaveGroupValue | null>(null);

/** Keeps a single inline confirm open among the leave buttons inside it. */
export function LeaveGroup({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <LeaveGroupContext.Provider value={{ openId, setOpenId }}>
      {children}
    </LeaveGroupContext.Provider>
  );
}

export function LeaveButton({
  label,
  target,
  busy,
  confirmText,
  beforeLeave,
  testId,
  className = 'btn btn-ghost',
  suffix,
  disabled = false,
}: {
  label: string;
  target: ScreenId;
  busy: boolean;
  confirmText: string;
  beforeLeave?: () => void | Promise<void>;
  testId: string;
  className?: string;
  suffix?: ReactNode;
  disabled?: boolean;
}) {
  const { go, openCameraPairing } = useSession();
  const { t } = useLocale();
  const group = useContext(LeaveGroupContext);
  const [localOpen, setLocalOpen] = useState(false);
  const open = group ? group.openId === testId : localOpen;

  const setOpen = (next: boolean) => {
    if (group) group.setOpenId(next ? testId : null);
    else setLocalOpen(next);
  };

  const navigate = () => (target === 2 ? openCameraPairing() : go(target));
  const leave = () => {
    setOpen(false);
    const pending = beforeLeave?.();
    if (pending instanceof Promise) {
      void pending.then(navigate);
      return;
    }
    navigate();
  };

  if (open) {
    return (
      <div className="slot-confirm" data-testid={`${testId}-confirm`}>
        <small>{confirmText ? t(confirmText) : confirmText}</small>
        <div>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            data-testid={`${testId}-leave`}
            onClick={leave}
          >
            {t('Leave')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            data-testid={`${testId}-stay`}
            onClick={() => setOpen(false)}
          >
            {t('Stay')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      className={className}
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={() => {
        if (busy) setOpen(true);
        else leave();
      }}
    >
      {t(label)}
      {suffix}
    </button>
  );
}
