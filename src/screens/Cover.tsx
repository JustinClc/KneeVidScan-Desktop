import { CameraPairingButton } from '../components/CameraPairingButton';
import logo from '../../assets/branding/kneevidscan.png';
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
          <img className="cover-logo" src={logo} alt="KneeVidScan logo" />
          <h1>{t('KneeVidScan-Desktop')}</h1>
          <p className="sub">{t('Record and analyse motion')}</p>
          <p className="cover-sub">
            {t(
              'Complete the questionnaire, take standing photos, record trials, then run pose estimation.',
            )}
          </p>
        </div>
        <div className="cover-actions">
          <button
            type="button"
            className="btn btn-primary cover-start"
            data-testid="cover-start-recording"
            onClick={() => {
              setFlow('record');
              go(1);
            }}
          >
            {t('Start Assessment')}
          </button>
          <CameraPairingButton
            testId="home-pair-cameras"
            className="btn btn-secondary cover-pair"
          />
        </div>
      </div>
    </section>
  );
}
