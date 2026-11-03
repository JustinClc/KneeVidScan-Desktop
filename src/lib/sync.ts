/**
 * Shared start sync for multi-phone trials.
 * Lite allows ≤5 frames skew. Phones correct for their clock offset from the
 * desktop using the `server_now` in each trial poll.
 */

export const TRIAL_MAX_SECONDS = 180;
export const MAX_FRAME_SKEW = 5;
/** Assumed preview/record fps for skew budgeting. */
export const ASSUMED_FPS = 30;
/**
 * Countdown before the shared start: phones see the signal on their next poll,
 * arm the recorder, and all begin at the same desktop-clock instant.
 */
export const START_LEAD_MS = 3000;

export type TrialPhase =
  | 'idle'
  | 'armed'
  | 'recording'
  | 'stopping'
  | 'done'
  | 'cancelled';

export type SharedStartSignal = {
  trialId: string;
  trialName: string;
  /** Absolute wall-clock ms when recording should begin. */
  startAtMs: number;
  maxDurationMs: number;
};

export function computeSharedStart(
  trialId: string,
  trialName: string,
  nowMs = Date.now(),
  leadMs = START_LEAD_MS,
): SharedStartSignal {
  return {
    trialId,
    trialName,
    startAtMs: nowMs + leadMs,
    maxDurationMs: TRIAL_MAX_SECONDS * 1000,
  };
}

/** Max acceptable start offset in milliseconds for ≤5-frame skew. */
export function maxSkewMs(fps = ASSUMED_FPS): number {
  return (MAX_FRAME_SKEW / fps) * 1000;
}

export function isWithinSkew(
  phoneStartMs: number,
  sharedStartAtMs: number,
  fps = ASSUMED_FPS,
): boolean {
  return Math.abs(phoneStartMs - sharedStartAtMs) <= maxSkewMs(fps);
}

export function clampTrialElapsed(elapsedSec: number): number {
  return Math.min(Math.max(0, elapsedSec), TRIAL_MAX_SECONDS);
}

export function shouldAutoStop(elapsedSec: number): boolean {
  return elapsedSec >= TRIAL_MAX_SECONDS;
}
