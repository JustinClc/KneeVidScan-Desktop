/**
 * In-memory pairing / trial / preview store for the Lite local backend.
 */

import {
  buildPairingQrUrl,
  isPairingExpired,
  pairingTtlMs,
  randomId,
  randomPairingCode,
  validateNewPairing,
  type DevicePairing,
  type PairedDevice,
} from '../lib/pairing';
import { viewCodeForIndex } from '../lib/roles';
import {
  resolvePreset,
  type LinkProbeSample,
  type RecordingPresetId,
  type RecordingQualityMode,
} from '../lib/recordingQuality';
import {
  computeSharedStart,
  TRIAL_MAX_SECONDS,
  type SharedStartSignal,
  type TrialPhase,
} from '../lib/sync';

export type DeviceToken = {
  deviceId: string;
  token: string;
};

/** Per-camera progress of a trial's video, from Start until Save. */
export type UploadStatus =
  | 'recording'
  | 'uploading'
  | 'converting'
  | 'ready'
  | 'failed'
  | 'cleared';

export type TrialUpload = {
  status: UploadStatus;
  bytes: number;
  /** Upload size the phone announced (Content-Length), while `uploading`. */
  totalBytes?: number;
  /** WebM → MP4 progress 0–1, while `converting`. */
  convertProgress?: number;
  filename: string;
  /** Last activity (start, upload bytes, status change). */
  at: number;
  /** Full-res MP4 on disk (no overlay) once `ready`. Trim replaces it. */
  path?: string;
  /**
   * Phone upload kept after the first trim. Later trims cut the current file
   * and leave this one in place so Revert can restore every view.
   */
  originalPath?: string;
  originalBytes?: number;
  error?: string;
};

/** A camera that sends nothing for this long after Stop is marked failed. */
export const UPLOAD_IDLE_FAIL_MS = 60_000;
/** Phones keep seeing a stopped / cancelled trial this long so they react. */
export const ENDED_TRIAL_VISIBLE_MS = 30_000;

export type TrialRecord = {
  id: string;
  name: string;
  phase: TrialPhase;
  createdAt: number;
  startSignal?: SharedStartSignal;
  stoppedAt?: number;
  /** Cameras paired when the trial started. */
  participants: string[];
  /** deviceId → full-res upload (original media, no overlay) */
  uploads: Record<string, TrialUpload>;
  /** Longest probed length of imported MP4s, when ffmpeg could read it. */
  importDurationSec?: number;
};

export type PreviewFrame = {
  deviceId: string;
  jpeg: Buffer;
  at: number;
};

export type StillFrame = {
  deviceId: string;
  png: Buffer;
  at: number;
  fullRes: boolean;
  contentType: string;
};

/** Desktop-visible progress of a still request. */
export type StillState = 'idle' | 'pending' | 'sending' | 'ready' | 'failed';

export type SubjectRecord = {
  subjectId: string;
  subjectName: string;
  heightCm: string;
  weightKg: string;
  updatedAt: number;
  /** Standing PNGs keyed by F / LL / RL — cropped to the guide frame, no overlay. */
  standing: Partial<Record<'F' | 'LL' | 'RL', StandingPng>>;
  /** Uncropped originals for the same postures (`…_standing_X_full.png`). */
  standingFull: Partial<Record<'F' | 'LL' | 'RL', StandingPng>>;
};

export type StandingPng = {
  filename: string;
  bytes: number;
  at: number;
  png: Buffer;
};

/** Desktop must refresh standing mode within this window or the phone reverts. */
export const STANDING_MODE_TTL_MS = 6000;

export type BackendPublicInfo = {
  apiBase: string;
  pwaBase: string;
  https: boolean;
  lanHost: string;
  port: number;
  /** HTTPS origin for the phone camera. Absent in HTTP-only mode. */
  secureBase?: string;
};

