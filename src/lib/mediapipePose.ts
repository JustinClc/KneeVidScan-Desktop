/**
 * Offline MediaPipe PoseLandmarkers for the desktop renderer.
 *
 * WASM + models are served by the local backend at `/mediapipe/` (see
 * `scripts/fetch-mediapipe.mjs`). Full serves the standing gate and review
 * re-check; Lite serves the Capture live overlay, which runs on up to three
 * ~10 fps previews at once. Both run in IMAGE mode and are shared instances.
 */

import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { LandmarkPoint } from './posture';

export type StandingLandmarker = {
  detect: (image: TexImageSource) => LandmarkPoint[] | null;
};

const pending = new Map<string, Promise<StandingLandmarker | null>>();

function wrap(lm: PoseLandmarker): StandingLandmarker {
  return {
    detect(image) {
      const raw = lm.detect(image).landmarks?.[0];
      if (!raw?.length) return null;
      return raw.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: p.visibility,
      }));
    },
  };
}

function loadLandmarker(
  backendBase: string,
  modelFile: string,
): Promise<StandingLandmarker | null> {
  const cached = pending.get(modelFile);
  if (cached) return cached;
  const loading = (async () => {
    try {
      const { FilesetResolver, PoseLandmarker } =
        await import('@mediapipe/tasks-vision');
      const base = backendBase.replace(/\/$/, '');
      const fileset = await FilesetResolver.forVisionTasks(
        `${base}/mediapipe/wasm`,
      );
      const create = (delegate: 'GPU' | 'CPU') =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: `${base}/mediapipe/${modelFile}`,
            delegate,
          },
          runningMode: 'IMAGE',
          numPoses: 1,
        });
      try {
        return wrap(await create('GPU'));
      } catch {
        return wrap(await create('CPU'));
      }
    } catch (err) {
      console.warn(
        `[MotusCap Lite] MediaPipe Pose (${modelFile}) unavailable`,
        err,
      );
      pending.delete(modelFile);
      return null;
    }
  })();
  pending.set(modelFile, loading);
  return loading;
}

/** Resolves null when the assets or WASM cannot load (caller shows manual capture). */
export function loadStandingLandmarker(
  backendBase: string,
): Promise<StandingLandmarker | null> {
  return loadLandmarker(backendBase, 'pose_landmarker_full.task');
}

/** Lite model for the Capture live overlay; null when it cannot load. */
export function loadLiveLandmarker(
  backendBase: string,
): Promise<StandingLandmarker | null> {
  return loadLandmarker(backendBase, 'pose_landmarker_lite.task');
}

export type PoseTaskModel = 'Lite' | 'Full' | 'Heavy';

const TASK_FILE: Record<PoseTaskModel, string> = {
  Lite: 'pose_landmarker_lite.task',
  Full: 'pose_landmarker_full.task',
  Heavy: 'pose_landmarker_heavy.task',
};

export function poseTaskFile(model: PoseTaskModel): string {
  return TASK_FILE[model];
}

export type VideoLandmarkerOptions = {
  model: PoseTaskModel;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
};

export type VideoLandmarker = {
  /** Present so the handle matches the image-mode type. VIDEO mode uses detectForVideo. */
  detect: (image: CanvasImageSource) => {
    landmarks?: Array<
      Array<{ x: number; y: number; z?: number; visibility?: number }>
    >;
  };
  detectForVideo: (
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
  close: () => void;
};

/**
 * A fresh VIDEO-mode landmarker. Not cached: each camera needs its own
 * tracker, and timestamps must increase within one instance.
 * Resolves null when WASM or the `.task` file cannot load.
 */
export async function createVideoLandmarker(
  backendBase: string,
  opts: VideoLandmarkerOptions,
): Promise<VideoLandmarker | null> {
  try {
    const { FilesetResolver, PoseLandmarker } =
      await import('@mediapipe/tasks-vision');
    const base = backendBase.replace(/\/$/, '');
    const fileset = await FilesetResolver.forVisionTasks(
      `${base}/mediapipe/wasm`,
    );
    const create = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: `${base}/mediapipe/${poseTaskFile(opts.model)}`,
          delegate,
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: opts.minPoseDetectionConfidence,
        minPosePresenceConfidence: opts.minPosePresenceConfidence,
        minTrackingConfidence: opts.minTrackingConfidence,
      });
    let lm: PoseLandmarker;
    try {
      lm = await create('GPU');
    } catch {
      lm = await create('CPU');
    }
    return {
      detect: (image) => lm.detect(image as TexImageSource),
      detectForVideo: (video, timestampMs) =>
        lm.detectForVideo(video, timestampMs),
      close: () => lm.close(),
    };
  } catch (err) {
    console.warn(
      `[MotusCap Lite] MediaPipe Pose video (${opts.model}) unavailable`,
      err,
    );
    return null;
  }
}
