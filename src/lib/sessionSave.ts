/**
 * Orchestrates Save / Export for Phase 3–4.
 * Always asks for a destination folder; writes original media (no overlay).
 * Pose export uses MediaPipe units from full-res re-run when available.
 */

import { backendClient } from './backendClient';
import type { TrialPoseResult } from './fullResPose';
import {
  joinSaveFolder,
  STANDING_SEQUENCE,
  standingFileName,
  standingFullFileName,
  subjectBase,
  subjectInfoFileName,
  trialFolderSlug,
  type StandingCode,
} from './naming';
import {
  bytesToBase64,
  buildPose2dCsv,
  buildPose3dCsv,
  buildPose3dTrc,
  buildPoseJson,
  planPoseExport,
  planPosturePhotos,
  planSessionSave,
  utf8ToBase64,
  type PoseExportFormat,
  type SaveWriteFile,
  type SessionSavePlan,
} from './saveExport';
import { t } from './locale';
import { camViewLabel } from './steps';
import { isInFlight, uploadLabel, waitForUploads } from './uploadStatus';
import type { TrialUploadInfo } from './backendClient';

export type SaveSessionInput = {
  subjectId: string;
  subjectName: string;
  trialName: string;
  trialId: string | null;
  camCount: number;
  devices: Array<{ deviceId: string; camIndex: number }>;
  /**
   * Subject folder already chosen this session.
   * When set, Save does not ask again and writes into `<folder>/<trial>`.
   */
  subjectFolder?: string | null;
  /** IMU CSV write is skipped until backend exists. */
  includeImuCsv?: boolean;
  /** Shown while Save waits for phones still uploading / converting. */
  onProgress?: (message: string) => void;
  uploadPollMs?: number;
  /**
   * Inject folder chooser / writer for tests.
   * Defaults to `window.motuscapLite`.
   */
  chooseFolder?: (title?: string) => Promise<string | null>;
  writeFiles?: (
    folder: string,
    files: SaveWriteFile[],
  ) => Promise<{
    ok: boolean;
    folder: string;
    written: string[];
    error?: string;
  }>;
};

/** A camera whose video could not be saved, and why. */
export type FailedVideo = {
  filename: string;
  camLabel: string;
  reason: string;
};

export type SaveSessionResult =
  | {
      ok: true;
      /** Trial subfolder the videos were written into. */
      folder: string;
      /** Subject folder that contains the trial subfolder. */
      subjectFolder: string;
      plan: SessionSavePlan;
      written: string[];
      failedVideos: FailedVideo[];
      /** Temp copies removed (only when every video was saved). */
      clearedTemp: boolean;
    }
  | {
      ok: false;
      cancelled?: boolean;
      error: string;
      plan?: SessionSavePlan;
    };

function failedList(failed: FailedVideo[]): string {
  return failed.map((f) => `${f.camLabel} (${f.reason})`).join('; ');
}

/** Operator-facing Save toast; names every camera whose video was not saved. */
export function formatSaveResultToast(result: {
  folder: string;
  written: string[];
  failedVideos: FailedVideo[];
}): string {
  const base = t('Saved to {folder} · {files}', {
    folder: result.folder,
    files: result.written.join(', '),
  });
  if (result.failedVideos.length === 0) return base;
  return `${base} · ${t('VIDEO NOT SAVED: {list}', { list: failedList(result.failedVideos) })}`;
}

/** Footer note under Pose Save — mirrors the toast for missing videos. */
export function formatSaveResultNote(result: {
  written: string[];
  failedVideos: FailedVideo[];
}): string {
  if (result.failedVideos.length === 0) {
    return t('Saved {count} files · just now', {
      count: result.written.length,
    });
  }
  return t('Saved {count} files · {failed} video(s) not saved: {list}', {
    count: result.written.length,
    failed: result.failedVideos.length,
    list: failedList(result.failedVideos),
  });
}

