import { useState } from 'react';
import { t } from '../lib/locale';
import { standingComplete } from '../lib/posture';
import { useLocale } from '../lib/useLocale';
import { useSession } from '../state/SessionContext';

const NEW_SUBJECT_CONFIRM =
  "Start a new subject profile? This clears the previous subject's details, standing photos, folder, and trials from this session. Photos already saved to a folder stay on disk.";

/** Live-recording reset. Hidden until frontal and both lateral photos are accepted. */
export function NewSubjectButton({
  beforeStart,
}: {
  beforeStart?: () => void;
}) {
  useLocale();
  const { capturedStanding, startNewSubject } = useSession();
  const [open, setOpen] = useState(false);
  if (!standingComplete(capturedStanding)) return null;

  return (
    <>
      <button
        className="btn btn-primary"
        type="button"
        data-testid="new-subject"
        onClick={() => setOpen(true)}
      >
        {t('+ New Subject')}
      </button>
      {open ? (
        <div
          className="folder-choice"
          role="dialog"
          aria-modal="true"
          data-testid="new-subject-dialog"
        >
          <div className="folder-choice-card">
            <p>{t(NEW_SUBJECT_CONFIRM)}</p>
            <div className="actions">
              <button
                className="btn btn-primary"
                type="button"
                data-testid="new-subject-confirm"
                onClick={() => {
                  setOpen(false);
                  beforeStart?.();
                  startNewSubject();
                }}
              >
                {t('Start new subject')}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                data-testid="new-subject-cancel"
                onClick={() => setOpen(false)}
              >
                {t('Cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
