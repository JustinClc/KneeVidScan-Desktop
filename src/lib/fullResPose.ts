/**
 * Phase 4 — full-res pose re-run (per camera, single-view 3D).
 *
 * Re-runs MediaPipe on uploaded `.mp4`s for the **selected trial** only.
 * One fresh VIDEO-mode landmarker per camera (Lite / Full / Heavy).
 * Soft-fails to a stub sequence when WASM or the upload is unavailable.
 * Never fuses multi-cam or IMU, and never fills real 2D with stub 3D.
 *
 * Stored / exported landmarks stay in **raw MediaPipe units** (hip-centred,
 * y pointing down). Scale-to-height, lock-hips, and the y flip are view-only.
 */

import { backendClient } from './backendClient';
import type { PoseLandmarkerHandle } from './poseCheck';
import {
  createVideoLandmarker,
  type VideoLandmarkerOptions,
} from './mediapipePose';
import type { LandmarkPoint } from './posture';
import { smoothPoseFrames } from './poseSmoothing';
import { camViewLabel } from './steps';
import { LIVE_POSE_CONNECTIONS } from './livePose';

export { LIVE_POSE_CONNECTIONS };

export type PoseModel = 'Lite' | 'Full' | 'Heavy';

export type FullResPoseParams = {
  model: PoseModel;
  landmarkSmoothing: boolean;
  landmarkStrength: number;
  temporalFilter: boolean;
  filterStrength: number;
  minDetectionConfidence: number;
  minPresenceConfidence: number;
  minTrackingConfidence: number;
};

export type PoseLandmark3D = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

export type PoseFrame = {
  frame: number;
  time_s: number;
  landmarks2d: LandmarkPoint[];
  /** Hip-centred MediaPipe world landmarks — never height-scaled for export. */
  landmarks3d: PoseLandmark3D[];
};

/** Per-axis provenance so lab can see stub 3D under real 2D. */
export type PoseAxisSource = 'mediapipe' | 'stub';

export type CamPoseResult = {
  camIndex: number;
  viewLabel: string;
  /**
   * Overall label: `mediapipe` only when both 2D and 3D are real;
   * `stub` when both stubbed; otherwise prefer describing via source2d/source3d.
   */
  source: 'mediapipe' | 'stub' | 'mixed';
  source2d: PoseAxisSource;
  source3d: PoseAxisSource;
  fps: number;
  frames: PoseFrame[];
  /** Object URL for the full-res upload when available (revoke on dispose). */
  videoUrl: string | null;
  /** Full-res pixel size, so normalized 2D can be converted to pixels. */
  videoWidth: number | null;
  videoHeight: number | null;
  /** Human-readable status for this camera (shown in Pose UI). */
  statusNote: string;
};

export type TrialPoseResult = {
  trialId: string | null;
  trialName: string;
  model: PoseModel;
  params: FullResPoseParams;
  cameras: CamPoseResult[];
  ranAt: number;
  note: string;
};

export const DEFAULT_POSE_PARAMS: FullResPoseParams = {
  model: 'Full',
  landmarkSmoothing: true,
  landmarkStrength: 0.5,
  temporalFilter: true,
  filterStrength: 0.5,
  minDetectionConfidence: 0.5,
  minPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

/** Soft cap so CI stub re-runs stay fast. */
export const STUB_MAX_FRAMES = 48;
export const STUB_FPS = 12;

/** Full-res sampling. Trials are capped at 3 minutes. */
export const POSE_SAMPLE_FPS = 15;
export const POSE_MAX_SECONDS = 180;

/** MediaPipe Pose landmark indices for hips / shoulders (view helpers). */
export const MP3D = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  lHeel: 29,
  rHeel: 30,
  lFoot: 31,
  rFoot: 32,
} as const;

/** Confidence sliders → MediaPipe VIDEO-mode thresholds. */
export function landmarkerOptionsFromParams(
  params: FullResPoseParams,
): VideoLandmarkerOptions {
  return {
    model: params.model,
    minPoseDetectionConfidence: params.minDetectionConfidence,
    minPosePresenceConfidence: params.minPresenceConfidence,
    minTrackingConfidence: params.minTrackingConfidence,
  };
}

