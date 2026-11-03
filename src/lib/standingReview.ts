import { MP, type LandmarkPoint, type PostureSide } from './posture';

function visible(point: LandmarkPoint | undefined): point is LandmarkPoint {
  return (
    !!point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1 &&
    (point.visibility ?? 1) >= 0.5
  );
}

export function reviewJointChains(side: PostureSide): number[][] {
  const left = [MP.leftHip, MP.leftKnee, MP.leftAnkle];
  const right = [MP.rightHip, MP.rightKnee, MP.rightAnkle];
  return side === 'L' ? [left] : side === 'R' ? [right] : [left, right];
}

/** Face region inferred only when facial pose landmarks are detected. */
export function reviewFaceRegion(points: LandmarkPoint[] | null) {
  const face = (points?.slice(0, 11) ?? []).filter(visible);
  if (face.length < 3) return null;
  const xs = face.map((p) => p.x);
  const ys = face.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const width = Math.max(Math.max(...xs) - Math.min(...xs), 0.04) * 2;
  const height = Math.max(Math.max(...ys) - Math.min(...ys), width * 0.65) * 2;
  const x = Math.max(0, cx - width / 2);
  const y = Math.max(0, cy - height * 0.6);
  return {
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
  };
}

/** Render the saved report image separately; the full original stays clean. */
export function standingReviewUrl(
  source: HTMLCanvasElement,
  points: LandmarkPoint[] | null,
  side: PostureSide,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(source, 0, 0);
  // Without reliable facial landmarks, obscure the whole photo rather than
  // accidentally publish an identifiable face. Joint annotations remain visible.
  const face = reviewFaceRegion(points) ?? { x: 0, y: 0, width: 1, height: 1 };
  if (face) {
    const x = face.x * canvas.width;
    const y = face.y * canvas.height;
    const width = face.width * canvas.width;
    const height = face.height * canvas.height;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.filter = `blur(${Math.max(12, width * 0.15)}px)`;
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  }
  ctx.lineWidth = Math.max(3, canvas.width / 220);
  ctx.strokeStyle = '#22d3ee';
  ctx.fillStyle = '#facc15';
  for (const chain of reviewJointChains(side)) {
    for (let i = 1; i < chain.length; i++) {
      const from = points?.[chain[i - 1]];
      const to = points?.[chain[i]];
      if (!visible(from) || !visible(to)) continue;
      ctx.beginPath();
      ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
      ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
      ctx.stroke();
    }
    for (const index of chain) {
      const point = points?.[index];
      if (!visible(point)) continue;
      ctx.beginPath();
      ctx.arc(
        point.x * canvas.width,
        point.y * canvas.height,
        Math.max(5, canvas.width / 100),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
    }
  }
  return canvas.toDataURL('image/png');
}
