import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
  act,
} from '@testing-library/react';
import { App } from './App';

const { mockClient, devices, resetMock, uploads, pairingPublicBases } =
  vi.hoisted(() => {
    const devices: Array<{
      device_id: string;
      name: string;
      cam_index: number;
      view_code: 'F' | 'L' | 'O' | null;
    }> = [];

    let pairingId = 0;
    /** `publicBase` passed to each createPairing call, in order. */
    const pairingPublicBases: Array<string | undefined> = [];
    let trialSeq = 0;
    let recordingQualityState = {
      mode: 'auto' as const,
      resolved: '720p' as const,
      previewEnabled: true,
      recommendation: '720p' as const,
      estimates: { '1080p': 28, '720p': 32, '480p': 34 },
      probes: 0,
    };
    /** deviceId → upload status the mock trial reports (default: ready). */
    const uploads = new Map<
      string,
      {
        status:
          | 'recording'
          | 'uploading'
          | 'converting'
          | 'ready'
          | 'failed'
          | 'cleared';
        bytes: number;
        totalBytes?: number;
        convertProgress?: number;
        filename: string;
        error?: string;
      }
    >();
    let activePairing: {
      id: string;
      code: string;
      qr_url: string;
      expires_at: number;
      reserved_index: number;
      replace_device_id: string | null;
      status: string;
    } | null = null;

    const recomputeViews = () => {
      const n = devices.length;
      for (let i = 0; i < n; i++) {
        devices[i].cam_index = i;
        devices[i].view_code =
          n === 1 ? null : ((['F', 'L', 'O'] as const)[i] ?? null);
      }
    };

    const mockClient = {
      setBaseUrl: () => {},
      baseUrl: () => 'http://127.0.0.1:9',
      health: async () => ({ ok: true }),
      session: async () => ({
        devices: [],
        pendingPairing: undefined,
        info: null,
        trialMaxSeconds: 180,
      }),
      createPairing: async (publicBase?: string, replaceDeviceId?: string) => {
        pairingPublicBases.push(publicBase);
        const replaceIdx = replaceDeviceId
          ? devices.findIndex((d) => d.device_id === replaceDeviceId)
          : -1;
        if (replaceIdx < 0 && devices.length >= 3) {
          throw new Error('Maximum of 3 cameras reached');
        }
        pairingId += 1;
        activePairing = {
          id: `dp_${pairingId}`,
          code: `MCAP-T${pairingId}`,
          qr_url: publicBase
            ? `${publicBase}/pwa/?api=${publicBase}&device_pairing_id=dp_${pairingId}&device_pairing_code=MCAP-T${pairingId}`
            : `http://127.0.0.1:9/pwa/?api=http://127.0.0.1:9&device_pairing_id=dp_${pairingId}&device_pairing_code=MCAP-T${pairingId}`,
          expires_at: Date.now() + 60_000,
          reserved_index: replaceIdx >= 0 ? replaceIdx : devices.length,
          replace_device_id: replaceIdx >= 0 ? replaceDeviceId! : null,
          status: 'pending',
        };
        return activePairing;
      },
      getPairing: async () => ({
        id: activePairing?.id ?? '',
        status: activePairing?.status ?? 'cancelled',
        device: null,
      }),
      cancelPairing: async () => {
        activePairing = null;
        return { ok: true };
      },
      mockComplete: async () => {
        if (!activePairing) throw new Error('No active pairing QR');
        const replaceIdx = activePairing.replace_device_id
          ? devices.findIndex(
              (d) => d.device_id === activePairing!.replace_device_id,
            )
          : -1;
        if (replaceIdx < 0 && devices.length >= 3) {
          throw new Error('Maximum of 3 cameras reached');
        }
        const cam_index = replaceIdx >= 0 ? replaceIdx : devices.length;
        const fresh = {
          device_id: `dev_${pairingId}`,
          name: `Mock Cam ${pairingId}`,
          cam_index,
          view_code: null,
        };
        if (replaceIdx >= 0) devices[replaceIdx] = fresh;
        else devices.push(fresh);
        recomputeViews();
        activePairing = null;
        const last = devices[cam_index];
        return {
          device_id: last.device_id,
          cam_index: last.cam_index,
          view_code: last.view_code,
          devices: [...devices],
        };
      },
      listDevices: async () => ({ devices: [...devices] }),
      removeDevice: async (id: string) => {
        const idx = devices.findIndex((d) => d.device_id === id);
        if (idx < 0) throw new Error('Not found');
        devices.splice(idx, 1);
        recomputeViews();
        return { ok: true };
      },
      previews: async () => ({ previews: [] }),
      previewUrl: (id: string) => `http://127.0.0.1:9/v1/devices/${id}/preview`,
      uploadUrl: (id: string, trialId: string) =>
        `http://127.0.0.1:9/v1/devices/${id}/trials/${trialId}/upload`,
      createTrial: async (name: string) => {
        trialSeq += 1;
        return {
          trial_id: `tr_${trialSeq}`,
          name,
          phase: 'idle',
        };
      },
      importMedia: async (_input: {
        trialName: string;
        filename: string;
        bytes: Uint8Array;
        trialId?: string;
        fresh?: boolean;
      }): Promise<{
        ok: true;
        trial_id: string;
        name: string;
        duration_sec: number | null;
        device_id: string;
        cam_index: number;
        view_code: 'F' | 'L' | 'O' | null;
        filename: string;
        bytes: number;
        devices: Array<{
          device_id: string;
          name: string;
          cam_index: number;
          view_code: 'F' | 'L' | 'O' | null;
        }>;
      }> => {
        throw new Error('unexpected import');
      },
      armTrial: async () => ({ ok: true }),
      // Countdown tests override this; by default recording starts at once.
      startTrial: async () => ({
        ok: true,
        start_signal: {
          trialId: `tr_${trialSeq}`,
          trialName: 'gait01',
          startAtMs: Date.now(),
          maxDurationMs: 180_000,
        },
      }),
      stopTrial: async () => ({ ok: true }),
      cancelTrial: async () => ({ ok: true }),
      deleteRecordings: async () => ({ ok: true }),
      trimTrial: async (
        _id: string,
        _window: { startSec: number; endSec: number },
      ): Promise<{
        ok: boolean;
        start_sec: number;
        end_sec: number;
        duration_sec: number;
        views: number;
      }> => {
        throw new Error('unexpected trim');
      },
      revertTrial: async (
        _id: string,
      ): Promise<{ ok: boolean; views: number; duration_sec: number }> => {
        throw new Error('unexpected revert');
      },
      listTrials: async () => ({ trials: [] }),
      getTrial: async (id: string) => ({
        trial_id: id,
        phase: 'done',
        uploads: Object.fromEntries(
          devices.map((d) => [
            d.device_id,
            uploads.get(d.device_id) ?? {
              status: 'ready' as const,
              bytes: 4,
              filename: 'x.mp4',
            },
          ]),
        ),
      }),
      fetchUpload: async (): Promise<Uint8Array | null> =>
        new Uint8Array([0, 0, 0, 0x18]),
      listSubjects: async () => ({ subjects: [] }),
      getSubject: async () => {
        throw new Error('Not found');
      },
      upsertSubject: async (body: { subjectId: string }) => ({
        subject_id: body.subjectId,
        subject_name: '',
        height_cm: '',
        weight_kg: '',
      }),
      saveStandingPng: async (_id: string, code: string, filename: string) => ({
        ok: true,
        code,
        filename,
        bytes: 68,
      }),
      saveStandingCapture: async (
        _id: string,
        code: string,
        _shot: {
          filename: string;
          croppedPng: Uint8Array;
          fullFilename: string;
          fullPng: Uint8Array;
        },
      ) => ({ ok: true, code }),
      getStandingPng: async () => Uint8Array.from([137, 80, 78, 71, 1]),
      standingDemo: async (body: {
        subjectId: string;
        subjectName?: string;
      }) => ({
        ok: true,
        files: (['F', 'LL', 'RL'] as const).map(
          (c) =>
            `${body.subjectId}_${(body.subjectName || 'X').replace(/\s+/g, '-')}_standing_${c}_annotated.png`,
        ),
      }),
      setStandingMode: async (_id: string, active: boolean) => ({
        ok: true,
        active,
      }),
      requestStill: async () => ({ ok: true }),
      fetchStill: async (): Promise<
        import('./lib/backendClient').StillResult
      > => ({ state: 'pending' }),
      nextPreview: async (
        _id: string,
        _after: number,
        _signal?: AbortSignal,
      ): Promise<{ blob: Blob; at: number } | null> => null,
      setLivePoseMode: async (_id: string, active: boolean) => ({
        ok: true,
        active,
      }),
      fetchPreviewBytes: async () => null,
      publishLocale: async (locale: string) => ({ locale, ready: true }),
      getRecordingQuality: async () => ({
        ...recordingQualityState,
        probes: devices.length,
      }),
      setRecordingQuality: async (partial: {
        mode?: typeof recordingQualityState.mode;
        previewEnabled?: boolean;
      }) => {
        if (partial.mode !== undefined) {
          recordingQualityState = {
            ...recordingQualityState,
            mode: partial.mode,
            resolved:
              partial.mode === 'auto'
                ? recordingQualityState.recommendation
                : partial.mode,
          };
        }
        if (partial.previewEnabled !== undefined) {
          recordingQualityState = {
            ...recordingQualityState,
            previewEnabled: partial.previewEnabled,
          };
        }
        return {
          ...recordingQualityState,
          probes: devices.length,
        };
      },
      requestLinkProbes: async () => ({
        ...recordingQualityState,
        probes: devices.length,
      }),
    };

    const resetMock = () => {
      devices.length = 0;
      uploads.clear();
      activePairing = null;
      pairingId = 0;
      pairingPublicBases.length = 0;
      trialSeq = 0;
      recordingQualityState = {
        mode: 'auto',
        resolved: '720p',
        previewEnabled: true,
        recommendation: '720p',
        estimates: { '1080p': 28, '720p': 32, '480p': 34 },
        probes: 0,
      };
    };

    return { mockClient, devices, resetMock, uploads, pairingPublicBases };
  });