export type PoseLandmarkerVideoHandle = PoseLandmarkerHandle & {
  detectForVideo?: (
    video: HTMLVideoElement,
    timestampMs: number,
  ) => {
    landmarks?: Array<
      Array<{ x: number; y: number; z?: number; visibility?: number }>
    >;
    worldLandmarks?: Array<
      Array<{ x: number; y: number; z?: number; visibility?: number }>
    >;
  };
};

function map2d(
  raw: Array<{ x: number; y: number; z?: number; visibility?: number }>,
): LandmarkPoint[] {
  return raw.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    visibility: p.visibility,
  }));
}

function map3d(
  raw: Array<{ x: number; y: number; z?: number; visibility?: number }>,
): PoseLandmark3D[] {
  return raw.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z ?? 0,
    visibility: p.visibility,
  }));
}

/**
 * Synthetic hip-centred 3D pose in MediaPipe world axes:
 * metres, origin at the hips, y pointing down.
 */
export function stubWorldLandmarks(phase = 0): PoseLandmark3D[] {
  const swing = Math.sin(phase) * 0.08;
  const pts: PoseLandmark3D[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 1,
  }));
  const place = (i: number, x: number, y: number, z: number) => {
    pts[i] = { x, y, z, visibility: 1 };
  };
  place(MP3D.lHip, -0.1, 0, 0);
  place(MP3D.rHip, 0.1, 0, 0);
  place(MP3D.lShoulder, -0.2, -0.55, 0);
  place(MP3D.rShoulder, 0.2, -0.55, 0);
  place(MP3D.nose, 0, -0.75, 0.02);
  place(MP3D.lElbow, -0.35, -0.35, swing);
  place(MP3D.rElbow, 0.35, -0.35, -swing);
  place(MP3D.lWrist, -0.4, -0.15, swing * 1.2);
  place(MP3D.rWrist, 0.4, -0.15, -swing * 1.2);
  place(MP3D.lKnee, -0.1, 0.4, swing * 0.5);
  place(MP3D.rKnee, 0.1, 0.4, -swing * 0.5);
  place(MP3D.lAnkle, -0.1, 0.8, swing * 0.3);
  place(MP3D.rAnkle, 0.1, 0.8, -swing * 0.3);
  place(MP3D.lHeel, -0.1, 0.82, -0.02);
  place(MP3D.rHeel, 0.1, 0.82, -0.02);
  place(MP3D.lFoot, -0.1, 0.85, 0.05 + swing * 0.2);
  place(MP3D.rFoot, 0.1, 0.85, 0.05 - swing * 0.2);
  return pts;
}

export function stubNormalizedLandmarks(phase = 0): LandmarkPoint[] {
  const swing = Math.sin(phase) * 0.02;
  const pts: LandmarkPoint[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1,
  }));
  const place = (i: number, x: number, y: number) => {
    pts[i] = { x, y, visibility: 1 };
  };
  place(MP3D.nose, 0.5, 0.12);
  place(MP3D.lShoulder, 0.38, 0.28);
  place(MP3D.rShoulder, 0.62, 0.28);
  place(MP3D.lElbow, 0.3 + swing, 0.4);
  place(MP3D.rElbow, 0.7 - swing, 0.4);
  place(MP3D.lWrist, 0.26 + swing, 0.52);
  place(MP3D.rWrist, 0.74 - swing, 0.52);
  place(MP3D.lHip, 0.42, 0.52);
  place(MP3D.rHip, 0.58, 0.52);
  place(MP3D.lKnee, 0.4, 0.72);
  place(MP3D.rKnee, 0.6, 0.72);
  place(MP3D.lAnkle, 0.38, 0.9);
  place(MP3D.rAnkle, 0.62, 0.9);
  place(MP3D.lFoot, 0.36, 0.96);
  place(MP3D.rFoot, 0.64, 0.96);
  return pts;
}

