import { t } from '../lib/locale';
import { useLocale } from '../lib/useLocale';
import { STEPS, STEP_SCREENS, type ScreenId } from '../lib/steps';

export function Stepper({
  current,
  steps = STEPS,
  screens = STEP_SCREENS,
}: {
  current: ScreenId;
  steps?: readonly string[];
  screens?: readonly ScreenId[];
}) {
  useLocale();
  const currentIndex = screens.indexOf(current);
  return (
    <div className="stepper" data-testid="stepper">
      {steps.map((name, i) => {
        let cls = 'step';
        if (i === currentIndex) cls += ' active';
        else if (currentIndex > i) cls += ' done';
        return (
          <span key={name} style={{ display: 'contents' }}>
            {i > 0 && <span style={{ color: '#D1D5DB', fontSize: 10 }}>·</span>}
            <span className={cls}>
              {i + 1} {t(name)}
            </span>
          </span>
        );
      })}
    </div>
  );
}
