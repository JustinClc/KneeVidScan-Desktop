/**
 * Shared in/out for synced review.
 * The bar is the overlap of every loaded view (the shortest duration), and
 * one window is applied to every camera so the results stay aligned and
 * the same length.
 */

export const MIN_TRIM_SEC = 0.1;
/** Metadata and the file probe can disagree by about a frame. */
export const TRIM_SLACK_SEC = 0.05;

export type TrimWindow = {
  startSec: number;
  endSec: number;
};

export function overlapDuration(durations: readonly number[]): number | null {
  const finite = durations.filter((d) => Number.isFinite(d) && d > 0);
  if (finite.length === 0) return null;
  return Math.min(...finite);
}

/**
 * Window that every probed file can actually cover.
 * A request that ends a few milliseconds past the shortest view is pulled
 * back. Anything further is rejected so we never pad one camera.
 */
export function resolveTrimWindow(
  durations: readonly number[],
  startSec: number,
  endSec: number,
  slackSec = TRIM_SLACK_SEC,
): TrimWindow {
  const limit = overlapDuration(durations);
  if (limit == null) throw new Error('Could not read video duration');
  if (endSec > limit + slackSec) {
    throw new Error(
      `Trim ends after the shortest view (${limit.toFixed(2)} s)`,
    );
  }
  const end = Math.min(endSec, limit);
  const start = Math.max(0, startSec);
  if (end - start < MIN_TRIM_SEC) throw new Error('Trim window is too short');
  return { startSec: start, endSec: end };
}

export function moveTrimStart(
  overlapSec: number,
  startSec: number,
  endSec: number,
): TrimWindow {
  const end = Math.min(overlapSec, Math.max(endSec, MIN_TRIM_SEC));
  const start = Math.min(Math.max(0, startSec), end - MIN_TRIM_SEC);
  return { startSec: Math.max(0, start), endSec: end };
}

export function moveTrimEnd(
  overlapSec: number,
  startSec: number,
  endSec: number,
): TrimWindow {
  const start = Math.max(0, Math.min(startSec, overlapSec - MIN_TRIM_SEC));
  const end = Math.max(start + MIN_TRIM_SEC, Math.min(overlapSec, endSec));
  return { startSec: start, endSec: end };
}

/** Pointer x on the scrubber track → seconds on the shared timeline. */
export function timeAtClientX(
  clientX: number,
  left: number,
  width: number,
  durationSec: number,
): number {
  if (!(width > 0) || !(durationSec > 0)) return 0;
  const t = ((clientX - left) / width) * durationSec;
  return Math.min(durationSec, Math.max(0, t));
}

/** True when the window actually cuts media, not a one-pixel nudge. */
export function trimChangesMedia(
  overlapSec: number,
  window: TrimWindow,
  slackSec = TRIM_SLACK_SEC,
): boolean {
  return window.startSec > slackSec || overlapSec - window.endSec > slackSec;
}