export class LiteStore {
  pairings = new Map<string, DevicePairing>();
  devices: PairedDevice[] = [];
  tokens = new Map<string, string>(); // token → deviceId
  trials = new Map<string, TrialRecord>();
  previews = new Map<string, PreviewFrame>();
  /** Still-capture requests: `pending` until the phone claims it, then `sending`. */
  stillRequests = new Map<string, 'pending' | 'sending'>();
  stills = new Map<string, StillFrame>();
  stillErrors = new Map<string, string>();
  private previewWaiters = new Map<
    string,
    Set<(frame: PreviewFrame) => void>
  >();
  /** deviceId → expiry; phone streams max-res + boosted preview while active. */
  standingModeUntil = new Map<string, number>();
  /** deviceId → expiry; phone sends ~10 fps previews for the Capture pose overlay. */
  livePoseUntil = new Map<string, number>();
  subjects = new Map<string, SubjectRecord>();
  info: BackendPublicInfo | null = null;
  /** Operator Locale. Unpublished until the desktop reports it. */
  operatorLocale: 'en' | 'zh-Hant' | 'zh-Hans' = 'en';
  localeReady = false;
  recordingQualityMode: RecordingQualityMode = 'auto';
  previewEnabled = true;
  /** Probes reported since the last refresh request. */
  linkProbes = new Map<string, LinkProbeSample>();
  /**
   * Probes from before the last refresh. Auto keeps resolving against them
   * until fresh ones arrive so phones do not bounce to the no-probe default.
   */
  staleLinkProbes = new Map<string, LinkProbeSample>();
  /** Incremented when desktop requests fresh link probes from all phones. */
  probeGeneration = 0;
  /** deviceId → probeGeneration last satisfied by a successful link-probe POST. */
  lastProbeGeneration = new Map<string, number>();

  setRecordingQualityMode(mode: RecordingQualityMode) {
    this.recordingQualityMode = mode;
  }

  requestLinkProbes() {
    this.probeGeneration += 1;
    for (const [id, sample] of this.linkProbes) {
      this.staleLinkProbes.set(id, sample);
    }
    this.linkProbes.clear();
    this.lastProbeGeneration.clear();
  }

  isProbeRequested(deviceId: string): boolean {
    const last = this.lastProbeGeneration.get(deviceId);
    if (last === undefined) return true;
    return this.probeGeneration > last;
  }

  acknowledgeLinkProbe(deviceId: string) {
    this.lastProbeGeneration.set(deviceId, this.probeGeneration);
  }

  setPreviewEnabled(on: boolean) {
    this.previewEnabled = on;
  }

  setLinkProbe(deviceId: string, sample: LinkProbeSample) {
    this.linkProbes.set(deviceId, sample);
  }

  clearLinkProbe(deviceId: string) {
    this.linkProbes.delete(deviceId);
    this.staleLinkProbes.delete(deviceId);
  }

  /** Fresh probes only (since the last refresh request). */
  listLinkProbes(): LinkProbeSample[] {
    return [...this.linkProbes.values()];
  }

  /** Fresh probes, falling back per device to the pre-refresh sample. */
  resolutionLinkProbes(): LinkProbeSample[] {
    return [...new Map([...this.staleLinkProbes, ...this.linkProbes]).values()];
  }

  resolvedRecordingPreset(): RecordingPresetId {
    return resolvePreset(
      this.recordingQualityMode,
      this.resolutionLinkProbes(),
    );
  }

  setInfo(info: BackendPublicInfo) {
    this.info = info;
  }

  deviceCount(): number {
    return this.devices.length;
  }

  recomputeRoles() {
    const n = this.devices.length;
    this.devices = this.devices.map((d, i) => ({
      ...d,
      camIndex: i,
      viewCode: viewCodeForIndex(n, i),
    }));
  }

  createPairing(
    opts: { publicBase?: string; replaceDeviceId?: string } = {},
  ):
    | { ok: true; pairing: DevicePairing; qrUrl: string; code: string }
    | { ok: false; error: string } {
    let reservedIndex: number;
    if (opts.replaceDeviceId) {
      const target = this.devices.find(
        (d) => d.deviceId === opts.replaceDeviceId,
      );
      if (!target)
        return { ok: false, error: 'Camera to replace is not paired' };
      reservedIndex = target.camIndex;
    } else {
      const check = validateNewPairing(this.devices.length);
      if (!check.ok) return check;
      reservedIndex = check.reservedIndex;
    }
    if (!this.info) return { ok: false, error: 'Backend not ready' };

    // Only one pending pairing at a time (one QR per device).
    for (const p of this.pairings.values()) {
      if (p.status === 'pending' && !isPairingExpired(p)) {
        return {
          ok: false,
          error: 'A pairing QR is already active — complete or cancel it first',
        };
      }
      if (isPairingExpired(p)) p.status = 'expired';
    }

    const now = Date.now();
    const pairing: DevicePairing = {
      id: randomId('dp'),
      code: randomPairingCode(),
      status: 'pending',
      createdAt: now,
      expiresAt: now + pairingTtlMs(),
      reservedIndex,
      ...(opts.replaceDeviceId
        ? { replaceDeviceId: opts.replaceDeviceId }
        : {}),
    };
    this.pairings.set(pairing.id, pairing);

    const publicBase = opts.publicBase?.replace(/\/+$/, '');
    const qrUrl = publicBase
      ? buildPairingQrUrl(`${publicBase}/pwa/`, {
          api: publicBase,
          device_pairing_id: pairing.id,
          device_pairing_code: pairing.code,
        })
      : buildPairingQrUrl(this.info.pwaBase, {
          api: this.info.apiBase,
          device_pairing_id: pairing.id,
          device_pairing_code: pairing.code,
          secure: this.info.secureBase,
        });
    pairing.qrUrl = qrUrl;

    return { ok: true, pairing, qrUrl, code: pairing.code };
  }

