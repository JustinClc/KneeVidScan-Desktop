/**
 * Live 2D pose overlay drawing for Capture — MediaPipe Lite on the **low-res
 * preview** only (see `loadLiveLandmarker`). Save / Export never burn this
 * overlay into videos.
 */

import type { LandmarkPoint } from './posture';

/** MediaPipe Pose connections used for the live overlay (subset). */
export const LIVE_POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 11],
  [0, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 31],
  [28, 32],
] as const;

export type LandmarkDrawRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  landmarks: LandmarkPoint[],
  width: number,
  height: number,
  color = '#2F6FE0',
  /** Video pixels inside the canvas. Defaults to the full canvas. */
  dest?: LandmarkDrawRect,
): void {
  const box = dest ?? { x: 0, y: 0, width, height };
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = color;
  ctx.fillStyle = '#93C5FD';
  ctx.lineWidth = Math.max(2, Math.round(box.width / 240));
  ctx.lineCap = 'round';

  const px = (p: LandmarkPoint) => box.x + p.x * box.width;
  const py = (p: LandmarkPoint) => box.y + p.y * box.height;

  for (const [a, b] of LIVE_POSE_CONNECTIONS) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!pa || !pb) continue;
    if ((pa.visibility ?? 1) < 0.3 || (pb.visibility ?? 1) < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(px(pa), py(pa));
    ctx.lineTo(px(pb), py(pb));
    ctx.stroke();
  }

  const r = Math.max(2, Math.round(box.width / 160));
  for (const p of landmarks) {
    if ((p.visibility ?? 1) < 0.3) continue;
    ctx.beginPath();
    ctx.arc(px(p), py(p), r, 0, Math.PI * 2);
    ctx.fill();
  }
}
