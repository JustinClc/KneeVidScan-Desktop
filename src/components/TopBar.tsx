import logo from '../../assets/branding/kneevidscan.png';
import { useLocale } from '../lib/useLocale';
import { Stepper } from './Stepper';
import type { ScreenId } from '../lib/steps';
import type { SessionFlow } from '../state/SessionContext';

export function TopBar({
  screen,
  flow,
}: {
  screen: ScreenId;
  flow: SessionFlow;
}) {
  const { t } = useLocale();
  return (
    <div className="topbar">
      <div className="logo">
        <img className="app-logo" src={logo} alt="" />
        {t('KneeVidScan-Desktop')}
      </div>
      {flow === 'record' && screen !== 2 ? <Stepper current={screen} /> : null}
    </div>
  );
}
