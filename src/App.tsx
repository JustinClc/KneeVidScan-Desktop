import { TopBar } from './components/TopBar';
import { Toast } from './components/Toast';
import { Cover } from './screens/Cover';
import { NewSession } from './screens/NewSession';
import { Pair } from './screens/Pair';
import { Subject } from './screens/Subject';
import { Capture } from './screens/Capture';
import { Review } from './screens/Review';
import { Pose } from './screens/Pose';
import { UploadMedia } from './screens/UploadMedia';
import { SessionProvider, useSession } from './state/SessionContext';

function Shell() {
  const { screen, flow, toast } = useSession();

  return (
    <div className="app-shell" data-testid="app-shell">
      <TopBar screen={screen} flow={flow} />
      {screen === 0 && <Cover />}
      {screen === 1 && <NewSession />}
      {screen === 2 && <Pair />}
      {screen === 4 && <Subject />}
      {screen === 5 && <Capture />}
      {screen === 6 && <Review />}
      {screen === 7 && <Pose />}
      {screen === 9 && <UploadMedia />}
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
