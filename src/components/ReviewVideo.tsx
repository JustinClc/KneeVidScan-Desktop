import { useRef, useState } from 'react';
import type { TrialUploadInfo } from '../lib/backendClient';
import { camLabel, t } from '../lib/locale';
import { useLocale } from '../lib/useLocale';
import { containFit } from '../lib/standingGate';
import { transferPercent, UPLOAD_STATUS_LABEL } from '../lib/uploadStatus';
import { useBoxSize } from '../lib/useBoxSize';

/** Matches the `.cam` border width; the tile is border-box. */
const CAM_BORDER_PX = 2;

function localizedUpload(
  upload: TrialUploadInfo | undefined,
  translate: typeof t,
): string {
  if (!upload) return translate('No recording from this camera');
  if (upload.status === 'failed') {
    return translate('Failed · {error}', {
      error: upload.error || translate('upload failed'),
    });
  }
  if (upload.status === 'uploading' && upload.bytes > 0) {
    return translate('Uploading… {mb} MB', {
      mb: (upload.bytes / 1_000_000).toFixed(1),
    });
  }
  return translate(UPLOAD_STATUS_LABEL[upload.status]);
}

type Props = {
  camCount: number;
  index: number;
  /** Recorded MP4 URL once this camera's upload is ready. */
  src: string | null;
  upload: TrialUploadInfo | undefined;
  videoRef: (el: HTMLVideoElement | null) => void;
  onDuration: (sec: number) => void;
};

export function ReviewVideoTile({
  camCount,
  index,
  src,
  upload,
  videoRef,
  onDuration,
}: Props) {
  useLocale();
  const cellRef = useRef<HTMLDivElement | null>(null);
  const cell = useBoxSize(cellRef);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);

  const fit =
    src && frame
      ? containFit(
          frame.w,
          frame.h,
          cell.w - 2 * CAM_BORDER_PX,
          cell.h - 2 * CAM_BORDER_PX,
        )
      : null;
  const tileStyle =
    fit && fit.width > 0
      ? {
          width: fit.width + 2 * CAM_BORDER_PX,
          height: fit.height + 2 * CAM_BORDER_PX,
        }
      : undefined;

  const pct = transferPercent(upload);
  const failed = !upload || upload.status === 'failed';
  const status = upload?.status ?? 'missing';
  const showBar = !failed && status !== 'cleared';

  return (
    <div className="cam-cell" ref={cellRef}>
      <div
        className="cam fit"
        style={tileStyle}
        data-testid={`review-video-${index}`}
        data-status={status}
      >
        <div className="feed">
          {src ? (
            <video
              ref={videoRef}
              src={src}
              className="feed-img"
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) {
                  setFrame({ w: v.videoWidth, h: v.videoHeight });
                }
                if (Number.isFinite(v.duration)) onDuration(v.duration);
              }}
            />
          ) : (
            <div
              className={`transfer${failed ? ' failed' : ''}`}
              data-testid={`review-progress-${index}`}
            >
              <div className="transfer-label">{localizedUpload(upload, t)}</div>
              {!showBar ? null : (
                <>
                  <div
                    className={`transfer-bar${pct == null ? ' indeterminate' : ''}`}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct == null ? undefined : Math.floor(pct)}
                  >
                    <span
                      style={pct == null ? undefined : { width: `${pct}%` }}
                    />
                  </div>
                  <div
                    className="transfer-pct"
                    data-testid={`review-progress-pct-${index}`}
                  >
                    {pct == null ? '…' : `${Math.floor(pct)}%`}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <span className="cam-label" data-testid={`review-cam-label-${index}`}>
          {camLabel(camCount, index)}
        </span>
      </div>
    </div>
  );
}
