import { CameraPairingButton } from '../components/CameraPairingButton';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LeaveButton, LeaveGroup } from '../components/LeaveButton';
import { backendClient } from '../lib/backendClient';
import {
  applyViewTransforms,
  DEFAULT_POSE_PARAMS,
  MP3D,
  runFullResPoseEstimation,
  videoBlobFromBase64,
  type FullResPoseParams,
  type PoseLandmark3D,
  type PoseModel,
  type SavedVideoLoad,
} from '../lib/fullResPose';
import { incrementTrialName, recordingVideoFileName } from '../lib/naming';
import { frameIndexAtTime } from '../lib/posePlayback';
import { drawLandmarks } from '../lib/livePose';
import { containFit, containRect } from '../lib/standingGate';
import { useBoxSize } from '../lib/useBoxSize';
import { camLabel, t } from '../lib/locale';
import { useLocale } from '../lib/useLocale';
import { saveSessionToFolder, formatSaveResultToast } from '../lib/sessionSave';
import { latestTrial, useSession } from '../state/SessionContext';

function fmtTime(sec: number) {
  const total = Math.max(0, sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

/** MediaPipe-style bone pairs for the 3D viewport (subset of 33). */
const BONES_3D: Array<[number, number]> = [
  [MP3D.nose, MP3D.lShoulder],
  [MP3D.nose, MP3D.rShoulder],
  [MP3D.lShoulder, MP3D.rShoulder],
  [MP3D.lShoulder, MP3D.lElbow],
  [MP3D.lElbow, MP3D.lWrist],
  [MP3D.rShoulder, MP3D.rElbow],
  [MP3D.rElbow, MP3D.rWrist],
  [MP3D.lShoulder, MP3D.lHip],
  [MP3D.rShoulder, MP3D.rHip],
  [MP3D.lHip, MP3D.rHip],
  [MP3D.lHip, MP3D.lKnee],
  [MP3D.lKnee, MP3D.lAnkle],
  [MP3D.lAnkle, MP3D.lHeel],
  [MP3D.lHeel, MP3D.lFoot],
  [MP3D.lAnkle, MP3D.lFoot],
  [MP3D.rHip, MP3D.rKnee],
  [MP3D.rKnee, MP3D.rAnkle],
  [MP3D.rAnkle, MP3D.rHeel],
  [MP3D.rHeel, MP3D.rFoot],
  [MP3D.rAnkle, MP3D.rFoot],
];

export function Pose() {
  const {
    camCount,
    devices,
    subjectId,
    subjectName,
    trialName,
    trials,
    trialRecords,
    heightCm,
    poseByTrial,
    savedFolderByTrial,
    setSavedFolder,
    subjectFolderById,
    setSubjectFolder,
    sessionEpoch,
    setTrialName,
    setTrialPose,
    go,
    showToast,
  } = useSession();
  useLocale();

  const effectiveCamCount = Math.max(camCount, 1);
  const [poseCam, setPoseCam] = useState(1);
  const [model, setModel] = useState<PoseModel>('Full');
  const [scaleToHeight, setScaleToHeight] = useState(false);
  const [lockHips, setLockHips] = useState(false);
  const [landmarkSmoothing, setLandmarkSmoothing] = useState(true);
  const [temporalFilter, setTemporalFilter] = useState(true);
  const [show2d, setShow2d] = useState(true);
  const [smooth1, setSmooth1] = useState(0.5);
  const [smooth2, setSmooth2] = useState(0.5);
  const [det, setDet] = useState(0.5);
  const [pres, setPres] = useState(0.5);
  const [track, setTrack] = useState(0.5);
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState('');
  const saveBusy = useRef(false);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playOrigin = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoCellRef = useRef<HTMLDivElement>(null);
  const orbit = useRef({ yaw: 0.4, pitch: 0.25, zoom: 1, panX: 0, panY: 0 });
  const progressTick = useRef(0);
  const poseRun = useRef(0);

  const selectedTrial = latestTrial(trialRecords, trialName);

  const pickerTrials =
    trials.length > 0
      ? trials
      : selectedTrial
        ? [selectedTrial.name]
        : [trialName];

  const poseResult = poseByTrial[trialName] ?? null;
  const camResult =
    poseResult?.cameras.find((c) => c.camIndex === poseCam - 1) ??
    poseResult?.cameras[0] ??
    null;
  const frameCount = camResult?.frames.length ?? 0;
  const safeFrame = frameCount ? Math.min(frameIdx, frameCount - 1) : 0;
  const currentFrame = camResult?.frames[safeFrame] ?? null;

  const params: FullResPoseParams = useMemo(
    () => ({
      ...DEFAULT_POSE_PARAMS,
      model,
      landmarkSmoothing,
      landmarkStrength: smooth1,
      temporalFilter,
      filterStrength: smooth2,
      minDetectionConfidence: det,
      minPresenceConfidence: pres,
      minTrackingConfidence: track,
    }),
    [
      model,
      landmarkSmoothing,
      smooth1,
      temporalFilter,
      smooth2,
      det,
      pres,
      track,
    ],
  );

  const heightNum = Number.parseFloat(heightCm) || 172;
  const videoUrl = camResult?.videoUrl ?? null;
  const [decodedSize, setDecodedSize] = useState<{
    url: string;
    w: number;
    h: number;
  } | null>(null);
  const videoW =
    decodedSize && decodedSize.url === videoUrl && decodedSize.w > 0
      ? decodedSize.w
      : (camResult?.videoWidth ?? 0);
  const videoH =
    decodedSize && decodedSize.url === videoUrl && decodedSize.h > 0
      ? decodedSize.h
      : (camResult?.videoHeight ?? 0);
  const videoCell = useBoxSize(videoCellRef);
  const fittedVideo =
    videoW > 0 && videoH > 0 && videoCell.w > 0 && videoCell.h > 0
      ? containFit(videoW, videoH, videoCell.w, videoCell.h)
      : null;
  const videoTileStyle =
    fittedVideo && fittedVideo.width > 0 && fittedVideo.height > 0
      ? { width: fittedVideo.width, height: fittedVideo.height }
      : undefined;

  const draw3d = useCallback(
    (landmarks: PoseLandmark3D[] | null) => {
      const canvas = canvasRef.current;
      const vp = vpRef.current;
      if (!canvas || !vp) return;
      canvas.width = vp.clientWidth;
      canvas.height = vp.clientHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { yaw, pitch, zoom, panX, panY } = orbit.current;
      const cx = canvas.width / 2 + panX;
      const cy = canvas.height / 2 + 20 + panY;
      const scale = Math.min(canvas.width, canvas.height) * 0.35 * zoom;

      const project = ([x, y, z]: [number, number, number]) => {
        const cyA = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        const x1 = x * cyA - z * sy;
        const z1 = x * sy + z * cyA;
        const y1 = y * cp - z1 * sp;
        return [cx + x1 * scale, cy - y1 * scale] as const;
      };

      const viewPts = landmarks?.length
        ? applyViewTransforms(landmarks, {
            scaleToHeight,
            heightCm: heightNum,
            lockHips,
          })
        : null;
      const footYs = viewPts
        ? [
            MP3D.lAnkle,
            MP3D.rAnkle,
            MP3D.lHeel,
            MP3D.rHeel,
            MP3D.lFoot,
            MP3D.rFoot,
          ]
            .map((i) => viewPts[i]?.y)
            .filter((y): y is number => y != null && Number.isFinite(y))
        : [];
      const floorY = footYs.length ? Math.min(...footYs) : 0;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let i = -4; i <= 4; i++) {
        const a = project([i * 0.25, floorY, -1]);
        const b = project([i * 0.25, floorY, 1]);
        const c = project([-1, floorY, i * 0.25]);
        const d = project([1, floorY, i * 0.25]);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(c[0], c[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.stroke();
      }

      if (!viewPts) return;

      const proj = viewPts.map(
        (p) => project([p.x, p.y, p.z]) as readonly [number, number],
      );

      ctx.strokeStyle = '#60A5FA';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const [a, b] of BONES_3D) {
        if (!proj[a] || !proj[b]) continue;
        ctx.beginPath();
        ctx.moveTo(proj[a][0], proj[a][1]);
        ctx.lineTo(proj[b][0], proj[b][1]);
        ctx.stroke();
      }
      for (const [x, y] of proj) {
        if (x === undefined) continue;
        ctx.beginPath();
        ctx.fillStyle = '#93C5FD';
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [scaleToHeight, heightNum, lockHips],
  );

  // Redraw 3D when frame / cam / view toggles change
  useEffect(() => {
    draw3d(currentFrame?.landmarks3d ?? null);
  }, [currentFrame, poseCam, draw3d]);

  useEffect(() => {
    orbit.current.yaw = 0.4 + (poseCam - 1) * 0.6;
    orbit.current.panX = 0;
    orbit.current.panY = 0;
    draw3d(currentFrame?.landmarks3d ?? null);
    const onResize = () => draw3d(currentFrame?.landmarks3d ?? null);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poseCam, effectiveCamCount]);

  // Reset scrubber when trial or cam changes
  useEffect(() => {
    setFrameIdx(0);
    setPlaying(false);
  }, [trialName, poseCam]);

  // Sync video element to current frame time when a full-res URL exists.
  // While playing, the playback clock owns the video element.
  useEffect(() => {
    if (playing) return;
    const video = videoRef.current;
    if (!video || !camResult?.videoUrl || !currentFrame) return;
    try {
      if (Math.abs(video.currentTime - currentFrame.time_s) > 0.05) {
        video.currentTime = currentFrame.time_s;
      }
    } catch {
      /* seek may fail on stub blobs */
    }
  }, [currentFrame, camResult?.videoUrl, playing]);

  // One clock for the 3D sequence and the 2D pose video.
  useEffect(() => {
    if (!playing) {
      const video = videoRef.current;
      if (video && !video.paused) video.pause();
      return;
    }
    const frames = camResult?.frames ?? [];
    const lastTime = frames[frames.length - 1]?.time_s ?? 0;
    if (frames.length < 2) {
      setPlaying(false);
      return;
    }
    const origin = playOrigin.current;
    const startedAt = performance.now();
    const url = camResult?.videoUrl ?? null;
    let raf = 0;
    let dead = false;
    let lastVideoTime = -1;
    let lastVideoMoveAt = startedAt;

    const video = videoRef.current;
    if (video && url) {
      try {
        if (Math.abs(video.currentTime - origin) > 0.05) {
          video.currentTime = origin;
        }
      } catch {
        /* seek may fail on stub blobs */
      }
      void Promise.resolve(video.play()).catch(() => {});
    }

    const tick = (now: number) => {
      if (dead) return;
      const v = videoRef.current;
      let usingVideo = false;
      if (v && url && v.ended) {
        setFrameIdx(frames.length - 1);
        setPlaying(false);
        return;
      }
      if (v && url && !v.paused && Number.isFinite(v.currentTime)) {
        if (Math.abs(v.currentTime - lastVideoTime) > 0.01) {
          lastVideoTime = v.currentTime;
          lastVideoMoveAt = now;
          usingVideo = true;
        } else if (now - lastVideoMoveAt < 150 && lastVideoTime >= 0) {
          usingVideo = true;
        }
      }
      const t =
        usingVideo && v ? v.currentTime : origin + (now - startedAt) / 1000;
      if (t >= lastTime - 1e-4) {
        setFrameIdx(frames.length - 1);
        setPlaying(false);
        return;
      }
      const next = frameIndexAtTime(frames, t);
      setFrameIdx((prev) => (prev === next ? prev : next));
      if (!usingVideo && v && url) {
        try {
          if (Math.abs(v.currentTime - t) > 0.05) v.currentTime = t;
        } catch {
          /* seek may fail on stub blobs */
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      const v = videoRef.current;
      if (v && !v.paused) v.pause();
    };
    // camResult frames are current when playback starts; frame ticks must not restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, trialName, poseCam, videoUrl]);

  // Paint 2D overlay in the same rectangle as the contained video frame.
  useEffect(() => {
    const canvas = overlayRef.current;
    const feed = canvas?.parentElement;
    if (!canvas || !feed) return;

    const paint = () => {
      const w = feed.clientWidth;
      const h = feed.clientHeight;
      if (w < 2 || h < 2) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const landmarks = show2d ? currentFrame?.landmarks2d : null;
      if (!landmarks?.length) {
        ctx.clearRect(0, 0, w, h);
        return;
      }
      const dest =
        videoW > 0 && videoH > 0
          ? containRect(videoW, videoH, w, h)
          : { x: 0, y: 0, width: w, height: h };
      drawLandmarks(ctx, landmarks, w, h, '#2F6FE0', dest);
    };

    paint();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(paint);
    ro.observe(feed);
    return () => ro.disconnect();
  }, [show2d, currentFrame, poseCam, videoW, videoH]);

  const onPointer = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const { yaw, pitch, panX, panY } = orbit.current;
    const shift = e.shiftKey;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (shift) {
        orbit.current.panX = panX + dx;
        orbit.current.panY = panY + dy;
      } else {
        orbit.current.yaw = yaw + dx * 0.01;
        orbit.current.pitch = Math.max(-1.2, Math.min(1.2, pitch + dy * 0.01));
      }
      draw3d(currentFrame?.landmarks3d ?? null);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onRerun = async () => {
    if (running) return;
    const run = poseRun.current;
    setPlaying(false);
    setRunning(true);
    setRunProgress('');
    progressTick.current = 0;
    showToast(
      t('Re-running pose on full-res uploads for {name}…', { name: trialName }),
    );
    const saved = {
      folder: (savedFolderByTrial[trialName] ?? null) as string | null,
    };
    let uploads: Record<string, { status?: string }> | null = null;
    if (selectedTrial?.id) {
      try {
        uploads = (await backendClient.getTrial(selectedTrial.id)).uploads;
      } catch {
        uploads = null;
      }
    }
    const loadSavedVideo = async (
      camIndex: number,
    ): Promise<SavedVideoLoad> => {
      const device = devices.find((d) => d.camIndex === camIndex);
      const cleared =
        device != null && uploads?.[device.deviceId]?.status === 'cleared';
      if (!cleared && !saved.folder) return { blob: null };
      if (!saved.folder) {
        const picked =
          (await window.motuscapLite?.chooseSaveFolder?.(
            t('Choose the trial folder that contains the saved MP4s'),
            t('Choose'),
          )) ?? null;
        saved.folder = picked;
        if (picked) setSavedFolder(trialName, picked);
      }
      const folder = saved.folder;
      if (!folder) {
        return {
          blob: null,
          reason: t(
            'The temp video was removed after Save. Choose the folder that contains the saved MP4.',
          ),
        };
      }
      const filename = recordingVideoFileName(
        subjectId,
        subjectName,
        trialName,
        effectiveCamCount,
        camIndex,
      );
      const read = window.motuscapLite?.readSaveFile;
      if (!read) {
        return {
          blob: null,
          reason: t('Could not read {filename}', { filename }),
        };
      }
      const b64 = await read(folder, filename);
      const blob = b64 ? videoBlobFromBase64(b64) : null;
      if (!blob) {
        return {
          blob: null,
          reason: t('Could not find {filename} in the save folder', {
            filename,
          }),
        };
      }
      return { blob };
    };
    try {
      const result = await runFullResPoseEstimation({
        trialName,
        trialId: selectedTrial?.id ?? null,
        camCount: effectiveCamCount,
        devices: devices.map((d) => ({
          deviceId: d.deviceId,
          camIndex: d.camIndex,
        })),
        durationSec: selectedTrial?.durationSec ?? 42,
        params,
        loadSavedVideo,
        onProgress: (p) => {
          if (run !== poseRun.current) return;
          const now = Date.now();
          if (now - progressTick.current < 200 && p.done !== p.total) return;
          progressTick.current = now;
          const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
          setRunProgress(`${camLabel(effectiveCamCount, p.camIndex)} ${pct}%`);
        },
      });
      if (run !== poseRun.current) return;
      setTrialPose(trialName, result);
      setFrameIdx(0);
      showToast(
        t('Pose ready · {count} view(s) · {note}', {
          count: result.cameras.length,
          note: result.note,
        }),
      );
    } catch (e) {
      if (run !== poseRun.current) return;
      showToast(t(e instanceof Error ? e.message : 'Pose re-run failed'));
    } finally {
      if (run === poseRun.current) {
        setRunning(false);
        setRunProgress('');
      }
    }
  };

  const proceedToReport = async () => {
    if (running || saveBusy.current) return;
    saveBusy.current = true;
    setSaving(true);
    setPlaying(false);
    const epoch = sessionEpoch.current;
    let folder = subjectFolderById[subjectId];
    try {
      // The trial picker uses names; save the latest recording for each name.
      const recorded = [
        ...new Map(trialRecords.map((trial) => [trial.name, trial])).values(),
      ];
      for (const trial of recorded) {
        setSaveProgress(t('Saving videos for {name}…', { name: trial.name }));
        const result = await saveSessionToFolder({
          subjectId,
          subjectName,
          trialName: trial.name,
          trialId: trial.id,
          camCount: effectiveCamCount,
          devices: devices.map(({ deviceId, camIndex }) => ({
            deviceId,
            camIndex,
          })),
          subjectFolder: folder,
          clearTempAfterSave: false,
          onProgress: (message) => {
            if (epoch === sessionEpoch.current) setSaveProgress(t(message));
          },
        });
        if (epoch !== sessionEpoch.current) return;
        if (!result.ok) {
          showToast(t(result.error), 8000);
          return;
        }
        if (result.failedVideos.length) {
          showToast(formatSaveResultToast(result), 10000);
          return;
        }
        folder = result.subjectFolder;
        setSubjectFolder(subjectId, folder);
        setSavedFolder(trial.name, result.folder);
      }
      if (epoch === sessionEpoch.current) go(8);
    } catch (error) {
      if (epoch === sessionEpoch.current)
        showToast(
          t(error instanceof Error ? error.message : 'Save failed'),
          8000,
        );
    } finally {
      saveBusy.current = false;
      if (epoch === sessionEpoch.current) {
        setSaving(false);
        setSaveProgress('');
      }
    }
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    const frames = camResult?.frames ?? [];
    if (frames.length < 2) return;
    const start = safeFrame >= frames.length - 1 ? 0 : safeFrame;
    playOrigin.current = frames[start]?.time_s ?? 0;
    if (start !== frameIdx) setFrameIdx(start);
    setPlaying(true);
  };

  const scrubMax = Math.max(0, frameCount - 1);
  const timeCur = currentFrame?.time_s ?? 0;
  const timeTotal =
    camResult?.frames[frameCount - 1]?.time_s ??
    selectedTrial?.durationSec ??
    0;

  return (
    <section
      className="screen active"
      data-screen="7"
      data-testid="screen-pose"
    >
      <div className="pp-layout">
        <aside className="pp-side" data-testid="pose-side">
          <div className="pp-scroll">
            <div className="pp-sec">
              <h3>{t('1. Model')}</h3>
              <div className="pp-seg" role="group" aria-label={t('Pose model')}>
                {(['Lite', 'Full', 'Heavy'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={model === m ? 'on' : ''}
                    data-testid={`pose-model-${m.toLowerCase()}`}
                    onClick={() => setModel(m)}
                  >
                    {t(m)}
                  </button>
                ))}
              </div>
              <p className="pp-note">
                {t(
                  'MediaPipe Pose, 33 landmarks per view. Heavy is the most accurate but the slowest. Re-run applies the selected model to full-res uploads.',
                )}
              </p>
            </div>
            <div className="pp-sec">
              <h3>{t('2. Skeleton')}</h3>
              <label className="pp-check">
                <span>
                  {t('Scale to subject height')}
                  <small>
                    {t('{name} · {height} cm · view only', {
                      name: subjectName,
                      height: heightCm,
                    })}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={scaleToHeight}
                  data-testid="pose-scale-height"
                  onChange={(e) => setScaleToHeight(e.target.checked)}
                />
              </label>
              <p className="pp-note" style={{ marginTop: 0 }}>
                {t(
                  'View toggle only — exports stay raw MediaPipe units (hip-centred). No root-motion claim.',
                )}
              </p>
              <label className="pp-check">
                <span>
                  {t('Lock hips upright')}
                  <small>{t('Vertical axis only · view only')}</small>
                </span>
                <input
                  type="checkbox"
                  checked={lockHips}
                  data-testid="pose-lock-hips"
                  onChange={(e) => setLockHips(e.target.checked)}
                />
              </label>
            </div>
            <div className="pp-sec">
              <h3>{t('3. Smoothing')}</h3>
              <label className="pp-check">
                <span>
                  {t('Landmark smoothing')}
                  <small>{t('Smooth raw landmarks before 3D')}</small>
                </span>
                <input
                  type="checkbox"
                  checked={landmarkSmoothing}
                  data-testid="pose-landmark-smoothing"
                  onChange={(e) => setLandmarkSmoothing(e.target.checked)}
                />
              </label>
              <div className="pp-slider">
                <div>
                  <span>{t('Landmark strength')}</span>
                  <b>{smooth1.toFixed(2)}</b>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={smooth1}
                  data-testid="pose-smooth-strength"
                  onChange={(e) => setSmooth1(Number(e.target.value))}
                />
              </div>
              <label className="pp-check">
                <span>
                  {t('Temporal filter')}
                  <small>{t('Reduces jitter between frames')}</small>
                </span>
                <input
                  type="checkbox"
                  checked={temporalFilter}
                  data-testid="pose-temporal-filter"
                  onChange={(e) => setTemporalFilter(e.target.checked)}
                />
              </label>
              <div className="pp-slider">
                <div>
                  <span>{t('Filter strength')}</span>
                  <b>{smooth2.toFixed(2)}</b>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={smooth2}
                  data-testid="pose-temporal-strength"
                  onChange={(e) => setSmooth2(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="pp-sec">
              <h3>{t('4. Detection & tracking')}</h3>
              {(
                [
                  ['Min. detection confidence', det, setDet, 'pose-det'],
                  ['Min. presence confidence', pres, setPres, 'pose-pres'],
                  ['Min. tracking confidence', track, setTrack, 'pose-track'],
                ] as const
              ).map(([label, val, set, tid]) => (
                <div className="pp-slider" key={label}>
                  <div>
                    <span>{t(label)}</span>
                    <b>{val.toFixed(2)}</b>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={val}
                    data-testid={tid}
                    onChange={(e) => set(Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="pp-run">
            <button
              className="btn btn-primary"
              type="button"
              style={{ width: '100%', justifyContent: 'center' }}
              data-testid="pose-rerun"
              disabled={running || saving}
              onClick={() => void onRerun()}
            >
              {running
                ? runProgress
                  ? t('Re-running… {progress}', { progress: runProgress })
                  : t('Re-running…')
                : t('Run pose estimation')}
            </button>
            <small data-testid="pose-rerun-note">
              {t(
                'Applies to every camera view of {name}. Full-res uploads only (not live preview).',
                { name: trialName },
              )}
            </small>
          </div>
        </aside>
        <div className="pp-main">
          <div className="pp-top">
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <b style={{ fontSize: 15 }}>{t('Pose estimation')}</b>
                <label
                  className="field"
                  style={{
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    textTransform: 'none',
                    letterSpacing: 0,
                  }}
                >
                  {t('Trial')}
                  <select
                    value={trialName}
                    data-testid="pose-trial-picker"
                    disabled={saving}
                    onChange={(e) => {
                      setTrialName(e.target.value);
                      setPoseCam(1);
                      showToast(
                        t('Showing trial {name}', { name: e.target.value }),
                      );
                    }}
                    style={{
                      font: 'inherit',
                      padding: '4px 8px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                    }}
                  >
                    {pickerTrials.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="pp-note" style={{ margin: '2px 0 0' }}>
                {t(
                  'Each camera is estimated on its own. Views are not combined into one 3D scene.',
                )}
              </div>
              {poseResult ? (
                <div
                  className="pp-note"
                  data-testid="pose-run-note"
                  style={{
                    margin: '6px 0 0',
                    color:
                      camResult?.source3d === 'stub' &&
                      camResult?.source2d === 'mediapipe'
                        ? 'var(--warn, #B45309)'
                        : undefined,
                  }}
                >
                  {t('Last run: {note}', { note: poseResult.note })}
                  {camResult?.statusNote
                    ? t(' · This view: {note}', { note: camResult.statusNote })
                    : ''}
                </div>
              ) : null}
            </div>
            <div
              className="pose-tabs"
              style={{ padding: 0, marginLeft: 'auto' }}
              data-testid="pose-cam-tabs"
            >
              {effectiveCamCount > 1 ? (
                <span className="pp-note" style={{ marginRight: 4 }}>
                  {t('Camera view')}
                </span>
              ) : null}
              {Array.from({ length: effectiveCamCount }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`pose-tab${poseCam === i + 1 ? ' on' : ''}`}
                  data-testid={`pose-cam-tab-${i}`}
                  onClick={() => setPoseCam(i + 1)}
                >
                  {camLabel(effectiveCamCount, i)}
                </button>
              ))}
            </div>
          </div>
          <div className="pp-wins">
            <div className="pp-win">
              <div className="pp-win-h">
                <b>
                  {t('3D pose · {cam}', {
                    cam: camLabel(effectiveCamCount, poseCam - 1),
                  })}
                </b>
                <span>
                  {t(
                    'Own camera frame · drag to rotate, Shift-drag to move, scroll to zoom',
                  )}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  data-testid="pose-3d-reset"
                  style={{ marginLeft: 'auto', padding: '2px 8px' }}
                  onClick={() => {
                    orbit.current = {
                      yaw: 0.4 + (poseCam - 1) * 0.6,
                      pitch: 0.25,
                      zoom: 1,
                      panX: 0,
                      panY: 0,
                    };
                    draw3d(currentFrame?.landmarks3d ?? null);
                  }}
                >
                  {t('Reset view')}
                </button>
              </div>
              <div
                className="viewport"
                ref={vpRef}
                data-testid="pose-3d-viewport"
                style={{
                  flex: 1,
                  minHeight: 0,
                  margin: 0,
                  borderRadius: '0 0 12px 12px',
                }}
                onPointerDown={onPointer}
                onWheel={(e) => {
                  e.preventDefault();
                  orbit.current.zoom = Math.max(
                    0.4,
                    Math.min(
                      2.5,
                      orbit.current.zoom * (e.deltaY > 0 ? 0.92 : 1.08),
                    ),
                  );
                  draw3d(currentFrame?.landmarks3d ?? null);
                }}
              >
                <canvas ref={canvasRef} />
                <div className="pp-badge" data-testid="pose-3d-badge">
                  {camResult?.source3d === 'mediapipe'
                    ? t('MediaPipe 3D · {model} · 33 landmarks', {
                        model: t(poseResult?.model ?? model),
                      })
                    : camResult?.source2d === 'mediapipe'
                      ? t('3D stub · no worldLandmarks')
                      : t('MediaPipe 3D · 33 landmarks (stub)')}
                </div>
                {currentFrame && currentFrame.landmarks3d.length === 0 ? (
                  <div
                    data-testid="pose-3d-empty"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--muted)',
                      fontSize: 13,
                      pointerEvents: 'none',
                    }}
                  >
                    {t('No pose detected in this frame')}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="pp-win">
              <div className="pp-win-h">
                <b>
                  {t('Video · 2D pose · {cam}', {
                    cam: camLabel(effectiveCamCount, poseCam - 1),
                  })}
                </b>
                <span>
                  {t('Overlay for viewing only · files stay original')}
                </span>
                <label className="pp-mini">
                  <input
                    type="checkbox"
                    checked={show2d}
                    data-testid="pose-show-skeleton"
                    onChange={(e) => setShow2d(e.target.checked)}
                  />{' '}
                  {t('Show skeleton')}
                </label>
              </div>
              <div
                className="grid-cams cams-1"
                style={{ flex: 1, minHeight: 0 }}
                data-testid="pose-video-panel"
              >
                <div className="cam-cell" ref={videoCellRef}>
                  <div
                    className={`cam${videoUrl ? ' fit' : ''}`}
                    style={videoTileStyle}
                    data-testid="pose-video-tile"
                  >
                    <div className="feed" data-testid="pose-video-feed">
                      {videoUrl ? (
                        <video
                          ref={videoRef}
                          src={videoUrl}
                          className="feed-img"
                          style={{ objectFit: 'contain' }}
                          muted
                          playsInline
                          preload="auto"
                          onLoadedMetadata={(e) => {
                            const v = e.currentTarget;
                            if (v.videoWidth > 0 && v.videoHeight > 0) {
                              setDecodedSize({
                                url: videoUrl,
                                w: v.videoWidth,
                                h: v.videoHeight,
                              });
                            }
                          }}
                        />
                      ) : (
                        <div
                          className="feed-placeholder"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            color: 'var(--muted)',
                            fontSize: 13,
                            padding: 16,
                            textAlign: 'center',
                          }}
                        >
                          {poseResult
                            ? t(
                                'No full-res video URL · showing re-run 2D overlay',
                              )
                            : t(
                                'Run pose estimation on full-res uploads to populate this view',
                              )}
                        </div>
                      )}
                      {show2d ? (
                        <canvas
                          ref={overlayRef}
                          className="pose-overlay"
                          data-testid="pose-2d-overlay"
                          data-pose-source={camResult?.source ?? 'none'}
                          data-pose-source-2d={camResult?.source2d ?? 'none'}
                          data-pose-source-3d={camResult?.source3d ?? 'none'}
                        />
                      ) : null}
                    </div>
                    <span className="cam-label">
                      {camLabel(effectiveCamCount, poseCam - 1)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div
            className="scrubber-wrap"
            style={{ margin: 0 }}
            data-testid="pose-scrubber"
          >
            <div className="scrub-transport">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-pressed={playing}
                data-testid="pose-play"
                disabled={frameCount < 2}
                title={
                  frameCount < 2
                    ? t('Available after pose estimation loads a sequence')
                    : t(
                        'Play or pause the 3D sequence and 2D pose video together',
                      )
                }
                onClick={togglePlay}
              >
                {playing ? t('Pause') : t('Play')}
              </button>
            </div>
            <input
              type="range"
              className="scrubber"
              min={0}
              max={scrubMax}
              value={safeFrame}
              disabled={frameCount === 0}
              data-testid="pose-scrub-range"
              onChange={(e) => {
                setPlaying(false);
                setFrameIdx(Number(e.target.value));
              }}
            />
            <div className="scrub-meta">
              <span data-testid="pose-frame-meta">
                {t('Frame {cur} / {total}', {
                  cur: frameCount ? safeFrame + 1 : 0,
                  total: frameCount,
                })}
                {frameCount
                  ? t(' · views in sync')
                  : t(' · re-run to load frames')}
              </span>
              <span data-testid="pose-time-meta">
                {fmtTime(timeCur)} / {fmtTime(timeTotal)}
              </span>
            </div>
          </div>
          <div className="pp-foot">
            <LeaveGroup>
              <LeaveButton
                label={t('← Back to review')}
                target={6}
                busy={running}
                confirmText={t(
                  'Leave Pose? The re-run continues and its result is saved to this trial.',
                )}
                testId="pose-back-review"
                disabled={saving}
              />
              <CameraPairingButton
                busy={running}
                confirmText={t(
                  'Leave Pose? The re-run continues and its result is saved to this trial.',
                )}
                testId="pose-pair-cameras"
                disabled={saving}
                beforeLeave={() => setPlaying(false)}
              />
            </LeaveGroup>

            <button
              className="btn btn-secondary"
              type="button"
              data-testid="pose-record-another"
              disabled={saving}
              onClick={() => {
                setPlaying(false);
                setTrialName(incrementTrialName(trialName));
                go(5);
              }}
            >
              {t('Record another video')}
            </button>
            {saving ? (
              <span
                className="pp-note"
                role="status"
                data-testid="pose-video-save-progress"
              >
                {saveProgress}
              </span>
            ) : null}
            <button
              className="btn btn-primary"
              type="button"
              data-testid="pose-proceed-report"
              style={{ marginLeft: 'auto' }}
              disabled={running || saving}
              onClick={() => void proceedToReport()}
            >
              {saving ? t('Saving…') : t('Proceed')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
