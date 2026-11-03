import { useEffect, useRef, useState } from 'react';
import { camLabel, t } from '../lib/locale';
import { useLocale } from '../lib/useLocale';
import { backendClient } from '../lib/backendClient';
import { drawLandmarks } from '../lib/livePose';
import {
  loadLiveLandmarker,
  type StandingLandmarker,
} from '../lib/mediapipePose';
import {
  CAPTURE_DETECT_GAP_MS,
  createFpsMeter,
  detectGapMs,
} from '../lib/framePacing';
import { containFit } from '../lib/standingGate';
import { useBoxSize } from '../lib/useBoxSize';
import type { SessionDevice } from '../state/SessionContext';

type PoseStatus = 'loading' | 'live' | 'no-person' | 'unavailable';

const POSE_TAG: Record<PoseStatus, string> = {
  loading: '2D pose · loading',
  live: '2D pose · live',
  'no-person': '2D pose · no person',
  unavailable: '2D pose · unavailable',
};

const PREVIEW_POLL_MS = 500;
const PREVIEW_RETRY_MS = 300;
/** Matches the `.cam` border width; the tile is border-box. */
const CAM_BORDER_PX = 2;

type Props = {
  camCount: number;
  index: number;
  device?: SessionDevice;
  recording?: boolean;
  showPose?: boolean;
  /** Long-poll every new phone frame (Capture), pose overlay or not. */
  live?: boolean;
  qc?: string;
  liveTag?: boolean;
  /** Size the tile to the camera frame's aspect so nothing is cropped. */
  fitFrame?: boolean;
  /** When false, skip preview long-poll and show a placeholder. */
  previewEnabled?: boolean;
};

