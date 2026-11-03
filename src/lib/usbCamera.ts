import { backendClient, type StartSignal } from './backendClient';
import { RECORDING_PRESETS, type RecordingPresetId } from './recordingQuality';

export type UsbCameraChoice = { deviceId: string; label: string };
type ActiveTrial = {
  trial_id: string;
  phase: string;
  start_signal: StartSignal | null;
  participants: string[];
};
type Control = {
  pending: boolean;
  standing: boolean;
  livePose: boolean;
  previewEnabled: boolean;
  recordingPreset: RecordingPresetId;
  videoBitsPerSecond: number;
};
type Take = {
  id: string;
  recorder: MediaRecorder;
  chunks: Blob[];
  discard: boolean;
  failed: boolean;
  startTimer?: ReturnType<typeof setTimeout>;
  stopTimer?: ReturnType<typeof setTimeout>;
};

export async function listUsbCameras(): Promise<UsbCameraChoice[]> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error('Camera access is unavailable on this computer.');
  // Labels are withheld until camera access is granted. Release the probe immediately.
  const probe = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: true,
  });
  try {
    return (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'videoinput' && d.deviceId)
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${i + 1}`,
      }));
  } finally {
    probe.getTracks().forEach((track) => track.stop());
  }
}

export function recorderMime(): string {
  if (typeof MediaRecorder === 'undefined')
    throw new Error('Video recording is unavailable on this computer.');
  const mime = [
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mime) throw new Error('No supported video recording format.');
  return mime;
}

/** A USB camera stays alive across screens, using the phone protocol for downstream compatibility. */
export class UsbCamera {
  readonly video = document.createElement('video');
  private canvas = document.createElement('canvas');
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private previewTimer?: ReturnType<typeof setTimeout>;
  private take: Take | null = null;
  private lastTrialId: string | null = null;
  private control: Control | null = null;
  private preset = '';
  private uploads = new Set<AbortController>();
  private failedUpload: { take: Take; blob: Blob } | null = null;
  private nextUploadRetry = 0;
  private disconnected = false;
  private assessmentEpoch = 0;

  constructor(
    readonly hardwareId: string,
    readonly deviceId: string,
    private token: string,
    private stream: MediaStream,
    private onError: (message: string) => void,
  ) {
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
    stream
      .getVideoTracks()
      .forEach((track) => track.addEventListener('ended', this.onEnded));
  }

  private onEnded = () => {
    if (this.disposed) return;
    this.disconnected = true;
    this.onError('Camera disconnected. Remove it and connect it again.');
    const take = this.take;
    if (take) {
      take.failed = true;
      this.finish(false);
      void this.fail(take.id, 'USB camera disconnected during recording');
    }
  };

  async start() {
    await this.video.play();
    if (!this.video.videoWidth || !this.video.videoHeight)
      throw new Error('Camera has no frame yet.');
    void this.tick();
    void this.preview();
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    this.uploads.add(controller);
    const timeout = setTimeout(
      () => controller.abort(),
      init.body instanceof Blob ? 120_000 : 5000,
    );
    try {
      const response = await fetch(`${backendClient.baseUrl()}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.token}`, ...init.headers },
      });
      if (!response.ok)
        throw new Error(`Camera request failed (${response.status})`);
      return response.status === 204
        ? (undefined as T)
        : ((await response.json()) as T);
    } finally {
      clearTimeout(timeout);
      this.uploads.delete(controller);
    }
  }

  private get path() {
    return `/v1/devices/${encodeURIComponent(this.deviceId)}`;
  }

  private async fail(trialId: string, error: string) {
    await this.request(
      `${this.path}/trials/${encodeURIComponent(trialId)}/upload-error`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error }),
      },
    ).catch(() => {});
  }

  private async frame(full: boolean): Promise<Blob> {
    // Separate canvases prevent preview encoding from overwriting a full-resolution still.
    const canvas = full ? document.createElement('canvas') : this.canvas;
    const width = this.video.videoWidth,
      height = this.video.videoHeight;
    if (!width || !height) throw new Error('Camera has no frame yet.');
    const scale = full ? 1 : Math.min(1, 640 / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Camera image could not be captured.');
    context.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error('Camera image could not be encoded.')),
        'image/jpeg',
        full ? 0.95 : 0.65,
      ),
    );
  }

  private async preview() {
    try {
      if (
        !this.disposed &&
        !this.disconnected &&
        (this.control?.previewEnabled !== false || this.control?.standing)
      ) {
        await this.request(`${this.path}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: await this.frame(false),
        });
      }
    } catch {
      /* A failed preview must not stop a full-resolution recording. */
    } finally {
      if (!this.disposed)
        this.previewTimer = setTimeout(
          () => void this.preview(),
          this.control?.standing || this.control?.livePose ? 80 : 500,
        );
    }
  }

  private async still() {
    try {
      if (this.disconnected) throw new Error('USB camera disconnected');
      await this.request(`${this.path}/still`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: await this.frame(true),
      });
    } catch (e) {
      await this.request(`${this.path}/still-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: e instanceof Error ? e.message : String(e),
        }),
      }).catch(() => {});
    }
  }

  private async tick() {
    try {
      const [control, active] = await Promise.all([
        this.request<Control>(`${this.path}/still-request`),
        this.request<{ trial: ActiveTrial | null }>('/v1/trials/active').catch(
          () => undefined,
        ),
      ]);
      if (this.disposed) return;
      this.control = control;
      // Process cancel/stop before camera constraint changes or still encoding.
      if (active) this.reconcile(active.trial);
      if (!this.take && !this.disconnected) {
        const desired = control.standing ? 'standing' : control.recordingPreset;
        if (this.preset !== desired) {
          const size = control.standing
            ? { longSide: 4096, shortSide: 2160 }
            : RECORDING_PRESETS[control.recordingPreset];
          if (size) {
            await this.stream
              .getVideoTracks()[0]
              .applyConstraints({
                width: { ideal: size.longSide },
                height: { ideal: size.shortSide },
                frameRate: { ideal: 30 },
              })
              .catch(() => {});
            this.preset = desired;
          }
        }
      }
      if (control.pending) await this.still();
      if (this.failedUpload && Date.now() >= this.nextUploadRetry) {
        const retry = this.failedUpload;
        this.failedUpload = null;
        void this.upload(retry.take, retry.blob);
      }
    } catch {
      /* Retry control requests; the local maximum-duration timer still stops the camera. */
    } finally {
      if (!this.disposed) this.timer = setTimeout(() => void this.tick(), 100);
    }
  }

  /** Reconcile against the server, so stopping works even after leaving Capture. */
  reconcile(trial: ActiveTrial | null) {
    if (this.disposed) return;
    if (this.take) {
      if (
        trial?.trial_id !== this.take.id ||
        trial.phase === 'done' ||
        trial.phase === 'stopping' ||
        trial.phase === 'cancelled'
      ) {
        this.finish(trial?.phase === 'cancelled');
      }
      return;
    }
    if (
      !trial ||
      trial.phase !== 'recording' ||
      !trial.start_signal ||
      trial.trial_id === this.lastTrialId ||
      !trial.participants.includes(this.deviceId)
    )
      return;
    this.lastTrialId = trial.trial_id;
    const signal = trial.start_signal;
    if (Date.now() >= signal.startAtMs + signal.maxDurationMs) return;
    if (this.disconnected) {
      void this.fail(trial.trial_id, 'USB camera disconnected');
      return;
    }
    try {
      const mimeType = recorderMime();
      const recorder = new MediaRecorder(this.stream, {
        mimeType,
        videoBitsPerSecond: this.control?.videoBitsPerSecond || 6_000_000,
      });
      const take: Take = {
        id: trial.trial_id,
        recorder,
        chunks: [],
        discard: false,
        failed: false,
      };
      this.take = take;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) take.chunks.push(event.data);
      };
      recorder.onerror = () => {
        take.failed = true;
        void this.fail(take.id, 'USB camera recording failed');
        this.onError('USB camera recording failed.');
      };
      recorder.onstop = () => {
        if (this.take === take) this.take = null;
        clearTimeout(take.stopTimer);
        if (take.discard || take.failed || this.disposed) return;
        const blob = new Blob(take.chunks, { type: mimeType });
        if (!blob.size) {
          void this.fail(take.id, 'USB camera produced an empty recording');
          return;
        }
        void this.upload(take, blob);
      };
      take.startTimer = setTimeout(
        () => {
          if (this.disposed || take.discard || this.take !== take) return;
          try {
            recorder.start(1000);
          } catch {
            take.failed = true;
            this.take = null;
            void this.fail(take.id, 'USB camera could not start recording');
          }
        },
        Math.max(0, signal.startAtMs - Date.now()),
      );
      take.stopTimer = setTimeout(
        () => this.finish(false),
        Math.max(0, signal.startAtMs + signal.maxDurationMs - Date.now()),
      );
    } catch (e) {
      void this.fail(
        trial.trial_id,
        e instanceof Error ? e.message : String(e),
      );
      this.onError('USB camera recording failed.');
    }
  }

  private finish(discard: boolean) {
    const take = this.take;
    if (!take) return;
    this.take = null;
    take.discard = discard || take.recorder.state === 'inactive';
    clearTimeout(take.startTimer);
    clearTimeout(take.stopTimer);
    if (take.recorder.state !== 'inactive') take.recorder.stop();
    else this.take = null;
  }

  private async upload(take: Take, blob: Blob) {
    const epoch = this.assessmentEpoch;
    const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
    try {
      await this.request(
        `${this.path}/trials/${encodeURIComponent(take.id)}/upload?filename=${encodeURIComponent(`usb_${take.id}.${extension}`)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': blob.type },
          body: blob,
        },
      );
      if (!this.disconnected && epoch === this.assessmentEpoch)
        this.onError('');
    } catch {
      if (this.disposed || epoch !== this.assessmentEpoch) return;
      this.failedUpload = { take, blob };
      this.nextUploadRetry = Date.now() + 4000;
      this.onError('USB camera upload failed. Retrying automatically.');
      await this.fail(take.id, 'USB camera upload failed; retrying');
    }
  }

  resetAssessment() {
    this.assessmentEpoch += 1;
    this.finish(true);
    this.failedUpload = null;
    if (!this.disconnected) this.onError('');
    this.uploads.forEach((controller) => controller.abort());
  }

  dispose() {
    this.disposed = true;
    this.finish(true);
    clearTimeout(this.timer);
    clearTimeout(this.previewTimer);
    this.uploads.forEach((controller) => controller.abort());
    this.failedUpload = null;
    this.stream.getTracks().forEach((track) => {
      track.removeEventListener('ended', this.onEnded);
      track.stop();
    });
    this.video.srcObject = null;
  }
}
