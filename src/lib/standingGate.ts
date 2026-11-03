/**
 * Standing posture guide frame + approval gate (pure helpers).
 *
 * The guide frame has a fixed 1 : 2.2 (w : h) shape at 90 % of the image
 * height, centred, in either phone orientation — so the live gate, the
 * on-screen frame and the saved crop all use the same rectangle.
 */

import type { NormRect } from './posture';

/** Guide frame width / height. */
export const GUIDE_ASPECT = 1 / 2.2;
/** Guide frame height as a fraction of the image height. */
export const GUIDE_HEIGHT_FRAC = 0.9;
/** Required landmarks must stay in the frame this long before the countdown. */
export const GATE_HOLD_MS = 500;
/** A miss shorter than this does not reset the hold or abort the countdown. */
export const GATE_MISS_GRACE_MS = 150;
export const COUNTDOWN_SECONDS = 3;
/** Phone must pick up the still request within this window (it polls every ~150 ms). */
export const STILL_PICKUP_MS = 5000;
/** Max wait for the phone's full-res still (4K JPEG encode + upload). */
export const STILL_TIMEOUT_MS = 30000;

/** Guide frame in normalised image coordinates for an image of `w × h` px. */
export function guideRect(imgW: number, imgH: number): NormRect {
  if (!(imgW > 0) || !(imgH > 0)) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  let h = GUIDE_HEIGHT_FRAC;
  let w = (h * imgH * GUIDE_ASPECT) / imgW;
  // Extremely tall images: keep the shape, fit the width instead.
  if (w > 1) {
    w = 1;
    h = imgW / GUIDE_ASPECT / imgH;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

export type PixelRect = { sx: number; sy: number; sw: number; sh: number };

/** Guide frame in whole pixels, clamped to the image (crop source rect). */
export function guideRectPx(imgW: number, imgH: number): PixelRect {
  const r = guideRect(imgW, imgH);
  const sx = Math.max(0, Math.round(r.x * imgW));
  const sy = Math.max(0, Math.round(r.y * imgH));
  const sw = Math.min(imgW - sx, Math.round(r.w * imgW));
  const sh = Math.min(imgH - sy, Math.round(r.h * imgH));
  return { sx, sy, sw, sh };
}

/** Fit `w × h` inside a box without cropping (CSS `object-fit: contain`). */
export function containFit(
  w: number,
  h: number,
  boxW: number,
  boxH: number,
): { width: number; height: number } {
  if (!(w > 0) || !(h > 0) || !(boxW > 0) || !(boxH > 0)) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(boxW / w, boxH / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export type ContainRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Where `object-fit: contain` draws `w×h` inside a box (centred, no crop). */
export function containRect(
  w: number,
  h: number,
  boxW: number,
  boxH: number,
): ContainRect {
  const fit = containFit(w, h, boxW, boxH);
  if (!(fit.width > 0) || !(fit.height > 0)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const width = Math.min(boxW, fit.width);
  const height = Math.min(boxH, fit.height);
  return {
    x: Math.max(0, Math.round((boxW - width) / 2)),
    y: Math.max(0, Math.round((boxH - height) / 2)),
    width,
    height,
  };
}

export type HoldTimer = {
  /** Feed the latest gate result; true once it has stayed ok for `holdMs`. */
  update: (ok: boolean, now: number) => boolean;
  /** How long the gate has been failing, 0 while ok. */
  missedFor: (now: number) => number;
  reset: () => void;
};

export function createHoldTimer(
  holdMs = GATE_HOLD_MS,
  graceMs = GATE_MISS_GRACE_MS,
): HoldTimer {
  let since: number | null = null;
  let missSince: number | null = null;
  return {
    update(ok, now) {
      if (!ok) {
        if (missSince == null) missSince = now;
        if (now - missSince >= graceMs) since = null;
        return false;
      }
      if (missSince != null && now - missSince >= graceMs) since = null;
      missSince = null;
      if (since == null) since = now;
      return now - since >= holdMs;
    },
    missedFor(now) {
      return missSince == null ? 0 : now - missSince;
    },
    reset() {
      since = null;
      missSince = null;
    },
  };
}

/** Review warning for parts MediaPipe could not find on the cropped still. */
export function reviewWarning(missing: readonly string[]): string | null {
  if (!missing.length) return null;
  return `${missing.join(', ')} not detected`;
}
