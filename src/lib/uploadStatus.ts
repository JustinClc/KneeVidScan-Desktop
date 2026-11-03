/**
 * Per-camera trial video status (phone → desktop temp folder → Save).
 */

import {
  backendClient,
  type TrialInfo,
  type TrialUploadInfo,
  type UploadStatus,
} from './backendClient';

export const UPLOAD_STATUS_LABEL: Record<UploadStatus, string> = {
  recording: 'Recording on phone',
  uploading: 'Uploading…',
  converting: 'Converting to MP4…',
  ready: 'Ready',
  failed: 'Failed',
  cleared: 'Saved · temp copy removed',
};

const IN_FLIGHT: ReadonlySet<UploadStatus> = new Set([
  'recording',
  'uploading',
  'converting',
]);

export function isInFlight(u: TrialUploadInfo | undefined): boolean {
  return Boolean(u && IN_FLIGHT.has(u.status));
}

export function uploadLabel(u: TrialUploadInfo | undefined): string {
  if (!u) return 'No recording from this camera';
  if (u.status === 'failed') return `Failed · ${u.error || 'upload failed'}`;
  if (u.status === 'uploading' && u.bytes > 0) {
    return `Uploading… ${(u.bytes / 1_000_000).toFixed(1)} MB`;
  }
  return UPLOAD_STATUS_LABEL[u.status];
}

/** Share of the bar given to the upload when an MP4 conversion follows it. */
export const UPLOAD_SHARE_BEFORE_CONVERT = 80;

/**
 * Whole-transfer percent for one camera: upload then (WebM only) MP4
 * conversion. Null while the share cannot be measured (no announced size).
 */
export function transferPercent(u: TrialUploadInfo | undefined): number | null {
  if (!u) return null;
  const converts = /\.webm$/i.test(u.filename);
  const uploadShare = converts ? UPLOAD_SHARE_BEFORE_CONVERT : 100;
  switch (u.status) {
    case 'recording':
      return 0;
    case 'uploading':
      if (!u.totalBytes) return null;
      return Math.min(99, (u.bytes / u.totalBytes) * uploadShare);
    case 'converting':
      return Math.min(
        99,
        uploadShare + (u.convertProgress ?? 0) * (100 - uploadShare),
      );
    case 'ready':
    case 'cleared':
      return 100;
    case 'failed':
      return null;
  }
}

/** Desktop gives up on a conversion that runs this long (backend has no cap). */
export const SAVE_WAIT_MAX_MS = 10 * 60_000;

/**
 * Poll the trial until no listed camera is still recording / uploading /
 * converting. The backend fails cameras that go quiet for 60 s after Stop.
 */
export async function waitForUploads(
  trialId: string,
  deviceIds: string[],
  opts: {
    onProgress?: (
      pending: Array<{ deviceId: string; upload: TrialUploadInfo }>,
    ) => void;
    pollMs?: number;
    maxWaitMs?: number;
    getTrial?: (id: string) => Promise<TrialInfo>;
  } = {},
): Promise<Record<string, TrialUploadInfo | undefined>> {
  const getTrial = opts.getTrial ?? backendClient.getTrial;
  const pollMs = opts.pollMs ?? 1000;
  const deadline = Date.now() + (opts.maxWaitMs ?? SAVE_WAIT_MAX_MS);
  for (;;) {
    const { uploads } = await getTrial(trialId);
    const pending = deviceIds
      .filter((id) => isInFlight(uploads[id]))
      .map((deviceId) => ({ deviceId, upload: uploads[deviceId] }));
    if (!pending.length || Date.now() >= deadline) {
      return Object.fromEntries(deviceIds.map((id) => [id, uploads[id]]));
    }
    opts.onProgress?.(pending);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
