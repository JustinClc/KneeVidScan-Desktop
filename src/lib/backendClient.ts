/**
 * Desktop renderer client for the Lite local backend.
 */

import type {
  RecordingPresetId,
  RecordingQualityMode,
} from './recordingQuality';

export type RecordingQualityState = {
  mode: RecordingQualityMode;
  resolved: RecordingPresetId;
  previewEnabled: boolean;
  recommendation: RecordingPresetId;
  estimates: Record<RecordingPresetId, number>;
  probes: number;
};

export type BackendDevice = {
  source?: 'usb';
  device_id: string;
  name: string;
  cam_index: number;
  view_code: 'F' | 'L' | 'O' | null;
  paired_at?: number;
  has_preview?: boolean;
};

export type StillResult =
  | { state: 'ready'; bytes: ArrayBuffer; contentType: string }
  | { state: 'pending' | 'sending' }
  | { state: 'failed'; error: string };

export type PairingCreated = {
  id: string;
  code: string;
  status: string;
  expires_at: number;
  qr_url: string;
  reserved_index: number;
  replace_device_id?: string | null;
};

export type SessionSnapshot = {
  devices: Array<{
    deviceId: string;
    name: string;
    camIndex: number;
    pairedAt: number;
    viewCode: 'F' | 'L' | 'O' | null;
  }>;
  pendingPairing?: {
    id: string;
    code: string;
    status: string;
    expiresAt: number;
    reservedIndex: number;
    replaceDeviceId?: string;
    /** Present for pairings created after the QR url is stored on the record. */
    qrUrl?: string;
  };
  info: {
    apiBase: string;
    pwaBase: string;
    https: boolean;
    lanHost: string;
    port: number;
  } | null;
  trialMaxSeconds: number;
};

/** Per-camera progress of a trial video, from Start until Save. */
export type UploadStatus =
  | 'recording'
  | 'uploading'
  | 'converting'
  | 'ready'
  | 'failed'
  | 'cleared';

export type TrialUploadInfo = {
  status: UploadStatus;
  bytes: number;
  /** Announced upload size, while `uploading`. */
  totalBytes?: number;
  /** WebM → MP4 progress 0–1, while `converting`. */
  convertProgress?: number;
  filename: string;
  at?: number;
  error?: string;
  /** True after a trim, until Revert puts this view back on the phone upload. */
  trimmed?: boolean;
};

/** Result of planting a local MP4 where Pose reads full-res uploads. */
export type ImportedMedia = {
  ok: true;
  trial_id: string;
  name: string;
  duration_sec: number | null;
  device_id: string;
  cam_index: number;
  view_code: 'F' | 'L' | 'O' | null;
  filename: string;
  bytes: number;
  devices: BackendDevice[];
};

export type TrialInfo = {
  trial_id: string;
  name?: string;
  phase: string;
  start_signal?: StartSignal | null;
  participants?: string[];
  uploads: Record<string, TrialUploadInfo>;
};

export type StartSignal = {
  trialId: string;
  trialName: string;
  startAtMs: number;
  maxDurationMs: number;
};

/** Renderer-owned copy. The preload object from contextBridge is not extensible. */
let apiBaseOverride: string | null = null;

function apiBase(): string {
  if (apiBaseOverride) return apiBaseOverride;
  const fromWindow = window.motuscapLite?.backendUrl;
  if (fromWindow) return fromWindow.replace(/\/$/, '');
  return 'https://127.0.0.1:0';
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = body as { error?: string } | null;
    throw new Error(err?.error || res.statusText || 'Request failed');
  }
  return body as T;
}