vi.mock('./lib/backendClient', () => ({
  backendClient: mockClient,
}));

const liveModel = vi.hoisted(() => ({
  current: null as null | {
    detect: (img: unknown) => Array<{ x: number; y: number }> | null;
  },
}));

// No WASM in CI — Subject falls back to manual Capture now.
vi.mock('./lib/standingReview', () => ({
  standingReviewUrl: () => 'data:image/png;base64,cmV2aWV3',
}));

vi.mock('./lib/mediapipePose', () => ({
  loadStandingLandmarker: async () => null,
  loadLiveLandmarker: async () => liveModel.current,
}));

// App-level workflow tests inject detector results; the gate and timing are
// exercised separately in Capture.test.tsx and sitToStand.test.ts.
const captureGate = vi.hoisted(() => ({
  onCheck: undefined as
    | undefined
    | ((check: import('./lib/sitToStand').SittingCheck) => void),
}));
vi.mock('./components/CamFeed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/CamFeed')>();
  return {
    ...actual,
    CamGrid: (props: React.ComponentProps<typeof actual.CamGrid>) => {
      captureGate.onCheck = props.onSittingCheck;
      return <actual.CamGrid {...props} onSittingCheck={undefined} />;
    },
  };
});

describe('KneeVidScan-Desktop Phase 1 shell', () => {
  beforeEach(() => {
    resetMock();
    window.motuscapLite = {
      saveQuestionnaire: async () => ({
        ok: true as const,
        folder: '/tmp/motuscap-lite-save',
      }),
      chooseSaveFolder: async () => '/tmp/motuscap-lite-save',
      writeSaveFiles: async (folder, files) => ({
        ok: true,
        folder,
        written: files.map((f) => f.filename),
      }),
      readSaveFile: async () => null,
      getBackendInfo: async () => ({
        apiBase: 'http://127.0.0.1:9',
        pwaBase: 'http://127.0.0.1:9/pwa/',
        https: false,
        lanHost: '127.0.0.1',
        port: 9,
      }),
      backendUrl: 'http://127.0.0.1:9',
      platform: 'linux',
    };
  });

  async function finishPostures() {
    const demo = document.querySelector(
      '[data-testid="subject-demo-complete"]',
    );
    if (!(demo instanceof HTMLElement)) {
      throw new Error('subject-demo-complete is missing');
    }
    fireEvent.click(demo);
  }

  async function completeQuestionnaire() {
    const form = screen.getByTestId('screen-session');
    for (const [label, value] of [
      ['Name/SID', 'UG0001'],
      ['Age', '45'],
      ['Height (m)', '1.72'],
      ['Weight (kg)', '68'],
    ]) {
      fireEvent.change(within(form).getByLabelText(label), {
        target: { value },
      });
    }
    for (const group of within(form).getAllByRole('group')) {
      fireEvent.click(within(group).getAllByRole('radio')[0]);
    }
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Submit' }));
    });
  }

  async function continueFromPair() {
    fireEvent.click(screen.getByTestId('pair-continue'));
    if (screen.queryByTestId('screen-cover'))
      fireEvent.click(screen.getByTestId('cover-start-recording'));
    if (screen.queryByTestId('screen-session')) await completeQuestionnaire();
  }

  function renderPairApp() {
    const view = render(<App />);
    fireEvent.click(screen.getByTestId('home-pair-cameras'));
    return view;
  }

  async function goToSubject(cams = 1) {
    renderPairApp();
    await waitFor(() =>
      expect(screen.getByTestId('screen-pair')).toBeInTheDocument(),
    );
    for (let i = 0; i < cams; i++) {
      fireEvent.click(screen.getByTestId('pair-next'));
      await waitFor(() =>
        expect(screen.getByTestId('pair-simulate')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId('pair-simulate'));
      await waitFor(() =>
        expect(screen.queryByTestId('qr-box')).not.toBeInTheDocument(),
      );
    }
    await continueFromPair();
    expect(screen.getByTestId('screen-subject')).toBeInTheDocument();
  }

  async function goToCapture(cams = 1) {
    await goToSubject(cams);
    await finishPostures();
    await waitFor(() =>
      expect(screen.getByTestId('subject-continue')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('subject-continue'));

    await waitFor(() =>
      expect(screen.getByTestId('screen-capture')).toBeInTheDocument(),
    );
    await showCapturePreview();
  }

  async function showCapturePreview() {
    const proceed = screen.queryByTestId('capture-proceed');
    if (proceed) await act(async () => fireEvent.click(proceed));
  }

  async function startCapture() {
    await showCapturePreview();
    await act(async () =>
      captureGate.onCheck?.({ ready: true, message: 'Position ready.' }),
    );
  }

  it('opens on Home with assessment and camera buttons and a no-camera warning', () => {
    render(<App />);
    const home = within(screen.getByTestId('screen-cover'));
    expect(
      home.getByRole('heading', { name: 'KneeVidScan-Desktop' }),
    ).toBeInTheDocument();
    expect(home.getByRole('img', { name: 'KneeVidScan logo' })).toHaveAttribute(
      'src',
      expect.stringContaining('kneevidscan.png'),
    );
    expect(home.getByRole('button', { name: 'Start Assessment' })).toBe(
      screen.getByTestId('cover-start-recording'),
    );
    expect(home.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByTestId('home-pair-cameras')).toHaveTextContent(
      '!No camera paired',
    );
    expect(home.queryByText('Upload an existing MP4')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cover-upload-media')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stepper')).not.toBeInTheDocument();
    expect(screen.queryByTestId('screen-session')).not.toBeInTheDocument();
  });

  it('keeps the Cover Locale on the next screen and after a remount', () => {
    const { unmount } = render(<App />);
    const select = screen.getByTestId('locale-select');
    expect(select).toHaveValue('en');
    expect(select).toHaveTextContent('English');
    expect(select).toHaveTextContent('繁體中文');
    expect(select).toHaveTextContent('简体中文');
    fireEvent.change(select, { target: { value: 'zh-Hant' } });
    expect(screen.getByTestId('cover-start-recording')).toHaveTextContent(
      '開始',
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '膝關照-桌面版',
    );
    expect(document.title).toBe('膝關照-桌面版');
    expect(document.querySelector('.topbar .logo')).toHaveTextContent(
      '膝關照-桌面版',
    );
    fireEvent.click(screen.getByTestId('cover-start-recording'));
    expect(screen.getByTestId('stepper')).toHaveTextContent('健康問卷');
    unmount();
    render(<App />);
    expect(screen.getByTestId('locale-select')).toHaveValue('zh-Hant');
    expect(screen.getByTestId('cover-start-recording')).toHaveTextContent(
      '開始',
    );
    fireEvent.change(screen.getByTestId('locale-select'), {
      target: { value: 'zh-Hans' },
    });
    expect(screen.getByTestId('cover-start-recording')).toHaveTextContent(
      '开始',
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '膝關照-桌面版',
    );
    fireEvent.change(screen.getByTestId('locale-select'), {
      target: { value: 'en' },
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'KneeVidScan-Desktop',
    );
    expect(document.title).toBe('KneeVidScan-Desktop');
  });

  it('Start opens the questionnaire without cameras and pairing is outside the stepper', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('cover-start-recording'));
    expect(screen.getByTestId('screen-session')).toBeInTheDocument();
    expect(screen.queryByTestId('screen-cover')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('stepper').querySelector('.step.active'),
    ).toHaveTextContent('1 Health questionnaire');
    expect(screen.getByTestId('stepper')).not.toHaveTextContent('Pair cameras');
    expect(screen.getByTestId('questionnaire-pair-cameras')).toHaveTextContent(
      'No camera paired',
    );
    expect(screen.queryByTestId('screen-pair')).not.toBeInTheDocument();
    await completeQuestionnaire();
    expect(screen.getByTestId('screen-subject')).toBeInTheDocument();
    expect(screen.getByTestId('subject-continue')).toBeDisabled();
    expect(
      screen.queryByTestId('standing-capture-now'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('subject-back-pairing')).toHaveTextContent(
      'No camera paired',
    );
  });

  it('returns to Home from camera settings even when no cameras are connected', () => {
    renderPairApp();
    expect(screen.queryByTestId('stepper')).not.toBeInTheDocument();
    expect(screen.getByTestId('pair-continue')).toHaveTextContent('Done');
    expect(screen.getByTestId('pair-continue')).toBeEnabled();
    fireEvent.click(screen.getByTestId('pair-continue'));
    expect(screen.getByTestId('screen-cover')).toBeInTheDocument();
    expect(screen.getByTestId('home-pair-cameras')).toHaveTextContent(
      'No camera paired',
    );
  });

  it('keeps cameras and assessment details when returning to Home and the questionnaire', async () => {
    await goToSubject();
    fireEvent.click(screen.getByTestId('subject-back-pairing'));
    expect(screen.getByTestId('screen-pair')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pair-home'));
    expect(screen.getByTestId('screen-cover')).toBeInTheDocument();
    expect(screen.getByTestId('home-pair-cameras')).not.toHaveTextContent(
      'No camera paired',
    );
    fireEvent.click(screen.getByTestId('cover-start-recording'));
    expect(screen.getByLabelText('Name/SID')).toHaveValue('UG0001');
    fireEvent.click(screen.getByTestId('questionnaire-pair-cameras'));
    expect(screen.getByTestId('pair-summary')).toHaveTextContent(
      '1 camera ready',
    );
    fireEvent.click(screen.getByTestId('pair-continue'));
    expect(screen.getByTestId('screen-session')).toBeInTheDocument();
    expect(screen.getByLabelText('Height (m)')).toHaveValue('1.72');
    expect(
      screen.getByTestId('questionnaire-pair-cameras'),
    ).not.toHaveTextContent('No camera paired');
  });

  it('preserves a partially completed questionnaire and the no-camera warning through camera settings', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('cover-start-recording'));
    fireEvent.change(screen.getByLabelText('Name/SID'), {
      target: { value: 'Draft P001' },
    });
    fireEvent.change(screen.getByLabelText('Height (m)'), {
      target: { value: '1.65' },
    });
    const form = screen.getByTestId('screen-session');
    fireEvent.click(screen.getByTestId('questionnaire-pair-cameras'));
    expect(form).not.toBeVisible();
    expect(screen.getByTestId('screen-pair')).toBeVisible();
    expect(screen.queryByTestId('stepper')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pair-continue'));
    expect(screen.getByTestId('screen-session')).toBe(form);
    expect(form).toBeVisible();
    expect(screen.getByLabelText('Name/SID')).toHaveValue('Draft P001');
    expect(screen.getByLabelText('Height (m)')).toHaveValue('1.65');
    expect(screen.getByTestId('questionnaire-pair-cameras')).toHaveTextContent(
      'No camera paired',
    );
  });

  it('suspends standing capture while visiting settings and keeps the accepted photos', async () => {
    await goToSubject();
    await finishPostures();
    await waitFor(() =>
      expect(screen.getByTestId('standing-step-RL')).toHaveAttribute(
        'data-state',
        'done',
      ),
    );
    const subject = screen.getByTestId('screen-subject');
    fireEvent.click(screen.getByTestId('subject-back-pairing'));
    expect(subject).not.toBeVisible();
    fireEvent.click(screen.getByTestId('pair-continue'));
    expect(screen.getByTestId('screen-subject')).toBe(subject);
    expect(subject).toBeVisible();
    for (const code of ['F', 'LL', 'RL'])
      expect(screen.getByTestId(`standing-step-${code}`)).toHaveAttribute(
        'data-state',
        'done',
      );
  });

  it('shows the warning again after the last camera is removed and returns to standing photos', async () => {
    await goToSubject();
    expect(screen.getByTestId('subject-back-pairing')).not.toHaveTextContent(
      'No camera paired',
    );
    fireEvent.click(screen.getByTestId('subject-back-pairing'));
    fireEvent.click(screen.getByTestId('cam-remove-0'));
    fireEvent.click(screen.getByTestId('cam-remove-yes-0'));
    await waitFor(() =>
      expect(screen.getByTestId('pair-summary')).toHaveTextContent(
        '0 cameras ready',
      ),
    );
    fireEvent.click(screen.getByTestId('pair-continue'));
    expect(screen.getByTestId('screen-subject')).toBeVisible();
    expect(screen.getByTestId('subject-back-pairing')).toHaveTextContent(
      'No camera paired',
    );
    expect(
      screen.queryByTestId('standing-capture-now'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('subject-back-questionnaire'));
    expect(screen.getByTestId('screen-session')).toBeVisible();
    fireEvent.click(screen.getByTestId('session-home'));
    expect(screen.getByTestId('screen-cover')).toBeVisible();
    expect(screen.getByTestId('home-pair-cameras')).toHaveTextContent(
      'No camera paired',
    );
  });

  it('enables Pair a device when the preload API cannot be extended', async () => {
    const api = {
      saveQuestionnaire: async () => ({
        ok: true as const,
        folder: '/tmp/motuscap-lite-save',
      }),
      chooseSaveFolder: async () => '/tmp/motuscap-lite-save',
      writeSaveFiles: async (
        folder: string,
        files: Array<{ filename: string }>,
      ) => ({
        ok: true,
        folder,
        written: files.map((f) => f.filename),
      }),
      readSaveFile: async () => null,
      getBackendInfo: async () => ({
        apiBase: 'http://127.0.0.1:9',
        pwaBase: 'http://127.0.0.1:9/pwa/',
        https: false,
        lanHost: '127.0.0.1',
        port: 9,
      }),
      platform: 'win32' as const,
    };
    Object.preventExtensions(api);
    window.motuscapLite = api;

    renderPairApp();
    await waitFor(() =>
      expect(screen.getByTestId('pair-next')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('pair-next'));
    await waitFor(() =>
      expect(screen.getByTestId('qr-box').querySelector('img')).toBeTruthy(),
    );
    expect(screen.getByAltText('Pairing QR').getAttribute('src')).toMatch(
      /^data:image\//,
    );
  });

  it('QR address switch: local by default, public URL only when chosen', async () => {
    localStorage.clear();
    try {
      renderPairApp();
      await waitFor(() =>
        expect(screen.getByTestId('pair-next')).not.toBeDisabled(),
      );
      expect(screen.getByTestId('qr-via-local')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByTestId('qr-via-summary')).toHaveTextContent(
        '127.0.0.1:9',
      );

      fireEvent.click(screen.getByTestId('qr-via-public'));
      fireEvent.change(screen.getByTestId('public-url-input'), {
        target: { value: 'https://demo.ngrok-free.app' },
      });
      expect(screen.getByTestId('qr-via-summary')).toHaveTextContent(
        'demo.ngrok-free.app',
      );
      fireEvent.click(screen.getByTestId('pair-next'));
      await waitFor(() =>
        expect(screen.getByTestId('qr-via-active')).toHaveTextContent(
          'Via public URL · demo.ngrok-free.app',
        ),
      );
      expect(pairingPublicBases.at(-1)).toBe('https://demo.ngrok-free.app');

      // Switching back keeps the saved URL but the QR goes local.
      fireEvent.click(screen.getByText('Cancel QR'));
      await waitFor(() =>
        expect(screen.getByTestId('qr-via-local')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId('qr-via-local'));
      fireEvent.click(screen.getByTestId('pair-next'));
      await waitFor(() =>
        expect(screen.getByTestId('qr-via-active')).toHaveTextContent(
          'Via local network · 127.0.0.1:9',
        ),
      );
      expect(pairingPublicBases.at(-1)).toBeUndefined();
      expect(localStorage.getItem('motuscap-lite.publicBaseUrl')).toBe(
        'https://demo.ngrok-free.app',
      );
    } finally {
      localStorage.clear();
    }
  });

  it('loads camera settings independently of the assessment stepper', async () => {
    renderPairApp();
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('stepper')).not.toBeInTheDocument();
    expect(screen.getByTestId('screen-pair')).toBeInTheDocument();
    await waitFor(() => {
      expect(window.motuscapLite?.backendUrl).toBe('http://127.0.0.1:9');
    });
  });

  it('re-pairs Cam 1 in place after confirm, even with all 3 slots used', async () => {
    renderPairApp();
    await waitFor(() =>
      expect(screen.getByTestId('pair-next')).not.toBeDisabled(),
    );
    for (let n = 1; n <= 3; n++) {
      fireEvent.click(screen.getByTestId('pair-next'));
      await waitFor(() =>
        expect(screen.getByTestId('qr-box')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId('pair-simulate'));
      await waitFor(() =>
        expect(
          screen.getByText(new RegExp(`${n} of 3 connected`)),
        ).toBeInTheDocument(),
      );
    }
    const before = devices.map((d) => d.device_id);

    fireEvent.click(screen.getByTestId('cam-repair-0'));
    expect(screen.getByTestId('cam-repair-confirm-0')).toHaveTextContent(
      'Replace Cam 1 · Frontal View?',
    );
    fireEvent.click(screen.getByTestId('cam-repair-yes-0'));
    await waitFor(() =>
      expect(screen.getByText('Scan to re-pair Cam 1')).toBeInTheDocument(),
    );
    expect(devices.map((d) => d.device_id)).toEqual(before);

    fireEvent.click(screen.getByTestId('pair-simulate'));
    await waitFor(() =>
      expect(screen.queryByTestId('qr-box')).not.toBeInTheDocument(),
    );
    expect(devices).toHaveLength(3);
    expect(devices[0].device_id).not.toBe(before[0]);
    expect(devices.slice(1).map((d) => d.device_id)).toEqual(before.slice(1));
    expect(devices.map((d) => d.view_code)).toEqual(['F', 'L', 'O']);
  });

  it('removes a paired camera from the slot next to Re-pair', async () => {
    renderPairApp();
    await waitFor(() =>
      expect(screen.getByTestId('pair-next')).not.toBeDisabled(),
    );
    for (let n = 1; n <= 2; n++) {
      fireEvent.click(screen.getByTestId('pair-next'));
      await waitFor(() =>
        expect(screen.getByTestId('qr-box')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId('pair-simulate'));
      await waitFor(() =>
        expect(
          screen.getByText(new RegExp(`${n} of 3 connected`)),
        ).toBeInTheDocument(),
      );
    }
    const before = devices.map((d) => d.device_id);

    const repairBox = screen.getByTestId('cam-repair-box-0');
    const removeBox = screen.getByTestId('cam-remove-box-0');
    expect(repairBox).toHaveTextContent('Re-pair');
    expect(removeBox).toHaveTextContent('Remove device');
    expect(repairBox.parentElement).toBe(removeBox.parentElement);
    expect(screen.getByTestId('cam-repair-box-1')).toBeInTheDocument();
    expect(screen.getByTestId('cam-remove-box-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cam-remove-0'));
    expect(screen.getByTestId('cam-remove-confirm-0')).toHaveTextContent(
      'Remove Cam 1',
    );
    fireEvent.click(screen.getByTestId('cam-remove-yes-0'));
    await waitFor(() =>
      expect(screen.getByText(/1 of 3 connected/)).toBeInTheDocument(),
    );
    expect(devices.map((d) => d.device_id)).toEqual([before[1]]);
    expect(devices[0].view_code).toBeNull();
    expect(screen.queryByTestId('cam-remove-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('cam-slot-0')).toHaveTextContent('Connected');
    expect(screen.getByTestId('cam-slot-1')).toHaveTextContent('Not paired');
  });

  it('pairs with mock QR then continues; enforces max 3', async () => {
    renderPairApp();

    await waitFor(() =>
      expect(screen.getByTestId('screen-pair')).toBeInTheDocument(),
    );

    expect(screen.getByTestId('screen-pair')).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId('backend-info')).toBeInTheDocument(),
    );

    expect(screen.getByTestId('pair-continue')).toBeEnabled();

    fireEvent.click(screen.getByTestId('pair-next'));
    await waitFor(() =>
      expect(screen.getByTestId('qr-box')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('pair-simulate'));
    await waitFor(() =>
      expect(screen.queryByTestId('qr-box')).not.toBeInTheDocument(),
    );
    expect(devices).toHaveLength(1);

    fireEvent.click(screen.getByTestId('pair-next'));
    await waitFor(() =>
      expect(screen.getByTestId('qr-box')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('pair-simulate'));
    await waitFor(() =>
      expect(screen.getByText(/2 of 3 connected/)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('pair-next'));
    await waitFor(() =>
      expect(screen.getByTestId('qr-box')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('pair-simulate'));
    await waitFor(() =>
      expect(
        screen.getByText(/Maximum of 3 cameras reached/),
      ).toBeInTheDocument(),
    );

    expect(screen.getByTestId('pair-next')).toBeDisabled();
    expect(devices.map((d) => d.view_code)).toEqual(['F', 'L', 'O']);

    await continueFromPair();
    expect(screen.getByTestId('screen-subject')).toBeInTheDocument();
  });

  it('has no subject switching or assessment completion controls before the report', async () => {
    await goToSubject();
    expect(screen.queryByTestId('new-subject')).not.toBeInTheDocument();
    await finishPostures();
    expect(screen.queryByTestId('new-subject')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('subject-continue')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('subject-continue'));

    await waitFor(() =>
      expect(screen.getByTestId('screen-capture')).toBeInTheDocument(),
    );
    await startCapture();
    await waitFor(() =>
      expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('capture-stop'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-review')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('review-proceed-pose'));
    expect(screen.getByTestId('screen-pose')).toBeInTheDocument();
    expect(screen.queryByTestId('new-subject')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('pose-complete-analysis'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /End Assessment|Complete analysis/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('Phase 2: requires Subject ID, F→LL→RL demo path, Continue gate, load-existing retake', async () => {
    renderPairApp();

    await waitFor(() =>
      expect(screen.getByTestId('screen-pair')).toBeInTheDocument(),
    );

    // Skip pairing via mock so we can open Subject
    fireEvent.click(screen.getByTestId('pair-next'));
    await waitFor(() =>
      expect(screen.getByTestId('qr-box')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('pair-simulate'));
    await waitFor(() =>
      expect(screen.queryByTestId('qr-box')).not.toBeInTheDocument(),
    );
    await continueFromPair();
    expect(screen.getByTestId('screen-subject')).toBeInTheDocument();

    // Standing is always frontal — label stays "Cam 1 · Frontal View" (even single-cam)
    expect(screen.getByTestId('standing-cam-label')).toHaveTextContent(
      'Cam 1 · Frontal View',
    );
    // Guide frame alone (no demo silhouette SVG inside)
    expect(screen.getByTestId('guide-frame').querySelector('svg')).toBeNull();

    const continueBtn = screen.getByTestId('subject-continue');
    expect(continueBtn).toBeDisabled();

    expect(
      screen.getByRole('heading', { name: 'Standing Posture Capture' }),
    ).toBeInTheDocument();
    for (const field of [
      'subject-id',
      'subject-name',
      'subject-height',
      'subject-weight',
    ]) {
      expect(screen.queryByTestId(field)).not.toBeInTheDocument();
    }
    expect(continueBtn).toHaveTextContent('Save & Continue');

    // Demo-complete path for CI (hardware-optional)
    await finishPostures();
    await waitFor(() => {
      expect(screen.getByTestId('standing-step-F')).toHaveAttribute(
        'data-state',
        'done',
      );
      expect(screen.getByTestId('standing-step-LL')).toHaveAttribute(
        'data-state',
        'done',
      );
      expect(screen.getByTestId('standing-step-RL')).toHaveAttribute(
        'data-state',
        'done',
      );
    });
    expect(screen.getByTestId('standing-prompt').textContent).toMatch(
      /face the frontal camera again/i,
    );
    expect(screen.getByTestId('standing-prompt').textContent).toMatch(
      /standing_F_annotated\.png/,
    );
    expect(screen.getByTestId('standing-prompt').textContent).toMatch(
      /standing_LL_annotated\.png/,
    );
    expect(screen.getByTestId('standing-prompt').textContent).toMatch(
      /standing_RL_annotated\.png/,
    );
    expect(screen.getByTestId('standing-prompt').textContent).toMatch(
      /Will save:/,
    );
    expect(continueBtn).not.toBeDisabled();

    const chooseSpy = vi.spyOn(window.motuscapLite!, 'chooseSaveFolder');
    const postureWrite = vi.spyOn(window.motuscapLite!, 'writeSaveFiles');
    expect(postureWrite).not.toHaveBeenCalled();
    fireEvent.click(continueBtn);
    await waitFor(() => expect(postureWrite).toHaveBeenCalled());
    expect(chooseSpy).not.toHaveBeenCalled();
    expect(postureWrite.mock.calls[0]?.[0]).toBe('/tmp/motuscap-lite-save');
    const photoFiles =
      postureWrite.mock.calls[0]?.[1]?.map((f) => f.filename) ?? [];
    expect(photoFiles).toEqual([
      'UG0001__standing_F_annotated.png',
      'UG0001__standing_F_full.png',
      'UG0001__standing_LL_annotated.png',
      'UG0001__standing_LL_full.png',
      'UG0001__standing_RL_annotated.png',
      'UG0001__standing_RL_full.png',
      'UG0001__subject.csv',
    ]);
    const csv = Buffer.from(
      postureWrite.mock.calls[0]?.[1]?.find((f) =>
        f.filename.endsWith('_subject.csv'),
      )?.base64 ?? '',
      'base64',
    ).toString('utf8');
    expect(csv).toContain('subject_id,display_name,height_cm,weight_kg');
    expect(csv).toContain('UG0001,,172,68');
    await waitFor(() =>
      expect(screen.getByTestId('screen-capture')).toBeInTheDocument(),
    );
  });

  describe('retaking accepted standing photos', () => {
    const croppedPng = Uint8Array.from([137, 80, 78, 71, 2]);
    const fullPng = Uint8Array.from([137, 80, 78, 71, 3]);

    beforeEach(async () => {
      const stillCapture = await import('./lib/standingCapture');
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 480;
      vi.spyOn(stillCapture, 'cropStillToGuide').mockResolvedValue({
        croppedPng,
        fullPng,
        canvas,
        fullWidth: 1920,
        fullHeight: 1080,
      });
      vi.spyOn(mockClient, 'fetchStill').mockResolvedValue({
        state: 'ready',
        bytes: croppedPng.slice().buffer,
        contentType: 'image/png',
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    async function takeShot() {
      await waitFor(() =>
        expect(screen.getByTestId('standing-capture-now')).toBeInTheDocument(),
      );
      vi.useFakeTimers();
      await act(async () => {
        fireEvent.click(screen.getByTestId('standing-capture-now'));
        await vi.advanceTimersByTimeAsync(3500);
      });
      vi.useRealTimers();
      expect(screen.getByTestId('standing-review')).toBeInTheDocument();
    }

    it('reopens each saved posture and cancellation keeps all photos and their export status', async () => {
      await goToCapture();
      fireEvent.click(screen.getByTestId('capture-back'));
      const save = vi.spyOn(mockClient, 'saveStandingCapture');
      for (const [code, name] of [
        ['F', 'Frontal'],
        ['LL', 'Left lateral'],
        ['RL', 'Right lateral'],
      ]) {
        expect(
          screen.getByTestId(`standing-retake-${code}`),
        ).toHaveAccessibleName(`Retake ${name} posture`);
        fireEvent.click(screen.getByTestId(`standing-retake-${code}`));
        expect(screen.getByTestId('standing-demo')).toHaveAttribute(
          'data-code',
          code,
        );
        expect(screen.getByTestId(`standing-step-${code}`)).toHaveAttribute(
          'data-state',
          'active',
        );
        expect(screen.getByTestId('standing-prompt')).toHaveTextContent(
          'The current photo is kept until you accept its replacement.',
        );
        expect(screen.getByTestId('subject-continue')).toBeDisabled();
        fireEvent.click(screen.getByTestId('standing-cancel-retake'));
        for (const kept of ['F', 'LL', 'RL']) {
          expect(screen.getByTestId(`standing-step-${kept}`)).toHaveAttribute(
            'data-state',
            'done',
          );
        }
      }
      expect(save).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('subject-continue'));
      await waitFor(() =>
        expect(screen.getByTestId('screen-capture')).toBeInTheDocument(),
      );
      expect(
        screen.queryByTestId('subject-folder-choice'),
      ).not.toBeInTheDocument();
    });

    it('replaces only the accepted posture and writes the annotated preview and clean original', async () => {
      const write = vi.spyOn(window.motuscapLite!, 'writeSaveFiles');
      await goToCapture();
      expect(write).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByTestId('capture-back'));
      const save = vi.spyOn(mockClient, 'saveStandingCapture');
      fireEvent.click(screen.getByTestId('standing-retake-LL'));
      await takeShot();
      expect(save).not.toHaveBeenCalled();

      save.mockRejectedValueOnce(new Error('Save failed'));
      await act(async () => {
        fireEvent.click(screen.getByTestId('standing-proceed'));
      });
      expect(screen.getByTestId('standing-review')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Could not save the posture: Save failed',
      );
      expect(screen.getByTestId('standing-cancel-retake')).not.toBeDisabled();

      await act(async () => {
        fireEvent.click(screen.getByTestId('standing-proceed'));
      });
      expect(save).toHaveBeenLastCalledWith('UG0001', 'LL', {
        filename: 'UG0001__standing_LL_annotated.png',
        croppedPng: new TextEncoder().encode('review'),
        fullFilename: 'UG0001__standing_LL_full.png',
        fullPng,
      });
      for (const code of ['F', 'LL', 'RL']) {
        expect(screen.getByTestId(`standing-step-${code}`)).toHaveAttribute(
          'data-state',
          'done',
        );
      }
      expect(
        screen.queryByTestId('standing-cancel-retake'),
      ).not.toBeInTheDocument();

      vi.spyOn(mockClient, 'getStandingPng').mockImplementation(
        async (...args: unknown[]) =>
          args[1] === 'LL'
            ? args[2] === 'full'
              ? fullPng
              : new TextEncoder().encode('review')
            : Uint8Array.from([137, 80, 78, 71, 1]),
      );
      fireEvent.click(screen.getByTestId('subject-continue'));

      await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
      const files = write.mock.calls[1][1];
      expect(
        files.find((file) =>
          file.filename.endsWith('_standing_LL_annotated.png'),
        )?.base64,
      ).toBe(Buffer.from('review').toString('base64'));
      expect(
        files.find((file) => file.filename.endsWith('_standing_LL_full.png'))
          ?.base64,
      ).toBe(Buffer.from(fullPng).toString('base64'));
    });

    it('keeps the accepted photo after a capture failure or cancellation during a phone request', async () => {
      await goToCapture();
      fireEvent.click(screen.getByTestId('capture-back'));
      const save = vi.spyOn(mockClient, 'saveStandingCapture');
      vi.mocked(mockClient.fetchStill).mockResolvedValueOnce({
        state: 'failed',
        error: 'Camera unavailable',
      });
      fireEvent.click(screen.getByTestId('standing-retake-F'));
      await waitFor(() =>
        expect(screen.getByTestId('standing-capture-now')).toBeInTheDocument(),
      );
      vi.useFakeTimers();
      await act(async () => {
        fireEvent.click(screen.getByTestId('standing-capture-now'));
        await vi.advanceTimersByTimeAsync(3500);
      });
      expect(screen.getByTestId('guide-status')).toHaveTextContent(
        'Camera unavailable',
      );
      fireEvent.click(screen.getByTestId('standing-retake'));
      let release = () => {};
      vi.spyOn(mockClient, 'requestStill').mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ ok: true });
          }),
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId('standing-capture-now'));
        await vi.advanceTimersByTimeAsync(3000);
      });
      fireEvent.click(screen.getByTestId('standing-cancel-retake'));
      await act(async () => {
        release();
        await vi.advanceTimersByTimeAsync(1000);
      });
      vi.useRealTimers();
      expect(screen.queryByTestId('standing-review')).not.toBeInTheDocument();
      expect(screen.getByTestId('standing-step-F')).toHaveAttribute(
        'data-state',
        'done',
      );
      expect(save).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('subject-continue'));
      await waitFor(() =>
        expect(screen.getByTestId('screen-capture')).toBeInTheDocument(),
      );
    });

    it('returns to the first missing posture after retaking an earlier accepted photo', async () => {
      await goToSubject();

      await takeShot();
      await act(async () => {
        fireEvent.click(screen.getByTestId('standing-proceed'));
      });
      expect(screen.getByTestId('standing-step-LL')).toHaveAttribute(
        'data-state',
        'active',
      );
      fireEvent.click(screen.getByTestId('standing-retake-F'));
      await takeShot();
      await act(async () => {
        fireEvent.click(screen.getByTestId('standing-proceed'));
      });
      expect(screen.getByTestId('standing-step-F')).toHaveAttribute(
        'data-state',
        'done',
      );
      expect(screen.getByTestId('standing-step-LL')).toHaveAttribute(
        'data-state',
        'active',
      );
      expect(screen.getByTestId('standing-step-RL')).toHaveAttribute(
        'data-state',
        'pending',
      );
      expect(screen.getByTestId('standing-demo')).toHaveAttribute(
        'data-code',
        'LL',
      );
      expect(screen.getByTestId('subject-continue')).toBeDisabled();
    });
  });

  it('waits for posture writing before opening Capture and prevents duplicate writes', async () => {
    await goToSubject();
    await finishPostures();
    await waitFor(() =>
      expect(screen.getByTestId('subject-continue')).not.toBeDisabled(),
    );
    let finish!: (result: {
      ok: true;
      folder: string;
      written: string[];
      missing: [];
    }) => void;
    const save = vi.fn(
      () =>
        new Promise<{
          ok: true;
          folder: string;
          written: string[];
          missing: [];
        }>((resolve) => {
          finish = resolve;
        }),
    );
    window.motuscapLite!.saveSubjectFolder = save;
    fireEvent.click(screen.getByTestId('subject-continue'));
    expect(screen.getByTestId('subject-continue')).toBeDisabled();
    fireEvent.click(screen.getByTestId('subject-continue'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('screen-subject')).toBeInTheDocument();
    await act(async () => {
      finish({
        ok: true,
        folder: '/tmp/motuscap-lite-save',
        written: [],
        missing: [],
      });
    });
    expect(screen.getByTestId('screen-capture')).toBeInTheDocument();
  });

  it('saves through the desktop folder API and opens Capture', async () => {
    const saveSubjectFolder = vi.fn(async () => ({
      ok: true as const,
      folder: '/tmp/motuscap-lite-save',
      written: ['UG0001__standing_F_annotated.png'],
      missing: [],
    }));
    window.motuscapLite!.saveSubjectFolder = saveSubjectFolder;
    const write = vi.spyOn(window.motuscapLite!, 'writeSaveFiles');
    const choose = vi.spyOn(window.motuscapLite!, 'chooseSaveFolder');
    renderPairApp();
    await waitFor(() =>
      expect(screen.getByTestId('screen-pair')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('pair-next'));
    await waitFor(() =>
      expect(screen.getByTestId('qr-box')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('pair-simulate'));
    await waitFor(() =>
      expect(screen.queryByTestId('qr-box')).not.toBeInTheDocument(),
    );
    await continueFromPair();
    await finishPostures();
    await waitFor(() =>
      expect(screen.getByTestId('subject-continue')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('subject-continue'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-capture')).toBeInTheDocument(),
    );
    expect(saveSubjectFolder).toHaveBeenCalledWith({
      subjectId: 'UG0001',
      subjectName: '',
      heightCm: '172',
      weightKg: '68',
      destination: 'existing',
      folder: '/tmp/motuscap-lite-save',
    });
    expect(choose).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps the posture photos after a write error and allows retry', async () => {
    const saveSubjectFolder = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: 'Disk full',
      })
      .mockResolvedValueOnce({
        ok: true as const,
        folder: '/tmp/motuscap-lite-save',
        written: ['UG0001__standing_F_annotated.png'],
        missing: [],
      });
    window.motuscapLite!.saveSubjectFolder = saveSubjectFolder;
    renderPairApp();
    await waitFor(() =>
      expect(screen.getByTestId('screen-pair')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('pair-next'));
    await waitFor(() =>
      expect(screen.getByTestId('qr-box')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('pair-simulate'));
    await waitFor(() =>
      expect(screen.queryByTestId('qr-box')).not.toBeInTheDocument(),
    );
    await continueFromPair();
    await finishPostures();
    await waitFor(() =>
      expect(screen.getByTestId('subject-continue')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('subject-continue'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Disk full'),
    );
    expect(screen.queryByTestId('screen-capture')).not.toBeInTheDocument();
    expect(screen.getByTestId('subject-continue')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('subject-continue'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-capture')).toBeInTheDocument(),
    );
    expect(saveSubjectFolder).toHaveBeenCalledTimes(2);
  });

  it('select existing writes the photos into the chosen folder', async () => {
    const postureWrite = vi.spyOn(window.motuscapLite!, 'writeSaveFiles');
    await goToCapture();
    expect(postureWrite.mock.calls[0]?.[0]).toBe('/tmp/motuscap-lite-save');
    const names = postureWrite.mock.calls[0]?.[1]?.map((f) => f.filename) ?? [];
    expect(names).toContain('UG0001__subject.csv');
    expect(names).toContain('UG0001__standing_F_annotated.png');
  });

  it('Phase 3: Capture → Review keeps all trials; Record another; Proceed to Pose and final report', async () => {
    await goToCapture();

    expect(screen.getByTestId('capture-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('capture-timer')).toHaveTextContent(
      '00:00 / 00:20',
    );
    expect(screen.getByTestId('capture-pose-toggle')).toBeInTheDocument();

    // Start / stop first trial
    await startCapture();
    await waitFor(() =>
      expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('capture-stop'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-review')).toBeInTheDocument(),
    );

    const picker = screen.getByTestId(
      'review-trial-picker',
    ) as HTMLSelectElement;
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['gait01']);
    expect(screen.getByTestId('review-scrubber')).toBeInTheDocument();
    expect(screen.getByTestId('review-play')).toBeInTheDocument();
    // Review: recorded videos only — no live previews or pose overlay
    expect(screen.getByTestId('review-video-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('cam-grid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pose-overlay-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('review-cam-label-0').textContent).not.toMatch(
      /·\s*[FLO]\s*$/,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('review-video-0').querySelector('video'),
      ).toHaveAttribute(
        'src',
        expect.stringMatching(/\/v1\/devices\/.+\/trials\/.+\/upload$/),
      ),
    );
    expect(screen.getByTestId('review-play')).not.toBeDisabled();

    // Record another → Capture; second trial kept in picker
    fireEvent.click(screen.getByTestId('review-record-another'));
    expect(screen.getByTestId('screen-capture')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-trial-name')).not.toBeInTheDocument();
    await startCapture();
    await waitFor(() =>
      expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('capture-stop'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-review')).toBeInTheDocument(),
    );

    const picker2 = screen.getByTestId(
      'review-trial-picker',
    ) as HTMLSelectElement;
    await waitFor(() =>
      expect(
        within(picker2)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['gait01', 'gait02']),
    );

    // Proceed to Pose even if Phase 4 is stub
    fireEvent.click(screen.getByTestId('review-proceed-pose'));
    expect(screen.getByTestId('screen-pose')).toBeInTheDocument();
    expect(screen.queryByTestId('pose-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pose-export')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pose-save-note')).not.toBeInTheDocument();
    const write = vi.spyOn(window.motuscapLite!, 'writeSaveFiles');
    // A missing upload keeps Pose open, so the operator can retry safely.
    vi.spyOn(mockClient, 'fetchUpload').mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId('pose-proceed-report'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('VIDEO NOT SAVED'),
    );
    expect(screen.queryByTestId('screen-final-report')).not.toBeInTheDocument();
    expect(screen.getByTestId('pose-proceed-report')).toBeEnabled();
    write.mockClear();
    fireEvent.click(screen.getByTestId('pose-proceed-report'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-final-report')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('assessment-report')).toHaveTextContent(
      'Example results',
    );
    expect(write.mock.calls.map(([folder]) => folder)).toEqual([
      '/tmp/motuscap-lite-save/gait01',
      '/tmp/motuscap-lite-save/gait02',
    ]);
    expect(write.mock.calls[0][1].map((file) => file.filename)).toContain(
      'UG0001__gait01.mp4',
    );
    expect(write.mock.calls[1][1].map((file) => file.filename)).toContain(
      'UG0001__gait02.mp4',
    );
    fireEvent.click(screen.getByTestId('report-back-pose'));
    expect(screen.getByTestId('screen-pose')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pose-proceed-report'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-final-report')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('report-end-assessment'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-cover')).toBeInTheDocument(),
    );
  });

  it('trims every loaded view to one shared window and replaces the uploads', async () => {
    await goToCapture(2);
    await startCapture();
    await waitFor(() =>
      expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('capture-stop'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-review')).toBeInTheDocument(),
    );

    const trim = screen.getByTestId('review-trim');
    expect(trim).toBeDisabled();
    expect(trim).toHaveTextContent('Trim all views');
    expect(screen.queryByTestId('review-trim-start')).not.toBeInTheDocument();

    await waitFor(() => {
      for (const i of [0, 1]) {
        expect(
          screen.getByTestId(`review-video-${i}`).querySelector('video'),
        ).toBeTruthy();
      }
    });
    const videos = [0, 1].map((i) => {
      const el = screen.getByTestId(`review-video-${i}`).querySelector('video');
      if (!(el instanceof HTMLVideoElement)) {
        throw new Error(`review video ${i} is missing`);
      }
      return el;
    });

    Object.defineProperty(videos[0], 'duration', {
      configurable: true,
      get: () => 10,
    });
    fireEvent.loadedMetadata(videos[0]);
    expect(screen.getByTestId('review-trim')).toBeDisabled();
    expect(screen.queryByTestId('review-trim-start')).not.toBeInTheDocument();

    Object.defineProperty(videos[1], 'duration', {
      configurable: true,
      get: () => 10.2,
    });
    fireEvent.loadedMetadata(videos[1]);
    await waitFor(() =>
      expect(screen.getByTestId('review-trim-start')).toBeInTheDocument(),
    );
    // Full overlap is not a cut yet.
    expect(screen.getByTestId('review-trim')).toBeDisabled();

    fireEvent.keyDown(screen.getByTestId('review-trim-start'), {
      key: 'ArrowRight',
    });
    fireEvent.keyDown(screen.getByTestId('review-trim-end'), {
      key: 'ArrowLeft',
    });
    expect(screen.getByTestId('review-trim')).not.toBeDisabled();

    fireEvent.change(screen.getByTestId('review-scrub-range'), {
      target: { value: '0' },
    });
    expect(screen.getByTestId('review-time').textContent).toMatch(/00:00\.1/);

    let trimmed = false;
    const trimTrial = vi.fn(async () => {
      trimmed = true;
      return {
        ok: true,
        start_sec: 0.1,
        end_sec: 9.9,
        duration_sec: 9.8,
        views: 2,
      };
    });
    const revertTrial = vi.fn(async () => {
      trimmed = false;
      return { ok: true, views: 2, duration_sec: 10.2 };
    });
    const originalTrim = mockClient.trimTrial;
    const originalRevert = mockClient.revertTrial;
    const originalGet = mockClient.getTrial;
    mockClient.trimTrial = trimTrial;
    mockClient.revertTrial = revertTrial;
    mockClient.getTrial = async (id: string) => {
      const body = await originalGet(id);
      if (!trimmed) return body;
      return {
        ...body,
        uploads: Object.fromEntries(
          Object.entries(body.uploads).map(([deviceId, upload]) => [
            deviceId,
            { ...upload, trimmed: true },
          ]),
        ),
      };
    };
    try {
      expect(screen.queryByTestId('review-revert')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('review-trim'));
      await waitFor(() => expect(trimTrial).toHaveBeenCalledTimes(1));
      expect(trimTrial).toHaveBeenCalledWith('tr_1', {
        startSec: expect.closeTo(0.1, 5),
        endSec: expect.closeTo(9.9, 5),
      });
      await waitFor(() =>
        expect(screen.getByTestId('review-revert')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId('review-revert'));
      await waitFor(() => expect(revertTrial).toHaveBeenCalledTimes(1));
      expect(revertTrial).toHaveBeenCalledWith('tr_1');
      await waitFor(() =>
        expect(screen.queryByTestId('review-revert')).not.toBeInTheDocument(),
      );
    } finally {
      mockClient.trimTrial = originalTrim;
      mockClient.revertTrial = originalRevert;
      mockClient.getTrial = originalGet;
    }
  });

  it('Phase 3: 3-minute cap constant and Capture start disabled without cameras', async () => {
    renderPairApp();
    // Jump via stepper is not available — open Capture only after pairing.
    // Without pairing, Continue is disabled; assert Capture start needs cams
    // by mocking devices empty after subject path is blocked.
    // Direct: pair 0 cams — stay on Pair.
    expect(screen.getByTestId('pair-continue')).toBeEnabled();

    const { TRIAL_MAX_SECONDS, shouldAutoStop } = await import('./lib/sync');
    expect(TRIAL_MAX_SECONDS).toBe(180);
    expect(shouldAutoStop(179)).toBe(false);
    expect(shouldAutoStop(180)).toBe(true);
  });

  it('Phase 5: IMU subset persists Pair → Capture → Review; empty panels; no fake traces', async () => {
    renderPairApp();
    await waitFor(() =>
      expect(screen.getByTestId('screen-pair')).toBeInTheDocument(),
    );

    // Empty IMU column until Scan
    expect(screen.getByTestId('imu-empty')).toBeInTheDocument();
    expect(screen.getByText('No IMUs paired')).toBeInTheDocument();
    expect(screen.getByTestId('pair-summary').textContent).toMatch(
      /IMUs optional/,
    );
    expect(screen.queryByTestId('imu-chips')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('imu-scan-connect'));
    expect(screen.getByTestId('imu-chips')).toBeInTheDocument();

    // Any subset: Femur L + Tibia R only
    fireEvent.click(screen.getByTestId('imu-chip-femurL'));
    fireEvent.click(screen.getByTestId('imu-chip-tibiaR'));
    expect(screen.getByTestId('pair-imu-badge').textContent).toMatch(
      /2 connected/,
    );
    expect(screen.getByTestId('pair-summary').textContent).toMatch(
      /2 IMUs connected/,
    );

    // Pair one camera and continue through Subject → Capture
    fireEvent.click(screen.getByTestId('pair-next'));
    await waitFor(() =>
      expect(screen.getByTestId('qr-box')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('pair-simulate'));
    await waitFor(() =>
      expect(screen.queryByTestId('qr-box')).not.toBeInTheDocument(),
    );
    await continueFromPair();
    expect(screen.getByTestId('screen-subject')).toBeInTheDocument();
    await finishPostures();
    await waitFor(() =>
      expect(screen.getByTestId('subject-continue')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('subject-continue'));

    await waitFor(() =>
      expect(screen.getByTestId('screen-capture')).toBeInTheDocument(),
    );

    // Capture: IMU panel only when slots connected; empty dashed charts
    const captureImu = screen.getByTestId('capture-imu-panel');
    expect(captureImu.textContent).toMatch(/IMU signals · live/);
    const liveEmpty = screen.getAllByTestId('imu-live-empty');
    expect(liveEmpty).toHaveLength(2);
    expect(liveEmpty.map((el) => el.querySelector('h3')?.textContent)).toEqual([
      'Femur L',
      'Tibia R',
    ]);
    expect(captureImu.querySelector('.playhead')).toBeNull();
    expect(captureImu.textContent).not.toMatch(/recalibrat/i);

    // Record → Review
    await startCapture();
    await waitFor(() =>
      expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('capture-stop'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-review')).toBeInTheDocument(),
    );

    const reviewImu = screen.getByTestId('review-imu-traces');
    expect(reviewImu.textContent).toMatch(/Recorded IMU traces/);
    const traces = screen.getAllByTestId('imu-trace-empty');
    expect(traces).toHaveLength(2);
    expect(
      traces.every((el) => el.textContent?.includes('No recording yet')),
    ).toBe(true);
    expect(reviewImu.querySelector('.playhead')).toBeNull();
    // No parked 35% playhead style on empty panels
    expect(reviewImu.innerHTML).not.toMatch(/left:\s*35%/);

    // Proceed to Pose — selection still in session (no IMU panel on Pose)
    fireEvent.click(screen.getByTestId('review-proceed-pose'));
    expect(screen.getByTestId('screen-pose')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pose-back-review'));
    expect(screen.getByTestId('review-imu-traces')).toBeInTheDocument();
    expect(screen.getAllByTestId('imu-trace-empty')).toHaveLength(2);
  });

  it('Phase 5: Capture/Review hide IMU chrome when none connected', async () => {
    await goToCapture();
    expect(screen.queryByTestId('capture-imu-panel')).not.toBeInTheDocument();

    await startCapture();
    await waitFor(() =>
      expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('capture-stop'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-review')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('review-imu-traces')).not.toBeInTheDocument();
    expect(screen.getByTestId('screen-review').textContent).not.toMatch(
      /IMU traces share the playhead/,
    );
  });

  it('Phase 4: Pose re-run fills selected trial; trial picker; export MediaPipe units', async () => {
    await goToCapture();

    await startCapture();
    await waitFor(() =>
      expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('capture-stop'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-review')).toBeInTheDocument(),
    );

    // Second trial so Pose picker has multiple options
    fireEvent.click(screen.getByTestId('review-record-another'));
    expect(screen.queryByTestId('capture-trial-name')).not.toBeInTheDocument();
    await startCapture();
    await waitFor(() =>
      expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId('capture-stop'));
    await waitFor(() =>
      expect(screen.getByTestId('screen-review')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('review-proceed-pose'));
    expect(screen.getByTestId('screen-pose')).toBeInTheDocument();

    // Left panel controls present
    expect(screen.getByTestId('pose-model-full')).toBeInTheDocument();
    expect(screen.getByTestId('pose-scale-height')).not.toBeChecked();
    expect(screen.getByTestId('pose-lock-hips')).toBeInTheDocument();
    expect(screen.getByTestId('pose-landmark-smoothing')).toBeChecked();
    expect(screen.getByTestId('pose-temporal-filter')).toBeChecked();
    expect(screen.getByTestId('pose-smooth-strength')).toBeInTheDocument();
    expect(screen.getByTestId('pose-temporal-strength')).toBeInTheDocument();
    expect(screen.getByTestId('pose-rerun')).toBeInTheDocument();
    expect(screen.getByTestId('pose-rerun-note').textContent).toMatch(
      /every camera view of gait02/i,
    );

    // Trial picker keeps all trials
    const picker = screen.getByTestId('pose-trial-picker') as HTMLSelectElement;
    await waitFor(() =>
      expect(
        within(picker)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['gait01', 'gait02']),
    );

    // Right panel: 3D + video + scrubber
    expect(screen.getByTestId('pose-3d-viewport')).toBeInTheDocument();
    expect(screen.getByTestId('pose-3d-reset')).toBeInTheDocument();
    expect(screen.getByTestId('pose-show-skeleton')).toBeInTheDocument();
    expect(screen.getByTestId('pose-scrubber')).toBeInTheDocument();
    expect(screen.getByTestId('pose-frame-meta').textContent).toMatch(
      /Frame 0 \/ 0/,
    );
    expect(screen.getByTestId('pose-play')).toBeDisabled();

    // Re-run (soft stub in CI — no WASM)
    fireEvent.click(screen.getByTestId('pose-rerun'));
    await waitFor(() =>
      expect(screen.getByTestId('pose-frame-meta').textContent).toMatch(
        /Frame 1 \//,
      ),
    );
    expect(screen.getByTestId('pose-2d-overlay')).toBeInTheDocument();

    const play = screen.getByTestId('pose-play');
    expect(play).toBeEnabled();
    expect(play).toHaveTextContent('Play');
    fireEvent.click(play);
    expect(play).toHaveTextContent('Pause');
    await waitFor(() =>
      expect(screen.getByTestId('pose-frame-meta').textContent).toMatch(
        /Frame ([2-9]|\d{2,}) \//,
      ),
    );
    fireEvent.click(play);
    expect(play).toHaveTextContent('Play');
    const pausedAt = screen.getByTestId('pose-frame-meta').textContent;
    await new Promise((r) => setTimeout(r, 180));
    expect(screen.getByTestId('pose-frame-meta').textContent).toBe(pausedAt);

    // Switch trial — scrubber resets; re-run only affects selected
    fireEvent.change(picker, { target: { value: 'gait01' } });
    await waitFor(() =>
      expect(screen.getByTestId('pose-rerun-note').textContent).toMatch(
        /gait01/,
      ),
    );
    expect(screen.getByTestId('pose-frame-meta').textContent).toMatch(
      /Frame 0 \/ 0/,
    );

    fireEvent.click(screen.getByTestId('pose-rerun'));
    await waitFor(() =>
      expect(screen.getByTestId('pose-frame-meta').textContent).toMatch(
        /Frame 1 \//,
      ),
    );

    // Footer navigation
    fireEvent.click(screen.getByTestId('pose-back-review'));
    expect(screen.getByTestId('screen-review')).toBeInTheDocument();

    // Record another video bumps a trailing trial number on Capture.
    fireEvent.click(screen.getByTestId('review-proceed-pose'));
    fireEvent.click(screen.getByTestId('pose-record-another'));
    expect(screen.getByTestId('screen-capture')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-trial-name')).not.toBeInTheDocument();
  });

  it('Capture asks phones for fast previews even with pose off', async () => {
    const spy = vi.spyOn(mockClient, 'setLivePoseMode');
    await goToCapture();
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(devices[0].device_id, true),
    );
    expect(screen.getByTestId('cam-grid')).toHaveAttribute(
      'data-show-pose',
      '0',
    );
    expect(screen.getByTestId('cam-grid')).toHaveAttribute('data-live', '1');
    spy.mockRestore();
  });

  it('locks quality Refresh while recording and turns preview back on when Capture closes', async () => {
    const spy = vi.spyOn(mockClient, 'setRecordingQuality');
    try {
      await goToCapture();
      const refresh = screen.getByTestId('capture-quality-refresh');
      await waitFor(() => expect(refresh).not.toBeDisabled());

      expect(
        screen.queryByTestId('capture-preview-toggle'),
      ).not.toBeInTheDocument();

      await startCapture();
      await waitFor(() =>
        expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
      );
      expect(screen.getByTestId('capture-quality-refresh')).toBeDisabled();
      expect(
        screen.getByTestId('capture-recording-quality-select'),
      ).toBeDisabled();

      fireEvent.click(screen.getByTestId('capture-stop'));
      await waitFor(() =>
        expect(screen.getByTestId('screen-review')).toBeInTheDocument(),
      );
      expect(spy).toHaveBeenLastCalledWith({ previewEnabled: true });
    } finally {
      spy.mockRestore();
    }
  });

  it('live 2D pose runs the real model on phone frames while the toggle is on', async () => {
    const originalNext = mockClient.nextPreview;
    const originalLive = mockClient.setLivePoseMode;
    let served = 0;
    const serveOneFrame = vi.fn(async () => {
      served += 1;
      if (served > 1) {
        await new Promise((r) => setTimeout(r, 50));
        return null;
      }
      return { blob: new Blob(['jpeg'], { type: 'image/jpeg' }), at: 1 };
    });
    const setLive = vi.fn(async (_id: string, active: boolean) => ({
      ok: true,
      active,
    }));
    mockClient.setLivePoseMode = setLive;
    const person = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
    const detect = vi.fn(
      (_img: unknown): Array<{ x: number; y: number }> | null => person,
    );
    liveModel.current = { detect };

    let nowSpy: { mockRestore: () => void } | undefined;
    try {
      let clock = 1000;
      nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
      await goToCapture();
      mockClient.nextPreview = serveOneFrame;
      const deviceId = devices[0].device_id;
      const toggle = within(
        screen.getByTestId('capture-pose-toggle'),
      ).getByRole('checkbox');
      fireEvent.click(toggle);

      await waitFor(() => expect(setLive).toHaveBeenCalledWith(deviceId, true));
      expect(screen.getByTestId('pose-overlay-0')).toBeInTheDocument();
      const img = await waitFor(() => {
        const el = screen
          .getByTestId('cam-feed-0')
          .querySelector('img.feed-img');
        expect(el).not.toBeNull();
        return el as HTMLImageElement;
      });
      await waitFor(() =>
        expect(screen.getByTestId('pose-live-0')).not.toHaveTextContent(
          'loading',
        ),
      );
      fireEvent.load(img);
      expect(detect).toHaveBeenCalledWith(img);
      expect(screen.getByTestId('pose-live-0')).toHaveTextContent(
        '2D pose · live',
      );

      detect.mockReturnValue(null);
      clock += 200;
      fireEvent.load(img);
      expect(screen.getByTestId('pose-live-0')).toHaveTextContent(
        '2D pose · no person',
      );

      fireEvent.click(toggle);
      expect(screen.queryByTestId('pose-overlay-0')).not.toBeInTheDocument();
      expect(screen.queryByTestId('pose-live-0')).not.toBeInTheDocument();
      expect(setLive).not.toHaveBeenCalledWith(deviceId, false);
      fireEvent.click(screen.getByTestId('capture-back'));
      await waitFor(() =>
        expect(setLive).toHaveBeenCalledWith(deviceId, false),
      );
    } finally {
      nowSpy?.mockRestore();
      mockClient.nextPreview = originalNext;
      mockClient.setLivePoseMode = originalLive;
      liveModel.current = null;
    }
  });

  it('live 2D pose shows unavailable and no skeleton when the model cannot load', async () => {
    liveModel.current = null;
    await goToCapture();
    fireEvent.click(
      within(screen.getByTestId('capture-pose-toggle')).getByRole('checkbox'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('pose-live-0')).toHaveTextContent(
        '2D pose · unavailable',
      ),
    );
  });

  it('navigates back and to pairing, confirming only while work is in progress', async () => {
    const originalStop = mockClient.stopTrial;
    const stopTrial = vi.fn(async () => ({ ok: true as const }));
    mockClient.stopTrial = stopTrial;
    const fullRes = await import('./lib/fullResPose');
    const poseSpy = vi
      .spyOn(fullRes, 'runFullResPoseEstimation')
      .mockImplementation(() => new Promise(() => {}) as never);

    try {
      renderPairApp();
      await waitFor(() =>
        expect(screen.getByTestId('pair-next')).not.toBeDisabled(),
      );
      fireEvent.click(screen.getByTestId('pair-next'));
      await waitFor(() =>
        expect(screen.getByTestId('qr-box')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId('pair-simulate'));
      await waitFor(() =>
        expect(screen.queryByTestId('qr-box')).not.toBeInTheDocument(),
      );
      await continueFromPair();
      expect(screen.getByTestId('screen-subject')).toBeInTheDocument();
      expect(screen.getByTestId('subject-back-pairing')).toHaveTextContent(
        'Pair cameras',
      );
      expect(
        screen.getByRole('button', { name: 'Pair cameras' }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('subject-back-pairing'));
      expect(screen.getByTestId('screen-pair')).toBeInTheDocument();
      expect(screen.getByText(/1 of 3 connected/)).toBeInTheDocument();

      await continueFromPair();
      await waitFor(() =>
        expect(screen.getByTestId('standing-capture-now')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId('standing-capture-now'));
      await waitFor(() =>
        expect(screen.getByTestId('guide-countdown').textContent).toMatch(/\d/),
      );
      fireEvent.click(screen.getByTestId('subject-back-pairing'));
      expect(
        screen.getByTestId('subject-back-pairing-confirm'),
      ).toHaveTextContent(
        'Leave Subject? The photo in progress is discarded; accepted photos are kept.',
      );
      fireEvent.click(screen.getByTestId('subject-back-pairing-stay'));
      expect(screen.getByTestId('screen-subject')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('subject-back-pairing'));
      fireEvent.click(screen.getByTestId('subject-back-pairing-leave'));
      expect(screen.getByTestId('screen-pair')).toBeInTheDocument();

      await continueFromPair();
      await finishPostures();
      await waitFor(() =>
        expect(screen.getByTestId('subject-continue')).not.toBeDisabled(),
      );
      fireEvent.click(screen.getByTestId('subject-continue'));

      await waitFor(() =>
        expect(screen.getByTestId('screen-capture')).toBeInTheDocument(),
      );
      expect(screen.getByTestId('capture-back')).toHaveTextContent('Back');
      expect(screen.getByTestId('capture-pair-cameras')).toHaveTextContent(
        'Pair cameras',
      );
      expect(
        screen.queryByRole('button', { name: '← Subject' }),
      ).not.toBeInTheDocument();

      const capturePage = screen.getByTestId('screen-capture');
      fireEvent.click(screen.getByTestId('capture-pair-cameras'));
      expect(capturePage).not.toBeVisible();
      expect(screen.getByTestId('screen-pair')).toBeInTheDocument();
      expect(screen.getByText(/1 of 3 connected/)).toBeInTheDocument();

      await continueFromPair();
      expect(screen.getByTestId('screen-capture')).toBe(capturePage);
      expect(capturePage).toBeVisible();
      await waitFor(() =>
        expect(screen.getByTestId('screen-capture')).toBeInTheDocument(),
      );
      await startCapture();
      await waitFor(() =>
        expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
      );
      fireEvent.click(screen.getByTestId('capture-pair-cameras'));
      expect(
        screen.getByTestId('capture-pair-cameras-confirm'),
      ).toHaveTextContent(
        'Leave Capture? The recording stops and the trial is kept.',
      );
      fireEvent.click(screen.getByTestId('capture-pair-cameras-stay'));
      expect(screen.getByTestId('screen-capture')).toBeInTheDocument();
      expect(screen.getByTestId('capture-stop')).not.toBeDisabled();
      expect(stopTrial).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('capture-pair-cameras'));
      fireEvent.click(screen.getByTestId('capture-back'));
      expect(
        screen.queryByTestId('capture-pair-cameras-confirm'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('capture-back-confirm')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('capture-back-stay'));

      fireEvent.click(screen.getByTestId('capture-pair-cameras'));
      fireEvent.click(screen.getByTestId('capture-pair-cameras-leave'));
      await waitFor(() =>
        expect(screen.getByTestId('screen-pair')).toBeInTheDocument(),
      );
      expect(stopTrial).toHaveBeenCalled();
      expect(screen.getByText(/1 of 3 connected/)).toBeInTheDocument();

      await continueFromPair();
      expect(screen.getByTestId('screen-capture')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByTestId('screen-capture')).toBeInTheDocument(),
      );
      await startCapture();
      await waitFor(() =>
        expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
      );
      fireEvent.click(screen.getByTestId('capture-stop'));
      await waitFor(() =>
        expect(screen.getByTestId('screen-review')).toBeInTheDocument(),
      );
      expect(screen.getByTestId('review-record-another')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('review-pair-cameras'));
      expect(
        screen.queryByTestId('review-pair-cameras-confirm'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('screen-pair')).toBeInTheDocument();
      expect(screen.getByText(/1 of 3 connected/)).toBeInTheDocument();

      await continueFromPair();
      expect(screen.getByTestId('screen-review')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('review-record-another'));
      await waitFor(() =>
        expect(screen.getByTestId('screen-capture')).toBeInTheDocument(),
      );
      await startCapture();
      await waitFor(() =>
        expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
      );
      fireEvent.click(screen.getByTestId('capture-stop'));
      await waitFor(() =>
        expect(screen.getByTestId('screen-review')).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByTestId('review-proceed-pose'));
      expect(screen.getByTestId('screen-pose')).toBeInTheDocument();
      expect(screen.getByTestId('pose-pair-cameras')).toHaveTextContent(
        'Pair cameras',
      );

      fireEvent.click(screen.getByTestId('pose-rerun'));
      await waitFor(() =>
        expect(screen.getByTestId('pose-rerun')).toHaveTextContent(
          'Re-running',
        ),
      );
      fireEvent.click(screen.getByTestId('pose-pair-cameras'));
      expect(screen.getByTestId('pose-pair-cameras-confirm')).toHaveTextContent(
        'Leave Pose? The re-run continues and its result is saved to this trial.',
      );
      fireEvent.click(screen.getByTestId('pose-pair-cameras-stay'));
      expect(screen.getByTestId('screen-pose')).toBeInTheDocument();
      const posePage = screen.getByTestId('screen-pose');
      fireEvent.click(screen.getByTestId('pose-pair-cameras'));
      fireEvent.click(screen.getByTestId('pose-pair-cameras-leave'));
      expect(posePage).not.toBeVisible();
      fireEvent.click(screen.getByTestId('pair-continue'));
      expect(screen.getByTestId('screen-pose')).toBe(posePage);
      expect(posePage).toBeVisible();
      expect(screen.getByTestId('pose-rerun')).toHaveTextContent('Re-running');
      fireEvent.click(screen.getByTestId('pose-back-review'));
      fireEvent.click(screen.getByTestId('pose-back-review-leave'));
      expect(screen.getByTestId('screen-review')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('review-proceed-pose'));
      fireEvent.click(screen.getByTestId('pose-pair-cameras'));
      expect(screen.getByTestId('screen-pair')).toBeInTheDocument();
      expect(screen.getByText(/1 of 3 connected/)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('pair-continue'));
      expect(screen.getByTestId('screen-pose')).toBeVisible();
    } finally {
      mockClient.stopTrial = originalStop;
      poseSpy.mockRestore();
    }
  });

  describe('recording countdown and upload status', () => {
    it('Review shows transfer progress in each tile, then the video', async () => {
      await goToCapture();
      const dev = devices[0].device_id;
      uploads.set(dev, {
        status: 'uploading',
        bytes: 50,
        totalBytes: 100,
        filename: 'a.webm',
      });
      await startCapture();
      await waitFor(() =>
        expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
      );
      fireEvent.click(screen.getByTestId('capture-stop'));
      await waitFor(() =>
        expect(screen.getByTestId('review-progress-pct-0')).toHaveTextContent(
          '40%',
        ),
      );
      expect(screen.getByTestId('review-play')).toBeDisabled();
      expect(
        screen.getByTestId('review-video-0').querySelector('video'),
      ).toBeNull();

      uploads.set(dev, {
        status: 'converting',
        bytes: 100,
        convertProgress: 0.5,
        filename: 'a.webm',
      });
      await waitFor(
        () => {
          expect(screen.getByTestId('review-video-0')).toHaveAttribute(
            'data-status',
            'converting',
          );
          expect(screen.getByTestId('review-progress-pct-0')).toHaveTextContent(
            '90%',
          );
        },
        { timeout: 3000 },
      );
      expect(screen.getByTestId('review-progress-0')).toHaveTextContent(
        'Converting to MP4…',
      );

      uploads.set(dev, { status: 'ready', bytes: 9, filename: 'a.mp4' });
      await waitFor(
        () =>
          expect(
            screen.getByTestId('review-video-0').querySelector('video'),
          ).not.toBeNull(),
        { timeout: 3000 },
      );
      expect(screen.queryByTestId('review-progress-0')).not.toBeInTheDocument();
      expect(screen.getByTestId('review-play')).not.toBeDisabled();
    });

    it('Review leaves a failed upload when the same trial name is recorded again', async () => {
      await goToCapture();
      const dev = devices[0].device_id;
      const original = mockClient.getTrial;
      const byTrial = new Map<
        string,
        { status: 'failed' | 'uploading'; error?: string }
      >();
      mockClient.getTrial = async (id: string) => ({
        trial_id: id,
        phase: 'done' as const,
        uploads: {
          [dev]: {
            status: byTrial.get(id)?.status ?? 'ready',
            bytes: byTrial.get(id)?.status === 'uploading' ? 10 : 0,
            totalBytes: 100,
            filename: 'a.mp4',
            ...(byTrial.get(id)?.error
              ? { error: byTrial.get(id)?.error }
              : {}),
          },
        },
      });
      try {
        byTrial.set('tr_1', { status: 'failed', error: 'aborted' });
        await startCapture();
        await waitFor(() =>
          expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
        );
        fireEvent.click(screen.getByTestId('capture-stop'));
        await waitFor(() =>
          expect(screen.getByTestId('review-video-0')).toHaveAttribute(
            'data-status',
            'failed',
          ),
        );
        expect(screen.getByTestId('review-progress-0')).toHaveTextContent(
          'Failed · aborted',
        );

        fireEvent.click(screen.getByTestId('review-record-another'));
        byTrial.set('tr_2', { status: 'uploading' });
        await startCapture();
        await waitFor(() =>
          expect(screen.getByTestId('capture-stop')).not.toBeDisabled(),
        );
        fireEvent.click(screen.getByTestId('capture-stop'));
        await waitFor(() =>
          expect(screen.getByTestId('review-video-0')).toHaveAttribute(
            'data-status',
            'uploading',
          ),
        );
        expect(screen.getByTestId('review-progress-0')).toHaveTextContent(
          'Uploading…',
        );
      } finally {
        mockClient.getTrial = original;
      }
    });
  });
});