export function CamFeed({
  camCount,
  index,
  device,
  recording,
  showPose,
  live,
  qc,
  liveTag,
  fitFrame,
  previewEnabled = true,
}: Props) {
  useLocale();
  const label = camLabel(camCount, index);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [poseStatus, setPoseStatus] = useState<PoseStatus>('loading');
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<StandingLandmarker | null>(null);
  const fpsMeter = useRef(createFpsMeter());
  const [fps, setFps] = useState(0);
  const lastDetectAt = useRef(0);
  const lastDetectMs = useRef(0);
  const cellRef = useRef<HTMLDivElement | null>(null);
  const cell = useBoxSize(cellRef);

  useEffect(() => {
    if (!showPose) {
      landmarkerRef.current = null;
      return;
    }
    let cancelled = false;
    setPoseStatus('loading');
    void loadLiveLandmarker(backendClient.baseUrl()).then((lm) => {
      if (cancelled) return;
      landmarkerRef.current = lm;
      setPoseStatus(lm ? 'no-person' : 'unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, [showPose]);

  // Live (Capture): long-poll each new phone frame. Otherwise light polling.
  useEffect(() => {
    if (!device?.deviceId) {
      setPreviewUrl(null);
      return;
    }
    if (!previewEnabled) {
      setPreviewUrl(null);
      return;
    }
    const deviceId = device.deviceId;
    let cancelled = false;
    let objectUrl: string | null = null;
    const show = (blob: Blob) => {
      const next = URL.createObjectURL(blob);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = next;
      setPreviewUrl(next);
    };

    if (live || showPose) {
      const abort = new AbortController();
      let lastAt = 0;
      void (async () => {
        while (!cancelled) {
          try {
            const hit = await backendClient.nextPreview(
              deviceId,
              lastAt,
              abort.signal,
            );
            if (cancelled) break;
            if (hit) {
              lastAt = hit.at;
              show(hit.blob);
              continue;
            }
          } catch {
            /* backend unreachable */
          }
          await new Promise((r) => setTimeout(r, PREVIEW_RETRY_MS));
        }
      })();
      return () => {
        cancelled = true;
        abort.abort();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }

    const tick = async () => {
      try {
        const res = await fetch(backendClient.previewUrl(deviceId, Date.now()));
        if (!res.ok) return;
        const blob = await res.blob();
        if (!cancelled) show(blob);
      } catch {
        /* no frame yet */
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), PREVIEW_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [device?.deviceId, showPose, live, previewEnabled]);

  // Live 2D pose on preview only; never baked into Save/Export.
  const onFrame = (img: HTMLImageElement) => {
    const fw = img.naturalWidth;
    const fh = img.naturalHeight;
    if (fw && fh) {
      setFrame((prev) =>
        prev && prev.w === fw && prev.h === fh ? prev : { w: fw, h: fh },
      );
    }
    const now = performance.now();
    fpsMeter.current.tick(now);
    const measured = fpsMeter.current.fps(now);
    setFps((prev) => (prev === measured ? prev : measured));

    const lm = landmarkerRef.current;
    const canvas = canvasRef.current;
    if (!showPose || !lm || !canvas) return;
    // The picture updates every frame; the skeleton keeps the last result
    // until the next detection slot.
    const gap = detectGapMs(
      CAPTURE_DETECT_GAP_MS,
      lastDetectMs.current,
      camCount,
    );
    if (now - lastDetectAt.current < gap) return;
    lastDetectAt.current = now;
    let landmarks = null;
    try {
      landmarks = lm.detect(img);
    } catch {
      landmarks = null;
    }
    lastDetectMs.current = performance.now() - now;
    const feed = canvas.parentElement;
    const w = feed?.clientWidth || 320;
    const h = feed?.clientHeight || 240;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (landmarks) {
      if (ctx) drawLandmarks(ctx, landmarks, w, h, '#2F6FE0');
      setPoseStatus('live');
    } else {
      ctx?.clearRect(0, 0, w, h);
      setPoseStatus('no-person');
    }
  };

  const fit =
    fitFrame && frame
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

  const tile = (
    <div
      className={`cam${recording ? ' recording' : ''}${fitFrame ? ' fit' : ''}`}
      style={tileStyle}
    >
      <div className="feed" data-testid={`cam-feed-${index}`}>
        {!previewEnabled ? (
          <div
            className="feed-placeholder"
            data-testid={`cam-preview-off-${index}`}
          >
            {t('Preview off')}
          </div>
        ) : previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="feed-img"
            draggable={false}
            onLoad={(e) => onFrame(e.currentTarget)}
          />
        ) : null}
        {showPose ? (
          <canvas
            ref={canvasRef}
            className="pose-overlay"
            data-testid={`pose-overlay-${index}`}
            data-pose-status={poseStatus}
          />
        ) : null}
      </div>
      <span className="cam-label" data-testid={`cam-label-${index}`}>
        {label}
      </span>
      {live && previewEnabled && previewUrl ? (
        <span
          className="cam-fps"
          data-testid={`cam-fps-${index}`}
          data-fps={fps}
        >
          {fps} fps
        </span>
      ) : null}
      {liveTag && showPose ? (
        <span className="pose-live" data-testid={`pose-live-${index}`}>
          {t(POSE_TAG[poseStatus])}
        </span>
      ) : null}
      {qc ? <span className="cam-qc">{qc}</span> : null}
    </div>
  );

  if (!fitFrame) return tile;
  return (
    <div className="cam-cell" ref={cellRef}>
      {tile}
    </div>
  );
}

export function CamGrid({
  camCount,
  devices,
  recording,
  showPose = false,
  live,
  liveTag,
  fitFrame,
  previewEnabled = true,
}: {
  camCount: number;
  devices?: SessionDevice[];
  recording?: boolean;
  /** Live/view overlay — off by default (Capture toggle / Pose page only). */
  showPose?: boolean;
  /** Long-poll every new phone frame (Capture), pose overlay or not. */
  live?: boolean;
  liveTag?: boolean;
  fitFrame?: boolean;
  previewEnabled?: boolean;
}) {
  return (
    <div
      className={`grid-cams cams-${camCount}`}
      style={{ flex: 1, minHeight: 0 }}
      data-testid="cam-grid"
      data-show-pose={showPose ? '1' : '0'}
      data-live={live ? '1' : '0'}
    >
      {Array.from({ length: Math.max(camCount, 1) }, (_, i) => (
        <CamFeed
          key={devices?.[i]?.deviceId ?? i}
          camCount={camCount}
          index={i}
          device={devices?.[i]}
          recording={recording}
          showPose={showPose}
          live={live}
          liveTag={liveTag}
          fitFrame={fitFrame}
          previewEnabled={previewEnabled}
        />
      ))}
    </div>
  );
}
