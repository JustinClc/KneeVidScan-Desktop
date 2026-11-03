import { useLocale } from '../lib/useLocale';
import { useSession } from '../state/SessionContext';

const LOCALE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'zh-Hans', label: '简体中文' },
] as const;

export function Cover() {
  const { go, setFlow } = useSession();
  const { locale, setLocale, t } = useLocale();

  return (
    <section
      className="screen active"
      data-screen="0"
      data-testid="screen-cover"
    >
      <div className="cover">
        <label className="locale-picker">
          <span className="sr-only">{t('Locale')}</span>
          <select
            data-testid="locale-select"
            aria-label={t('Locale')}
            value={locale}
            onChange={(e) =>
              setLocale(e.target.value as 'en' | 'zh-Hant' | 'zh-Hans')
            }
          >
            {LOCALE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="cover-intro">
          <h1>MotusCap Lite</h1>
          <p className="sub">{t('Motion capture for lab sessions')}</p>
        </div>
        <div className="cover-grid">
          <article className="cover-card">
            <div className="cover-icon" aria-hidden="true">
              ◎
            </div>
            <h2>{t('Record and analyse motion')}</h2>
            <p className="cover-sub">
              {t(
                'Pair cameras, take standing postures, record trials, then run pose estimation.',
              )}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="cover-start-recording"
              onClick={() => {
                setFlow('record');
                go(1);
              }}
            >
              {t('Start recording')}
            </button>
          </article>
          <article className="cover-card">
            <div className="cover-icon" aria-hidden="true">
              ⬆
            </div>
            <h2>{t('Upload an existing MP4')}</h2>
            <p className="cover-sub">
              {t(
                'Import one motion video for pose analysis without a live capture.',
              )}
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="cover-upload-media"
              onClick={() => {
                setFlow('upload');
                go(9);
              }}
            >
              {t('Upload media')}
            </button>
          </article>
        </div>
      </div>
    </section>
  );
}