  getPairing(id: string): DevicePairing | undefined {
    const p = this.pairings.get(id);
    if (p && isPairingExpired(p)) {
      p.status = 'expired';
    }
    return p;
  }

  cancelPairing(id: string): boolean {
    const p = this.pairings.get(id);
    if (!p || p.status !== 'pending') return false;
    p.status = 'cancelled';
    return true;
  }

  completePairing(
    id: string,
    opts: { code?: string; deviceName?: string } = {},
  ):
    | {
        ok: true;
        deviceId: string;
        devicePairingToken: string;
        camIndex: number;
        viewCode: 'F' | 'L' | 'O' | null;
      }
    | { ok: false; error: string; status?: number } {
    const p = this.getPairing(id);
    if (!p) return { ok: false, error: 'Pairing not found', status: 404 };
    const replaceIdx = p.replaceDeviceId
      ? this.devices.findIndex((d) => d.deviceId === p.replaceDeviceId)
      : -1;
    if (p.replaceDeviceId && replaceIdx < 0) {
      return {
        ok: false,
        error: 'The camera being replaced is no longer paired',
        status: 409,
      };
    }
    if (!p.replaceDeviceId) {
      const check = validateNewPairing(this.devices.length);
      if (!check.ok) return { ok: false, error: check.error, status: 409 };
    }
    if (p.status === 'expired') {
      return { ok: false, error: 'Pairing expired', status: 410 };
    }
    if (p.status === 'completed') {
      return { ok: false, error: 'Pairing already completed', status: 409 };
    }
    if (p.status !== 'pending') {
      return { ok: false, error: `Pairing is ${p.status}`, status: 409 };
    }
    if (opts.code && opts.code !== p.code) {
      return { ok: false, error: 'Invalid pairing code', status: 403 };
    }

    const deviceId = randomId('dev');
    const token = randomId('tok');
    const camIndex = replaceIdx >= 0 ? replaceIdx : this.devices.length;
    const device: PairedDevice = {
      deviceId,
      name: opts.deviceName?.trim() || `Cam ${camIndex + 1}`,
      camIndex,
      pairedAt: Date.now(),
      viewCode: null,
    };
    if (replaceIdx >= 0) {
      this.forgetDevice(this.devices[replaceIdx].deviceId);
      this.devices[replaceIdx] = device;
    } else {
      this.devices.push(device);
    }
    this.tokens.set(token, deviceId);
    p.status = 'completed';
    p.deviceId = deviceId;
    this.recomputeRoles();

    const updated = this.devices.find((d) => d.deviceId === deviceId)!;
    return {
      ok: true,
      deviceId,
      devicePairingToken: token,
      camIndex: updated.camIndex,
      viewCode: updated.viewCode,
    };
  }

  /** Desktop / CI mock: complete the active pending pairing without a phone. */
  mockCompleteActivePairing(deviceName?: string):
    | {
        ok: true;
        deviceId: string;
        devicePairingToken: string;
        camIndex: number;
        viewCode: 'F' | 'L' | 'O' | null;
      }
    | { ok: false; error: string } {
    const pending = [...this.pairings.values()].find(
      (p) => p.status === 'pending' && !isPairingExpired(p),
    );
    if (!pending) return { ok: false, error: 'No active pairing QR' };
    return this.completePairing(pending.id, {
      code: pending.code,
      deviceName: deviceName ?? `Mock Cam ${this.devices.length + 1}`,
    });
  }