export const SELECT_SUBJECT_FOLDER_PROMPT = 'Select the subject folder';
export const CREATE_SUBJECT_FOLDER_PROMPT = 'Choose the parent folder';

/**
 * A remembered path is already the subject folder.
 * A new choice is the parent; the subject folder is created inside it.
 */
export async function resolveSubjectFolder(opts: {
  subjectId: string;
  subjectName: string;
  subjectFolder?: string | null;
  choose: (title?: string) => Promise<string | null>;
}): Promise<string | null> {
  const existing = opts.subjectFolder?.trim() || '';
  if (existing) return existing;
  const parent = await opts.choose(CREATE_SUBJECT_FOLDER_PROMPT);
  if (!parent) return null;
  return joinSaveFolder(parent, subjectBase(opts.subjectId, opts.subjectName));
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** One header row and one data row for the Subject info fields. */
export function buildSubjectInfoCsv(info: {
  subjectId: string;
  subjectName: string;
  heightCm: string;
  weightKg: string;
}): string {
  const row = [
    info.subjectId,
    info.subjectName,
    info.heightCm,
    info.weightKg,
  ].map(csvCell);
  return `subject_id,display_name,height_cm,weight_kg\n${row.join(',')}\n`;
}

function failureReason(u: TrialUploadInfo | undefined): string {
  if (u?.status === 'cleared') return 'already saved, temp copy removed';
  if (u?.status === 'failed') return u.error || 'upload failed';
  if (isInFlight(u)) return `gave up waiting (${uploadLabel(u)})`;
  return uploadLabel(u);
}

async function fetchStandingBytes(
  subjectId: string,
  code: StandingCode,
  variant: 'crop' | 'full' = 'crop',
): Promise<Uint8Array | null> {
  return backendClient.getStandingPng(subjectId, code, variant);
}

export async function saveSessionToFolder(
  input: SaveSessionInput,
): Promise<SaveSessionResult> {
  const plan = planSessionSave({
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    trialName: input.trialName,
    camCount: input.camCount,
    includeImuCsv: false, // Phase 5+: naming ready; skip write until IMU backend
  });

  const choose =
    input.chooseFolder ??
    ((title?: string) =>
      window.motuscapLite?.chooseSaveFolder?.(
        title ? t(title) : title,
        t('Choose'),
      ) ?? Promise.resolve(null));
  const write =
    input.writeFiles ??
    ((folder, files) =>
      window.motuscapLite?.writeSaveFiles?.(folder, files) ??
      Promise.resolve({
        ok: false,
        folder,
        written: [],
        error: 'writeSaveFiles unavailable',
      }));

  const subjectFolder = await resolveSubjectFolder({
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    subjectFolder: input.subjectFolder,
    choose,
  });
  if (!subjectFolder) {
    return { ok: false, cancelled: true, error: 'Save cancelled', plan };
  }
  const folder = joinSaveFolder(
    subjectFolder,
    trialFolderSlug(input.trialName),
  );

  const files: SaveWriteFile[] = [];
  const failedVideos: FailedVideo[] = [];
  const camLabel = (i: number) => camViewLabel(input.camCount, i);
  const trialId = input.trialId;

  const deviceFor = (camIndex: number) =>
    input.devices.find((d) => d.camIndex === camIndex);
  let statuses: Record<string, TrialUploadInfo | undefined> = {};
  let statusError: string | null = null;
  if (trialId) {
    const ids = plan.videos
      .map((v) => deviceFor(v.camIndex)?.deviceId)
      .filter((id): id is string => Boolean(id));
    try {
      statuses = await waitForUploads(trialId, ids, {
        pollMs: input.uploadPollMs,
        onProgress: (pending) => {
          const cams = pending.map(({ deviceId, upload }) => {
            const idx = input.devices.find(
              (d) => d.deviceId === deviceId,
            )?.camIndex;
            return `${idx == null ? deviceId : camLabel(idx)}: ${uploadLabel(upload)}`;
          });
          input.onProgress?.(`Waiting for videos · ${cams.join(' · ')}`);
        },
      });
    } catch (e) {
      statusError = e instanceof Error ? e.message : 'backend unreachable';
    }
  }

  for (const video of plan.videos) {
    const device = deviceFor(video.camIndex);
    const fail = (reason: string) =>
      failedVideos.push({
        filename: video.filename,
        camLabel: camLabel(video.camIndex),
        reason,
      });
    if (!trialId) {
      fail('no recorded trial');
      continue;
    }
    if (!device) {
      fail('camera not paired');
      continue;
    }
    if (statusError) {
      fail(statusError);
      continue;
    }
    const upload = statuses[device.deviceId];
    if (upload?.status !== 'ready') {
      fail(failureReason(upload));
      continue;
    }
    const bytes = await backendClient.fetchUpload(trialId, device.deviceId);
    if (!bytes) {
      fail('could not read the video from temp storage');
      continue;
    }
    files.push({
      filename: video.filename,
      base64: bytesToBase64(bytes),
      mime: 'video/mp4',
    });
  }

  // IMU CSV intentionally omitted until backend exists.
  // Posture photos are saved from the Subject page, not with each trial.

  const result = await write(folder, files);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || 'Write failed',
      plan,
    };
  }

  // Keep temp copies while any video is missing so a later Save still has them.
  let clearedTemp = false;
  if (trialId && failedVideos.length === 0) {
    clearedTemp = await backendClient
      .deleteRecordings(trialId)
      .then(() => true)
      .catch(() => false);
  }

  return {
    ok: true,
    folder: result.folder,
    subjectFolder,
    plan,
    written: result.written.length
      ? result.written
      : files.map((f) => f.filename),
    failedVideos,
    clearedTemp,
  };
}

