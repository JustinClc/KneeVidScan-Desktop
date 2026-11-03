/**
 * Save / Export planners for Phase 3.
 *
 * A trial Save asks once for a subject folder, then writes original videos
 * (no 2D overlay) into `<folder>/<trial>/`.
 * Standing PNGs are a separate save, at the subject-folder root.
 * IMU CSV only when a backend exists (skipped for now).
 *
 * Export writes per-camera 2D CSV, 3D CSV, OpenSim TRC, and raw JSON.
 * Never burns pose overlay into exported videos. Never height-scales numbers.
 */

import {
  imuCsvFileName,
  poseExportFileName,
  recordingFileBase,
  standingFileName,
  standingFullFileName,
  type PoseFileFormat,
  type StandingCode,
} from './naming';

export type SaveVideoPlan = {
  filename: string;
  camIndex: number;
  viewCode: 'F' | 'L' | 'O' | null;
};

export type PosturePhotoPlan = {
  code: StandingCode;
  variant: 'crop' | 'full';
  filename: string;
};

export type SessionSavePlan = {
  folderRequired: true;
  videos: SaveVideoPlan[];
  /** null until IMU backend lands */
  imuCsv: string | null;
};

export type PoseExportFormat = PoseFileFormat;

export type PoseExportPlan = {
  filename: string;
  format: PoseExportFormat;
  /** The camera this file contains. */
  camIndex: number;
  /** Overlay must never be burned into video exports. */
  overlay: false;
};

export type SaveWriteFile = {
  filename: string;
  /** Base64 payload written by the Electron main process. */
  base64: string;
  mime?: string;
};

/** Build the Save file list for one trial (original videos only). */
export function planSessionSave(opts: {
  subjectId: string;
  subjectName: string;
  trialName: string;
  camCount: number;
  /**
   * When true and IMU backend exists — include `_IMU.csv` name in the plan.
   * Phase 5 UI wires naming helpers only; Save still defaults to false
   * (no BLE / write / playback yet).
   */
  includeImuCsv?: boolean;
}): SessionSavePlan {
  const camCount = Math.max(0, opts.camCount);
  const videos: SaveVideoPlan[] = Array.from({ length: camCount }, (_, i) => {
    const base = recordingFileBase(
      opts.subjectId,
      opts.subjectName,
      opts.trialName,
      camCount,
      i,
    );
    const viewCode =
      camCount === 1 ? null : i === 0 ? 'F' : i === 1 ? 'L' : ('O' as const);
    return {
      filename: `${base}.mp4`,
      camIndex: i,
      viewCode,
    };
  });

  // Filename only — columns via imuCsvHeaderColumns(connectedImus) when write lands.
  const imuCsv =
    opts.includeImuCsv === true
      ? imuCsvFileName(opts.subjectId, opts.subjectName, opts.trialName)
      : null;

  return { folderRequired: true, videos, imuCsv };
}

/**
 * Six posture files for one subject: cropped F/LL/RL plus each `_full` original.
 * Names have no trial, so a later save overwrites the same files.
 */
export function planPosturePhotos(opts: {
  subjectId: string;
  subjectName: string;
  codes?: readonly StandingCode[];
}): PosturePhotoPlan[] {
  const codes = opts.codes ?? (['F', 'LL', 'RL'] as const);
  const photos: PosturePhotoPlan[] = [];
  for (const code of codes) {
    photos.push({
      code,
      variant: 'crop',
      filename: standingFileName(opts.subjectId, opts.subjectName, code),
    });
    photos.push({
      code,
      variant: 'full',
      filename: standingFullFileName(opts.subjectId, opts.subjectName, code),
    });
  }
  return photos;
}

/** Filenames only — useful for toasts / tests. */
export function listSaveFilenames(plan: SessionSavePlan): string[] {
  const names = plan.videos.map((v) => v.filename);
  if (plan.imuCsv) names.push(plan.imuCsv);
  return names;
}

/** Pose CSV/JSON export plan — no overlay videos. */
export function planPoseExport(opts: {
  subjectId: string;
  subjectName: string;
  trialName: string;
  camCount: number;
  format: PoseExportFormat;
  /** Export one cam index, or all views. */
  camIndex?: number | 'all';
}): PoseExportPlan[] {
  const camCount = Math.max(1, opts.camCount);
  const indices =
    opts.camIndex === undefined || opts.camIndex === 'all'
      ? Array.from({ length: camCount }, (_, i) => i)
      : [opts.camIndex];

  return indices.map((i) => ({
    filename: poseExportFileName(
      opts.subjectId,
      opts.subjectName,
      opts.trialName,
      camCount,
      i,
      opts.format,
    ),
    format: opts.format,
    camIndex: i,
    overlay: false as const,
  }));
}

/**
 * Exported landmarks, in column order. The first ten match the lab's
 * existing scripts; the rest are appended. `trcName` matches Pose2Sim's
 * Markers_Mediapipe.xml. Ears are CSV-only — that marker set has no ears.
 */
