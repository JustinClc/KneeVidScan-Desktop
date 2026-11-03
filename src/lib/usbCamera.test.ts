import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listUsbCameras, UsbCamera } from './usbCamera';

class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported = (type: string) => type.includes('webm');
  state = 'inactive';
  mimeType = 'video/webm';
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob(['video'], { type: 'video/webm' }),
    });
    this.onstop?.();
  });
  constructor() {
    Recorder.instances.push(this);
  }
}
function track() {
  return Object.assign(new EventTarget(), {
    stop: vi.fn(),
    applyConstraints: vi.fn(async () => {}),
    getSettings: () => ({ deviceId: 'usb-hardware' }),
  });
}
function trial(phase = 'recording', participants = ['usb-1']) {
  return {
    trial_id: 'trial-1',
    phase,
    participants,
    start_signal: {
      trialId: 'trial-1',
      trialName: 'gait01',
      startAtMs: Date.now() + 3000,
      maxDurationMs: 180_000,
    },
  };
}
describe('USB camera recording', () => {
  let camera: UsbCamera;
  let videoTrack: ReturnType<typeof track>;
  let error: ReturnType<typeof vi.fn<(message: string) => void>>;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    Recorder.instances = [];
    vi.stubGlobal('MediaRecorder', Recorder);
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    videoTrack = track();
    error = vi.fn<(message: string) => void>();
    const stream = Object.assign(new MediaStream(), {
      getTracks: () => [videoTrack as unknown as MediaStreamTrack],
      getVideoTracks: () => [videoTrack as unknown as MediaStreamTrack],
    });
    camera = new UsbCamera('usb-hardware', 'usb-1', 'token-1', stream, error);
  });
  afterEach(() => {
    camera?.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it('starts at the shared countdown and uploads the full recording on stop', async () => {
    const active = trial();
    camera.reconcile(active);
    const recorder = Recorder.instances[0];
    await vi.advanceTimersByTimeAsync(2999);
    expect(recorder.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(recorder.start).toHaveBeenCalledTimes(1);
    camera.reconcile({ ...active, phase: 'done' });
    await vi.advanceTimersByTimeAsync(0);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '/usb-1/trials/trial-1/upload?filename=usb_trial-1.webm',
      ),
      expect.objectContaining({
        method: 'POST',
        body: expect.any(Blob),
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
    camera.reconcile({ ...active, phase: 'recording' });
    expect(Recorder.instances).toHaveLength(1);
  });
  it('discards a cancelled countdown without starting or uploading', async () => {
    const active = trial();
    camera.reconcile(active);
    camera.reconcile({ ...active, phase: 'cancelled' });
    await vi.advanceTimersByTimeAsync(4000);
    expect(Recorder.instances[0].start).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('ignores trials that do not include this camera', () => {
    camera.reconcile(trial('recording', ['phone-1']));
    expect(Recorder.instances).toHaveLength(0);
  });
  it('stops at the maximum duration even if control polling is unavailable', async () => {
    camera.reconcile(trial());
    await vi.advanceTimersByTimeAsync(183_000);
    expect(Recorder.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/upload?'),
      expect.anything(),
    );
  });
  it('reports an unplugged camera and does not upload a partial take as successful', async () => {
    camera.reconcile(trial());
    await vi.advanceTimersByTimeAsync(3000);
    videoTrack.dispatchEvent(new Event('ended'));
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith(
      'Camera disconnected. Remove it and connect it again.',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/upload-error'),
      expect.anything(),
    );
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/upload?')),
    ).toBe(false);
  });
  it('releases streams and discards pending recording on disposal', async () => {
    camera.reconcile(trial());
    camera?.dispose();
    await vi.advanceTimersByTimeAsync(4000);
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(Recorder.instances[0].start).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('captures clean full-resolution stills and previews through the same authenticated protocol', async () => {
    vi.spyOn(camera.video, 'play').mockResolvedValue();
    Object.defineProperty(camera.video, 'videoWidth', { value: 1920 });
    Object.defineProperty(camera.video, 'videoHeight', { value: 1080 });
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: draw,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (callback) => callback(new Blob(['image'], { type: 'image/jpeg' })),
    );
    fetchMock.mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/still-request')
              ? {
                  pending: true,
                  standing: true,
                  livePose: false,
                  previewEnabled: true,
                  recordingPreset: '720p',
                  videoBitsPerSecond: 3_500_000,
                }
              : url.endsWith('/active')
                ? { trial: null }
                : { ok: true },
          ),
          { status: 200 },
        ),
    );
    await camera.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/usb-1/preview'),
      expect.objectContaining({ method: 'POST', body: expect.any(Blob) }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/usb-1/still'),
      expect.objectContaining({ method: 'POST', body: expect.any(Blob) }),
    );
    expect(draw).toHaveBeenCalledWith(camera.video, 0, 0, 1920, 1080);
    expect(draw).toHaveBeenCalledWith(camera.video, 0, 0, 640, 360);
  });
  it('resets an assessment without releasing the connected camera stream', async () => {
    camera.reconcile(trial());
    camera.resetAssessment();
    await vi.advanceTimersByTimeAsync(4000);
    expect(videoTrack.stop).not.toHaveBeenCalled();
    expect(Recorder.instances[0].start).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('enumerates camera inputs and releases the permission probe', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [videoTrack] })),
        enumerateDevices: vi.fn(async () => [
          { kind: 'videoinput', deviceId: 'usb-hardware', label: 'USB camera' },
          { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
        ]),
      },
    });
    expect(await listUsbCameras()).toEqual([
      { deviceId: 'usb-hardware', label: 'USB camera' },
    ]);
    expect(videoTrack.stop).toHaveBeenCalled();
  });
});
