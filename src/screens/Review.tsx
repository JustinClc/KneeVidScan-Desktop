import { CameraPairingButton } from '../components/CameraPairingButton';
import { useEffect, useRef, useState } from 'react';
import { EmptyImuTraces } from '../components/EmptyImu';
import { ReviewVideoTile } from '../components/ReviewVideo';
import { backendClient, type TrialUploadInfo } from '../lib/backendClient';
import {
  MIN_TRIM_SEC,
  moveTrimEnd,
  moveTrimStart,
  timeAtClientX,
  trimChangesMedia,
} from '../lib/trimWindow';
import { isInFlight } from '../lib/uploadStatus';
import { t } from '../lib/locale';
import { useLocale } from '../lib/useLocale';
import { latestTrial, useSession } from '../state/SessionContext';

const UPLOAD_POLL_MS = 500;
/** Re-seek a playing camera video once it drifts this far from the playhead. */
const PLAY_DRIFT_SEC = 0.3;
/** Paused: any larger gap means the scrubber moved. */
const SEEK_EPS_SEC = 0.04;

function fmt(x: number) {
  const total = Math.max(0, x);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

export function Review() {
  const {
    camCount,
    devices,
    connectedImus,
    hasImus,
    trialName,
    trials,
    trialRecords,
    setTrialName,
    recordTrial,
    clearTrialPose,
    showToast,
    go,
  } = useSession();
  useLocale();

  const selected = latestTrial(trialRecords, trialName);
  const selectedId = selected?.id ?? null;
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>(
    {},
  );
  useEffect(() => setVideoDurations({}), [selectedId]);
  const longestVideo = Math.max(0, ...Object.values(videoDurations));
  const durationSec = Math.max(
    1,
    longestVideo || (selected?.durationSec ?? 42),
  );

  const [uploads, setUploads] = useState<Record<
    string,
    TrialUploadInfo
  > | null>(null);
  useEffect(() => {
    setUploads(null);
    if (!selectedId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      let keepPolling = true;
      try {
        const info = await backendClient.getTrial(selectedId);
        if (stopped) return;
        setUploads(info.uploads);
        keepPolling = Object.values(info.uploads).some(isInFlight);
      } catch {
        /* backend unreachable: try again */
      }
      if (!stopped && keepPolling) {
        timer = window.setTimeout(() => void poll(), UPLOAD_POLL_MS);
      }
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [selectedId]);

  const [pct, setPct] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [trimIn, setTrimIn] = useState(0);
  const [trimOut, setTrimOut] = useState<number | null>(null);
  const [trimming, setTrimming] = useState(false);
  const [trimError, setTrimError] = useState<string | null>(null);
  const [mediaRev, setMediaRev] = useState(0);
  const raf = useRef<number | null>(null);
  const lastTs = useRef(0);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Reset scrubber when switching trials (shared playhead per trial)
  useEffect(() => {
    setPct(0);
    setPlaying(false);
    setTrimIn(0);
    setTrimOut(null);
    setTrimError(null);
    setTrimming(false);
    setMediaRev(0);
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
  }, [trialName, selectedId]);

  const pause = () => {
    setPlaying(false);
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
  };

  const transfersDone =
    uploads != null && devices.every((d) => !isInFlight(uploads[d.deviceId]));
  const baseSrc = (deviceId: string) =>
    transfersDone && selectedId && uploads?.[deviceId]?.status === 'ready'
      ? backendClient.uploadUrl(deviceId, selectedId)
      : null;
  const srcFor = (deviceId: string) => {
    const base = baseSrc(deviceId);
    if (!base) return null;
    return mediaRev > 0 ? `${base}?v=${mediaRev}` : base;
  };
  const canPlay = devices.some((d) => baseSrc(d.deviceId) != null);
  const allLoaded =
    transfersDone &&
    devices.length > 0 &&
    devices.every((d) => {
      const dur = videoDurations[d.deviceId];
      return baseSrc(d.deviceId) != null && Number.isFinite(dur) && dur > 0;
    });
  const overlapSec = allLoaded
    ? Math.min(...devices.map((d) => videoDurations[d.deviceId] ?? 0))
    : null;
  const timelineSec = overlapSec ?? durationSec;
  const endSec = allLoaded
    ? Math.min(trimOut ?? timelineSec, timelineSec)
    : timelineSec;
  const startSec = allLoaded
    ? Math.min(Math.max(0, trimIn), Math.max(0, endSec - MIN_TRIM_SEC))
    : 0;
  const canTrim = allLoaded && !trimming;
  const trimmed =
    uploads != null &&
    devices.length > 0 &&
    devices.every((d) => uploads[d.deviceId]?.trimmed === true);
  const dirty =
    allLoaded && trimChangesMedia(timelineSec, { startSec, endSec });
  const startPct = timelineSec > 0 ? (startSec / timelineSec) * 100 : 0;
  const endPct = timelineSec > 0 ? (endSec / timelineSec) * 100 : 100;

  const playback = useRef({ rate: 1, start: 0, end: 1, timeline: 1 });
  playback.current = {
    rate,
    start: startSec,
    end: endSec,
    timeline: timelineSec,
  };

  useEffect(() => {
    if (!playing) return;
    lastTs.current = performance.now();
    const tick = (ts: number) => {
      const dt = (ts - lastTs.current) / 1000;
      lastTs.current = ts;
      const bounds = playback.current;
      setPct((p) => {
        const timeline = bounds.timeline;
        if (!(timeline > 0)) return p;
        const next = (p / 100) * timeline + dt * bounds.rate;
        if (next >= bounds.end - 1e-4) {
          pause();
          return (bounds.end / timeline) * 100;
        }
        if (next < bounds.start) return (bounds.start / timeline) * 100;
        return (next / timeline) * 100;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing]);

  useEffect(() => {
    setPct((p) => {
      if (!(timelineSec > 0)) return 0;
      const t = (p / 100) * timelineSec;
      const clamped = Math.min(endSec, Math.max(startSec, t));
      const next = (clamped / timelineSec) * 100;
      return Math.abs(next - p) < 1e-4 ? p : next;
    });
  }, [startSec, endSec, timelineSec]);

  const cur = Math.min(
    endSec,
    Math.max(startSec, timelineSec > 0 ? (pct / 100) * timelineSec : 0),
  );

  const seekTo = (sec: number) => {
    const clamped = Math.min(endSec, Math.max(startSec, sec));
    setPct(timelineSec > 0 ? (clamped / timelineSec) * 100 : 0);
  };

  const dragHandle = (which: 'start' | 'end', clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || !canTrim) return;
    const t = timeAtClientX(clientX, rect.left, rect.width, timelineSec);
    if (which === 'start') {
      setTrimIn(moveTrimStart(timelineSec, t, endSec).startSec);
    } else {
      setTrimOut(moveTrimEnd(timelineSec, startSec, t).endSec);
    }
  };

  const nudgeHandle = (which: 'start' | 'end', key: string, shift: boolean) => {
    const dir =
      key === 'ArrowRight' || key === 'ArrowUp'
        ? 1
        : key === 'ArrowLeft' || key === 'ArrowDown'
          ? -1
          : 0;
    if (!dir || !canTrim) return false;
    const step = (shift ? 1 : MIN_TRIM_SEC) * dir;
    if (which === 'start') {
      setTrimIn(moveTrimStart(timelineSec, startSec + step, endSec).startSec);
    } else {
      setTrimOut(moveTrimEnd(timelineSec, startSec, endSec + step).endSec);
    }
    return true;
  };

  const applyTrim = async () => {
    if (!selectedId || !canTrim || !dirty) return;
    pause();
    setTrimming(true);
    setTrimError(null);
    try {
      const result = await backendClient.trimTrial(selectedId, {
        startSec,
        endSec,
      });
      const info = await backendClient.getTrial(selectedId);
      setUploads(info.uploads);
      if (selected) {
        recordTrial({ ...selected, durationSec: result.duration_sec });
        clearTrialPose(selected.name);
      }
      setTrimIn(0);
      setTrimOut(null);
      setPct(0);
      setVideoDurations({});
      setMediaRev((n) => n + 1);
      showToast(
        t('Trimmed every view to {seconds} s', {
          seconds: result.duration_sec.toFixed(1),
        }),
      );
    } catch (err) {
      setTrimError(t(err instanceof Error ? err.message : 'Trim failed'));
    } finally {
      setTrimming(false);
    }
  };

  const revertTrim = async () => {
    if (!selectedId || !trimmed || trimming) return;
    pause();
    setTrimming(true);
    setTrimError(null);
    try {
      const result = await backendClient.revertTrial(selectedId);
      const info = await backendClient.getTrial(selectedId);
      setUploads(info.uploads);
      if (selected && result.duration_sec > 0) {
        recordTrial({ ...selected, durationSec: result.duration_sec });
      }
      if (selected) clearTrialPose(selected.name);
      setTrimIn(0);
      setTrimOut(null);
      setPct(0);
      setVideoDurations({});
      setMediaRev((n) => n + 1);
      showToast(t('Restored the original videos'));
    } catch (err) {
      setTrimError(t(err instanceof Error ? err.message : 'Revert failed'));
    } finally {
      setTrimming(false);
    }
  };

  // Camera videos follow the shared playhead, speed and play state.
  useEffect(() => {
    for (const v of videos.current.values()) {
      v.playbackRate = rate;
      const target = Math.min(
        cur,
        Number.isFinite(v.duration) ? v.duration : cur,
      );
      if (playing) {
        if (Math.abs(v.currentTime - target) > PLAY_DRIFT_SEC) {
          v.currentTime = target;
        }
        if (v.paused && !v.ended && cur < v.duration) {
          void Promise.resolve(v.play()).catch(() => {});
        }
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > SEEK_EPS_SEC) {
          v.currentTime = target;
        }
      }
    }
  }, [playing, rate, cur]);

  const pickerTrials =
    trials.length > 0 ? trials : selected ? [selected.name] : [trialName];

  return (
    <section
      className="screen active"
      data-screen="6"
      data-testid="screen-review"
    >
      <div className="review-layout">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h1 style={{ margin: 0 }}>{t('Sit-to-stand recording review')}</h1>
            <p className="sub" style={{ margin: '4px 0 0' }}>
              {t(
                hasImus
                  ? 'Shared scrubber across all cameras · IMU traces share the playhead.'
                  : 'Shared scrubber across all cameras.',
              )}
            </p>
          </div>
          <div
            className="actions"
            style={{ margin: 0, gap: 10, alignItems: 'center' }}
          >
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
                onChange={(e) => setTrialName(e.target.value)}
                data-testid="review-trial-picker"
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
            <button
              className="btn btn-primary"
              type="button"
              data-testid="review-proceed-pose"
              onClick={() => go(7)}
            >
              {t('Proceed to pose reconstruction')}
            </button>
            <>
              <button
                className="btn btn-ghost"
                type="button"
                data-testid="review-record-another"
                onClick={() => {
                  pause();
                  go(5);
                }}
              >
                {t('Record another')}
              </button>
              <CameraPairingButton
                busy={false}
                confirmText=""
                beforeLeave={pause}
                testId="review-pair-cameras"
              />
            </>
          </div>
        </div>
        <div
          className={`grid-cams cams-${Math.max(camCount, 1)}`}
          style={{ flex: 1, minHeight: 0 }}
          data-testid="review-video-grid"
        >
          {devices.map((d) => (
            <ReviewVideoTile
              key={`${selectedId}:${d.deviceId}:${mediaRev}`}
              camCount={Math.max(camCount, 1)}
              index={d.camIndex}
              src={srcFor(d.deviceId)}
              upload={uploads?.[d.deviceId]}
              videoRef={(el) => {
                if (el) videos.current.set(d.deviceId, el);
                else videos.current.delete(d.deviceId);
              }}
              onDuration={(sec) =>
                setVideoDurations((prev) =>
                  prev[d.deviceId] === sec
                    ? prev
                    : { ...prev, [d.deviceId]: sec },
                )
              }
            />
          ))}
        </div>
        <div className="scrubber-wrap" data-testid="review-scrubber">
          <div className="scrub-transport">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              aria-pressed={playing}
              data-testid="review-play"
              disabled={!canPlay || trimming}
              title={
                canPlay
                  ? undefined
                  : t('Available once the videos have transferred')
              }
              onClick={() => {
                if (playing) pause();
                else {
                  if (cur >= endSec - 0.05) seekTo(startSec);
                  setPlaying(true);
                }
              }}
            >
              {playing ? t('Pause') : t('Play')}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              data-testid="review-trim"
              disabled={!canTrim || !dirty}
              title={
                trimming
                  ? t('Replacing every view')
                  : !allLoaded
                    ? t('Available once every view has loaded')
                    : !dirty
                      ? t(
                          'Drag either end of the bar to choose the kept region',
                        )
                      : t('Replace every uploaded video with this range')
              }
              onClick={() => void applyTrim()}
            >
              {trimming && !trimmed ? t('Trimming…') : t('Trim all views')}
            </button>
            {trimmed ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="review-revert"
                disabled={trimming}
                title={t('Put every view back on the video from the phones')}
                onClick={() => void revertTrim()}
              >
                {trimming ? t('Reverting…') : t('Revert to original')}
              </button>
            ) : null}
            <div
              className="speed-group"
              role="group"
              aria-label={t('Playback speed')}
            >
              {[0.5, 1].map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`speed-btn${rate === r ? ' on' : ''}`}
                  aria-pressed={rate === r}
                  data-testid={`review-speed-${r}`}
                  onClick={() => setRate(r)}
                >
                  {r}×
                </button>
              ))}
            </div>
          </div>
          <div
            className="scrub-track"
            ref={trackRef}
            data-testid="review-trim-track"
          >
            <div className="scrub-shade" style={{ width: `${startPct}%` }} />
            <div
              className="scrub-shade scrub-shade-end"
              style={{ width: `${100 - endPct}%` }}
            />
            <div
              className="scrub-keep"
              style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
            />
            <input
              type="range"
              className="scrubber"
              min={0}
              max={100}
              step={0.1}
              value={timelineSec > 0 ? (cur / timelineSec) * 100 : 0}
              disabled={!canPlay || trimming}
              data-testid="review-scrub-range"
              onChange={(e) =>
                seekTo((Number(e.target.value) / 100) * timelineSec)
              }
            />
            {allLoaded ? (
              <>
                <button
                  type="button"
                  className="trim-handle"
                  data-testid="review-trim-start"
                  aria-label={t('Trim start')}
                  role="slider"
                  aria-valuemin={0}
                  aria-valuemax={Math.max(0, endSec - MIN_TRIM_SEC)}
                  aria-valuenow={startSec}
                  aria-valuetext={fmt(startSec)}
                  disabled={!canTrim}
                  style={{ left: `${startPct}%` }}
                  onPointerDown={(e) => {
                    if (!canTrim) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    dragHandle('start', e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                    dragHandle('start', e.clientX);
                  }}
                  onKeyDown={(e) => {
                    if (nudgeHandle('start', e.key, e.shiftKey)) {
                      e.preventDefault();
                    }
                  }}
                />
                <button
                  type="button"
                  className="trim-handle"
                  data-testid="review-trim-end"
                  aria-label={t('Trim end')}
                  role="slider"
                  aria-valuemin={startSec + MIN_TRIM_SEC}
                  aria-valuemax={timelineSec}
                  aria-valuenow={endSec}
                  aria-valuetext={fmt(endSec)}
                  disabled={!canTrim}
                  style={{ left: `${endPct}%` }}
                  onPointerDown={(e) => {
                    if (!canTrim) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    dragHandle('end', e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                    dragHandle('end', e.clientX);
                  }}
                  onKeyDown={(e) => {
                    if (nudgeHandle('end', e.key, e.shiftKey)) {
                      e.preventDefault();
                    }
                  }}
                />
              </>
            ) : null}
          </div>
          <div className="scrub-meta">
            <span>{t('SessionTime')}</span>
            <span data-testid="review-time">
              {fmt(cur)} / {fmt(timelineSec)}
            </span>
          </div>
          {allLoaded ? (
            <p className="sub scrub-trim-note">
              {t(
                'Drag either end, then trim. Every view is cut to this range and the uploaded videos are replaced.',
              )}
            </p>
          ) : null}
          {trimError ? (
            <p
              className="scrub-trim-error"
              role="alert"
              data-testid="review-trim-error"
            >
              {trimError}
            </p>
          ) : null}
        </div>
        {hasImus ? (
          <div className="imu-review show" data-testid="review-imu-traces">
            <div className="block-title" style={{ margin: 0 }}>
              {t('Recorded IMU traces')}
            </div>
            <p className="sub" style={{ margin: 0, fontSize: 12 }}>
              {t(
                'Empty until the IMU backend module lands. Paired slots only — no fake traces or parked playhead.',
              )}
            </p>
            <EmptyImuTraces slots={connectedImus} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