  authDevice(token: string | undefined): PairedDevice | null {
    if (!token) return null;
    const deviceId = this.tokens.get(token);
    if (!deviceId) return null;
    return this.devices.find((d) => d.deviceId === deviceId) ?? null;
  }

  /** Phone switched to another of its cameras; the slot and token stay. */
  renameDevice(deviceId: string, name: string): PairedDevice | null {
    const device = this.devices.find((d) => d.deviceId === deviceId);
    const trimmed = name.trim().slice(0, 80);
    if (!device || !trimmed) return null;
    device.name = trimmed;
    return device;
  }

  removeDevice(deviceId: string): boolean {
    const idx = this.devices.findIndex((d) => d.deviceId === deviceId);
    if (idx < 0) return false;
    this.devices.splice(idx, 1);
    this.forgetDevice(deviceId);
    this.recomputeRoles();
    return true;
  }

  /** Drop every camera so an import batch owns the slots. No files are deleted. */
  clearDevices() {
    const ids = this.devices.map((d) => d.deviceId);
    this.devices = [];
    for (const id of ids) this.forgetDevice(id);
  }

  /**
   * A local MP4 standing in for a paired phone.
   * Same 3-slot F/L/O rules, so Pose can read `/upload` without Pair.
   */
  addImportDevice(
    name: string,
  ): { ok: true; device: PairedDevice } | { ok: false; error: string } {
    const check = validateNewPairing(this.devices.length);
    if (!check.ok) return check;
    const deviceId = randomId('dev');
    this.devices.push({
      deviceId,
      name: name.trim() || `Import ${this.devices.length + 1}`,
      camIndex: this.devices.length,
      pairedAt: Date.now(),
      viewCode: null,
    });
    this.recomputeRoles();
    const device = this.devices.find((d) => d.deviceId === deviceId);
    if (!device) return { ok: false, error: 'Import camera was not created' };
    return { ok: true, device };
  }

  /** Mark an imported trial finished and remember the longest probed length. */
  finishImport(
    trialId: string,
    durationSec: number | null,
  ): TrialRecord | null {
    const t = this.trials.get(trialId);
    if (!t) return null;
    t.phase = 'done';
    // Outside the phone "just ended" window, so a poll does not treat an
    // import as a capture the paired phones should upload.
    t.stoppedAt = Date.now() - ENDED_TRIAL_VISIBLE_MS - 1;
    if (durationSec != null && durationSec > 0) {
      t.importDurationSec = Math.max(t.importDurationSec ?? 0, durationSec);
    }
    t.participants = this.devices.map((d) => d.deviceId);
    return t;
  }

  /** Revoke a device's token and drop its live state (slot handled by caller). */
  private forgetDevice(deviceId: string) {
    for (const [tok, id] of this.tokens) {
      if (id === deviceId) this.tokens.delete(tok);
    }
    this.previews.delete(deviceId);
    this.standingModeUntil.delete(deviceId);
    this.livePoseUntil.delete(deviceId);
    this.linkProbes.delete(deviceId);
    this.staleLinkProbes.delete(deviceId);
    this.lastProbeGeneration.delete(deviceId);
    this.clearStill(deviceId);
  }

  createTrial(name: string): TrialRecord {
    const trial: TrialRecord = {
      id: randomId('tr'),
      name: name.trim() || 'gait01',
      phase: 'idle',
      createdAt: Date.now(),
      participants: [],
      uploads: {},
    };
    this.trials.set(trial.id, trial);
    return trial;
  }

  armTrial(trialId: string): TrialRecord | null {
    const t = this.trials.get(trialId);
    if (!t) return null;
    t.phase = 'armed';
    return t;
  }

  startTrial(trialId: string): SharedStartSignal | null {
    const t = this.trials.get(trialId);
    if (!t) return null;
    const signal = computeSharedStart(t.id, t.name);
    t.startSignal = signal;
    t.phase = 'recording';
    const now = Date.now();
    t.participants = this.devices.map((d) => d.deviceId);
    t.uploads = {};
    for (const id of t.participants) {
      t.uploads[id] = { status: 'recording', bytes: 0, filename: '', at: now };
    }
    return signal;
  }

  stopTrial(trialId: string): TrialRecord | null {
    const t = this.trials.get(trialId);
    if (!t) return null;
    if (t.phase === 'cancelled') return t;
    t.phase = 'done';
    t.stoppedAt = Date.now();
    return t;
  }