export function buildStubCamPose(opts: {
  camIndex: number;
  camCount: number;
  durationSec: number;
  fps?: number;
  maxFrames?: number;
}): CamPoseResult {
  const fps = opts.fps ?? STUB_FPS;
  const maxFrames = opts.maxFrames ?? STUB_MAX_FRAMES;
  const estimated = Math.max(1, Math.round(opts.durationSec * fps));
  const frameCount = Math.min(maxFrames, estimated);
  const frames: PoseFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const phase = (i / Math.max(1, frameCount - 1)) * Math.PI * 2;
    frames.push({
      frame: i,
      time_s: i / fps,
      landmarks2d: stubNormalizedLandmarks(phase + opts.camIndex * 0.2),
      landmarks3d: stubWorldLandmarks(phase + opts.camIndex * 0.2),
    });
  }
  return {
    camIndex: opts.camIndex,
    viewLabel: camViewLabel(opts.camCount, opts.camIndex),
    source: 'stub',
    source2d: 'stub',
    source3d: 'stub',
    fps,
    frames,
    videoUrl: null,
    videoWidth: null,
    videoHeight: null,
    statusNote: '2D stub · 3D stub (WASM or full-res upload unavailable)',
  };
}

async function fetchUploadBlob(
  trialId: string,
  deviceId: string,
): Promise<Blob | null> {
  try {
    const res = await fetch(backendClient.uploadUrl(deviceId, trialId));
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size < 64) return null; // placeholder / empty
    return blob;
  } catch {
    return null;
  }
}

/** Decode a saved MP4 that was read from the user's folder. */
export function videoBlobFromBase64(b64: string): Blob | null {
  try {
    const bin = atob(b64);
    if (bin.length < 64) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'video/mp4' });
  } catch {
    return null;
  }
}

export type SavedVideoLoad = {
  blob: Blob | null;
  /** Shown when the temp upload is gone and the saved file could not be read. */
  reason?: string | null;
};

export type PoseSample = {
  time_s: number;
  landmarks2d?: Array<{
    x: number;
    y: number;
    z?: number;
    visibility?: number;
  }> | null;
  worldLandmarks?: Array<{
    x: number;
    y: number;
    z?: number;
    visibility?: number;
  }> | null;
};

export type DetectFramesResult = {
  frames: PoseFrame[];
  /** True when at least one frame had real MediaPipe worldLandmarks. */
  hadWorldLandmarks: boolean;
  /** True when at least one frame had real 2D landmarks from MediaPipe. */
  had2dLandmarks: boolean;
  videoWidth: number;
  videoHeight: number;
  fps: number;
};

/**
 * One output frame per sample, including misses, so frame N is the same
 * moment on every camera. 3D comes only from world landmarks.
 */
export function buildPoseFrames(samples: PoseSample[]): {
  frames: PoseFrame[];
  hadWorldLandmarks: boolean;
  had2dLandmarks: boolean;
} {
  let hadWorldLandmarks = false;
  let had2dLandmarks = false;
  const frames = samples.map((s, i) => {
    const landmarks2d = s.landmarks2d?.length ? map2d(s.landmarks2d) : [];
    const landmarks3d = s.worldLandmarks?.length ? map3d(s.worldLandmarks) : [];
    if (landmarks2d.length) had2dLandmarks = true;
    if (landmarks3d.length) hadWorldLandmarks = true;
    return { frame: i, time_s: s.time_s, landmarks2d, landmarks3d };
  });
  return { frames, hadWorldLandmarks, had2dLandmarks };
}

export type ReadPoseFrames = (opts: {
  blob: Blob;
  landmarker: PoseLandmarkerVideoHandle;
  maxFrames?: number;
  targetFps?: number;
  onProgress?: (done: number, total: number) => void;
}) => Promise<DetectFramesResult | null>;

function waitFor(
  target: EventTarget,
  event: string,
  ms: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(event, onEvent);
      reject(new Error(`${event} timed out`));
    }, ms);
    const onEvent = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      resolve();
    };
    target.addEventListener(event, onEvent);
  });
}

function waitForLoad(video: HTMLVideoElement, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('loadedmetadata timed out'));
    }, ms);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onBad = () => {
      cleanup();
      reject(new Error('video load failed'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onOk);
      video.removeEventListener('error', onBad);
    };
    video.addEventListener('loadedmetadata', onOk);
    video.addEventListener('error', onBad);
  });
}

