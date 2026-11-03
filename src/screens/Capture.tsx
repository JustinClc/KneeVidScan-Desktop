import { useCallback, useEffect, useRef, useState } from 'react';
import { CamGrid } from '../components/CamFeed';
import { LeaveButton, LeaveGroup } from '../components/LeaveButton';
import { EmptyImuLive } from '../components/EmptyImu';
import {
  backendClient,
  type RecordingQualityState,
} from '../lib/backendClient';
import { TRIAL_MAX_SECONDS } from '../lib/sync';
import { t } from '../lib/locale';
import { useLocale } from '../lib/useLocale';
import {
  TARGET_MIN_FPS,
  type RecordingPresetId,
  type RecordingQualityMode,
} from '../lib/recordingQuality';
import { useSession } from '../state/SessionContext';

/** Phones keep 15 fps previews while this heartbeat is under the 6 s expiry. */
const CAPTURE_PREVIEW_HEARTBEAT_MS = 2000;
const PROBE_POLL_MS = 400;
const PROBE_TIMEOUT_MS = 3000;

const PRESET_IDS: RecordingPresetId[] = ['1080p', '720p', '480p'];
const PRESET_RANK: Record<RecordingPresetId, number> = {
  '1080p': 0,
  '720p': 1,
  '480p': 2,
};

function presetOptionLabel(
  id: RecordingPresetId,
  estimates: Record<RecordingPresetId, number>,
) {
  const fps = estimates[id];
  if (fps > 0) return `${id} (~${fps} fps)`;
  return `${id} (~— fps)`;
}

function qualityWarning(state: RecordingQualityState): boolean {
  const { mode, recommendation, estimates } = state;
  if (mode === 'auto') {
    const est = estimates[recommendation];
    return est > 0 && est < TARGET_MIN_FPS;
  }
  const preset = mode as RecordingPresetId;
  const est = estimates[preset];
  if (est > 0 && est < TARGET_MIN_FPS) return true;
  return PRESET_RANK[preset] < PRESET_RANK[recommendation];
}

function formatTimer(elapsed: number) {
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  return `${m}:${s} / 03:00`;
}