  /** Stop pressed during the countdown: phones discard, nothing is kept. */
  cancelTrial(trialId: string): TrialRecord | null {
    const t = this.trials.get(trialId);
    if (!t) return null;
    t.phase = 'cancelled';
    t.stoppedAt = Date.now();
    t.uploads = {};
    return t;
  }

  /** What phones poll: the live trial, or one that ended moments ago. */
  activeTrial(now = Date.now()): TrialRecord | null {
    return (
      [...this.trials.values()]
        .filter((t) =>
          t.phase === 'armed' ||
          t.phase === 'recording' ||
          t.phase === 'stopping'
            ? true
            : (t.phase === 'done' || t.phase === 'cancelled') &&
              now - (t.stoppedAt ?? 0) < ENDED_TRIAL_VISIBLE_MS,
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    );
  }

  setPreview(deviceId: string, jpeg: Buffer) {
    // Strictly increasing so `after=<at>` long-polls never miss a frame.
    const prev = this.previews.get(deviceId);
    const at = Math.max(Date.now(), (prev?.at ?? 0) + 1);
    const frame = { deviceId, jpeg, at };
    this.previews.set(deviceId, frame);
    const waiters = this.previewWaiters.get(deviceId);
    if (waiters) {
      this.previewWaiters.delete(deviceId);
      for (const wake of waiters) wake(frame);
    }
  }

  /** Resolve with the first preview newer than `after`, or null on timeout. */
  waitForPreview(
    deviceId: string,
    after: number,
    timeoutMs: number,
  ): Promise<PreviewFrame | null> {
    const current = this.previews.get(deviceId);
    if (current && current.at > after) return Promise.resolve(current);
    return new Promise((resolve) => {
      let waiters = this.previewWaiters.get(deviceId);
      if (!waiters) {
        waiters = new Set();
        this.previewWaiters.set(deviceId, waiters);
      }
      const wake = (frame: PreviewFrame | null) => {
        clearTimeout(timer);
        this.previewWaiters.get(deviceId)?.delete(wake);
        resolve(frame);
      };
      const timer = setTimeout(() => wake(null), timeoutMs);
      waiters.add(wake);
    });
  }

  requestStill(deviceId: string): boolean {
    if (!this.devices.some((d) => d.deviceId === deviceId)) return false;
    this.stillErrors.delete(deviceId);
    this.stillRequests.set(deviceId, 'pending');
    return true;
  }

  /** Phone picks up a pending request; true only once per request. */
  claimStillRequest(deviceId: string): boolean {
    if (this.stillRequests.get(deviceId) !== 'pending') return false;
    this.stillRequests.set(deviceId, 'sending');
    return true;
  }

  consumeStillRequest(deviceId: string): boolean {
    if (!this.stillRequests.has(deviceId)) return false;
    this.stillRequests.delete(deviceId);
    return true;
  }

  hasStillRequest(deviceId: string): boolean {
    return this.stillRequests.has(deviceId);
  }

  failStill(deviceId: string, error: string) {
    this.stillRequests.delete(deviceId);
    this.stillErrors.set(deviceId, error || 'Phone could not send the photo');
  }

  stillState(deviceId: string): { state: StillState; error?: string } {
    if (this.stills.has(deviceId)) return { state: 'ready' };
    const req = this.stillRequests.get(deviceId);
    if (req) return { state: req };
    const error = this.stillErrors.get(deviceId);
    if (error) return { state: 'failed', error };
    return { state: 'idle' };
  }

  setStill(
    deviceId: string,
    png: Buffer,
    fullRes = true,
    contentType = 'image/png',
  ) {
    this.stills.set(deviceId, {
      deviceId,
      png,
      at: Date.now(),
      fullRes,
      contentType,
    });
  }

  takeStill(deviceId: string): StillFrame | null {
    const frame = this.stills.get(deviceId) ?? null;
    if (frame) this.stills.delete(deviceId);
    return frame;
  }

  /** Drop any stale still / request so a new capture never returns an old frame. */
  clearStill(deviceId: string) {
    this.stills.delete(deviceId);
    this.stillRequests.delete(deviceId);
    this.stillErrors.delete(deviceId);
  }

  setStandingMode(
    deviceId: string,
    active: boolean,
    now = Date.now(),
  ): boolean {
    if (!this.devices.some((d) => d.deviceId === deviceId)) return false;
    if (active)
      this.standingModeUntil.set(deviceId, now + STANDING_MODE_TTL_MS);
    else this.standingModeUntil.delete(deviceId);
    return true;
  }

  isStandingMode(deviceId: string, now = Date.now()): boolean {
    const until = this.standingModeUntil.get(deviceId);
    return until != null && until > now;
  }

  setLivePoseMode(
    deviceId: string,
    active: boolean,
    now = Date.now(),
  ): boolean {
    if (!this.devices.some((d) => d.deviceId === deviceId)) return false;
    if (active) this.livePoseUntil.set(deviceId, now + STANDING_MODE_TTL_MS);
    else this.livePoseUntil.delete(deviceId);
    return true;
  }

  isLivePoseMode(deviceId: string, now = Date.now()): boolean {
    const until = this.livePoseUntil.get(deviceId);
    return until != null && until > now;
  }

  upsertSubject(input: {
    subjectId: string;
    subjectName?: string;
    heightCm?: string;
    weightKg?: string;
  }): SubjectRecord {
    const id = input.subjectId.trim();
    const prev = this.subjects.get(id);
    const record: SubjectRecord = {
      subjectId: id,
      subjectName: input.subjectName ?? prev?.subjectName ?? '',
      heightCm: input.heightCm ?? prev?.heightCm ?? '',
      weightKg: input.weightKg ?? prev?.weightKg ?? '',
      updatedAt: Date.now(),
      standing: prev?.standing ? { ...prev.standing } : {},
      standingFull: prev?.standingFull ? { ...prev.standingFull } : {},
    };
    this.subjects.set(id, record);
    return record;
  }

  getSubject(subjectId: string): SubjectRecord | undefined {
    return this.subjects.get(subjectId.trim());
  }

  /**
   * Save a clean standing PNG (no guide / skeleton). Retake overwrites.
   * `variant: 'full'` stores the uncropped original alongside the crop.
   */
  saveStandingPng(
    subjectId: string,
    code: 'F' | 'LL' | 'RL',
    filename: string,
    png: Buffer,
    variant: 'crop' | 'full' = 'crop',
  ): SubjectRecord | null {
    const id = subjectId.trim();
    if (!id) return null;
    const record =
      this.subjects.get(id) ??
      this.upsertSubject({ subjectId: id, subjectName: '' });
    const target = variant === 'full' ? record.standingFull : record.standing;
    target[code] = {
      filename,
      bytes: png.length,
      at: Date.now(),
      png,
    };
    record.updatedAt = Date.now();
    this.subjects.set(id, record);
    return record;
  }

  /** Clear standing captures so a returning subject must retake F→LL→RL. */
  clearStanding(subjectId: string): SubjectRecord | null {
    const record = this.subjects.get(subjectId.trim());
    if (!record) return null;
    record.standing = {};
    record.standingFull = {};
    record.updatedAt = Date.now();
    return record;
  }

  private setUpload(
    trialId: string,
    deviceId: string,
    patch: Partial<TrialUpload> & { status: UploadStatus },
  ): TrialUpload | null {
    const t = this.trials.get(trialId);
    if (!t || t.phase === 'cancelled') return null;
    const prev = t.uploads[deviceId];
    const next: TrialUpload = {
      bytes: prev?.bytes ?? 0,
      filename: prev?.filename ?? '',
      ...patch,
      at: Date.now(),
    };
    if (next.status !== 'failed') delete next.error;
    if (next.status !== 'ready') delete next.path;
    t.uploads[deviceId] = next;
    return next;
  }

  beginUpload(
    trialId: string,
    deviceId: string,
    filename: string,
    totalBytes?: number,
  ) {
    return this.setUpload(trialId, deviceId, {
      status: 'uploading',
      filename,
      bytes: 0,
      ...(totalBytes && totalBytes > 0 ? { totalBytes } : {}),
    });
  }

  uploadProgress(trialId: string, deviceId: string, bytes: number) {
    const u = this.trials.get(trialId)?.uploads[deviceId];
    if (!u || u.status !== 'uploading') return;
    u.bytes = bytes;
    u.at = Date.now();
  }

  uploadConverting(trialId: string, deviceId: string, bytes: number) {
    return this.setUpload(trialId, deviceId, {
      status: 'converting',
      bytes,
      convertProgress: 0,
    });
  }

  conversionProgress(trialId: string, deviceId: string, fraction: number) {
    const u = this.trials.get(trialId)?.uploads[deviceId];
    if (!u || u.status !== 'converting') return;
    u.convertProgress = Math.min(1, Math.max(0, fraction));
    u.at = Date.now();
  }

  /** Expected trial video length from the shared start to Stop, if known. */
  trialDurationSec(trialId: string): number | null {
    const t = this.trials.get(trialId);
    const start = t?.startSignal?.startAtMs;
    if (!t || start == null || t.stoppedAt == null) return null;
    const ms = Math.min(
      t.stoppedAt - start,
      t.startSignal?.maxDurationMs ?? Infinity,
    );
    return ms > 0 ? ms / 1000 : null;
  }

  /** Remember the phone upload the first time this view is trimmed. */
  keepPhoneUpload(trialId: string, deviceId: string) {
    const u = this.trials.get(trialId)?.uploads[deviceId];
    if (!u?.path || u.originalPath) return;
    u.originalPath = u.path;
    u.originalBytes = u.bytes;
  }

  uploadReady(trialId: string, deviceId: string, path: string, bytes: number) {
    const prev = this.trials.get(trialId)?.uploads[deviceId];
    return this.setUpload(trialId, deviceId, {
      status: 'ready',
      path,
      bytes,
      filename: (prev?.filename ?? '').replace(/\.webm$/i, '.mp4'),
      ...(prev?.originalPath
        ? {
            originalPath: prev.originalPath,
            originalBytes: prev.originalBytes,
          }
        : {}),
    });
  }

  failUpload(trialId: string, deviceId: string, error: string) {
    return this.setUpload(trialId, deviceId, {
      status: 'failed',
      error: error || 'Upload failed',
    });
  }

  /** Per-camera status, failing cameras that went quiet after Stop. */
  uploadStatuses(trialId: string, now = Date.now()) {
    const t = this.trials.get(trialId);
    if (!t) return null;
    if (t.phase === 'done' && t.stoppedAt != null) {
      for (const u of Object.values(t.uploads)) {
        if (
          (u.status === 'recording' || u.status === 'uploading') &&
          now - Math.max(u.at, t.stoppedAt) > UPLOAD_IDLE_FAIL_MS
        ) {
          u.error =
            u.status === 'uploading'
              ? 'Upload stalled for 60 s'
              : 'No upload from this camera 60 s after Stop';
          u.status = 'failed';
          u.at = now;
        }
      }
    }
    return t.uploads;
  }

  getUpload(trialId: string, deviceId: string): TrialUpload | null {
    return this.uploadStatuses(trialId)?.[deviceId] ?? null;
  }

  /** After Save: files are gone, cameras read `cleared`. */
  clearRecordings(trialId: string): boolean {
    const t = this.trials.get(trialId);
    if (!t) return false;
    for (const u of Object.values(t.uploads)) {
      if (u.status === 'ready') {
        u.status = 'cleared';
        delete u.path;
        u.at = Date.now();
      }
    }
    return true;
  }

  listTrials(): Array<{
    id: string;
    name: string;
    phase: TrialPhase;
    startAtMs: number | null;
    stoppedAt: number | null;
    uploadCount: number;
  }> {
    return [...this.trials.values()]
      .filter((t) => t.phase !== 'cancelled')
      .map((t) => ({
        id: t.id,
        name: t.name,
        phase: t.phase,
        startAtMs: t.startSignal?.startAtMs ?? null,
        stoppedAt: t.stoppedAt ?? null,
        uploadCount: Object.values(t.uploads).filter(
          (u) => u.status === 'ready',
        ).length,
      }));
  }

  /** Minimal valid 1×1 PNG for mock / CI standing captures. */
  static minimalPng(): Buffer {
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
  }

  snapshot() {
    return {
      devices: this.devices.map((d) => ({ ...d })),
      pendingPairing: [...this.pairings.values()].find(
        (p) => p.status === 'pending' && !isPairingExpired(p),
      ),
      trialMaxSeconds: TRIAL_MAX_SECONDS,
      subjects: [...this.subjects.values()].map((s) => ({
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        heightCm: s.heightCm,
        weightKg: s.weightKg,
        updatedAt: s.updatedAt,
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
      })),
      info: this.info,
    };
  }
}

export const store = new LiteStore();