/**
 * Sample a video blob through MediaPipe.
 * Returns null when the video cannot be decoded.
 * Every sample time is kept. A miss is an empty landmark list, not a stub.
 */
export const detectFramesFromVideo: ReadPoseFrames = async (opts) => {
  if (typeof document === 'undefined') return null;
  const maxFrames = opts.maxFrames ?? POSE_SAMPLE_FPS * POSE_MAX_SECONDS;
  const targetFps = opts.targetFps ?? POSE_SAMPLE_FPS;

  const url = URL.createObjectURL(opts.blob);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    await waitForLoad(video, 10_000);

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const step = 1 / targetFps;
    const total = Math.min(
      maxFrames,
      Math.max(1, Math.ceil(duration * targetFps)),
    );
    const samples: PoseSample[] = [];
    let t = 0;
    let lastTs = -1;

    while (t <= duration + 1e-6 && samples.length < maxFrames) {
      const seekTo = Math.min(Math.max(t, 0), Math.max(0, duration - 0.001));
      if (Math.abs(video.currentTime - seekTo) > 0.0005) {
        const sought = waitFor(video, 'seeked', 1500);
        video.currentTime = seekTo;
        try {
          await sought;
        } catch {
          /* use whatever frame is current */
        }
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let raw2: PoseSample['landmarks2d'] = null;
      let raw3: PoseSample['worldLandmarks'] = null;
      let ts = Math.round(t * 1000);
      if (ts <= lastTs) ts = lastTs + 1;
      lastTs = ts;

      try {
        if (opts.landmarker.detectForVideo) {
          const result = opts.landmarker.detectForVideo(video, ts);
          raw2 = result.landmarks?.[0] ?? null;
          raw3 = result.worldLandmarks?.[0] ?? null;
        } else {
          const result = opts.landmarker.detect(canvas);
          raw2 = result.landmarks?.[0] ?? null;
        }
      } catch {
        /* this sample stays empty */
      }

      samples.push({ time_s: t, landmarks2d: raw2, worldLandmarks: raw3 });
      opts.onProgress?.(samples.length, total);
      t += step;
    }

    if (!samples.length) return null;
    return {
      ...buildPoseFrames(samples),
      videoWidth: video.videoWidth || canvas.width,
      videoHeight: video.videoHeight || canvas.height,
      fps: targetFps,
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Build a clear lab-facing status when 2D/3D provenance differ. */
export function describeCamPoseStatus(opts: {
  source2d: PoseAxisSource;
  source3d: PoseAxisSource;
}): string {
  if (opts.source2d === 'mediapipe' && opts.source3d === 'mediapipe') {
    return '2D + 3D from MediaPipe (full-res)';
  }
  if (opts.source2d === 'mediapipe' && opts.source3d === 'stub') {
    return '2D from MediaPipe; 3D stub — no worldLandmarks';
  }
  if (opts.source2d === 'stub' && opts.source3d === 'mediapipe') {
    return '2D stub; 3D from MediaPipe (unexpected — check landmarker)';
  }
  return '2D stub · 3D stub (WASM or full-res upload unavailable)';
}

export type RunFullResPoseInput = {
  trialName: string;
  trialId: string | null;
  camCount: number;
  devices: Array<{ deviceId: string; camIndex: number }>;
  durationSec: number;
  params: FullResPoseParams;
  /** One fresh landmarker per camera. Tests inject this. */
  createLandmarker?: () => Promise<PoseLandmarkerVideoHandle | null>;
  /** Tests inject this to skip video decode. */
  readFrames?: ReadPoseFrames;
  onProgress?: (p: { camIndex: number; done: number; total: number }) => void;
  /**
   * Used when Save has deleted the temp upload. Reads the MP4 from the
   * folder the operator chose.
   */
  loadSavedVideo?: (camIndex: number) => Promise<SavedVideoLoad>;
  /** Skip network; force stub cameras. */
  forceStub?: boolean;
};

/**
 * Re-run pose on every camera view of the selected trial’s full-res uploads.
 * Soft stub when WASM or the upload is unavailable.
 * Each camera gets its own VIDEO-mode landmarker so tracking does not carry over.
 */
export async function runFullResPoseEstimation(
  input: RunFullResPoseInput,
): Promise<TrialPoseResult> {
  const camCount = Math.max(1, input.camCount);
  const durationSec = Math.max(1, input.durationSec);
  const createLandmarker =
    input.createLandmarker ??
    (() =>
      createVideoLandmarker(
        backendClient.baseUrl(),
        landmarkerOptionsFromParams(input.params),
      ));
  const readFrames = input.readFrames ?? detectFramesFromVideo;

  const cameras: CamPoseResult[] = [];
  let any2dMediaPipe = false;
  let any3dMediaPipe = false;
  let any3dStubUnder2d = false;
  let anyFullStub = false;
  const failNotes: string[] = [];

  for (let i = 0; i < camCount; i++) {
    const device = input.devices.find((d) => d.camIndex === i);
    let videoUrl: string | null = null;
    let detected: DetectFramesResult | null = null;
    let landmarker: PoseLandmarkerVideoHandle | null = null;
    let failNote: string | null = null;

    try {
      if (!input.forceStub) {
        let blob: Blob | null = null;
        if (input.trialId && device) {
          blob = await fetchUploadBlob(input.trialId, device.deviceId);
        }
        if (!blob && input.loadSavedVideo) {
          const saved = await input.loadSavedVideo(i);
          blob = saved.blob;
          if (!blob && saved.reason) failNote = saved.reason;
        }
        if (blob) {
          videoUrl = URL.createObjectURL(blob);
          landmarker = await createLandmarker();
          if (!landmarker) {
            failNote = 'Pose model failed to load';
          } else {
            detected = await readFrames({
              blob,
              landmarker,
              onProgress: (done, total) =>
                input.onProgress?.({ camIndex: i, done, total }),
            });
            if (!detected) failNote = 'Could not read pose from the video';
          }
        }
      }
    } catch {
      detected = null;
      failNote = failNote ?? 'Pose re-run failed while reading the video';
    } finally {
      try {
        landmarker?.close?.();
      } catch {
        /* ignore */
      }
    }

    if (!detected?.frames.length) {
      anyFullStub = true;
      const stub = buildStubCamPose({
        camIndex: i,
        camCount,
        durationSec,
      });
      if (failNote) failNotes.push(failNote);
      cameras.push({
        ...stub,
        frames: smoothPoseFrames(stub.frames, input.params, stub.fps),
        videoUrl,
        statusNote: failNote ?? stub.statusNote,
      });
      continue;
    }

    const noDetections =
      !detected.had2dLandmarks && !detected.hadWorldLandmarks;
    const source2d: PoseAxisSource = 'mediapipe';
    const source3d: PoseAxisSource =
      noDetections || detected.hadWorldLandmarks ? 'mediapipe' : 'stub';
    any2dMediaPipe = true;
    if (source3d === 'mediapipe') any3dMediaPipe = true;
    if (source3d === 'stub') any3dStubUnder2d = true;

    const source: CamPoseResult['source'] =
      source3d === 'mediapipe' ? 'mediapipe' : 'mixed';

    cameras.push({
      camIndex: i,
      viewLabel: camViewLabel(camCount, i),
      source,
      source2d,
      source3d,
      fps: detected.fps,
      frames: smoothPoseFrames(detected.frames, input.params, detected.fps),
      videoUrl,
      videoWidth: detected.videoWidth,
      videoHeight: detected.videoHeight,
      statusNote: noDetections
        ? 'MediaPipe ran; no pose detected'
        : describeCamPoseStatus({ source2d, source3d }),
    });
  }

  const noteParts: string[] = [];
  if (any3dStubUnder2d) {
    // Loudest signal for lab — Priscilla soft nit #1
    noteParts.push('2D from MediaPipe; 3D stub — no worldLandmarks');
  } else if (any2dMediaPipe && any3dMediaPipe && !anyFullStub) {
    noteParts.push('MediaPipe on full-res uploads (2D + 3D)');
  } else if (any2dMediaPipe || any3dMediaPipe) {
    noteParts.push('mixed MediaPipe + stub (some uploads missing)');
  } else if (failNotes[0]) {
    noteParts.push(failNotes[0]);
  } else {
    noteParts.push(
      'soft stub (WASM or full-res upload unavailable — lab needs real WASM)',
    );
  }
  noteParts.push(`model=${input.params.model}`);
  noteParts.push('units=mediapipe (hip-centred; not height-scaled)');

  return {
    trialId: input.trialId,
    trialName: input.trialName,
    model: input.params.model,
    params: input.params,
    cameras,
    ranAt: Date.now(),
    note: noteParts.join(' · '),
  };
}

/** Release object URLs held by a trial pose result. */
export function disposeTrialPoseResult(
  result: TrialPoseResult | null | undefined,
): void {
  if (!result) return;
  for (const cam of result.cameras) {
    if (cam.videoUrl) {
      try {
        URL.revokeObjectURL(cam.videoUrl);
      } catch {
        /* ignore */
      }
      cam.videoUrl = null;
    }
  }
}

/**
 * View-only: optional scale so displayed 3D height ≈ subject height (metres).
 * Does **not** mutate stored/export landmarks.
 */
export function scaleLandmarksForView(
  landmarks: PoseLandmark3D[],
  heightCm: number,
): PoseLandmark3D[] {
  if (!heightCm || heightCm <= 0) return landmarks;
  const target = heightCm / 100;
  const ys = landmarks.map((p) => p.y);
  const span = Math.max(...ys) - Math.min(...ys);
  if (span < 1e-4) return landmarks;
  const s = target / span;
  return landmarks.map((p) => ({
    ...p,
    x: p.x * s,
    y: p.y * s,
    z: p.z * s,
  }));
}

/** View-only: MediaPipe y-down → y-up. Does not mutate stored landmarks. */
export function toViewSpace(landmarks: PoseLandmark3D[]): PoseLandmark3D[] {
  return landmarks.map((p) => ({ ...p, y: -p.y }));
}

/**
 * View-only: rotate so mid-hip → mid-shoulder aligns with +Y (upright hips).
 * Expects view space (y up).
 */
export function lockHipsUprightForView(
  landmarks: PoseLandmark3D[],
): PoseLandmark3D[] {
  const lHip = landmarks[MP3D.lHip];
  const rHip = landmarks[MP3D.rHip];
  const lSh = landmarks[MP3D.lShoulder];
  const rSh = landmarks[MP3D.rShoulder];
  if (!lHip || !rHip || !lSh || !rSh) return landmarks;

  const hip: [number, number, number] = [
    (lHip.x + rHip.x) / 2,
    (lHip.y + rHip.y) / 2,
    (lHip.z + rHip.z) / 2,
  ];
  const sh: [number, number, number] = [
    (lSh.x + rSh.x) / 2,
    (lSh.y + rSh.y) / 2,
    (lSh.z + rSh.z) / 2,
  ];
  const up: [number, number, number] = [
    sh[0] - hip[0],
    sh[1] - hip[1],
    sh[2] - hip[2],
  ];
  const len = Math.hypot(up[0], up[1], up[2]) || 1;
  const ux = up[0] / len;
  const uy = up[1] / len;
  const uz = up[2] / len;

  // Rotate around Z so torso aligns toward +Y in the YZ plane (simple upright).
  const pitch = Math.atan2(uz, uy);
  const cp = Math.cos(-pitch);
  const sp = Math.sin(-pitch);

  return landmarks.map((p) => {
    const x = p.x - hip[0];
    const y = p.y - hip[1];
    const z = p.z - hip[2];
    const y2 = y * cp - z * sp;
    const z2 = y * sp + z * cp;
    // Mild roll to keep shoulders level in X
    void ux;
    return { ...p, x: x + hip[0], y: y2 + hip[1], z: z2 + hip[2] };
  });
}

export function applyViewTransforms(
  landmarks: PoseLandmark3D[],
  opts: { scaleToHeight: boolean; heightCm: number; lockHips: boolean },
): PoseLandmark3D[] {
  let out = toViewSpace(landmarks);
  if (opts.lockHips) out = lockHipsUprightForView(out);
  if (opts.scaleToHeight) out = scaleLandmarksForView(out, opts.heightCm);
  return out;
}
