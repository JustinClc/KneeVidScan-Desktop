import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Capture } from './Capture';
import type { SittingCheck } from '../lib/sitToStand';

const mock = vi.hoisted(() => ({
  onCheck: undefined as ((check: SittingCheck) => void) | undefined,
  camera: -1,
  session: {} as Record<string, any>,
  client: {
    createTrial: vi.fn(),
    armTrial: vi.fn(),
    startTrial: vi.fn(),
    cancelTrial: vi.fn(),
    stopTrial: vi.fn(),
    setRecordingQuality: vi.fn(),
    getRecordingQuality: vi.fn(),
    requestLinkProbes: vi.fn(),
    setLivePoseMode: vi.fn(),
  },
}));
vi.mock('../lib/backendClient', () => ({ backendClient: mock.client }));
vi.mock('../components/CamFeed', () => ({
  CamGrid: (props: any) => {
    mock.onCheck = props.onSittingCheck;
    mock.camera = props.sittingCameraIndex;
    return <div data-testid="cam-grid" />;
  },
}));
vi.mock('../components/CameraPairingButton', () => ({
  CameraPairingButton: () => <button>Pair</button>,
}));
vi.mock('../state/SessionContext', () => ({ useSession: () => mock.session }));

function Harness() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [activeTrialId, setActiveTrialId] = useState<string | null>(null);
  const [activeStartAtMs, setActiveStartAtMs] = useState<number | null>(null);
  Object.assign(mock.session, {
    recording,
    setRecording,
    elapsed,
    setElapsed,
    activeTrialId,
    setActiveTrialId,
    activeStartAtMs,
    setActiveStartAtMs,
  });
  return <Capture />;
}
const ready: SittingCheck = { ready: true, message: 'Ready' };
async function check(value = ready) {
  await act(async () => mock.onCheck?.(value));
}
async function advanceWithPose(ms: number) {
  for (let n = 0; n < ms; n += 200) {
    await check();
    await act(async () => vi.advanceTimersByTimeAsync(Math.min(200, ms - n)));
  }
}
async function proceed() {
  await act(async () => fireEvent.click(screen.getByTestId('capture-proceed')));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mock.onCheck = undefined;
  mock.session = {
    screen: 5,
    camCount: 2,
    devices: [],
    connectedImus: [],
    usbCameraErrors: {},
    hasImus: false,
    trialName: 'gait01',
    trialRecords: [],
    poseOn: false,
    setTrialName: vi.fn(),
    setPoseOn: vi.fn(),
    recordTrial: vi.fn(),
    go: vi.fn(),
    showToast: vi.fn(),
  };
  mock.client.createTrial.mockResolvedValue({ trial_id: 'trial1' });
  mock.client.armTrial.mockResolvedValue({ ok: true });
  mock.client.startTrial.mockImplementation(async () => ({
    start_signal: { startAtMs: Date.now() + 5000, maxDurationMs: 20000 },
  }));
  mock.client.cancelTrial.mockResolvedValue({ ok: true });
  mock.client.stopTrial.mockResolvedValue({ ok: true });
  mock.client.getRecordingQuality.mockResolvedValue(null);
  mock.client.setRecordingQuality.mockResolvedValue(null);
  mock.client.setLivePoseMode.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe('automatic sit-to-stand recording', () => {
  it('opens with instructions and removes manual trial/start/stop controls', async () => {
    render(<Harness />);
    expect(screen.getByTestId('sit-instruction-video')).toBeInTheDocument();
    expect(screen.queryByTestId('cam-grid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('capture-trial-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('capture-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('capture-stop')).not.toBeInTheDocument();
    await proceed();
    expect(
      screen.queryByTestId('sit-instruction-video'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('cam-grid')).toBeInTheDocument();
    expect(mock.camera).toBe(1);
    expect(mock.client.startTrial).not.toHaveBeenCalled();
  });
  it('counts down five seconds, records twenty seconds and opens review', async () => {
    render(<Harness />);
    await proceed();
    await check();
    expect(mock.client.startTrial).toHaveBeenCalledWith('trial1', {
      leadMs: 5000,
      maxDurationMs: 20000,
    });
    expect(screen.getByTestId('capture-countdown')).toHaveTextContent('5');
    expect(screen.queryByTestId('capture-stop')).not.toBeInTheDocument();
    await advanceWithPose(4800);
    expect(screen.getByTestId('capture-countdown')).toHaveTextContent('1');
    await advanceWithPose(200);
    expect(screen.queryByTestId('capture-countdown')).not.toBeInTheDocument();
    expect(screen.getByTestId('capture-stop')).toHaveTextContent(
      'Stop recording',
    );
    await act(async () => vi.advanceTimersByTimeAsync(20000));
    expect(mock.client.stopTrial).toHaveBeenCalledTimes(1);
    expect(mock.session.recordTrial).toHaveBeenCalledWith(
      expect.objectContaining({ durationSec: 20 }),
    );
    expect(mock.session.go).toHaveBeenCalledWith(6);
  });
  it('cancels and resets when posture fails during countdown', async () => {
    render(<Harness />);
    await proceed();
    await check();
    await advanceWithPose(2000);
    await check({ ready: false, message: 'Outside frame' });
    expect(mock.client.cancelTrial).toHaveBeenCalledWith('trial1');
    expect(mock.session.recordTrial).not.toHaveBeenCalled();
    expect(mock.session.go).not.toHaveBeenCalled();
    expect(screen.queryByTestId('capture-countdown')).not.toBeInTheDocument();
    await check();
    expect(screen.getByTestId('capture-countdown')).toHaveTextContent('5');
  });
  it('cancels a countdown when preview detections become stale', async () => {
    render(<Harness />);
    await proceed();
    await check();
    await act(async () => vi.advanceTimersByTimeAsync(1600));
    expect(mock.client.cancelTrial).toHaveBeenCalledWith('trial1');
    expect(mock.session.recordTrial).not.toHaveBeenCalled();
  });
  it('continues recording when the person stands, and supports early stop', async () => {
    render(<Harness />);
    await proceed();
    await check();
    await advanceWithPose(5000);
    await check({ ready: false, message: 'Standing' });
    expect(mock.client.cancelTrial).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    await act(async () => fireEvent.click(screen.getByTestId('capture-stop')));
    expect(mock.session.recordTrial).toHaveBeenCalledWith(
      expect.objectContaining({ durationSec: 3 }),
    );
    expect(mock.session.go).toHaveBeenCalledWith(6);
  });
  it('cancels a pending preparation if the subject moves before arming finishes', async () => {
    let release!: () => void;
    mock.client.armTrial.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    render(<Harness />);
    await proceed();
    await check();
    await check({ ready: false, message: 'Moved' });
    await act(async () => release());
    expect(mock.client.startTrial).not.toHaveBeenCalled();
    expect(mock.client.cancelTrial).toHaveBeenCalledWith('trial1');
  });
  it('uses the only camera in a single-camera session', async () => {
    mock.session.camCount = 1;
    render(<Harness />);
    await proceed();
    expect(mock.camera).toBe(0);
  });
  it('blocks starting while the pairing screen is visible', async () => {
    const view = render(<Harness />);
    await proceed();
    mock.session.screen = 2;
    view.rerender(<Harness />);
    await check();
    expect(mock.client.createTrial).not.toHaveBeenCalled();
  });
  it('does not duplicate starts while cameras are preparing', async () => {
    let release!: () => void;
    mock.client.armTrial.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    render(<Harness />);
    await proceed();
    await check();
    await check();
    await check();
    expect(mock.client.createTrial).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(mock.client.startTrial).toHaveBeenCalledTimes(1);
  });
  it('cancels preparation when the page unmounts', async () => {
    let release!: () => void;
    mock.client.armTrial.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const view = render(<Harness />);
    await proceed();
    await check();
    view.unmount();
    await act(async () => release());
    expect(mock.client.startTrial).not.toHaveBeenCalled();
    expect(mock.client.cancelTrial).toHaveBeenCalledWith('trial1');
  });
  it('keeps the trial available for retry if stopping fails', async () => {
    mock.client.stopTrial.mockRejectedValueOnce(
      new Error('Temporary backend error'),
    );
    render(<Harness />);
    await proceed();
    await check();
    await advanceWithPose(5000);
    await act(async () => fireEvent.click(screen.getByTestId('capture-stop')));
    expect(mock.session.go).not.toHaveBeenCalled();
    expect(mock.session.recordTrial).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByTestId('capture-control-retry')),
    );
    expect(mock.session.go).toHaveBeenCalledWith(6);
    expect(mock.client.stopTrial).toHaveBeenCalledTimes(2);
  });

  it('automatically increments names for additional tests', async () => {
    mock.session.trialRecords = [{ name: 'gait01' }];
    render(<Harness />);
    await proceed();
    await check();
    expect(mock.client.createTrial).toHaveBeenCalledWith('gait02');
  });
});
