import { CameraPairingButton } from '../components/CameraPairingButton';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CamGrid } from '../components/CamFeed';
import { LeaveButton, LeaveGroup } from '../components/LeaveButton';
import { EmptyImuLive } from '../components/EmptyImu';
import {
  backendClient,
  type RecordingQualityState,
} from '../lib/backendClient';
import {
  SIT_TO_STAND_SECONDS,
  SIT_TO_STAND_COUNTDOWN_MS,
  POSE_FRESH_MS,
  type SittingCheck,
} from '../lib/sitToStand';
import { incrementTrialName } from '../lib/naming';
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
  return `${m}:${s} / 00:20`;
}

export function Capture() {
  const {
    screen: currentScreen,
    camCount,
    usbCameraErrors,
    devices,
    connectedImus,
    hasImus,
    trialName,
    trialRecords,
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

  const [instructionDone, setInstructionDone] = useState(false);
  const [sittingCameraIndex, setSittingCameraIndex] = useState(
    camCount > 1 ? 1 : 0,
  );
  const [sittingCheck, setSittingCheck] = useState<SittingCheck>({
    ready: false,
    message: 'Waiting for a clear side view of your seated posture.',
  });
  const gateRef = useRef({ ready: false, at: 0, version: 0 });
  const mounted = useRef(true);
  const screenRef = useRef(currentScreen);
  screenRef.current = currentScreen;
  const autoStartBlocked = useRef(false);
  const timerRef = useRef<number | null>(null);
  /** Seconds left before the shared start; null once recording (or idle). */
  const [countdown, setCountdown] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [controlError, setControlError] = useState<'cancel' | 'stop' | null>(
    null,
  );
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
    mounted.current = true;
    return () => {
      mounted.current = false;
      gateRef.current.version++;
      if (timerRef.current) window.clearInterval(timerRef.current);
      // Preview off is a Capture-only setting; Standing and Pair need frames.
      void backendClient
        .setRecordingQuality({ previewEnabled: true })
        .catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (currentScreen !== 5) {
      gateRef.current.ready = false;
      gateRef.current.version++;
    }
  }, [currentScreen]);

  useEffect(() => {
    setSittingCameraIndex((index) =>
      Math.min(index, Math.max(0, camCount - 1)),
    );
  }, [camCount]);

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
    if (currentScreen === 5) void refreshQualityProbes();
  }, [deviceIds, refreshQualityProbes, currentScreen]);

  useEffect(() => {
    if (currentScreen !== 5 || !deviceIds) return;
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
  }, [deviceIds, currentScreen]);

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
    const cancelled =
      controlError === 'cancel' || (startAt != null && Date.now() < startAt);
    if (trialId) {
      try {
        await (cancelled
          ? backendClient.cancelTrial(trialId)
          : backendClient.stopTrial(trialId));
      } catch (error) {
        autoStartBlocked.current = true;
        setControlError(cancelled ? 'cancel' : 'stop');
        setRecording(true);
        if (cancelled && startAt != null)
          setCountdown(Math.max(1, Math.ceil((startAt - Date.now()) / 1000)));
        showToast(
          t(
            error instanceof Error
              ? error.message
              : 'Could not stop recording. Please retry.',
          ),
        );
        stoppingRef.current = false;
        return;
      }
      setControlError(null);
      if (!cancelled) {
        const recordedSec = startAt != null ? (Date.now() - startAt) / 1000 : 0;
        recordTrial({
          id: trialId,
          name,
          startAtMs: startAt,
          durationSec: Math.max(
            Math.min(Math.round(recordedSec), SIT_TO_STAND_SECONDS),
            1,
          ),
          stoppedAt: Date.now(),
        });
      }
    }
    activeTrialIdRef.current = null;
    startAtRef.current = null;
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
        if (
          !gateRef.current.ready ||
          now - gateRef.current.at > POSE_FRESH_MS
        ) {
          gateRef.current.ready = false;
          setSittingCheck({
            ready: false,
            message:
              'Position changed. Sit inside the frame to restart the countdown.',
          });
          void stopRec(true);
          return;
        }
        setCountdown(Math.ceil((startAtMs - now) / 1000));
        return;
      }
      setCountdown(null);
      const e = Math.min(
        Math.floor((now - startAtMs) / 1000),
        SIT_TO_STAND_SECONDS,
      );
      if (e !== elapsedRef.current) {
        elapsedRef.current = e;
        setElapsed(e);
      }
      if (e >= SIT_TO_STAND_SECONDS) void stopRec(false);
    };
    tick();
    timerRef.current = window.setInterval(tick, 200);
  };

  const startRec = async () => {
    if (
      startingRef.current ||
      stoppingRef.current ||
      activeTrialIdRef.current ||
      autoStartBlocked.current
    )
      return;
    startingRef.current = true;
    setStarting(true);
    const version = gateRef.current.version;
    let createdId: string | null = null;
    const stillReady = () =>
      mounted.current &&
      screenRef.current === 5 &&
      gateRef.current.ready &&
      gateRef.current.version === version &&
      Date.now() - gateRef.current.at <= POSE_FRESH_MS;
    try {
      stoppingRef.current = false;
      let name = trialNameRef.current.trim() || 'gait01';
      while (trialRecords.some((trial) => trial.name === name))
        name = incrementTrialName(name);
      trialNameRef.current = name;
      setTrialName(name);
      const created = await backendClient.createTrial(name);
      createdId = created.trial_id;
      if (!stillReady()) {
        await backendClient.cancelTrial(createdId);
        return;
      }
      await backendClient.armTrial(createdId);
      if (!stillReady()) {
        await backendClient.cancelTrial(createdId);
        return;
      }
      const started = await backendClient.startTrial(createdId, {
        leadMs: SIT_TO_STAND_COUNTDOWN_MS,
        maxDurationMs: SIT_TO_STAND_SECONDS * 1000,
      });
      if (!stillReady()) {
        await backendClient.cancelTrial(createdId);
        return;
      }
      const startAtMs = started.start_signal.startAtMs;
      activeTrialIdRef.current = createdId;
      startAtRef.current = startAtMs;
      setActiveTrialId(createdId);
      setActiveStartAtMs(startAtMs);
      setRecording(true);
      setElapsed(0);
      elapsedRef.current = 0;
      runClock(startAtMs);
    } catch (e) {
      autoStartBlocked.current = true;
      if (createdId) await backendClient.cancelTrial(createdId).catch(() => {});
      if (mounted.current)
        showToast(t(e instanceof Error ? e.message : 'Could not start trial'));
    } finally {
      startingRef.current = false;
      if (mounted.current) setStarting(false);
    }
  };

  const onSittingCheck = (check: SittingCheck) => {
    if (currentScreen !== 5) return;
    setSittingCheck(check);
    const gate = gateRef.current;
    if (!check.ready) {
      gate.version++;
      autoStartBlocked.current = false;
    }
    gate.ready = check.ready;
    gate.at = Date.now();
    if (
      !check.ready &&
      activeTrialIdRef.current &&
      startAtRef.current != null &&
      Date.now() < startAtRef.current
    )
      void stopRec(true);
    if (
      check.ready &&
      instructionDone &&
      camCount > 0 &&
      !Object.keys(usbCameraErrors).length
    )
      void startRec();
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

  return (
    <section
      className="screen active"
      data-screen="5"
      data-testid="screen-capture"
    >
      <div className="capture-layout">
        <aside className="sidebar" data-testid="capture-sidebar">
          <h2>{t('Sit-to-stand Test')}</h2>
          <p className="sub">
            {t(
              'Watch the instructions, then sit with either side facing the camera. Recording starts automatically when your position is ready.',
            )}
          </p>
          {instructionDone ? (
            <>
              <label className="field" htmlFor="sitting-camera">
                {t('Side-view camera')}
              </label>
              <select
                id="sitting-camera"
                data-testid="sitting-camera-select"
                value={sittingCameraIndex}
                disabled={starting || recording}
                onChange={(e) => {
                  gateRef.current = {
                    ready: false,
                    at: 0,
                    version: gateRef.current.version + 1,
                  };
                  setSittingCheck({
                    ready: false,
                    message:
                      'Waiting for a clear side view of your seated posture.',
                  });
                  setSittingCameraIndex(Number(e.target.value));
                }}
              >
                {Array.from({ length: Math.max(camCount, 1) }, (_, i) => (
                  <option key={i} value={i}>
                    {t('Camera {number}', { number: i + 1 })}
                  </option>
                ))}
              </select>
              <div
                className={`timer${recording && countdown == null ? ' rec' : ''}`}
                data-testid="capture-timer"
              >
                {formatTimer(elapsed)}
              </div>
              {recording && countdown == null && !controlError ? (
                <button
                  className="btn btn-red"
                  type="button"
                  onClick={() => void stopRec(false)}
                  data-testid="capture-stop"
                >
                  {t('Stop recording')}
                </button>
              ) : null}
              {controlError ? (
                <button
                  type="button"
                  className="btn btn-red"
                  data-testid="capture-control-retry"
                  onClick={() => void stopRec(controlError === 'cancel')}
                >
                  {t('Retry camera stop')}
                </button>
              ) : null}
            </>
          ) : null}
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
                disabled={starting}
                busy={recording}
                confirmText={t(
                  'Leave Capture? The recording stops and the trial is kept.',
                )}
                beforeLeave={recording ? () => stopRec(true) : undefined}
                testId="capture-back"
                className="btn btn-ghost btn-sm"
              />
              <CameraPairingButton
                busy={recording}
                confirmText={t(
                  'Leave Capture? The recording stops and the trial is kept.',
                )}
                beforeLeave={recording ? () => stopRec(true) : undefined}
                testId="capture-pair-cameras"
                disabled={starting}
                className="btn btn-ghost btn-sm"
              />
            </LeaveGroup>
          </div>
        </aside>
        <div className="main-stage">
          {!instructionDone ? (
            <div className="sit-instructions" data-testid="sit-instructions">
              <h1>{t('Sit-to-stand Test')}</h1>
              <div
                className="sit-instruction-video"
                data-testid="sit-instruction-video"
                role="img"
                aria-label={t('Sit-to-stand instruction video placeholder')}
              >
                <span className="sit-play-icon" aria-hidden="true">
                  ▶
                </span>
                <strong>{t('How to perform the sit-to-stand test')}</strong>
                <span>{t('Instruction video coming soon')}</span>
              </div>
              <p>
                {t(
                  'Use a stable chair. Sit with your left or right side facing the side-view camera and keep your whole body inside the frame. When recording begins, repeatedly stand up and sit down for 20 seconds.',
                )}
              </p>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="capture-proceed"
                disabled={
                  camCount < 1 || Object.keys(usbCameraErrors).length > 0
                }
                onClick={() => {
                  setElapsed(0);
                  void backendClient
                    .setRecordingQuality({ previewEnabled: true })
                    .then(setQuality)
                    .catch(() => {});
                  setInstructionDone(true);
                }}
              >
                {t('Proceed to recording')}
              </button>
              {camCount < 1 ? (
                <p role="status">{t('Connect a camera to proceed.')}</p>
              ) : null}
            </div>
          ) : (
            <>
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
                      ? t('Sit inside the frame')
                      : countdown != null
                        ? t('Get ready')
                        : t('Recording')}
                </div>
                {recording && countdown == null ? (
                  <span
                    className="badge rec"
                    style={{ display: 'inline-flex' }}
                  >
                    <span className="dot" /> {t('REC')}
                  </span>
                ) : null}
              </div>
              <div aria-live="polite" aria-atomic="true">
                {!controlError &&
                (starting ||
                  countdown != null ||
                  (recording && elapsed < 3)) ? (
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
                        ? t('Hold your seated position')
                        : t('Stand up and sit down repeatedly')}
                    </strong>
                  </div>
                ) : null}
              </div>
              <p
                className="sitting-status"
                role="status"
                data-testid="sitting-status"
              >
                {t(sittingCheck.message)}
              </p>
              <CamGrid
                camCount={Math.max(camCount, 1)}
                devices={devices}
                recording={recording && countdown == null}
                showPose={poseOn}
                live
                liveTag
                fitFrame
                previewEnabled
                sittingCameraIndex={Math.min(
                  sittingCameraIndex,
                  Math.max(0, camCount - 1),
                )}
                onSittingCheck={onSittingCheck}
              />
            </>
          )}
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