export type MissingPostureFile = {
  filename: string;
  code: StandingCode;
  variant: 'crop' | 'full';
};

export type SavePostureInput = {
  subjectId: string;
  subjectName: string;
  heightCm: string;
  weightKg: string;
  /** Already created subject folder. When set, do not ask again. */
  subjectFolder?: string | null;
  /**
   * `existing` writes into the folder the operator selects.
   * `new` treats that selection as a parent and creates the subject folder inside it.
   */
  destination?: 'existing' | 'new';
  chooseFolder?: (title?: string) => Promise<string | null>;
  writeFiles?: SaveSessionInput['writeFiles'];
  /** Test hook. Defaults to the standing PNG endpoints. */
  fetchStanding?: (
    subjectId: string,
    code: StandingCode,
    variant: 'crop' | 'full',
  ) => Promise<Uint8Array | null>;
};

export type SavePostureResult =
  | {
      ok: true;
      /** Subject folder root. Photos are not placed in a trial subfolder. */
      folder: string;
      written: string[];
      missing: MissingPostureFile[];
    }
  | {
      ok: false;
      cancelled?: boolean;
      error: string;
      /** Set when a folder was chosen but nothing could be written. */
      folder?: string;
    };

export function formatPostureSaveToast(result: {
  folder: string;
  written: string[];
  missing: MissingPostureFile[];
}): string {
  const base = t('Saved to {folder} · {files}', {
    folder: result.folder,
    files: result.written.join(', '),
  });
  if (result.missing.length === 0) return base;
  const names = result.missing.map((m) => m.filename).join(', ');
  return `${base} · not saved: ${names}`;
}

/**
 * Photos stay under the subject id used at capture. If the form id changed
 * before Save, copy them onto the current id so the folder write can find them.
 */
