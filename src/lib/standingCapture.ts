/**
 * Full-res standing still → guide-frame crop (desktop renderer).
 * The phone sends a high-quality JPEG; both saved files are PNG, so the
 * uncropped `…_standing_X_full.png` is a lossless re-encode of that frame.
 */

import { guideRectPx } from './standingGate';

export type CroppedStill = {
  /** Cropped PNG bytes for `…_standing_X.png`. */
  croppedPng: Uint8Array;
  /** Uncropped PNG bytes for `…_standing_X_full.png`. */
  fullPng: Uint8Array;
  /** Canvas holding the crop — reused for the MediaPipe re-check. */
  canvas: HTMLCanvasElement;
  fullWidth: number;
  fullHeight: number;
};

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob) throw new Error('Could not encode the PNG');
  return new Uint8Array(await blob.arrayBuffer());
}

export async function cropStillToGuide(
  original: Uint8Array,
  contentType = 'image/png',
): Promise<CroppedStill> {
  const copy = new Uint8Array(original.byteLength);
  copy.set(original);
  const bitmap = await createImageBitmap(
    new Blob([copy.buffer], { type: contentType }),
  );
  try {
    const { sx, sy, sw, sh } = guideRectPx(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const croppedPng = await canvasPng(canvas);

    let fullPng: Uint8Array = copy;
    if (contentType !== 'image/png') {
      const full = document.createElement('canvas');
      full.width = bitmap.width;
      full.height = bitmap.height;
      const fctx = full.getContext('2d');
      if (!fctx) throw new Error('Canvas unavailable');
      fctx.drawImage(bitmap, 0, 0);
      fullPng = await canvasPng(full);
      full.width = 0;
      full.height = 0;
    }
    return {
      croppedPng,
      fullPng,
      canvas,
      fullWidth: bitmap.width,
      fullHeight: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}