export const EXPORT_LANDMARKS = [
  { name: 'left_shoulder', index: 11, trcName: 'LShoulder' },
  { name: 'right_shoulder', index: 12, trcName: 'RShoulder' },
  { name: 'left_hip', index: 23, trcName: 'LHip' },
  { name: 'right_hip', index: 24, trcName: 'RHip' },
  { name: 'left_knee', index: 25, trcName: 'LKnee' },
  { name: 'right_knee', index: 26, trcName: 'RKnee' },
  { name: 'left_ankle', index: 27, trcName: 'LAnkle' },
  { name: 'right_ankle', index: 28, trcName: 'RAnkle' },
  { name: 'left_foot_index', index: 31, trcName: 'LBigToe' },
  { name: 'right_foot_index', index: 32, trcName: 'RBigToe' },
  { name: 'nose', index: 0, trcName: 'Nose' },
  { name: 'left_eye', index: 2, trcName: 'LEye' },
  { name: 'right_eye', index: 5, trcName: 'REye' },
  { name: 'left_ear', index: 7, trcName: null },
  { name: 'right_ear', index: 8, trcName: null },
  { name: 'left_elbow', index: 13, trcName: 'LElbow' },
  { name: 'right_elbow', index: 14, trcName: 'RElbow' },
  { name: 'left_wrist', index: 15, trcName: 'LWrist' },
  { name: 'right_wrist', index: 16, trcName: 'RWrist' },
  { name: 'left_heel', index: 29, trcName: 'LHeel' },
  { name: 'right_heel', index: 30, trcName: 'RHeel' },
] as const;

const TRC_LANDMARKS = EXPORT_LANDMARKS.filter(
  (lm): lm is (typeof EXPORT_LANDMARKS)[number] & { trcName: string } =>
    lm.trcName !== null,
);

export type PoseExportPoint = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export type PoseExportFrame = {
  frame: number;
  time_s: number;
  /** Normalized image landmarks, 0–1 of width/height, origin top-left. */
  landmarks2d?: PoseExportPoint[];
  /** World landmarks in raw MediaPipe metres (hip-centred, y down). */
  landmarks3d: PoseExportPoint[];
};

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 1e6) / 1e6);
}

function names(suffix: string): string[] {
  return EXPORT_LANDMARKS.map((lm) => `${lm.name}_${suffix}`);
}

function pointCell(
  points: PoseExportPoint[] | undefined,
  index: number,
  axis: 'x' | 'y' | 'z' | 'p',
): string {
  if (!points?.length) return '';
  const p = points[index];
  if (!p) return '';
  if (axis === 'p') {
    return p.visibility === undefined ? '' : fmtNum(p.visibility);
  }
  const value = p[axis];
  return value === undefined ? '' : fmtNum(value);
}

function csvLine(cells: Array<string | number>): string {
  return cells.join(',');
}

/**
 * 2D landmarks, one row per frame. x/y are normalized 0–1.
 * `VideoWidth` and `VideoHeight` are repeated so pixels are recoverable
 * (`x * width`, `y * height`) without a second file.
 */
export function buildPose2dCsv(opts: {
  fps: number;
  videoWidth?: number | null;
  videoHeight?: number | null;
  frames?: PoseExportFrame[];
}): string {
  const header = csvLine([
    'Frame',
    'FPS',
    ...names('x'),
    ...names('y'),
    ...names('p'),
    'VideoWidth',
    'VideoHeight',
  ]);
  const rows = [header];
  const width = opts.videoWidth ?? '';
  const height = opts.videoHeight ?? '';
  for (const f of opts.frames ?? []) {
    rows.push(
      csvLine([
        f.frame + 1,
        opts.fps,
        ...EXPORT_LANDMARKS.map((lm) =>
          pointCell(f.landmarks2d, lm.index, 'x'),
        ),
        ...EXPORT_LANDMARKS.map((lm) =>
          pointCell(f.landmarks2d, lm.index, 'y'),
        ),
        ...EXPORT_LANDMARKS.map((lm) =>
          pointCell(f.landmarks2d, lm.index, 'p'),
        ),
        width,
        height,
      ]),
    );
  }
  return `${rows.join('\n')}\n`;
}

/**
 * 3D landmarks, one row per frame. Raw MediaPipe world metres:
 * hip-centred, y pointing down. Never height-scaled.
 */