export function Capture() {
  const {
    camCount,
    devices,
    connectedImus,
    hasImus,
    trialName,
    recording,
    elapsed,
    poseOn,
    activeTrialId,
    activeStartAtMs,
    setTrialName,
    setRecording,
    setElapsed,
    setPoseOn,
    setActiveTrialId,
    setActiveStartAtMs,
    recordTrial,
    go,
    showToast,
  } = useSession();
  useLocale();

  const timerRef = useRef<number | null>(null);
  /** Seconds left before the shared start; null once recording (or idle). */
  const [countdown, setCountdown] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [quality, setQuality] = useState<RecordingQualityState | null>(null);
  const [probesRefreshing, setProbesRefreshing] = useState(false);
  const elapsedRef = useRef(0);
  const activeTrialIdRef = useRef<string | null>(null);
  const startAtRef = useRef<number | null>(null);
  const trialNameRef = useRef(trialName);
  const stoppingRef = useRef(false);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);
  useEffect(() => {
    activeTrialIdRef.current = activeTrialId;
  }, [activeTrialId]);
  useEffect(() => {
    startAtRef.current = activeStartAtMs;
  }, [activeStartAtMs]);
  useEffect(() => {
    trialNameRef.current = trialName;
  }, [trialName]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      // Preview off is a Capture-only setting; Standing and Pair need frames.
      void backendClient
        .setRecordingQuality({ previewEnabled: true })
        .catch(() => {});
    };
  }, []);

  const deviceIds = devices.map((d) => d.deviceId).join(',');

  const refreshQualityProbes = useCallback(async () => {
    const deviceCount = devices.length;
    if (deviceCount === 0) {
      try {
        setQuality(await backendClient.getRecordingQuality());
      } catch {
        /* ignore */
      }
      return;
    }
    setProbesRefreshing(true);
    try {
      await backendClient.requestLinkProbes();
      const deadline = Date.now() + PROBE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const next = await backendClient.getRecordingQuality();
        setQuality(next);
        if (next.probes >= deviceCount) break;
        await new Promise((r) => setTimeout(r, PROBE_POLL_MS));
      }
    } catch {
      /* ignore */
    } finally {
      setProbesRefreshing(false);
    }
  }, [devices.length]);

  useEffect(() => {
    void refreshQualityProbes();
  }, [deviceIds, refreshQualityProbes]);

  useEffect(() => {
    if (!deviceIds) return;
    const ids = deviceIds.split(',');
    const beat = (active: boolean) => {
      for (const id of ids) {
        void backendClient.setLivePoseMode(id, active).catch(() => {});
      }
    };
    beat(true);
    const timer = window.setInterval(
      () => beat(true),
      CAPTURE_PREVIEW_HEARTBEAT_MS,
    );
    return () => {
      window.clearInterval(timer);
      beat(false);
    };
  }, [deviceIds]);

  const stopRec = async (silent: boolean) => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setRecording(false);
    setCountdown(null);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const name = trialNameRef.current.trim() || 'gait01';
    const trialId = activeTrialIdRef.current;
    const startAt = startAtRef.current;
    // Stop during the countdown: nothing was recorded, so nothing is kept.
    const cancelled = startAt != null && Date.now() < startAt;
    if (trialId) {
      try {
        await (cancelled
          ? backendClient.cancelTrial(trialId)
          : backendClient.stopTrial(trialId));
      } catch {
        /* ignore */
      }
      if (!cancelled) {
        const recordedSec = startAt != null ? (Date.now() - startAt) / 1000 : 0;
        recordTrial({
          id: trialId,
          name,
          startAtMs: startAt,
          durationSec: Math.max(
            Math.min(Math.round(recordedSec), TRIAL_MAX_SECONDS),
            1,
          ),
          stoppedAt: Date.now(),
        });
      }
    }
    setActiveTrialId(null);
    setActiveStartAtMs(null);
    stoppingRef.current = false;
    if (cancelled) {
      setElapsed(0);
      elapsedRef.current = 0;
      if (!silent) showToast(t('Start cancelled — nothing was recorded'));
      return;
    }
    if (!silent) {
      showToast(
        t('Trial “{name}” stopped — phones are uploading the videos', {
          name,
        }),
      );
      go(6);
    }
  };

  /** Countdown to the shared start, then elapsed time measured from it. */
  const runClock = (startAtMs: number) => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    const tick = () => {
      const now = Date.now();
      if (now < startAtMs) {
        setCountdown(Math.ceil((startAtMs - now) / 1000));
        return;
      }
      setCountdown(null);
      const e = Math.min(
        Math.floor((now - startAtMs) / 1000),
        TRIAL_MAX_SECONDS,
      );
      if (e !== elapsedRef.current) {
        elapsedRef.current = e;
        setElapsed(e);
      }
      if (e >= TRIAL_MAX_SECONDS) void stopRec(false);
    };
    tick();
    timerRef.current = window.setInterval(tick, 200);
  };

  const startRec = async () => {
    if (startingRef.current || activeTrialIdRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      stoppingRef.current = false;
      // Prefer ref so a just-typed trial name is not lost to a stale render.
      const name = trialNameRef.current.trim() || trialName.trim() || 'gait01';
      trialNameRef.current = name;
      const created = await backendClient.createTrial(name);
      await backendClient.armTrial(created.trial_id);
      const started = await backendClient.startTrial(created.trial_id);
      const startAtMs = started.start_signal.startAtMs;
      activeTrialIdRef.current = created.trial_id;
      startAtRef.current = startAtMs;
      setActiveTrialId(created.trial_id);
      setActiveStartAtMs(startAtMs);
      setRecording(true);
      setElapsed(0);
      elapsedRef.current = 0;
      const lead = Math.max(0, Math.round((startAtMs - Date.now()) / 1000));
      if (lead > 0) {
        showToast(
          t('Get ready · all phones start recording in {lead} s', { lead }),
        );
      }
      runClock(startAtMs);
    } catch (e) {
      showToast(t(e instanceof Error ? e.message : 'Could not start trial'));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  const onQualityMode = async (mode: RecordingQualityMode) => {
    try {
      setQuality(await backendClient.setRecordingQuality({ mode }));
    } catch (e) {
      showToast(
        t(
          e instanceof Error ? e.message : 'Could not update recording quality',
        ),
      );
    }
  };

  const onPreviewEnabled = async (previewEnabled: boolean) => {
    try {
      setQuality(await backendClient.setRecordingQuality({ previewEnabled }));
    } catch (e) {
      showToast(
        t(
          e instanceof Error ? e.message : 'Could not update recording quality',
        ),
      );
    }
  };

  return (
    <section
      className="screen active"
      data-screen="5"
      data-testid="screen-capture"
    >
      <div className="capture-layout">
        <aside className="sidebar" data-testid="capture-sidebar">
          <h2>{t('Trial')}</h2>
          <div>
            <label className="field">{t('Trial name')}</label>
            <input
              type="text"
              value={trialName}
              onChange={(e) => {
                trialNameRef.current = e.target.value;
                setTrialName(e.target.value);
              }}
              data-testid="capture-trial-name"
              disabled={starting || recording}
            />
          </div>
          <div
            className={`timer${recording && countdown == null ? ' rec' : ''}`}
            data-testid="capture-timer"
          >
            {formatTimer(elapsed)}
          </div>
          <button
            className={`btn ${recording ? 'btn-gray' : 'btn-green'}`}
            type="button"
            disabled={starting || recording || camCount < 1}
            onClick={() => void startRec()}
            data-testid="capture-start"
          >
            {starting ? t('Preparing cameras…') : t('Start')}
          </button>
          <button
            className={`btn ${recording ? 'btn-red' : 'btn-gray'}`}
            type="button"
            disabled={!recording}
            onClick={() => void stopRec(false)}
            data-testid="capture-stop"
          >
            {countdown != null ? t('Cancel start') : t('Stop')}
          </button>
          <div className="divider" style={{ margin: '4px 0' }} />
          <div data-testid="capture-recording-quality">
            <label className="field">{t('Recording quality')}</label>
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <select
                value={quality?.mode ?? 'auto'}
                disabled={starting || recording || countdown != null}
                onChange={(e) =>
                  void onQualityMode(e.target.value as RecordingQualityMode)
                }
                data-testid="capture-recording-quality-select"
                style={{
                  flex: 1,
                  minWidth: 120,
                  font: 'inherit',
                  padding: '4px 8px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                }}
              >
                <option value="auto">
                  {t('Auto')} · {quality?.recommendation ?? '720p'}
                </option>
                {PRESET_IDS.map((id) => (
                  <option key={id} value={id}>
                    {presetOptionLabel(
                      id,
                      quality?.estimates ?? {
                        '1080p': 0,
                        '720p': 0,
                        '480p': 0,
                      },
                    )}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={
                  probesRefreshing || starting || recording || countdown != null
                }
                onClick={() => void refreshQualityProbes()}
                data-testid="capture-quality-refresh"
              >
                {t('Refresh')}
              </button>
            </div>
            {quality ? (
              <small style={{ display: 'block', marginTop: 6, opacity: 0.85 }}>
                {t('Recommended: {preset}', {
                  preset: quality.recommendation,
                })}
              </small>
            ) : null}
            {quality && qualityWarning(quality) ? (
              <small
                data-testid="capture-quality-warning"
                style={{ display: 'block', marginTop: 4, color: '#b45309' }}
              >
                {t('May drop below 30 fps / slow upload on this network')}
              </small>
            ) : null}
          </div>
          <label
            className="pose-switch"
            data-testid="capture-preview-toggle"
            style={{ marginTop: 8 }}
          >
            <input
              type="checkbox"
              checked={quality?.previewEnabled ?? true}
              onChange={(e) => void onPreviewEnabled(e.target.checked)}
            />
            <span className="sw" />
            <span>
              <b>{t('Live preview')}</b>
            </span>
          </label>
          <label className="pose-switch" data-testid="capture-pose-toggle">
            <input
              type="checkbox"
              checked={poseOn}
              onChange={(e) => setPoseOn(e.target.checked)}
            />
            <span className="sw" />
            <span>
              <b>{t('Real-time 2D pose')}</b>
              <small>
                desktop · low-res preview · doesn’t change the recorded video
              </small>
            </span>
          </label>
          <div
            style={{
              marginTop: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <LeaveGroup>
              <LeaveButton
                label={t('Back')}
                target={4}
                busy={recording}
                confirmText={t(
                  'Leave Capture? The recording stops and the trial is kept.',
                )}
                beforeLeave={recording ? () => stopRec(true) : undefined}
                testId="capture-back"
                className="btn btn-ghost btn-sm"
              />
              <LeaveButton
                label={t('Pair cameras')}
                target={2}
                busy={recording}
                confirmText={t(
                  'Leave Capture? The recording stops and the trial is kept.',
                )}
                beforeLeave={recording ? () => stopRec(true) : undefined}
                testId="capture-pair-cameras"
                className="btn btn-ghost btn-sm"
              />
            </LeaveGroup>
          </div>
        </aside>
        <div className="main-stage">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <div className="block-title" style={{ margin: 0 }}>
              {starting
                ? t('Get ready')
                : !recording
                  ? t('Preview')
                  : countdown != null
                    ? t('Get ready')
                    : t('Recording')}
            </div>
            {recording && countdown == null ? (
              <span className="badge rec" style={{ display: 'inline-flex' }}>
                <span className="dot" /> {t('REC')}
              </span>
            ) : null}
          </div>
          <div aria-live="polite" aria-atomic="true">
            {starting || countdown != null || (recording && elapsed < 3) ? (
              <div
                className={`capture-start-banner${!starting && countdown == null ? ' capture-start-banner-go' : ''}`}
                data-testid="capture-start-banner"
              >
                {starting ? (
                  <strong className="capture-start-heading">
                    {t('Preparing cameras…')}
                  </strong>
                ) : countdown != null ? (
                  <>
                    <span>{t('Recording starts in')}</span>
                    <strong
                      className="capture-countdown-number"
                      data-testid="capture-countdown"
                      aria-label={t('Starting in {seconds}', {
                        seconds: countdown,
                      })}
                    >
                      {countdown}
                    </strong>
                  </>
                ) : null}
                <strong
                  className={
                    !starting && countdown == null
                      ? 'capture-start-heading'
                      : 'capture-start-instruction'
                  }
                >
                  {starting || countdown != null
                    ? t('Ask the subject to wait')
                    : t('Ask the subject to start moving now')}
                </strong>
              </div>
            ) : null}
          </div>
          <CamGrid
            camCount={Math.max(camCount, 1)}
            devices={devices}
            recording={recording && countdown == null}
            showPose={poseOn}
            live
            liveTag
            fitFrame
            previewEnabled={quality?.previewEnabled ?? true}
          />
        </div>
        {hasImus ? (
          <>
            <div className="divider-drag" title={t('Drag to resize')} />
            <aside className="imu-panel show" data-testid="capture-imu-panel">
              <header>
                {t('IMU signals · live')}
                <span>
                  {t('Empty until IMU backend · CSV write skipped for now')}
                </span>
              </header>
              <div className="imu-scroll">
                <EmptyImuLive slots={connectedImus} />
              </div>
            </aside>
          </>
        ) : null}
      </div>
    </section>
  );
}
