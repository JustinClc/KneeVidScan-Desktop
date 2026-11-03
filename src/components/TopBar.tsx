import { Stepper } from './Stepper';
import { UPLOAD_STEP_SCREENS, UPLOAD_STEPS, type ScreenId } from '../lib/steps';
import type { SessionFlow } from '../state/SessionContext';

export function TopBar({
  screen,
  flow,
}: {
  screen: ScreenId;
  flow: SessionFlow;
}) {
  const uploadRail =
    flow === 'upload' &&
    (UPLOAD_STEP_SCREENS as readonly ScreenId[]).includes(screen);
  return (
    <div className="topbar">
      <div className="logo">
        Motus<span>Cap</span> <em className="lite">Lite</em>
      </div>
      {flow === 'record' ? <Stepper current={screen} /> : null}
      {uploadRail ? (
        <Stepper
          current={screen}
          steps={UPLOAD_STEPS}
          screens={UPLOAD_STEP_SCREENS}
        />
      ) : null}
    </div>
  );
}