export async function rehomeStandingPhotos(input: {
  fromId: string;
  toId: string;
  subjectName: string;
  fetchStanding: (
    subjectId: string,
    code: StandingCode,
    variant: 'crop' | 'full',
  ) => Promise<Uint8Array | null>;
  saveStanding: (
    subjectId: string,
    code: StandingCode,
    filename: string,
    bytes: Uint8Array,
    variant: 'crop' | 'full',
  ) => Promise<unknown>;
}): Promise<void> {
  const fromId = input.fromId.trim();
  const toId = input.toId.trim();
  if (!fromId || !toId || fromId === toId) return;
  for (const code of STANDING_SEQUENCE) {
    for (const variant of ['crop', 'full'] as const) {
      const bytes = await input.fetchStanding(fromId, code, variant);
      if (!bytes || bytes.byteLength === 0) {
        if (variant === 'crop') {
          throw new Error(
            `Posture photo ${code} is missing for ${fromId}. Capture it again.`,
          );
        }
        continue;
      }
      const filename =
        variant === 'full'
          ? standingFullFileName(toId, input.subjectName, code)
          : standingFileName(toId, input.subjectName, code);
      await input.saveStanding(toId, code, filename, bytes, variant);
    }
  }
}

/**
 * Write the subject's posture PNGs at the subject-folder root.
 * Missing stills are reported and skipped. Nothing is replaced with a placeholder.
 */
export async function savePosturePhotos(
  input: SavePostureInput,
): Promise<SavePostureResult> {
  const photos = planPosturePhotos({
    subjectId: input.subjectId,
    subjectName: input.subjectName,
  });
  const choose =
    input.chooseFolder ??
    ((title?: string) =>
      window.motuscapLite?.chooseSaveFolder?.(
        title ? t(title) : title,
        t('Choose'),
      ) ?? Promise.resolve(null));
  const write =
    input.writeFiles ??
    ((folder, files) =>
      window.motuscapLite?.writeSaveFiles?.(folder, files) ??
      Promise.resolve({
        ok: false,
        folder,
        written: [],
        error: 'writeSaveFiles unavailable',
      }));
  const load = input.fetchStanding ?? fetchStandingBytes;

  const remembered = input.subjectFolder?.trim() || '';
  const prompt =
    input.destination === 'new'
      ? CREATE_SUBJECT_FOLDER_PROMPT
      : SELECT_SUBJECT_FOLDER_PROMPT;
  const picked = remembered || (await choose(prompt));
  if (!picked) {
    return { ok: false, cancelled: true, error: 'Save cancelled' };
  }
  const folder =
    !remembered && input.destination === 'new'
      ? joinSaveFolder(picked, subjectBase(input.subjectId, input.subjectName))
      : picked;

  const files: SaveWriteFile[] = [];
  const missing: MissingPostureFile[] = [];
  for (const photo of photos) {
    const bytes = await load(input.subjectId, photo.code, photo.variant);
    if (!bytes || bytes.byteLength === 0) {
      missing.push({
        filename: photo.filename,
        code: photo.code,
        variant: photo.variant,
      });
      continue;
    }
    files.push({
      filename: photo.filename,
      base64: bytesToBase64(bytes),
      mime: 'image/png',
    });
  }

  const missingCrops = missing.filter((m) => m.variant === 'crop');
  if (missingCrops.length > 0 || files.length === 0) {
    const names = (missingCrops.length > 0 ? missingCrops : missing)
      .map((m) => m.filename)
      .join(', ');
    return {
      ok: false,
      error: `No posture photos saved: ${names}`,
      folder,
    };
  }

  files.push({
    filename: subjectInfoFileName(input.subjectId, input.subjectName),
    base64: utf8ToBase64(
      buildSubjectInfoCsv({
        subjectId: input.subjectId,
        subjectName: input.subjectName,
        heightCm: input.heightCm,
        weightKg: input.weightKg,
      }),
    ),
    mime: 'text/csv',
  });

  const result = await write(folder, files);
  if (!result.ok) {
    return { ok: false, error: result.error || 'Write failed', folder };
  }
  return {
    ok: true,
    folder: result.folder || folder,
    written: result.written.length
      ? result.written
      : files.map((f) => f.filename),
    missing,
  };
}

