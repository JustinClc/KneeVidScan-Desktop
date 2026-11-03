import { useEffect } from 'react';
import { useLocale } from './lib/useLocale';
import { TopBar } from './components/TopBar';
import { Toast } from './components/Toast';
import { Cover } from './screens/Cover';
import { NewSession } from './screens/NewSession';
import { Pair } from './screens/Pair';
import { Subject } from './screens/Subject';
import { Capture } from './screens/Capture';
import { Review } from './screens/Review';
import { Pose } from './screens/Pose';
import { FinalReport } from './screens/FinalReport';
import { SessionProvider, useSession } from './state/SessionContext';

function Shell() {
  const { screen, flow, toast, pairingReturnScreen } = useSession();
  const assessmentScreen = screen === 2 ? pairingReturnScreen : screen;
  const { locale, t } = useLocale();

  useEffect(() => {
    document.title = t('KneeVidScan-Desktop');
  }, [locale, t]);

  return (
    <div className="app-shell" data-testid="app-shell">
      <TopBar screen={screen} flow={flow} />
      <div
        className="assessment-route"
        hidden={screen === 2}
        inert={screen === 2}
      >
        {assessmentScreen === 0 && <Cover />}
        {assessmentScreen === 1 && <NewSession />}
        {assessmentScreen === 4 && <Subject />}
        {assessmentScreen === 5 && <Capture />}
        {assessmentScreen === 6 && <Review />}
        {assessmentScreen === 7 && <Pose />}
        {assessmentScreen === 8 && <FinalReport />}
      </div>
      {screen === 2 && <Pair />}
      <Toast message={toast} />
    </div>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}

export default App;
