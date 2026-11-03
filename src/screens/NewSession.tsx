import { t } from '../lib/locale';
import { useLocale } from '../lib/useLocale';
import { useSession } from '../state/SessionContext';

const RECENT = [
  { title: 'Clinic A — knee rehab', meta: '2 cameras · 6 trials · Oct 17' },
  { title: 'Home pilot — sit-to-stand', meta: '1 camera · 3 trials · Oct 15' },
  {
    title: 'Lab session — balance',
    meta: '3 cameras · 2 IMUs · 8 trials · Oct 12',
  },
  { title: 'Demo — squat form', meta: '2 cameras · 4 trials · Oct 9' },
];

export function NewSession() {
  const {
    sessionName,
    sessionNotes,
    setSessionName,
    setSessionNotes,
    go,
    setFlow,
    showToast,
  } = useSession();
  useLocale();

  return (
    <section
      className="screen active"
      data-screen="1"
      data-testid="screen-session"
    >
      <div className="content fill-page">
        <div>
          <h1>{t('New Session')}</h1>
          <p className="sub" style={{ margin: 0 }}>
            {t('Name this capture session, or reopen a recent one.')}
          </p>
        </div>
        <div className="fill-cols" style={{ gridTemplateColumns: '1.1fr 1fr' }}>
          <div className="card fcol form-gap">
            <div className="block-title" style={{ margin: 0 }}>
              {t('Create a session')}
            </div>
            <div>
              <label className="field">{t('Session name')}</label>
              <input
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
              />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <label className="field">{t('Notes (optional)')}</label>
              <textarea
                style={{ flex: 1, minHeight: 120 }}
                placeholder={t('Location, protocol, operator…')}
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
              />
            </div>
            <div className="next-up">
              <b>{t('Next steps')}</b>
              <span>
                {t(
                  'Pair 1–3 cameras (IMUs optional) → Subject & standing posture → Capture → Review → Pose results',
                )}
              </span>
            </div>
            <div className="actions" style={{ marginTop: 0 }}>
              <button
                className="btn btn-ghost"
                type="button"
                data-testid="session-home"
                onClick={() => {
                  setFlow('home');
                  go(0);
                }}
              >
                {t('Home')}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  showToast(
                    t('Session “{name}” created', {
                      name: sessionName || t('Untitled'),
                    }),
                  );
                  go(2);
                }}
              >
                {t('Create session')}
              </button>
            </div>
          </div>
          <div className="card fcol">
            <div className="block-title">
              {t('Recent sessions')}{' '}
              <span className="badge" style={{ marginLeft: 8 }}>
                {t('Sample')}
              </span>
            </div>
            <div className="recent-list">
              {RECENT.map((r) => (
                <button
                  key={r.title}
                  className="recent"
                  type="button"
                  onClick={() => {
                    setSessionName(r.title);
                    go(2);
                  }}
                >
                  <b>{t(r.title)}</b>
                  <span>{t(r.meta)}</span>
                </button>
              ))}
            </div>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => go(2)}
              style={{
                width: '100%',
                justifyContent: 'center',
                marginTop: 12,
              }}
            >
              {t('Open existing session…')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
