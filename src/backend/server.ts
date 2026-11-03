/**
 * KneeVidScan-Desktop local backend — pairing, shared start, preview, PWA over HTTPS.
 */

import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { generateLocalCerts, preferredLanHost } from './certs';
import { PWA_CSS, PWA_HTML, PWA_JS } from './pwaAssets';
import { resolveTrimWindow } from '../lib/trimWindow';
import {
  convertToMp4,
  probeDurationSec,
  RecordingFiles,
  trimCopies,
} from './recordings';
import { LiteStore, store, type TrialUpload } from './store';
import { CAM_MAX } from '../lib/roles';
import { standingFileName } from '../lib/naming';
import {
  estimateFps,
  recommendPreset,
  RECORDING_PRESETS,
  type LinkProbeSample,
  type RecordingPresetId,
  type RecordingQualityMode,
} from '../lib/recordingQuality';

export type LiteServer = {
  port: number;
  lanHost: string;
  apiBase: string;
  pwaBase: string;
  https: boolean;
  /** Same in-memory store the HTTP handlers read and write. */
  store: LiteStore;
  close: () => Promise<void>;
};

type Json = Record<string, unknown>;

function sendJson(res: ServerResponse, status: number, body: Json) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Filename',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  });
  res.end(data);
}

function sendRaw(
  res: ServerResponse,
  status: number,
  body: Buffer | string,
  contentType: string,
  extraHeaders: Record<string, string> = {},
) {
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buf.length,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'X-Frame-At',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(buf);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Json> {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8')) as Json;
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1];
}

function pathParts(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

/** Max hold for `GET …/preview?after=` before answering 404 (no new frame). */
const PREVIEW_LONG_POLL_MS = 1500;

/** Offline MediaPipe WASM + model folder, set by `startLiteServer`. */
let mediapipeDir: string | null = null;
/** This launch's trial videos on disk, set by `startLiteServer`. */
let recordings: RecordingFiles | null = null;
/** Bundled ffmpeg for WebM and non-ftyp MP4 → MP4; those uploads fail without it. */
let ffmpegPath: string | null = null;

const RECORDING_PRESET_IDS: RecordingPresetId[] = ['1080p', '720p', '480p'];

function isRecordingQualityMode(v: unknown): v is RecordingQualityMode {
  return v === 'auto' || v === '1080p' || v === '720p' || v === '480p';
}

function parseLinkProbe(body: Json): LinkProbeSample {
  const num = (key: string) => {
    const v = body[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  return {
    width: num('width'),
    height: num('height'),
    frameRate: num('frameRate'),
    uploadBytesPerSec: num('uploadBytesPerSec'),
  };
}

function recordingQualityPayload(s: LiteStore): Json {
  const probes = s.resolutionLinkProbes();
  const estimates: Record<RecordingPresetId, number> = {
    '1080p': 0,
    '720p': 0,
    '480p': 0,
  };
  if (probes.length) {
    for (const id of RECORDING_PRESET_IDS) {
      estimates[id] = Math.min(...probes.map((p) => estimateFps(id, p)));
    }
  }
  return {
    mode: s.recordingQualityMode,
    resolved: s.resolvedRecordingPreset(),
    previewEnabled: s.previewEnabled,
    recommendation: recommendPreset(probes),
    estimates,
    probes: s.listLinkProbes().length,
  };
}

function uploadMeta(u: TrialUpload) {
  return {
    status: u.status,
    bytes: u.bytes,
    filename: u.filename,
    at: u.at,
    ...(u.totalBytes ? { totalBytes: u.totalBytes } : {}),
    ...(u.convertProgress != null
      ? { convertProgress: u.convertProgress }
      : {}),
    ...(u.error ? { error: u.error } : {}),
    ...(u.originalPath && u.path && u.originalPath !== u.path
      ? { trimmed: true }
      : {}),
  };
}

/** Phone or tunnel dropped the upload socket. The body is incomplete. */
function isClientAbort(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { message?: string; code?: string };
  return (
    e.code === 'ECONNRESET' ||
    e.code === 'EPIPE' ||
    e.code === 'ABORT_ERR' ||
    /aborted/i.test(e.message ?? '')
  );
}

/** `bytes=a-b` → inclusive byte span within `size`; null if absent/invalid. */
export function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!m || (!m[1] && !m[2]) || size <= 0) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start <= end && start < size ? { start, end } : null;
}

/** `<device>.webm` or `<device>.src.mp4` → `<device>.mp4`. */
export function convertedMp4Path(inputPath: string): string {
  const mp4Path = inputPath.replace(/\.(?:webm|src\.mp4)$/, '.mp4');
  if (mp4Path === inputPath) {
    throw new Error(`Unexpected upload path: ${inputPath}`);
  }
  return mp4Path;
}

async function convertInBackground(
  trialId: string,
  deviceId: string,
  inputPath: string,
) {
  try {
    const mp4Path = convertedMp4Path(inputPath);
    if (!ffmpegPath) throw new Error('MP4 converter (ffmpeg) is missing');
    await convertToMp4(ffmpegPath, inputPath, mp4Path, {
      durationSec: store.trialDurationSec(trialId),
      onProgress: (f) => store.conversionProgress(trialId, deviceId, f),
    });
    await fs.rm(inputPath, { force: true });
    const { size } = await fs.stat(mp4Path);
    if (store.getUpload(trialId, deviceId)?.status === 'converting') {
      store.uploadReady(trialId, deviceId, mp4Path, size);
    }
  } catch (err) {
    store.failUpload(
      trialId,
      deviceId,
      err instanceof Error ? err.message : 'MP4 conversion failed',
    );
  }
}

const MEDIAPIPE_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
};

