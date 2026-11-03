/**
 * Standing pose quality gate for the Subject screen.
 *
 * Landmark rules match MediaPipe Pose (see `posture.ts`). When a PoseLandmarker
 * instance is supplied (or loads later), preview / still frames are checked for
 * real. Otherwise a timed stub drives the red → green + 3s demo / CI path.
 *
 * The live Capture overlay uses the Lite model from `mediapipePose.ts`.
 */

import {
  evaluateStandingLandmarks,
  type LandmarkPoint,
  type PoseQuality,
  type PostureSide,
} from './posture';

export type PoseCheckSource = 'mediapipe' | 'stub';

export type PoseLandmarkerHandle = {
  detect: (image: CanvasImageSource) => {
    landmarks?: Array<
      Array<{ x: number; y: number; z?: number; visibility?: number }>
    >;
  };
  close?: () => void;
};

export type PoseChecker = {
  source: PoseCheckSource;
  ready: boolean;
  /** Attach a real MediaPipe PoseLandmarker when the desktop host has one. */
  attachLandmarker: (lm: PoseLandmarkerHandle | null) => void;
  checkFrame: (
    side: PostureSide,
    image?: CanvasImageSource | null,
  ) => Promise<PoseQuality>;
  dispose: () => void;
};

/** Build a full synthetic “in frame” landmark set for stub / demo / CI. */
export function stubLandmarksInFrame(): LandmarkPoint[] {
  const pts: LandmarkPoint[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1,
  }));
  const place = (i: number, x: number, y: number) => {
    pts[i] = { x, y, visibility: 1 };
  };
  place(0, 0.5, 0.12);
  place(2, 0.47, 0.1);
  place(5, 0.53, 0.1);
  place(7, 0.44, 0.11);
  place(8, 0.56, 0.11);
  place(11, 0.38, 0.28);
  place(12, 0.62, 0.28);
  place(23, 0.42, 0.52);
  place(24, 0.58, 0.52);
  place(25, 0.4, 0.72);
  place(26, 0.6, 0.72);
  place(27, 0.38, 0.9);
  place(28, 0.62, 0.9);
  place(29, 0.39, 0.93);
  place(30, 0.61, 0.93);
  place(31, 0.36, 0.96);
  place(32, 0.64, 0.96);
  return pts;
}

/**
 * Create a pose checker. Call `attachLandmarker` once MediaPipe WASM is ready
 * on Windows/Electron; until then the stub reports OK after `stubReadyAfterMs`.
 */
export function createPoseChecker(
  opts: {
    /** Stub becomes ready after this delay (demo / no camera). */
    stubReadyAfterMs?: number;
    landmarker?: PoseLandmarkerHandle | null;
  } = {},
): PoseChecker {
  const stubReadyAfterMs = opts.stubReadyAfterMs ?? 900;
  const startedAt = Date.now();
  let landmarker: PoseLandmarkerHandle | null = opts.landmarker ?? null;

  return {
    get source() {
      return landmarker ? 'mediapipe' : 'stub';
    },
    get ready() {
      return true;
    },
    attachLandmarker(lm) {
      landmarker = lm;
    },
    async checkFrame(side, image) {
      if (landmarker && image) {
        try {
          const result = landmarker.detect(image);
          const raw = result.landmarks?.[0] ?? null;
          const mapped = raw
            ? raw.map((p) => ({
                x: p.x,
                y: p.y,
                z: p.z,
                visibility: p.visibility,
              }))
            : null;
          return evaluateStandingLandmarks(side, mapped);
        } catch {
          /* fall through to stub */
        }
      }

      if (Date.now() - startedAt < stubReadyAfterMs) {
        return evaluateStandingLandmarks(side, null);
      }
      return evaluateStandingLandmarks(side, stubLandmarksInFrame());
    },
    dispose() {
      try {
        landmarker?.close?.();
      } catch {
        /* ignore */
      }
      landmarker = null;
    },
  };
}

/** Pose model quality for MediaPipe (Lite / Full / Heavy). */
export type PoseLandmarkerModel = 'Lite' | 'Full' | 'Heavy';

/**
 * MediaPipe `modelComplexity` mapping — keep in sync with Pose UI Lite/Full/Heavy.
 * Legacy Pose solution: 0 = lite, 1 = full, 2 = heavy.
 * tasks-vision PoseLandmarker: pass the matching `.task` asset when the host
 * factory loads models by path.
 */
export function poseModelToComplexity(
  model: PoseLandmarkerModel = 'Full',
): 0 | 1 | 2 {
  if (model === 'Lite') return 0;
  if (model === 'Heavy') return 2;
  return 1;
}

export type PoseLandmarkerFactoryOpts = {
  /** Lite / Full / Heavy — stored on Pose; hosts should honour when loading WASM. */
  model?: PoseLandmarkerModel;
  /** 0 = Lite, 1 = Full, 2 = Heavy (MediaPipe convention). */
  modelComplexity?: 0 | 1 | 2;
};

export type PoseLandmarkerFactory = (
  opts?: PoseLandmarkerFactoryOpts,
) => Promise<PoseLandmarkerHandle | null>;

/**
 * Optional MediaPipe bootstrap for Electron hosts that inject a landmarker
 * factory on `window.__motuscapPoseLandmarker__`. Soft-fails so CI / demos
 * keep the stub gate; landmark *rules* in `posture.ts` already match MediaPipe.
 *
 * TODO(WASM): Host factory must select Lite/Full/Heavy assets from
 * `opts.model` / `opts.modelComplexity` (see `poseModelToComplexity`).
 * Until WASM is bundled, this returns null and callers soft-stub.
 */
export async function tryCreateMediaPipeLandmarker(
  opts: PoseLandmarkerFactoryOpts = {},
): Promise<PoseLandmarkerHandle | null> {
  if (typeof window === 'undefined') return null;
  const factory = (
    window as unknown as {
      __motuscapPoseLandmarker__?: PoseLandmarkerFactory;
    }
  ).__motuscapPoseLandmarker__;
  if (!factory) return null;
  const model = opts.model ?? 'Full';
  const modelComplexity = opts.modelComplexity ?? poseModelToComplexity(model);
  try {
    // Pass model so a real WASM host can load lite/full/heavy without a second API.
    return await factory({ model, modelComplexity });
  } catch {
    return null;
  }
}