export const backendClient = {
  setBaseUrl(url: string) {
    apiBaseOverride = url.replace(/\/$/, '');
  },
  baseUrl: apiBase,

  health: () => req<{ ok: boolean }>('/v1/health'),

  publishLocale: (locale: 'en' | 'zh-Hant' | 'zh-Hans') =>
    req<{ locale: string; ready: boolean }>('/v1/locale', {
      method: 'POST',
      body: JSON.stringify({ locale }),
    }),

  session: () => req<SessionSnapshot>('/v1/session'),

  createPairing: (publicBaseUrl?: string, replaceDeviceId?: string) =>
    req<PairingCreated>('/v1/device-pairings', {
      method: 'POST',
      ...(publicBaseUrl || replaceDeviceId
        ? {
            body: JSON.stringify({
              ...(publicBaseUrl ? { public_base_url: publicBaseUrl } : {}),
              ...(replaceDeviceId
                ? { replace_device_id: replaceDeviceId }
                : {}),
            }),
          }
        : {}),
    }),

  getPairing: (id: string) =>
    req<{
      id: string;
      status: string;
      device: BackendDevice | null;
    }>(`/v1/device-pairings/${encodeURIComponent(id)}`),

  cancelPairing: (id: string) =>
    req<{ ok: boolean }>(`/v1/device-pairings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  mockComplete: (deviceName?: string) =>
    req<{
      device_id: string;
      cam_index: number;
      view_code: 'F' | 'L' | 'O' | null;
      devices: SessionSnapshot['devices'];
    }>('/v1/device-pairings/mock-complete', {
      method: 'POST',
      body: JSON.stringify({ device_name: deviceName }),
    }),

  connectUsbCamera: (cameraId: string, name: string) =>
    req<{ device_id: string; device_pairing_token: string }>(
      '/v1/usb-cameras',
      {
        method: 'POST',
        body: JSON.stringify({ camera_id: cameraId, name }),
      },
    ),

  listDevices: () => req<{ devices: BackendDevice[] }>('/v1/devices'),

  removeDevice: (id: string) =>
    req<{ ok: boolean }>(`/v1/devices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  previews: () =>
    req<{
      previews: Array<{
        device_id: string;
        cam_index: number;
        view_code: 'F' | 'L' | 'O' | null;
        at: number | null;
        url: string | null;
      }>;
    }>('/v1/previews'),

  previewUrl: (deviceId: string, at?: number) =>
    `${apiBase()}/v1/devices/${encodeURIComponent(deviceId)}/preview${
      at ? `?t=${at}` : ''
    }`,

  createTrial: (name: string) =>
    req<{ trial_id: string; name: string; phase: string }>('/v1/trials', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  /**
   * Plant a local MP4 on a trial upload URL without pairing a phone.
   * `fresh` clears previously paired cameras so the file owns slot 0.
   */
  importMedia: async (input: {
    trialName: string;
    filename: string;
    bytes: Uint8Array;
    trialId?: string;
    fresh?: boolean;
    /** Fraction of the POST body sent, 0–1, while the MP4 is uploading. */
    onProgress?: (fraction: number) => void;
  }): Promise<ImportedMedia> => {
    const params = new URLSearchParams();
    params.set('name', input.trialName);
    params.set('filename', input.filename);
    if (input.trialId) params.set('trial_id', input.trialId);
    if (input.fresh) params.set('fresh', '1');
    const copy = new ArrayBuffer(input.bytes.byteLength);
    new Uint8Array(copy).set(input.bytes);
    const url = `${apiBase()}/v1/imports?${params}`;
    const blob = new Blob([copy], { type: 'video/mp4' });
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', 'video/mp4');
      xhr.upload.onprogress = (event) => {
        if (!input.onProgress || !event.lengthComputable || event.total <= 0) {
          return;
        }
        input.onProgress(event.loaded / event.total);
      };
      xhr.onerror = () => reject(new Error('Import failed'));
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          body = null;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          const err = body as { error?: string } | null;
          reject(new Error(err?.error || xhr.statusText || 'Import failed'));
          return;
        }
        input.onProgress?.(1);
        resolve(body as ImportedMedia);
      };
      xhr.send(blob);
    });
  },

  armTrial: (id: string) =>
    req<{ ok: boolean }>(`/v1/trials/${encodeURIComponent(id)}/arm`, {
      method: 'POST',
    }),

  startTrial: (
    id: string,
    options?: { leadMs: number; maxDurationMs: number },
  ) =>
    req<{ ok: boolean; start_signal: StartSignal }>(
      `/v1/trials/${encodeURIComponent(id)}/start`,
      { method: 'POST', body: options ? JSON.stringify(options) : undefined },
    ),

  stopTrial: (id: string) =>
    req<{ ok: boolean }>(`/v1/trials/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
    }),

  /** Stop pressed during the countdown: phones discard, nothing is kept. */
  cancelTrial: (id: string) =>
    req<{ ok: boolean }>(`/v1/trials/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    }),

  /** Remove a trial's temporary videos once Save has written them. */
  deleteRecordings: (id: string) =>
    req<{ ok: boolean }>(`/v1/trials/${encodeURIComponent(id)}/recordings`, {
      method: 'DELETE',
    }),

  listTrials: () =>
    req<{
      trials: Array<{
        id: string;
        name: string;
        phase: string;
        startAtMs: number | null;
        stoppedAt: number | null;
        uploadCount: number;
      }>;
    }>('/v1/trials'),

  getTrial: (id: string) =>
    req<TrialInfo>(`/v1/trials/${encodeURIComponent(id)}`),

  /**
   * Replace every ready view of this trial with the same time window.
   * The uploaded MP4s are the trimmed files afterwards.
   */
  trimTrial: (id: string, window: { startSec: number; endSec: number }) =>
    req<{
      ok: boolean;
      start_sec: number;
      end_sec: number;
      duration_sec: number;
      views: number;
    }>(`/v1/trials/${encodeURIComponent(id)}/trim`, {
      method: 'POST',
      body: JSON.stringify({
        start_sec: window.startSec,
        end_sec: window.endSec,
      }),
    }),

  /** Restore every view to the phone upload kept by the first trim. */
  revertTrial: (id: string) =>
    req<{ ok: boolean; views: number; duration_sec: number }>(
      `/v1/trials/${encodeURIComponent(id)}/revert`,
      { method: 'POST' },
    ),

  uploadUrl: (deviceId: string, trialId: string) =>
    `${apiBase()}/v1/devices/${encodeURIComponent(deviceId)}/trials/${encodeURIComponent(trialId)}/upload`,

  /** Original MP4 (no overlay), or null when it is not ready. */
  fetchUpload: async (
    trialId: string,
    deviceId: string,
  ): Promise<Uint8Array | null> => {
    try {
      const res = await fetch(
        `${apiBase()}/v1/devices/${encodeURIComponent(deviceId)}/trials/${encodeURIComponent(trialId)}/upload`,
      );
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  },

  standingUrl: (subjectId: string, code: 'F' | 'LL' | 'RL') =>
    `${apiBase()}/v1/subjects/${encodeURIComponent(subjectId)}/standing/${code}`,

  getStandingPng: async (
    subjectId: string,
    code: 'F' | 'LL' | 'RL',
    variant: 'crop' | 'full' = 'crop',
  ): Promise<Uint8Array | null> => {
    try {
      const suffix = variant === 'full' ? '/full' : '';
      const res = await fetch(
        `${apiBase()}/v1/subjects/${encodeURIComponent(subjectId)}/standing/${code}${suffix}`,
      );
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  },

  listSubjects: () =>
    req<{
      subjects: Array<{
        subjectId: string;
        subjectName: string;
        heightCm: string;
        weightKg: string;
        standing: Record<
          string,
          { filename: string; bytes: number; at: number }
        >;
      }>;
    }>('/v1/subjects'),

  getSubject: (id: string) =>
    req<{
      subject_id: string;
      subject_name: string;
      height_cm: string;
      weight_kg: string;
      standing: Record<string, { filename: string; bytes: number; at: number }>;
    }>(`/v1/subjects/${encodeURIComponent(id)}`),

  upsertSubject: (body: {
    subjectId: string;
    subjectName?: string;
    heightCm?: string;
    weightKg?: string;
  }) =>
    req<{
      subject_id: string;
      subject_name: string;
      height_cm: string;
      weight_kg: string;
    }>(`/v1/subjects/${encodeURIComponent(body.subjectId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        subject_name: body.subjectName,
        height_cm: body.heightCm,
        weight_kg: body.weightKg,
      }),
    }),

  /** Send the annotated preview and clean original in one request so a failed upload cannot replace only one. */
  saveStandingCapture: (
    subjectId: string,
    code: 'F' | 'LL' | 'RL',
    shot: {
      filename: string;
      /** Legacy crop slot contains the blurred, annotated report PNG. */
      croppedPng: Uint8Array;
      fullFilename: string;
      fullPng: Uint8Array;
    },
  ) => {
    const params = new URLSearchParams({
      filename: shot.filename,
      fullFilename: shot.fullFilename,
      cropBytes: String(shot.croppedPng.byteLength),
    });
    return req<{ ok: boolean; code: string }>(
      `/v1/subjects/${encodeURIComponent(subjectId)}/standing/${code}/pair?${params}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Blob([
          new Uint8Array(shot.croppedPng).buffer,
          new Uint8Array(shot.fullPng).buffer,
        ]),
      },
    );
  },

  saveStandingPng: async (
    subjectId: string,
    code: 'F' | 'LL' | 'RL',
    filename: string,
    bytes: ArrayBuffer | Uint8Array,
    variant: 'crop' | 'full' = 'crop',
  ) => {
    const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const copy = new Uint8Array(raw.byteLength);
    copy.set(raw);
    const body = new Blob([copy.buffer], { type: 'image/png' });
    const suffix = variant === 'full' ? '/full' : '';
    const res = await fetch(
      `${apiBase()}/v1/subjects/${encodeURIComponent(subjectId)}/standing/${code}${suffix}?filename=${encodeURIComponent(filename)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'image/png',
          'X-Filename': filename,
        },
        body,
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error || res.statusText || 'Upload failed',
      );
    }
    return (await res.json()) as {
      ok: boolean;
      code: string;
      filename: string;
      bytes: number;
    };
  },

  standingDemo: (body: {
    subjectId: string;
    subjectName?: string;
    heightCm?: string;
    weightKg?: string;
  }) =>
    req<{ ok: boolean; files: string[] }>(
      `/v1/subjects/${encodeURIComponent(body.subjectId)}/standing-demo`,
      {
        method: 'POST',
        body: JSON.stringify({
          subject_name: body.subjectName,
          height_cm: body.heightCm,
          weight_kg: body.weightKg,
        }),
      },
    ),

  /** Heartbeat while on Standing; the phone reverts once it stops arriving. */
  setStandingMode: (deviceId: string, active: boolean) =>
    req<{ ok: boolean; active: boolean }>(
      `/v1/devices/${encodeURIComponent(deviceId)}/standing-mode`,
      { method: 'POST', body: JSON.stringify({ active }) },
    ),

  /** Heartbeat while the Capture pose overlay is on; phones revert when it stops. */
  setLivePoseMode: (deviceId: string, active: boolean) =>
    req<{ ok: boolean; active: boolean }>(
      `/v1/devices/${encodeURIComponent(deviceId)}/live-pose-mode`,
      { method: 'POST', body: JSON.stringify({ active }) },
    ),

  requestStill: (deviceId: string) =>
    req<{ ok: boolean }>(
      `/v1/devices/${encodeURIComponent(deviceId)}/still-request`,
      { method: 'POST' },
    ),

  fetchStill: async (deviceId: string): Promise<StillResult> => {
    const res = await fetch(
      `${apiBase()}/v1/devices/${encodeURIComponent(deviceId)}/still`,
    );
    if (res.ok) {
      return {
        state: 'ready',
        bytes: await res.arrayBuffer(),
        contentType: res.headers.get('content-type') || 'image/png',
      };
    }
    const body = (await res.json().catch(() => ({}))) as {
      state?: string;
      error?: string;
    };
    if (body.state === 'failed') {
      return {
        state: 'failed',
        error: body.error || 'Phone could not send the photo',
      };
    }
    return { state: body.state === 'sending' ? 'sending' : 'pending' };
  },

  /** Long-poll: resolves with the first frame newer than `after`, or null. */
  nextPreview: async (
    deviceId: string,
    after: number,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob; at: number } | null> => {
    const res = await fetch(
      `${apiBase()}/v1/devices/${encodeURIComponent(deviceId)}/preview?after=${after}`,
      { signal },
    );
    if (!res.ok) return null;
    const blob = await res.blob();
    const at = Number(res.headers.get('x-frame-at')) || Date.now();
    return { blob, at };
  },

  fetchPreviewBytes: async (deviceId: string): Promise<ArrayBuffer | null> => {
    const res = await fetch(
      `${apiBase()}/v1/devices/${encodeURIComponent(deviceId)}/preview?t=${Date.now()}`,
    );
    if (!res.ok) return null;
    return res.arrayBuffer();
  },

  getRecordingQuality: () =>
    req<RecordingQualityState>('/v1/session/recording-quality'),

  setRecordingQuality: (partial: {
    mode?: RecordingQualityMode;
    previewEnabled?: boolean;
    requestProbes?: boolean;
  }) =>
    req<RecordingQualityState>('/v1/session/recording-quality', {
      method: 'POST',
      body: JSON.stringify(partial),
    }),

  requestLinkProbes: () =>
    req<RecordingQualityState>('/v1/session/recording-quality', {
      method: 'POST',
      body: JSON.stringify({ requestProbes: true }),
    }),
};