async function serveMediapipe(res: ServerResponse, pathname: string) {
  const rel = decodeURIComponent(pathname.slice('/mediapipe/'.length));
  const type = MEDIAPIPE_TYPES[path.extname(rel)];
  if (!mediapipeDir || !type) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  const full = path.resolve(mediapipeDir, rel);
  if (!full.startsWith(path.resolve(mediapipeDir) + path.sep)) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  try {
    sendRaw(res, 200, await fs.readFile(full), type);
  } catch {
    sendJson(res, 404, {
      error: 'MediaPipe asset missing — run pnpm mediapipe:assets',
    });
  }
}

function standingCode(raw: string | undefined): 'F' | 'LL' | 'RL' | null {
  const code = (raw ?? '').toUpperCase();
  return code === 'F' || code === 'LL' || code === 'RL' ? code : null;
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const parts = pathParts(url.pathname);
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    sendJson(res, 204, {});
    return true;
  }

  if (url.pathname === '/v1/locale') {
    if (method === 'GET') {
      sendJson(res, 200, {
        locale: store.operatorLocale,
        ready: store.localeReady,
      });
      return true;
    }
    if (method === 'POST') {
      const body = await readJson(req);
      const next = body.locale;
      if (next !== 'en' && next !== 'zh-Hant' && next !== 'zh-Hans') {
        sendJson(res, 400, {
          error: 'Locale must be en, zh-Hant, or zh-Hans',
        });
        return true;
      }
      store.operatorLocale = next;
      store.localeReady = true;
      sendJson(res, 200, { locale: next, ready: true });
      return true;
    }
  }

  // Health
  if (method === 'GET' && url.pathname === '/v1/health') {
    sendJson(res, 200, { ok: true, cam_max: CAM_MAX, ...store.snapshot() });
    return true;
  }

  // Snapshot for desktop UI
  if (method === 'GET' && url.pathname === '/v1/session') {
    sendJson(res, 200, store.snapshot() as unknown as Json);
    return true;
  }

  if (method === 'GET' && url.pathname === '/v1/session/recording-quality') {
    sendJson(res, 200, recordingQualityPayload(store));
    return true;
  }

  if (method === 'POST' && url.pathname === '/v1/session/recording-quality') {
    const body = await readJson(req);
    if (isRecordingQualityMode(body.mode)) {
      store.setRecordingQualityMode(body.mode);
    }
    if (typeof body.previewEnabled === 'boolean') {
      store.setPreviewEnabled(body.previewEnabled);
    }
    if (body.requestProbes === true) {
      store.requestLinkProbes();
    }
    sendJson(res, 200, recordingQualityPayload(store));
    return true;
  }

  // Create pairing
  if (method === 'POST' && url.pathname === '/v1/device-pairings') {
    let publicBase: string | undefined;
    let replaceDeviceId: string | undefined;
    try {
      const body = await readJson(req);
      if (
        typeof body.replace_device_id === 'string' &&
        body.replace_device_id
      ) {
        replaceDeviceId = body.replace_device_id;
      }
      if (
        typeof body.public_base_url === 'string' &&
        body.public_base_url.trim()
      ) {
        const parsed = new URL(body.public_base_url.trim());
        if (parsed.protocol !== 'https:') throw new Error('not https');
        publicBase = parsed.origin;
      }
    } catch {
      sendJson(res, 400, {
        error:
          'Public URL must be an https:// address, for example https://abc.ngrok-free.app',
      });
      return true;
    }
    const result = store.createPairing({ publicBase, replaceDeviceId });
    if (!result.ok) {
      sendJson(res, 409, { error: result.error });
      return true;
    }
    sendJson(res, 201, {
      id: result.pairing.id,
      code: result.code,
      status: result.pairing.status,
      expires_at: result.pairing.expiresAt,
      qr_url: result.qrUrl,
      reserved_index: result.pairing.reservedIndex,
      replace_device_id: result.pairing.replaceDeviceId ?? null,
    });
    return true;
  }

  // Get / cancel pairing
  if (parts[0] === 'v1' && parts[1] === 'device-pairings' && parts[2]) {
    const id = parts[2];
    if (method === 'GET' && parts.length === 3) {
      const p = store.getPairing(id);
      if (!p) {
        sendJson(res, 404, { error: 'Not found' });
        return true;
      }
      const device = p.deviceId
        ? store.devices.find((d) => d.deviceId === p.deviceId)
        : undefined;
      sendJson(res, 200, {
        id: p.id,
        code: p.code,
        status: p.status,
        expires_at: p.expiresAt,
        reserved_index: p.reservedIndex,
        device: device
          ? {
              device_id: device.deviceId,
              name: device.name,
              cam_index: device.camIndex,
              view_code: device.viewCode,
            }
          : null,
      });
      return true;
    }

    if (method === 'DELETE' && parts.length === 3) {
      const ok = store.cancelPairing(id);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
      return true;
    }

    // POST /v1/device-pairings/:id/complete
    if (method === 'POST' && parts[3] === 'complete') {
      const body = await readJson(req);
      const result = store.completePairing(id, {
        code: typeof body.code === 'string' ? body.code : undefined,
        deviceName:
          typeof body.device_name === 'string' ? body.device_name : undefined,
      });
      if (!result.ok) {
        sendJson(res, result.status ?? 400, { error: result.error });
        return true;
      }
      sendJson(res, 200, {
        device_id: result.deviceId,
        device_pairing_token: result.devicePairingToken,
        cam_index: result.camIndex,
        view_code: result.viewCode,
      });
      return true;
    }
  }

  // Mock complete (desktop / CI — no phone hardware)
  if (
    method === 'POST' &&
    url.pathname === '/v1/device-pairings/mock-complete'
  ) {
    const body = await readJson(req);
    const result = store.mockCompleteActivePairing(
      typeof body.device_name === 'string' ? body.device_name : undefined,
    );
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return true;
    }
    sendJson(res, 200, {
      device_id: result.deviceId,
      device_pairing_token: result.devicePairingToken,
      cam_index: result.camIndex,
      view_code: result.viewCode,
      devices: store.devices.map((d) => ({
        device_id: d.deviceId,
        name: d.name,
        cam_index: d.camIndex,
        view_code: d.viewCode,
        paired_at: d.pairedAt,
      })),
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/v1/usb-cameras') {
    const body = await readJson(req);
    const result = store.connectUsbCamera(
      typeof body.camera_id === 'string' ? body.camera_id : '',
      typeof body.name === 'string' ? body.name : '',
    );
    if (!result.ok) {
      sendJson(res, 409, { error: result.error });
    } else {
      sendJson(res, 201, {
        device_id: result.deviceId,
        device_pairing_token: result.devicePairingToken,
        cam_index: result.camIndex,
        view_code: result.viewCode,
      });
    }
    return true;
  }

  // Devices list / delete
  if (method === 'GET' && url.pathname === '/v1/devices') {
    sendJson(res, 200, {
      devices: store.devices.map((d) => ({
        device_id: d.deviceId,
        name: d.name,
        cam_index: d.camIndex,
        view_code: d.viewCode,
        paired_at: d.pairedAt,
        has_preview: store.previews.has(d.deviceId),
        ...(d.source ? { source: d.source } : {}),
      })),
    });
    return true;
  }

  if (parts[0] === 'v1' && parts[1] === 'devices' && parts[2]) {
    const deviceId = parts[2];

    if (method === 'DELETE' && parts.length === 3) {
      const ok = store.removeDevice(deviceId);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
      return true;
    }

    // Preview upload
    if (method === 'POST' && parts[3] === 'preview') {
      const device = store.authDevice(bearer(req));
      if (!device || device.deviceId !== deviceId) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return true;
      }
      const jpeg = await readBody(req);
      if (!jpeg.length) {
        sendJson(res, 400, { error: 'Empty preview' });
        return true;
      }
      store.setPreview(deviceId, jpeg);
      sendJson(res, 204, {});
      return true;
    }

    // Preview get. `?after=<at>` long-polls until a newer frame arrives.
    if (method === 'GET' && parts[3] === 'preview') {
      const afterRaw = url.searchParams.get('after');
      const after = afterRaw == null ? null : Number(afterRaw);
      const frame =
        after != null && Number.isFinite(after)
          ? await store.waitForPreview(deviceId, after, PREVIEW_LONG_POLL_MS)
          : store.previews.get(deviceId);
      if (!frame) {
        sendJson(res, 404, { error: 'No preview' });
        return true;
      }
      sendRaw(res, 200, frame.jpeg, 'image/jpeg', {
        'X-Frame-At': String(frame.at),
      });
      return true;
    }

    // Phone switched cameras: show the new camera name on the desktop
    if (method === 'POST' && parts[3] === 'camera' && parts.length === 4) {
      const device = store.authDevice(bearer(req));
      if (!device || device.deviceId !== deviceId) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return true;
      }
      const body = await readJson(req);
      const renamed = store.renameDevice(
        deviceId,
        typeof body.name === 'string' ? body.name : '',
      );
      if (!renamed) {
        sendJson(res, 400, { error: 'Camera name required' });
        return true;
      }
      sendJson(res, 200, { ok: true, name: renamed.name });
      return true;
    }

    // Standing still: desktop requests a full-res grab from the phone
    if (
      method === 'POST' &&
      parts[3] === 'still-request' &&
      parts.length === 4
    ) {
      store.clearStill(deviceId);
      const ok = store.requestStill(deviceId);
      if (!ok) {
        sendJson(res, 404, { error: 'Device not found' });
        return true;
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    // Desktop heartbeat: phone streams max-res + boosted preview while active
    if (
      method === 'POST' &&
      parts[3] === 'standing-mode' &&
      parts.length === 4
    ) {
      const body = await readJson(req);
      const ok = store.setStandingMode(deviceId, body.active === true);
      if (!ok) {
        sendJson(res, 404, { error: 'Device not found' });
        return true;
      }
      sendJson(res, 200, { ok: true, active: body.active === true });
      return true;
    }

    // Desktop heartbeat: phone sends ~10 fps previews for the Capture pose overlay
    if (
      method === 'POST' &&
      parts[3] === 'live-pose-mode' &&
      parts.length === 4
    ) {
      const body = await readJson(req);
      const ok = store.setLivePoseMode(deviceId, body.active === true);
      if (!ok) {
        sendJson(res, 404, { error: 'Device not found' });
        return true;
      }
      sendJson(res, 200, { ok: true, active: body.active === true });
      return true;
    }

    if (
      method === 'POST' &&
      parts[3] === 'link-probe-bytes' &&
      parts.length === 4
    ) {
      const device = store.authDevice(bearer(req));
      if (!device || device.deviceId !== deviceId) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return true;
      }
      const payload = await readBody(req);
      sendJson(res, 200, { ok: true, received: payload.length });
      return true;
    }

    if (method === 'POST' && parts[3] === 'link-probe' && parts.length === 4) {
      const device = store.authDevice(bearer(req));
      if (!device || device.deviceId !== deviceId) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return true;
      }
      const body = await readJson(req);
      store.setLinkProbe(deviceId, parseLinkProbe(body));
      store.acknowledgeLinkProbe(deviceId);
      sendJson(res, 200, { ok: true });
      return true;
    }

    // Phone polls whether a still is requested
    if (
      method === 'GET' &&
      parts[3] === 'still-request' &&
      parts.length === 4
    ) {
      const device = store.authDevice(bearer(req));
      if (!device || device.deviceId !== deviceId) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return true;
      }
      sendJson(res, 200, {
        pending: store.claimStillRequest(deviceId),
        standing: store.isStandingMode(deviceId),
        livePose: store.isLivePoseMode(deviceId),
        recordingPreset: store.resolvedRecordingPreset(),
        videoBitsPerSecond:
          RECORDING_PRESETS[store.resolvedRecordingPreset()].videoBitsPerSecond,
        previewEnabled: store.previewEnabled,
        probeRequested: store.isProbeRequested(deviceId),
      });
      return true;
    }

    // Phone uploads a clean full-res still (JPEG or PNG)
    if (method === 'POST' && parts[3] === 'still' && parts.length === 4) {
      const device = store.authDevice(bearer(req));
      if (!device || device.deviceId !== deviceId) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return true;
      }
      const png = await readBody(req);
      if (!png.length) {
        sendJson(res, 400, { error: 'Empty still' });
        return true;
      }
      const type = req.headers['content-type'];
      store.consumeStillRequest(deviceId);
      store.setStill(
        deviceId,
        png,
        true,
        type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      );
      sendJson(res, 200, { ok: true, bytes: png.length });
      return true;
    }

    // Phone reports it could not grab / send the still
    if (method === 'POST' && parts[3] === 'still-error' && parts.length === 4) {
      const device = store.authDevice(bearer(req));
      if (!device || device.deviceId !== deviceId) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return true;
      }
      const body = await readJson(req).catch(() => ({}) as Json);
      store.failStill(
        deviceId,
        typeof body.error === 'string' ? body.error.slice(0, 200) : '',
      );
      sendJson(res, 200, { ok: true });
      return true;
    }

    // Desktop fetches the latest still (consumed); 404 carries the progress
    if (method === 'GET' && parts[3] === 'still' && parts.length === 4) {
      const frame = store.takeStill(deviceId);
      if (!frame) {
        sendJson(res, 404, store.stillState(deviceId));
        return true;
      }
      sendRaw(res, 200, frame.png, frame.contentType);
      return true;
    }

    // Full-res upload after trial, streamed to the launch's temp folder
    if (
      method === 'POST' &&
      parts[3] === 'trials' &&
      parts[4] &&
      parts[5] === 'upload' &&
      parts.length === 6
    ) {
      const device = store.authDevice(bearer(req));
      if (!device || device.deviceId !== deviceId) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return true;
      }
      const trialId = parts[4];
      const trial = store.trials.get(trialId);
      if (!trial || !recordings) {
        sendJson(res, 404, { error: 'Trial not found' });
        return true;
      }
      if (trial.phase === 'cancelled') {
        sendJson(res, 409, { error: 'Trial was cancelled' });
        return true;
      }
      const filename =
        (typeof req.headers['x-filename'] === 'string'
          ? req.headers['x-filename']
          : null) ||
        url.searchParams.get('filename') ||
        `trial_${trialId}.mp4`;
      store.beginUpload(
        trialId,
        deviceId,
        filename,
        Number(req.headers['content-length']) || undefined,
      );
      let saved;
      try {
        saved = await recordings.write(trialId, deviceId, req, (bytes) =>
          store.uploadProgress(trialId, deviceId, bytes),
        );
      } catch (err) {
        // A reset socket is "aborted". Leave the camera uploading so the
        // phone can send the same video again. A 4xx would stop that retry.
        if (isClientAbort(err)) {
          if (!res.headersSent && !res.writableEnded && !res.destroyed) {
            try {
              sendJson(res, 503, { error: 'Upload connection dropped' });
            } catch {
              /* the phone already hung up */
            }
          }
          return true;
        }
        const message = err instanceof Error ? err.message : 'Upload failed';
        store.failUpload(trialId, deviceId, message);
        if (!res.headersSent && !res.destroyed) {
          sendJson(res, 400, { error: message });
        }
        return true;
      }
      if (saved.format === 'mp4') {
        store.uploadReady(trialId, deviceId, saved.path, saved.bytes);
      } else {
        // WebM and MP4 that does not start with ftyp both become a normal MP4.
        store.uploadConverting(trialId, deviceId, saved.bytes);
        void convertInBackground(trialId, deviceId, saved.path);
      }
      sendJson(res, 200, {
        ok: true,
        bytes: saved.bytes,
        status: store.getUpload(trialId, deviceId)?.status ?? 'ready',
      });
      return true;
    }

    // Phone gave up after its retries
    if (
      method === 'POST' &&
      parts[3] === 'trials' &&
      parts[4] &&
      parts[5] === 'upload-error' &&
      parts.length === 6
    ) {
      const device = store.authDevice(bearer(req));
      if (!device || device.deviceId !== deviceId) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return true;
      }
      const body = await readJson(req).catch(() => ({}) as Json);
      const ok = store.failUpload(
        parts[4],
        deviceId,
        typeof body.error === 'string' ? body.error.slice(0, 200) : '',
      );
      sendJson(
        res,
        ok ? 200 : 404,
        ok ? { ok: true } : { error: 'Trial not found' },
      );
      return true;
    }

    // Desktop reads the original MP4 for Save / pose re-run (no overlay)
    if (
      method === 'GET' &&
      parts[3] === 'trials' &&
      parts[4] &&
      parts[5] === 'upload' &&
      parts.length === 6
    ) {
      const hit = store.getUpload(parts[4], deviceId);
      if (hit?.status !== 'ready' || !hit.path) {
        sendJson(res, 404, {
          error: 'Upload not found',
          status: hit?.status ?? null,
        });
        return true;
      }
      const { size } = await fs.stat(hit.path);
      const headers = {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      };
      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const range = parseByteRange(rangeHeader, size);
        if (!range) {
          res.writeHead(416, {
            ...headers,
            'Content-Range': `bytes */${size}`,
          });
          res.end();
          return true;
        }
        res.writeHead(206, {
          ...headers,
          'Content-Length': range.end - range.start + 1,
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        });
        createReadStream(hit.path, range).pipe(res);
        return true;
      }
      res.writeHead(200, { ...headers, 'Content-Length': size });
      createReadStream(hit.path).pipe(res);
      return true;
    }
  }

  // List trials (Review picker / Save)
  if (method === 'GET' && url.pathname === '/v1/trials') {
    sendJson(res, 200, { trials: store.listTrials() });
    return true;
  }

  // Latest previews index for desktop
  if (method === 'GET' && url.pathname === '/v1/previews') {
    const items: Json[] = [];
    for (const d of store.devices) {
      const frame = store.previews.get(d.deviceId);
      items.push({
        device_id: d.deviceId,
        cam_index: d.camIndex,
        view_code: d.viewCode,
        at: frame?.at ?? null,
        url: frame ? `/v1/devices/${d.deviceId}/preview?t=${frame.at}` : null,
      });
    }
    sendJson(res, 200, { previews: items });
    return true;
  }

  // Desktop import: plant an MP4 where Pose already reads full-res uploads.
  // No phone pairing and no bearer token — the operator is on this machine.
  if (method === 'POST' && url.pathname === '/v1/imports') {
    const filename = url.searchParams.get('filename')?.trim() || 'import.mp4';
    const requestedId = url.searchParams.get('trial_id')?.trim() || '';
    if (!filename.toLowerCase().endsWith('.mp4')) {
      await readBody(req);
      sendJson(res, 400, { error: 'Only MP4 files can be imported' });
      return true;
    }
    if (!recordings) {
      await readBody(req);
      sendJson(res, 500, { error: 'Recordings unavailable' });
      return true;
    }
    if (requestedId && !store.trials.has(requestedId)) {
      await readBody(req);
      sendJson(res, 404, { error: 'Trial not found' });
      return true;
    }
    if (url.searchParams.get('fresh') === '1') store.clearDevices();

    let createdNow = false;
    let trial = requestedId ? store.trials.get(requestedId) : undefined;
    if (!trial) {
      const name = url.searchParams.get('name')?.trim() || 'import01';
      trial = store.createTrial(name);
      createdNow = true;
    }
    const added = store.addImportDevice(filename);
    if (!added.ok) {
      await readBody(req);
      if (createdNow) store.trials.delete(trial.id);
      sendJson(res, 409, { error: added.error });
      return true;
    }
    const deviceId = added.device.deviceId;
    const dropFailed = async () => {
      await recordings?.removeDevice(trial.id, deviceId);
      store.removeDevice(deviceId);
      if (createdNow) store.trials.delete(trial.id);
    };
    let saved;
    try {
      saved = await recordings.write(trial.id, deviceId, req);
    } catch (err) {
      await dropFailed();
      const message = err instanceof Error ? err.message : 'Import failed';
      sendJson(res, 400, {
        error: /not MP4 or WebM|empty recording/i.test(message)
          ? 'Only MP4 files can be imported'
          : message,
      });
      return true;
    }
    if (saved.format !== 'mp4') {
      await dropFailed();
      sendJson(res, 400, { error: 'Only MP4 files can be imported' });
      return true;
    }
    store.beginUpload(trial.id, deviceId, filename, saved.bytes);
    store.uploadReady(trial.id, deviceId, saved.path, saved.bytes);
    let durationSec: number | null = null;
    if (ffmpegPath) {
      try {
        durationSec = await probeDurationSec(ffmpegPath, saved.path);
      } catch {
        durationSec = null;
      }
    }
    const finished = store.finishImport(trial.id, durationSec);
    sendJson(res, 201, {
      ok: true,
      trial_id: trial.id,
      name: trial.name,
      duration_sec: finished?.importDurationSec ?? null,
      device_id: deviceId,
      cam_index: added.device.camIndex,
      view_code:
        store.devices.find((d) => d.deviceId === deviceId)?.viewCode ?? null,
      filename,
      bytes: saved.bytes,
      devices: store.devices.map((d) => ({
        device_id: d.deviceId,
        name: d.name,
        cam_index: d.camIndex,
        view_code: d.viewCode,
        paired_at: d.pairedAt,
      })),
    });
    return true;
  }

  // Trials
  if (method === 'POST' && url.pathname === '/v1/trials') {
    const body = await readJson(req);
    const name = typeof body.name === 'string' ? body.name : 'gait01';
    const trial = store.createTrial(name);
    sendJson(res, 201, {
      trial_id: trial.id,
      name: trial.name,
      phase: trial.phase,
    });
    return true;
  }

  // Phones poll this; `server_now` lets them correct for clock offset.
  if (method === 'GET' && url.pathname === '/v1/trials/active') {
    const active = store.activeTrial();
    if (!active) {
      sendJson(res, 200, { server_now: Date.now(), trial: null });
      return true;
    }
    sendJson(res, 200, {
      server_now: Date.now(),
      trial: {
        trial_id: active.id,
        name: active.name,
        participants: active.participants,
        phase: active.phase,
        start_signal: active.startSignal
          ? {
              trialId: active.startSignal.trialId,
              trialName: active.startSignal.trialName,
              startAtMs: active.startSignal.startAtMs,
              maxDurationMs: active.startSignal.maxDurationMs,
            }
          : null,
      },
    });
    return true;
  }

  if (parts[0] === 'v1' && parts[1] === 'trials' && parts[2]) {
    const trialId = parts[2];
    const trial = store.trials.get(trialId);
    if (!trial) {
      sendJson(res, 404, { error: 'Trial not found' });
      return true;
    }

    if (method === 'GET' && parts.length === 3) {
      const uploadsMeta: Record<string, ReturnType<typeof uploadMeta>> = {};
      for (const [deviceId, u] of Object.entries(
        store.uploadStatuses(trialId) ?? {},
      )) {
        uploadsMeta[deviceId] = uploadMeta(u);
      }
      sendJson(res, 200, {
        trial_id: trial.id,
        name: trial.name,
        phase: trial.phase,
        start_signal: trial.startSignal ?? null,
        participants: trial.participants,
        uploads: uploadsMeta,
      });
      return true;
    }

    if (method === 'POST' && parts[3] === 'arm') {
      store.armTrial(trialId);
      sendJson(res, 200, { ok: true, phase: 'armed' });
      return true;
    }

    if (method === 'POST' && parts[3] === 'start') {
      const body = await readJson(req);
      const custom =
        body.leadMs !== undefined || body.maxDurationMs !== undefined;
      if (custom && (body.leadMs !== 5000 || body.maxDurationMs !== 20000)) {
        sendJson(res, 400, { error: 'Invalid sit-to-stand recording timing' });
        return true;
      }
      const signal = store.startTrial(
        trialId,
        custom ? { leadMs: 5000, maxDurationMs: 20000 } : undefined,
      );
      if (!signal) {
        sendJson(res, 404, { error: 'Trial not found' });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        phase: 'recording',
        start_signal: {
          trialId: signal.trialId,
          trialName: signal.trialName,
          startAtMs: signal.startAtMs,
          maxDurationMs: signal.maxDurationMs,
        },
      });
      return true;
    }

    if (method === 'POST' && parts[3] === 'stop') {
      const t = store.stopTrial(trialId);
      sendJson(res, 200, { ok: true, phase: t?.phase ?? 'done' });
      return true;
    }

    if (method === 'POST' && parts[3] === 'cancel') {
      store.cancelTrial(trialId);
      await recordings?.removeTrial(trialId);
      sendJson(res, 200, { ok: true, phase: 'cancelled' });
      return true;
    }

    // After a successful Save the temp copies are no longer needed.
    if (
      method === 'DELETE' &&
      parts[3] === 'recordings' &&
      parts.length === 4
    ) {
      await recordings?.removeTrial(trialId);
      store.clearRecordings(trialId);
      sendJson(res, 200, { ok: true });
      return true;
    }

    // Replace every ready view with the same [start, end] cut.
    if (method === 'POST' && parts[3] === 'trim' && parts.length === 4) {
      const body = await readJson(req);
      const startSec = Number(body.start_sec);
      const endSec = Number(body.end_sec);
      if (
        !Number.isFinite(startSec) ||
        !Number.isFinite(endSec) ||
        startSec < 0 ||
        endSec <= startSec
      ) {
        sendJson(res, 400, { error: 'start_sec and end_sec are required' });
        return true;
      }
      const entries = Object.entries(store.uploadStatuses(trialId) ?? {});
      if (
        entries.length === 0 ||
        entries.some(([, u]) => u.status !== 'ready' || !u.path)
      ) {
        sendJson(res, 409, {
          error: 'Every view must finish uploading before trim',
        });
        return true;
      }
      if (!ffmpegPath) {
        sendJson(res, 500, { error: 'MP4 trimmer (ffmpeg) is missing' });
        return true;
      }
      const paths = entries.map(([, u]) => u.path!);
      let window: { startSec: number; endSec: number };
      try {
        const durations = await Promise.all(
          paths.map((p) => probeDurationSec(ffmpegPath!, p)),
        );
        window = resolveTrimWindow(durations, startSec, endSec);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Trim failed';
        const status = /shortest view|too short|duration/i.test(message)
          ? 400
          : 500;
        sendJson(res, status, { error: message });
        return true;
      }
      let copies;
      try {
        copies = await trimCopies(
          ffmpegPath,
          paths,
          window.startSec,
          window.endSec,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Trim failed';
        sendJson(res, 500, { error: message });
        return true;
      }
      if (copies.length !== entries.length) {
        await Promise.all(copies.map((c) => fs.rm(c.path, { force: true })));
        sendJson(res, 500, { error: 'Trim did not cover every view' });
        return true;
      }
      for (const [deviceId] of entries)
        store.keepPhoneUpload(trialId, deviceId);
      const previous = entries.map(([, u]) => u.path!);
      const originals = new Set(
        entries.map(
          ([deviceId]) => store.getUpload(trialId, deviceId)?.originalPath,
        ),
      );
      entries.forEach(([deviceId], i) => {
        const copy = copies[i];
        if (!copy) return;
        store.uploadReady(trialId, deviceId, copy.path, copy.bytes);
      });
      await Promise.all(
        previous
          .filter((p) => !originals.has(p))
          .map((p) => fs.rm(p, { force: true })),
      );
      sendJson(res, 200, {
        ok: true,
        start_sec: window.startSec,
        end_sec: window.endSec,
        duration_sec: window.endSec - window.startSec,
        views: copies.length,
      });
      return true;
    }

    // Put every view back on the phone upload kept by the first trim.
    if (method === 'POST' && parts[3] === 'revert' && parts.length === 4) {
      const entries = Object.entries(store.uploadStatuses(trialId) ?? {});
      const restorable = entries.filter(
        ([, u]) =>
          u.status === 'ready' &&
          u.originalPath &&
          u.path &&
          u.originalPath !== u.path,
      );
      if (restorable.length === 0 || restorable.length !== entries.length) {
        sendJson(res, 409, { error: 'Nothing to revert' });
        return true;
      }
      let durationSec = 0;
      if (ffmpegPath) {
        try {
          const durations = await Promise.all(
            restorable.map(([, u]) =>
              probeDurationSec(ffmpegPath!, u.originalPath!),
            ),
          );
          durationSec = Math.max(0, ...durations);
        } catch {
          durationSec = 0;
        }
      }
      for (const [deviceId, u] of restorable) {
        if (u.path && u.path !== u.originalPath) {
          await fs.rm(u.path, { force: true });
        }
        store.uploadReady(
          trialId,
          deviceId,
          u.originalPath!,
          u.originalBytes ?? 0,
        );
      }
      sendJson(res, 200, {
        ok: true,
        views: restorable.length,
        duration_sec: durationSec,
      });
      return true;
    }
  }

  // Subjects + standing posture PNGs
  if (method === 'GET' && url.pathname === '/v1/subjects') {
    const snap = store.snapshot();
    sendJson(res, 200, { subjects: snap.subjects });
    return true;
  }

  if (parts[0] === 'v1' && parts[1] === 'subjects' && parts[2]) {
    const subjectId = decodeURIComponent(parts[2]);

    if (method === 'GET' && parts.length === 3) {
      const s = store.getSubject(subjectId);
      if (!s) {
        sendJson(res, 404, { error: 'Subject not found' });
        return true;
      }
      sendJson(res, 200, {
        subject_id: s.subjectId,
        subject_name: s.subjectName,
        height_cm: s.heightCm,
        weight_kg: s.weightKg,
        updated_at: s.updatedAt,
        standing: (['F', 'LL', 'RL'] as const).reduce(
          (acc, code) => {
            const hit = s.standing[code];
            if (hit) {
              acc[code] = {
                filename: hit.filename,
                bytes: hit.bytes,
                at: hit.at,
              };
            }
            return acc;
          },
          {} as Record<string, { filename: string; bytes: number; at: number }>,
        ),
      });
      return true;
    }

    if (method === 'PUT' && parts.length === 3) {
      const body = await readJson(req);
      if (!subjectId.trim()) {
        sendJson(res, 400, { error: 'Subject ID required' });
        return true;
      }
      const record = store.upsertSubject({
        subjectId,
        subjectName:
          typeof body.subject_name === 'string' ? body.subject_name : undefined,
        heightCm:
          typeof body.height_cm === 'string' ? body.height_cm : undefined,
        weightKg:
          typeof body.weight_kg === 'string' ? body.weight_kg : undefined,
      });
      sendJson(res, 200, {
        subject_id: record.subjectId,
        subject_name: record.subjectName,
        height_cm: record.heightCm,
        weight_kg: record.weightKg,
        updated_at: record.updatedAt,
      });
      return true;
    }

    // Replace an accepted annotated preview + clean original together, only after receiving both.
    if (
      method === 'POST' &&
      parts[3] === 'standing' &&
      parts.length === 6 &&
      parts[5] === 'pair'
    ) {
      const code = standingCode(parts[4]);
      const cropBytes = Number(url.searchParams.get('cropBytes'));
      const filename = url.searchParams.get('filename');
      const fullFilename = url.searchParams.get('fullFilename');
      const body = await readBody(req);
      if (
        !subjectId.trim() ||
        !code ||
        !filename ||
        !fullFilename ||
        !Number.isSafeInteger(cropBytes) ||
        cropBytes <= 0 ||
        cropBytes >= body.length
      ) {
        sendJson(res, 400, {
          error: 'Both standing images and filenames are required',
        });
        return true;
      }
      // No awaits between these writes: readers see the complete replacement.
      store.saveStandingPng(
        subjectId,
        code,
        filename,
        body.subarray(0, cropBytes),
      );
      store.saveStandingPng(
        subjectId,
        code,
        fullFilename,
        body.subarray(cropBytes),
        'full',
      );
      sendJson(res, 200, { ok: true, code });
      return true;
    }

    // POST /v1/subjects/:id/standing/:code[/full] — save clean PNG (crop or original)
    const standingVariant =
      parts.length === 6 && parts[5] === 'full'
        ? 'full'
        : parts.length === 5
          ? 'crop'
          : null;
    if (
      method === 'POST' &&
      parts[3] === 'standing' &&
      parts[4] &&
      standingVariant
    ) {
      const code = standingCode(parts[4]);
      if (!code) {
        sendJson(res, 400, { error: 'Standing code must be F, LL, or RL' });
        return true;
      }
      const png = await readBody(req);
      if (!png.length) {
        sendJson(res, 400, { error: 'Empty PNG' });
        return true;
      }
      const filename =
        (typeof req.headers['x-filename'] === 'string'
          ? req.headers['x-filename']
          : null) ||
        url.searchParams.get('filename') ||
        `standing_${code}.png`;
      const record = store.saveStandingPng(
        subjectId,
        code,
        filename,
        png,
        standingVariant,
      );
      if (!record) {
        sendJson(res, 400, { error: 'Subject ID required' });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        code,
        filename,
        bytes: png.length,
      });
      return true;
    }

    // GET standing PNG
    if (
      method === 'GET' &&
      parts[3] === 'standing' &&
      parts[4] &&
      standingVariant
    ) {
      const code = standingCode(parts[4]);
      if (!code) {
        sendJson(res, 400, { error: 'Standing code must be F, LL, or RL' });
        return true;
      }
      const s = store.getSubject(subjectId);
      const hit =
        standingVariant === 'full' ? s?.standingFull[code] : s?.standing[code];
      if (!hit) {
        sendJson(res, 404, { error: 'Standing PNG not found' });
        return true;
      }
      sendRaw(res, 200, hit.png, 'image/png');
      return true;
    }

    // Clear standing (retake)
    if (method === 'DELETE' && parts[3] === 'standing' && parts.length === 4) {
      const record = store.clearStanding(subjectId);
      if (!record) {
        sendJson(res, 404, { error: 'Subject not found' });
        return true;
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    // Demo / CI: save three minimal standing PNGs in order F → LL → RL
    if (
      method === 'POST' &&
      parts[3] === 'standing-demo' &&
      parts.length === 4
    ) {
      const body = await readJson(req);
      const subjectName =
        typeof body.subject_name === 'string' ? body.subject_name : '';
      if (!subjectId.trim()) {
        sendJson(res, 400, { error: 'Subject ID required' });
        return true;
      }
      store.upsertSubject({
        subjectId,
        subjectName,
        heightCm:
          typeof body.height_cm === 'string' ? body.height_cm : undefined,
        weightKg:
          typeof body.weight_kg === 'string' ? body.weight_kg : undefined,
      });
      const files: string[] = [];
      for (const code of ['F', 'LL', 'RL'] as const) {
        const filename = standingFileName(subjectId, subjectName, code);
        store.saveStandingPng(
          subjectId,
          code,
          filename,
          LiteStore.minimalPng(),
        );
        files.push(filename);
      }
      sendJson(res, 200, { ok: true, files });
      return true;
    }
  }

  return false;
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `https://${host}`);

    if (url.pathname === '/pwa' || url.pathname === '/pwa/') {
      sendRaw(res, 200, PWA_HTML, 'text/html; charset=utf-8');
      return;
    }
    if (url.pathname === '/pwa/app.css') {
      sendRaw(res, 200, PWA_CSS, 'text/css; charset=utf-8');
      return;
    }
    if (url.pathname === '/pwa/app.js') {
      sendRaw(res, 200, PWA_JS, 'application/javascript; charset=utf-8');
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/mediapipe/')) {
      await serveMediapipe(res, url.pathname);
      return;
    }

    if (url.pathname.startsWith('/v1/')) {
      const handled = await handleApi(req, res, url);
      if (handled) return;
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}