export type ExportPoseInput = {
  subjectId: string;
  subjectName: string;
  trialName: string;
  camCount: number;
  format: PoseExportFormat;
  camIndex?: number | 'all';
  /** Full-res re-run result for this trial — raw MediaPipe units only. */
  poseResult?: TrialPoseResult | null;
  /** Already chosen subject folder. Landmark files go in its trial subfolder. */
  subjectFolder?: string | null;
  chooseFolder?: SaveSessionInput['chooseFolder'];
  writeFiles?: SaveSessionInput['writeFiles'];
};

export type ExportPoseResult =
  | {
      ok: true;
      /** Trial subfolder the landmark files were written into. */
      folder: string;
      subjectFolder: string;
      written: string[];
    }
  | { ok: false; cancelled?: boolean; error: string };

/**
 * Export 2D CSV, 3D CSV, OpenSim TRC, or raw JSON.
 * Uses full-res re-run frames when available.
 * Never burns overlay into videos; never height-scales exported numbers.
 */
export async function exportPoseToFolder(
  input: ExportPoseInput,
): Promise<ExportPoseResult> {
  const plans = planPoseExport({
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    trialName: input.trialName,
    camCount: input.camCount,
    format: input.format,
    camIndex: input.camIndex,
  });

  const choose =
    input.chooseFolder ??
    ((title?: string) =>
      window.motuscapLite?.chooseSaveFolder?.(
        title ? t(title) : title,
        t('Choose'),
      ) ?? Promise.resolve(null));
  const write =
    input.writeFiles ??
    ((folder, files) =>
      window.motuscapLite?.writeSaveFiles?.(folder, files) ??
      Promise.resolve({
        ok: false,
        folder,
        written: [],
        error: 'writeSaveFiles unavailable',
      }));

  const subjectFolder = await resolveSubjectFolder({
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    subjectFolder: input.subjectFolder,
    choose,
  });
  if (!subjectFolder) {
    return { ok: false, cancelled: true, error: 'Export cancelled' };
  }
  const folder = joinSaveFolder(
    subjectFolder,
    trialFolderSlug(input.trialName),
  );

  const files: SaveWriteFile[] = plans.map((p) => {
    const viewLabel = camViewLabel(input.camCount, p.camIndex);
    const cam = input.poseResult?.cameras.find(
      (c) => c.camIndex === p.camIndex,
    );
    const frames = cam?.frames.map((f) => ({
      frame: f.frame,
      time_s: f.time_s,
      landmarks2d: f.landmarks2d,
      landmarks3d: f.landmarks3d,
    }));
    const fps = cam?.fps ?? 15;
    const body =
      p.format === 'csv2d'
        ? buildPose2dCsv({
            fps,
            videoWidth: cam?.videoWidth,
            videoHeight: cam?.videoHeight,
            frames,
          })
        : p.format === 'csv3d'
          ? buildPose3dCsv({ fps, frames })
          : p.format === 'trc'
            ? buildPose3dTrc({ filename: p.filename, fps, frames })
            : buildPoseJson({
                subjectId: input.subjectId,
                subjectName: input.subjectName,
                trialName: input.trialName,
                camCount: input.camCount,
                viewLabel,
                camIndex: p.camIndex,
                fps,
                videoWidth: cam?.videoWidth,
                videoHeight: cam?.videoHeight,
                frames,
                source: cam?.source ?? (frames?.length ? 'mediapipe' : 'empty'),
              });
    const mime =
      p.format === 'json'
        ? 'application/json'
        : p.format === 'trc'
          ? 'text/plain'
          : 'text/csv';
    return {
      filename: p.filename,
      base64: utf8ToBase64(body),
      mime,
    };
  });

  const result = await write(folder, files);
  if (!result.ok) {
    return { ok: false, error: result.error || 'Write failed' };
  }
  return {
    ok: true,
    folder: result.folder,
    subjectFolder,
    written: result.written.length
      ? result.written
      : plans.map((p) => p.filename),
  };
}
