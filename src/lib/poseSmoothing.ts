/**
 * Post-detection smoothing for stored pose frames (view and export).
 *
 * Landmark smoothing is a zero-phase low-pass on each coordinate.
 * `landmarkStrength` sets the cutoff: 0 leaves the signal almost unchanged,
 * 1 is heavy. The temporal filter is a second zero-phase exponential
 * average, so neither pass lags the video. Segments are mirror-padded so a
 * noisy first frame does not pull the rest of the clip. A sample with
 * visibility below 0.5, or an empty frame, starts a new segment so
 * smoothing never blends across a gap.
 */

export type SmoothablePoint = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export type SmoothableFrame = {
  frame: number;
  time_s: number;
  landmarks2d: SmoothablePoint[];
  landmarks3d: SmoothablePoint[];
};

export type SmoothParams = {
  landmarkSmoothing: boolean;
  landmarkStrength: number;
  temporalFilter: boolean;
  filterStrength: number;
};

const VIS_MIN = 0.5;

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Strength 0 → 30 Hz (light). Strength 1 → 0.4 Hz (strong). */
function cutoffHz(strength: number): number {
  const s = clamp01(strength);
  return 30 * (1 - s) + 0.4 * s;
}

/** Strength 0 → passthrough. Strength 1 → alpha 0.05. */
function temporalAlpha(strength: number): number {
  return 1 - 0.95 * clamp01(strength);
}

function alphaFromCutoff(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(cutoff, 1e-3));
  return 1 / (1 + tau / Math.max(dt, 1e-4));
}

/**
 * Forward-backward one-pole filter. Mirror-padding keeps the ends from
 * sticking to the first sample, which a causal pass does on a short clip.
 */
function zeroPhase(
  values: number[],
  times: number[],
  alphaFor: (dt: number) => number,
  fallbackDt: number,
): number[] {
  const n = values.length;
  if (n < 2) return values.slice();
  const pad = n - 1;
  const dt0 = Math.max(times[1] - times[0], fallbackDt);
  const dtN = Math.max(times[n - 1] - times[n - 2], fallbackDt);
  const extV = Array.from({ length: n + 2 * pad }, () => 0);
  const extT = Array.from({ length: n + 2 * pad }, () => 0);
  for (let i = 1; i <= pad; i++) {
    extV[pad - i] = values[i];
    extT[pad - i] = times[0] - i * dt0;
  }
  for (let i = 0; i < n; i++) {
    extV[pad + i] = values[i];
    extT[pad + i] = times[i];
  }
  for (let i = 1; i <= pad; i++) {
    extV[pad + n + i - 1] = values[n - 1 - i];
    extT[pad + n + i - 1] = times[n - 1] + i * dtN;
  }

  const fwd = extV.slice();
  for (let i = 1; i < fwd.length; i++) {
    const dt = Math.max(extT[i] - extT[i - 1], fallbackDt);
    const a = alphaFor(dt);
    fwd[i] = a * extV[i] + (1 - a) * fwd[i - 1];
  }
  const back = fwd.slice();
  for (let i = back.length - 2; i >= 0; i--) {
    const dt = Math.max(extT[i + 1] - extT[i], fallbackDt);
    const a = alphaFor(dt);
    back[i] = a * fwd[i] + (1 - a) * back[i + 1];
  }
  return back.slice(pad, pad + n);
}

type Axis = 'x' | 'y' | 'z';

function smoothKey(
  frames: SmoothableFrame[],
  key: 'landmarks2d' | 'landmarks3d',
  axes: readonly Axis[],
  params: SmoothParams,
  fps: number,
): void {
  const fallbackDt = 1 / Math.max(fps, 1);
  const cutoff = params.landmarkSmoothing
    ? cutoffHz(params.landmarkStrength)
    : null;
  const alpha = params.temporalFilter
    ? temporalAlpha(params.filterStrength)
    : null;

  for (let li = 0; li < 33; li++) {
    for (const axis of axes) {
      const samples: Array<{
        index: number;
        value: number;
        time: number;
      } | null> = frames.map((f, index) => {
        const pts = f[key];
        const p = pts[li];
        if (!pts.length || !p || (p.visibility ?? 1) < VIS_MIN) return null;
        const value = p[axis];
        if (value === undefined || !Number.isFinite(value)) return null;
        return { index, value, time: f.time_s };
      });

      let seg: Array<{ index: number; value: number; time: number }> = [];
      const flush = () => {
        if (!seg.length) return;
        let values = seg.map((s) => s.value);
        const times = seg.map((s) => s.time);
        if (cutoff !== null) {
          values = zeroPhase(
            values,
            times,
            (dt) => alphaFromCutoff(cutoff, dt),
            fallbackDt,
          );
        }
        if (alpha !== null) {
          values = zeroPhase(values, times, () => alpha, fallbackDt);
        }
        seg.forEach((s, k) => {
          frames[s.index][key][li][axis] = values[k];
        });
        seg = [];
      };
      for (const s of samples) {
        if (!s) flush();
        else seg.push(s);
      }
      flush();
    }
  }
}

/** Returns a new frame list. Does not mutate `frames`. */
export function smoothPoseFrames<T extends SmoothableFrame>(
  frames: T[],
  params: SmoothParams,
  fps = 15,
): T[] {
  if (!params.landmarkSmoothing && !params.temporalFilter) {
    return frames;
  }
  const out = frames.map((f) => ({
    ...f,
    landmarks2d: f.landmarks2d.map((p) => ({ ...p })),
    landmarks3d: f.landmarks3d.map((p) => ({ ...p })),
  })) as T[];
  smoothKey(out, 'landmarks3d', ['x', 'y', 'z'], params, fps);
  smoothKey(out, 'landmarks2d', ['x', 'y'], params, fps);
  return out;
}
