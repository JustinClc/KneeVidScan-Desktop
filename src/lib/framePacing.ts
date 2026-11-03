/**
 * Desktop-side pacing for live previews: measured fps for the tile label,
 * and how often to run MediaPipe so the picture is never held up by it.
 */

/** Posture gate: full model, one camera. */
export const POSTURE_DETECT_GAP_MS = 100;
/** Capture overlay: lite model, per camera. */
export const CAPTURE_DETECT_GAP_MS = 66;

export function createFpsMeter(windowMs = 1000) {
  const stamps: number[] = [];
  const drop = (now: number) => {
    while (stamps.length && stamps[0] < now - windowMs) stamps.shift();
  };
  return {
    tick(now: number) {
      stamps.push(now);
      drop(now);
    },
    fps(now: number) {
      drop(now);
      return Math.round((stamps.length * 1000) / windowMs);
    },
  };
}

/**
 * Minimum time between detections on one feed. `sharedBy` feeds use the
 * same main-thread model, so each must leave room for the others.
 */
export function detectGapMs(
  targetGapMs: number,
  lastDetectMs: number,
  sharedBy: number,
): number {
  return Math.max(
    targetGapMs,
    Math.round(lastDetectMs * Math.max(1, sharedBy) * 1.5),
  );
}