function listen(server: http.Server | https.Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', onError);
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('Failed to bind Lite backend'));
    });
  });
}

function closeServer(server: http.Server | https.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    // Phone long-polls and uploads would otherwise hold the app's quit.
    server.closeAllConnections();
  });
}

/** Fixed so `ngrok http 52321` keeps working across restarts. */
const DEFAULT_PAGE_PORT = 52321;

export async function startLiteServer(
  opts: {
    port?: number;
    pagePort?: number;
    preferHttps?: boolean;
    /** Folder holding `wasm/` + `pose_landmarker_full.task`. */
    mediapipeDir?: string;
    /**
     * Parent of per-launch video folders. Earlier launch folders under it are
     * removed on start. Omitted: a private temp folder, nothing swept.
     */
    recordingsRoot?: string;
    /** ffmpeg binary used to turn WebM and non-ftyp MP4 uploads into MP4. */
    ffmpegPath?: string;
  } = {},
): Promise<LiteServer> {
  const preferHttps = opts.preferHttps !== false;
  mediapipeDir = opts.mediapipeDir ?? null;
  ffmpegPath = opts.ffmpegPath ?? null;
  const files = await RecordingFiles.create({ root: opts.recordingsRoot });
  recordings = files;
  const lanHost = preferredLanHost();
  const certs = preferHttps ? await generateLocalCerts([lanHost]) : null;

  // The phone QR uses HTTP so the pairing page can render. A self-signed
  // HTTPS URL is rejected by phone browsers before any HTML is shown.
  const pageServer = http.createServer(handler);
  const httpsServer = certs
    ? https.createServer({ key: certs.key, cert: certs.cert }, handler)
    : null;

  let httpPort = 0;
  let httpsPort = 0;
  try {
    httpPort = certs
      ? await listen(pageServer, opts.pagePort ?? DEFAULT_PAGE_PORT).catch(() =>
          listen(pageServer, 0),
        )
      : await listen(pageServer, opts.port ?? 0);
    httpsPort = httpsServer ? await listen(httpsServer, opts.port ?? 0) : 0;
  } catch (err) {
    pageServer.close();
    httpsServer?.close();
    await files.close();
    throw err;
  }
  const pageBase = `http://${lanHost}:${httpPort}`;
  const secureBase = httpsServer
    ? `https://${lanHost}:${httpsPort}`
    : undefined;
  const apiBase = secureBase ?? pageBase;
  const pwaBase = `${pageBase}/pwa/`;
  store.setInfo({
    apiBase: pageBase,
    pwaBase,
    https: Boolean(httpsServer),
    lanHost,
    port: httpsPort || httpPort,
    secureBase,
  });

  return {
    port: httpsPort || httpPort,
    lanHost,
    apiBase,
    pwaBase,
    https: Boolean(httpsServer),
    store,
    close: async () => {
      await closeServer(pageServer);
      if (httpsServer) await closeServer(httpsServer);
      await files.close();
      if (recordings === files) recordings = null;
    },
  };
}

/** Replace Phase 0 stub export. */
export { store };
export { describeBackendStub } from './stub';