export function buildPose3dCsv(opts: {
  fps: number;
  frames?: PoseExportFrame[];
}): string {
  const header = csvLine([
    'Frame',
    'FPS',
    ...names('x'),
    ...names('y'),
    ...names('z'),
    ...names('p'),
  ]);
  const rows = [header];
  for (const f of opts.frames ?? []) {
    rows.push(
      csvLine([
        f.frame + 1,
        opts.fps,
        ...EXPORT_LANDMARKS.map((lm) =>
          pointCell(f.landmarks3d, lm.index, 'x'),
        ),
        ...EXPORT_LANDMARKS.map((lm) =>
          pointCell(f.landmarks3d, lm.index, 'y'),
        ),
        ...EXPORT_LANDMARKS.map((lm) =>
          pointCell(f.landmarks3d, lm.index, 'z'),
        ),
        ...EXPORT_LANDMARKS.map((lm) =>
          pointCell(f.landmarks3d, lm.index, 'p'),
        ),
      ]),
    );
  }
  return `${rows.join('\n')}\n`;
}

/**
 * OpenSim TRC in metres, Y up. Marker names match Pose2Sim
 * `Markers_Mediapipe.xml` (ears omitted). Axes: X = x, Y = -y, Z = -z,
 * which stays right-handed. The skeleton stays hip-centred, so inverse
 * kinematics can recover joint angles and not pelvis translation.
 */
export function buildPose3dTrc(opts: {
  filename: string;
  fps: number;
  frames?: PoseExportFrame[];
}): string {
  const frames = opts.frames ?? [];
  const n = frames.length;
  const markers = TRC_LANDMARKS.length;
  const rate = opts.fps;
  const namesLine =
    `Frame#\tTime\t` +
    TRC_LANDMARKS.map((lm) => lm.trcName).join('\t\t\t') +
    '\t\t';
  const xyzLine =
    '\t\t' +
    TRC_LANDMARKS.map((_, i) => `X${i + 1}\tY${i + 1}\tZ${i + 1}`).join('\t') +
    '\t';
  const header = [
    `PathFileType\t4\t(X/Y/Z)\t${opts.filename}`,
    'DataRate\tCameraRate\tNumFrames\tNumMarkers\tUnits\tOrigDataRate\tOrigDataStartFrame\tOrigNumFrames',
    [rate, rate, n, markers, 'm', rate, 1, n].join('\t'),
    namesLine,
    xyzLine,
  ];
  const rows = frames.map((f) => {
    const cells = [String(f.frame + 1), f.time_s.toFixed(5)];
    for (const lm of TRC_LANDMARKS) {
      const p = f.landmarks3d.length ? f.landmarks3d[lm.index] : undefined;
      if (!p) {
        cells.push('', '', '');
      } else {
        cells.push(fmtNum(p.x), fmtNum(-p.y), fmtNum(-(p.z ?? 0)));
      }
    }
    return cells.join('\t');
  });
  return `${[...header, ...rows].join('\n')}\n`;
}

/**
 * Full 33-landmark dump, 2D and 3D, in raw MediaPipe units.
 * Scale-to-height is view-only and must not appear in exported numbers.
 */
export function buildPoseJson(opts: {
  subjectId: string;
  subjectName: string;
  trialName: string;
  camCount: number;
  viewLabel: string;
  camIndex: number;
  fps?: number;
  videoWidth?: number | null;
  videoHeight?: number | null;
  frames?: PoseExportFrame[];
  source?: 'mediapipe' | 'stub' | 'mixed' | 'empty';
}): string {
  return `${JSON.stringify(
    {
      units: 'mediapipe',
      note: '2D x/y are normalized 0-1 of video_width/video_height, origin top-left. 3D is MediaPipe world landmarks in metres, hip-centred, y down. Scale-to-height is view-only. TRC is the same 3D in metres with Y up (Y=-y, Z=-z) and Pose2Sim MediaPipe marker names; the hips stay at the origin.',
      overlay_on_video: false,
      subject_id: opts.subjectId,
      subject_name: opts.subjectName,
      trial: opts.trialName,
      cam_index: opts.camIndex,
      cam_count: opts.camCount,
      view: opts.viewLabel,
      fps: opts.fps ?? null,
      video_width: opts.videoWidth ?? null,
      video_height: opts.videoHeight ?? null,
      source: opts.source ?? (opts.frames?.length ? 'mediapipe' : 'empty'),
      frames: (opts.frames ?? []).map((f) => ({
        frame: f.frame,
        time_s: f.time_s,
        landmarks2d: (f.landmarks2d ?? []).map((p) => ({
          x: p.x,
          y: p.y,
          z: p.z ?? null,
          visibility: p.visibility ?? null,
        })),
        landmarks3d: f.landmarks3d.map((p) => ({
          x: p.x,
          y: p.y,
          z: p.z ?? 0,
          visibility: p.visibility ?? null,
        })),
      })),
    },
    null,
    2,
  )}\n`;
}

/** UTF-8 string → base64 for the main-process writer. */
export function utf8ToBase64(text: string): string {
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }
  return Buffer.from(text, 'utf8').toString('base64');
}

export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof btoa === 'function') {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < raw.length; i += chunk) {
      binary += String.fromCharCode(...raw.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  return Buffer.from(raw).toString('base64');
}
