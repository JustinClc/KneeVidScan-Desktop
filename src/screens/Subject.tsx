import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LeaveButton } from '../components/LeaveButton';
import { NewSubjectButton } from '../components/NewSubjectButton';
import {
  standingFileName,
  standingFullFileName,
  subjectInfoFileName,
  type StandingCode,
} from '../lib/naming';
import {
  FACE_FRONTAL_AGAIN,
  POSTURE_STEPS,
  canContinueSubject,
  evaluateStandingLandmarks,
  positiveBodyMeasure,
  requiredParts,
  type LandmarkPoint,
  type PoseQuality,
} from '../lib/posture';
import { t } from '../lib/locale';
import { useLocale } from '../lib/useLocale';
import {
  COUNTDOWN_SECONDS,
  STILL_PICKUP_MS,
  STILL_TIMEOUT_MS,
  containFit,
  createHoldTimer,
  GATE_MISS_GRACE_MS,
  guideRect,
  reviewWarning,
} from '../lib/standingGate';
import {
  POSTURE_DETECT_GAP_MS,
  createFpsMeter,
  detectGapMs,
} from '../lib/framePacing';
import { cropStillToGuide } from '../lib/standingCapture';
import {
  loadStandingLandmarker,
  type StandingLandmarker,
} from '../lib/mediapipePose';
import { drawLandmarks } from '../lib/livePose';
import { DEMO_SUBJECT } from '../lib/subjects';
import { backendClient } from '../lib/backendClient';
import {
  formatPostureSaveToast,
  rehomeStandingPhotos,
  savePosturePhotos,
} from '../lib/sessionSave';
import { planPosturePhotos } from '../lib/saveExport';
import { useBoxSize } from '../lib/useBoxSize';
import { useSession } from '../state/SessionContext';
import demoFrontal from '../assets/standing-demo/frontal.jpg';
import demoLeftLateral from '../assets/standing-demo/left-lateral.jpg';
import demoRightLateral from '../assets/standing-demo/right-lateral.jpg';

const DEMO_IMAGES: Record<StandingCode, string> = {
  F: demoFrontal,
  LL: demoLeftLateral,
  RL: demoRightLateral,
};

/** Standing is always on the frontal camera — keep the Frontal View label even for single-cam. */
const STANDING_CAM_LABEL = 'Cam 1 · Frontal View';

function photoFailure(message: string) {
  const prefix = 'Photo not received from phone: ';
  if (message.startsWith(prefix)) {
    return t('Photo not received from phone: {detail}', {
      detail: message.slice(prefix.length),
    });
  }
  return t(message);
}
/** Back-off when no frame / backend error; normal frames arrive via long-poll. */
const PREVIEW_RETRY_MS = 200;
const STANDING_HEARTBEAT_MS = 2000;
/** Layout fallback until the first preview frame reports its size. */
const DEFAULT_FRAME = { w: 1920, h: 1080 };

type Phase = 'live' | 'count' | 'capturing' | 'review' | 'error';
type DetectorState = 'loading' | 'ready' | 'unavailable';

type ReviewShot = {
  code: StandingCode;
  croppedPng: Uint8Array;
  fullPng: Uint8Array;
  url: string;
  width: number;
  height: number;
  warning: string | null;
};

const EMPTY_QUALITY: PoseQuality = {
  ok: false,
  missHint: null,
  present: [],
  missing: [],
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function Subject() {
  const {
    devices,
    subjectId,
    subjectName,
    heightCm,
    weightKg,
    postureDone,
    capturedStanding,
    postureSavedById,
    setSubjectFolder,
    markPostureSaved,
    setSubjectId,
    setSubjectName,
    setHeightCm,
    setWeightKg,
    markStandingCaptured,
    resetStanding,
    go,
    showToast,
  } = useSession();
  useLocale();

  const frontal = useMemo(
    () =>
      devices.find((d) => d.viewCode === 'F' || d.camIndex === 0) ?? devices[0],
    [devices],
  );
  const frontalId = frontal?.deviceId;

  const [pstStep, setPstStep] = useState(0);
  const [retakingCode, setRetakingCode] = useState<StandingCode | null>(null);
  const [phase, setPhaseState] = useState<Phase>('live');
  const [count, setCount] = useState(COUNTDOWN_SECONDS);
  const [quality, setQuality] = useState<PoseQuality>(EMPTY_QUALITY);
  const [detector, setDetector] = useState<DetectorState>('loading');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [frame, setFrame] = useState(DEFAULT_FRAME);
  const [review, setReview] = useState<ReviewShot | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [folderChoice, setFolderChoice] = useState(false);
  const folderPick = useRef(false);

  const phaseRef = useRef<Phase>('live');
  const stepRef = useRef(0);
  const landmarkerRef = useRef<StandingLandmarker | null>(null);
  const holdRef = useRef(createHoldTimer());
  const fpsMeter = useRef(createFpsMeter());
  const [fps, setFps] = useState(0);
  const lastDetectAt = useRef(0);
  const lastDetectMs = useRef(0);
  const countdownRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const captureEpoch = useRef(0);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const box = useBoxSize(feedRef);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  useEffect(() => {
    stepRef.current = pstStep;
  }, [pstStep]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (countdownRef.current != null) {
        window.clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, []);

  const done =
    retakingCode == null &&
    (postureDone ||
      canContinueSubject(subjectId, capturedStanding) ||
      pstStep >= POSTURE_STEPS.length);
  const stepIndex = Math.min(pstStep, POSTURE_STEPS.length - 1);
  const P = POSTURE_STEPS[stepIndex];
  const canContinue =
    retakingCode == null &&
    (canContinueSubject(subjectId, capturedStanding) || done);
  const bodyReady =
    positiveBodyMeasure(heightCm) && positiveBodyMeasure(weightKg);
  const photoNames = [
    ...planPosturePhotos({ subjectId, subjectName }).map((p) => p.filename),
    subjectInfoFileName(subjectId, subjectName),
  ];
  const showLive = !done && phase !== 'review';

  const clearCountdown = () => {
    if (countdownRef.current != null) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  const clearOverlay = () => {
    const c = overlayRef.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  };

  const backToLive = useCallback(() => {
    captureEpoch.current += 1;
    clearCountdown();
    holdRef.current.reset();
    setCount(COUNTDOWN_SECONDS);
    setQuality(EMPTY_QUALITY);
    setErrorMsg(null);
    setPhase('live');
  }, [setPhase]);

  const discardReview = useCallback(() => {
    setReview((r) => {
      if (r) URL.revokeObjectURL(r.url);
      return null;
    });
  }, []);

  useEffect(() => () => discardReview(), [discardReview]);

  const capture = useCallback(async () => {
    const epoch = ++captureEpoch.current;
    const isCurrent = () =>
      mountedRef.current && captureEpoch.current === epoch;
    clearCountdown();
    setPhase('capturing');
    clearOverlay();
    const step = POSTURE_STEPS[stepRef.current];
    if (!step) return;
    try {
      if (!frontalId) throw new Error('No frontal camera paired');
      await backendClient.requestStill(frontalId);
      if (!isCurrent()) return;
      const startedAt = Date.now();
      let still: { bytes: Uint8Array; type: string } | null = null;
      let failure = 'Photo not received from phone';
      while (Date.now() - startedAt < STILL_TIMEOUT_MS) {
        await sleep(250);
        if (!isCurrent()) return;
        const res = await backendClient.fetchStill(frontalId).catch(() => null);
        if (!isCurrent()) return;
        if (res?.state === 'ready' && res.bytes.byteLength > 0) {
          still = { bytes: new Uint8Array(res.bytes), type: res.contentType };
          break;
        }
        if (res?.state === 'failed') {
          failure = `Photo not received from phone: ${res.error}`;
          break;
        }
        if (
          res?.state === 'pending' &&
          Date.now() - startedAt > STILL_PICKUP_MS
        ) {
          failure =
            'Phone did not respond — keep the camera page open and on screen';
          break;
        }
      }
      if (!isCurrent()) return;
      if (!still) {
        setErrorMsg(failure);
        setPhase('error');
        return;
      }
      const cropped = await cropStillToGuide(still.bytes, still.type);
      let warning: string | null = null;
      const lm = landmarkerRef.current;
      if (lm) {
        let points: LandmarkPoint[] | null = null;
        try {
          points = lm.detect(cropped.canvas);
        } catch {
          points = null;
        }
        warning = reviewWarning(
          evaluateStandingLandmarks(step.side, points).missing,
        );
      }
      if (!isCurrent()) return;
      setReview({
        code: step.code,
        croppedPng: cropped.croppedPng,
        fullPng: cropped.fullPng,
        url: URL.createObjectURL(
          new Blob([cropped.croppedPng.slice()], { type: 'image/png' }),
        ),
        width: cropped.canvas.width,
        height: cropped.canvas.height,
        warning,
      });
      setPhase('review');
    } catch (err) {
      if (!isCurrent()) return;
      setErrorMsg(
        err instanceof Error ? err.message : 'Photo not received from phone',
      );
      setPhase('error');
    }
  }, [frontalId, setPhase]);

  const startCountdown = useCallback(() => {
    if (!positiveBodyMeasure(heightCm) || !positiveBodyMeasure(weightKg)) {
      return;
    }
    if (countdownRef.current != null) return;
    setPhase('count');
    let c = COUNTDOWN_SECONDS;
    setCount(c);
    countdownRef.current = window.setInterval(() => {
      c -= 1;
      if (c > 0) {
        setCount(c);
      } else {
        clearCountdown();
        void capture();
      }
    }, 1000);
  }, [capture, setPhase, heightCm, weightKg]);

  // Load the offline MediaPipe Pose model once.
  useEffect(() => {
    let cancelled = false;
    void loadStandingLandmarker(backendClient.baseUrl()).then((lm) => {
      if (cancelled) return;
      landmarkerRef.current = lm;
      setDetector(lm ? 'ready' : 'unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the phone on max-res stream + boosted preview while on Standing.
  useEffect(() => {
    if (!frontalId || done) return;
    const beat = () =>
      void backendClient.setStandingMode(frontalId, true).catch(() => {});
    beat();
    const timer = window.setInterval(beat, STANDING_HEARTBEAT_MS);
    return () => {
      window.clearInterval(timer);
      void backendClient.setStandingMode(frontalId, false).catch(() => {});
    };
  }, [frontalId, done]);

  // Live preview from the frontal cam: long-poll each new phone frame.
  useEffect(() => {
    if (!frontalId || !showLive) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    let lastAt = 0;
    const abort = new AbortController();
    void (async () => {
      while (!cancelled) {
        try {
          const hit = await backendClient.nextPreview(
            frontalId,
            lastAt,
            abort.signal,
          );
          if (cancelled) break;
          if (hit) {
            lastAt = hit.at;
            const next = URL.createObjectURL(hit.blob);
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = next;
            setPreviewUrl(next);
            continue;
          }
        } catch {
          /* backend unreachable */
        }
        await sleep(PREVIEW_RETRY_MS);
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setPreviewUrl(null);
    };
  }, [frontalId, showLive]);

  const stage = containFit(frame.w, frame.h, box.w, box.h);
  const rect = guideRect(frame.w, frame.h);

  // Gate: run MediaPipe on each new preview frame.
  const onFrame = (img: HTMLImageElement) => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return;
    setFrame((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    const now = performance.now();
    fpsMeter.current.tick(now);
    const measured = fpsMeter.current.fps(now);
    setFps((prev) => (prev === measured ? prev : measured));

    const lm = landmarkerRef.current;
    const ph = phaseRef.current;
    if (!lm || (ph !== 'live' && ph !== 'count')) return;
    const step = POSTURE_STEPS[stepRef.current];
    if (!step) return;
    if (
      now - lastDetectAt.current <
      detectGapMs(POSTURE_DETECT_GAP_MS, lastDetectMs.current, 1)
    ) {
      return;
    }
    lastDetectAt.current = now;

    let points: LandmarkPoint[] | null = null;
    try {
      points = lm.detect(img);
    } catch {
      points = null;
    }
    lastDetectMs.current = performance.now() - now;
    const canvas = overlayRef.current;
    if (canvas) {
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        if (points) drawLandmarks(ctx, points, cw, ch, '#2F6FE0');
        else ctx.clearRect(0, 0, cw, ch);
      }
    }

    const q = evaluateStandingLandmarks(step.side, points, guideRect(w, h));
    setQuality(q);
    const t = performance.now();
    const held = holdRef.current.update(q.ok, t);
    if (ph === 'live' && held) {
      startCountdown();
    } else if (
      ph === 'count' &&
      !q.ok &&
      holdRef.current.missedFor(t) >= GATE_MISS_GRACE_MS
    ) {
      // Lost a landmark mid-countdown for longer than one blip — back to red.
      backToLive();
    }
  };

  const proceed = async () => {
    if (!review || saving) return;
    if (!subjectId.trim()) {
      showToast(t('Enter a subject ID before saving the posture.'));
      return;
    }
    if (!positiveBodyMeasure(heightCm) || !positiveBodyMeasure(weightKg)) {
      return;
    }
    setSaving(true);
    const { code } = review;
    const filename = standingFileName(subjectId, subjectName, code);
    const fullName = standingFullFileName(subjectId, subjectName, code);
    try {
      await backendClient.upsertSubject({
        subjectId,
        subjectName,
        heightCm,
        weightKg,
      });
      await backendClient.saveStandingCapture(subjectId, code, {
        filename,
        croppedPng: review.croppedPng,
        fullFilename: fullName,
        fullPng: review.fullPng,
      });
    } catch (err) {
      showToast(
        t('Could not save the posture: {detail}', {
          detail: err instanceof Error ? err.message : String(err),
        }),
      );
      setSaving(false);
      return;
    }
    setSaving(false);
    markStandingCaptured(code, filename);
    showToast(
      t('{name} posture saved', {
        name: t(POSTURE_STEPS[stepRef.current].name),
      }),
    );
    discardReview();

    const missingStep = POSTURE_STEPS.findIndex(
      (step) => step.code !== code && !capturedStanding.includes(step.code),
    );
    const next = missingStep < 0 ? POSTURE_STEPS.length : missingStep;
    setRetakingCode(null);
    stepRef.current = next;
    setPstStep(next);
    backToLive();
    if (next >= POSTURE_STEPS.length) showToast(t(FACE_FRONTAL_AGAIN));
  };

  const retake = () => {
    discardReview();
    backToLive();
  };

  const retakeSaved = (code: StandingCode) => {
    if (saving || retakingCode != null) return;
    discardReview();
    backToLive();
    const index = POSTURE_STEPS.findIndex((step) => step.code === code);
    stepRef.current = index;
    setPstStep(index);
    setRetakingCode(code);
  };

  const cancelRetake = () => {
    discardReview();
    backToLive();
    const missingStep = POSTURE_STEPS.findIndex(
      (step) => !capturedStanding.includes(step.code),
    );
    const next = missingStep < 0 ? POSTURE_STEPS.length : missingStep;
    stepRef.current = next;
    setPstStep(next);
    setRetakingCode(null);
  };

  // Sync step index from capturedStanding (e.g. after load-existing reset)
  useEffect(() => {
    if (capturedStanding.length === 0 && pstStep !== 0 && !done) {
      setPstStep(0);
      backToLive();
    }
  }, [capturedStanding.length, pstStep, done, backToLive]);

  const saveSubjectAndContinue = async () => {
    if (saving || !canContinue || !subjectId.trim() || !bodyReady) return;
    if (!postureSavedById[subjectId]) {
      setFolderChoice(true);
      return;
    }
    showToast(t(FACE_FRONTAL_AGAIN));
    go(5);
  };

  const confirmSubjectFolder = async (destination: 'existing' | 'new') => {
    if (folderPick.current || saving || !subjectId.trim()) return;
    folderPick.current = true;
    // Keep the choice window up until the folder dialog returns. Closing it
    // while a macOS sheet is open makes that sheet report a cancel.
    let result: Awaited<ReturnType<typeof savePosturePhotos>>;
    try {
      const saveInMain = window.motuscapLite?.saveSubjectFolder;
      const listed = await backendClient.listSubjects().catch(() => null);
      const ready = (listed?.subjects ?? []).filter((s) =>
        (['F', 'LL', 'RL'] as const).every(
          (code) => (s.standing?.[code]?.bytes ?? 0) > 0,
        ),
      );
      const formId = subjectId.trim();
      const source =
        ready.find((s) => s.subjectId === formId) ??
        (ready.length === 1 ? ready[0] : undefined);
      if (source && source.subjectId !== formId) {
        await rehomeStandingPhotos({
          fromId: source.subjectId,
          toId: formId,
          subjectName,
          fetchStanding: (id, code, variant) =>
            backendClient.getStandingPng(id, code, variant),
          saveStanding: (id, code, filename, bytes, variant) =>
            backendClient.saveStandingPng(id, code, filename, bytes, variant),
        });
      }
      if (saveInMain) {
        // The desktop app writes the photos from the store in the main
        // process. The choice window stays up until that call returns.
        result = await saveInMain({
          subjectId,
          subjectName,
          heightCm,
          weightKg,
          destination,
          dialogTitle: t(
            destination === 'new'
              ? 'Choose the parent folder'
              : 'Select the subject folder',
          ),
          buttonLabel: t('Choose'),
        });
        setFolderChoice(false);
      } else {
        result = await savePosturePhotos({
          subjectId,
          subjectName,
          heightCm,
          weightKg,
          subjectFolder: null,
          destination,
          chooseFolder: async (title) => {
            const picked = await window.motuscapLite?.chooseSaveFolder?.(
              title ? t(title) : undefined,
              t('Choose'),
            );
            setFolderChoice(false);
            if (picked) setSaving(true);
            return picked ?? null;
          },
        });
      }
    } catch (err) {
      setFolderChoice(false);
      showToast(
        t('Could not save the subject folder: {detail}', {
          detail: err instanceof Error ? err.message : String(err),
        }),
        8000,
      );
      return;
    } finally {
      folderPick.current = false;
      setSaving(false);
    }
    if (!result.ok) {
      showToast(
        result.cancelled
          ? t('Folder selection cancelled. The posture photos are still here.')
          : t(result.error),
        8000,
      );
      return;
    }
    setSubjectFolder(subjectId, result.folder);
    markPostureSaved(subjectId);
    showToast(formatPostureSaveToast(result));
    showToast(t(FACE_FRONTAL_AGAIN));
    go(5);
  };

  const demoComplete = async () => {
    clearCountdown();
    discardReview();
    setRetakingCode(null);
    resetStanding();
    const id = subjectId.trim() || DEMO_SUBJECT.subjectId;
    if (!subjectId.trim()) setSubjectId(id);
    try {
      const res = await backendClient.standingDemo({
        subjectId: id,
        subjectName,
        heightCm,
        weightKg,
      });
      for (const code of ['F', 'LL', 'RL'] as const) {
        const filename =
          res.files.find((f) => f.endsWith(`_standing_${code}.png`)) ||
          standingFileName(id, subjectName, code);
        markStandingCaptured(code, filename);
      }
    } catch {
      for (const code of ['F', 'LL', 'RL'] as const) {
        markStandingCaptured(code, standingFileName(id, subjectName, code));
      }
    }
    setPstStep(POSTURE_STEPS.length);
    backToLive();
    showToast(t(FACE_FRONTAL_AGAIN));
  };

  const guideOk = phase === 'count' || phase === 'capturing' || done;
  const partLabels = requiredParts(P.side).map((p) => p.label);
  const manual = detector === 'unavailable';

  const statusText = (() => {
    if (done) return t('Posture captures saved');
    if (!frontalId) return t('No frontal camera paired');
    if (phase === 'capturing') return t('Taking photo…');
    if (phase === 'error')
      return photoFailure(errorMsg ?? 'Photo not received from phone');
    if (phase === 'count')
      return t('Pose ready · capturing in {count}', { count });
    if (!previewUrl) return t('Waiting for the camera…');
    if (detector === 'loading') return t('Loading pose detection…');
    if (manual) return t('Pose detection unavailable — use Capture now');
    if (quality.ok) return t('Hold still…');
    if (quality.missing[0]) {
      return t('{part} not in frame', { part: t(quality.missing[0]) });
    }
    return t('Step into the frame');
  })();

  const discardInProgressStanding = () => {
    discardReview();
    backToLive();
    setPstStep(0);
    setRetakingCode(null);
  };

  const sourceText =
    detector === 'ready'
      ? t('MediaPipe Pose (Full) · standing gate')
      : detector === 'loading'
        ? t('Loading MediaPipe Pose…')
        : t('Pose detection unavailable');

  const reviewStage = review
    ? containFit(review.width, review.height, box.w, box.h)
    : null;

  return (
    <section
      className="screen active"
      data-screen="4"
      data-testid="screen-subject"
    >
      <div className="content fill-page">
        <div>
          <h1>{t('Subject & standing posture')}</h1>
          <p className="sub" style={{ margin: 0 }}>
            {t(
              "Enter the subject's details, then capture three natural standing postures with the frontal camera. Each photo is taken automatically once the pose is in the frame, then reviewed.",
            )}
          </p>
        </div>
        <div className="fill-cols" style={{ gridTemplateColumns: '1fr 1.7fr' }}>
          <div className="card fcol form-gap">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div className="block-title" style={{ margin: 0 }}>
                {t('Subject info')}
              </div>
              <NewSubjectButton beforeStart={discardInProgressStanding} />
            </div>
            <div>
              <label className="field">{t('Display name')}</label>
              <input
                type="text"
                data-testid="subject-name"
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
              />
            </div>
            <div>
              <label className="field">
                {t('Subject ID')} <span style={{ color: '#DC2626' }}>*</span>
              </label>
              <input
                type="text"
                data-testid="subject-id"
                value={subjectId}
                required
                onChange={(e) => setSubjectId(e.target.value)}
                style={{
                  borderColor: subjectId.trim() ? undefined : '#DC2626',
                }}
              />
              <small
                style={{
                  fontSize: 11,
                  color: subjectId.trim() ? 'var(--muted)' : '#DC2626',
                }}
              >
                {subjectId.trim()
                  ? t(
                      'Required. Used in every saved file name. Spaces in the display name become hyphens.',
                    )
                  : t('Enter a subject ID to continue.')}
              </small>
            </div>
            <div className="row">
              <div>
                <label className="field">
                  {t('Height (cm)')} <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  type="number"
                  data-testid="subject-height"
                  value={heightCm}
                  required
                  onChange={(e) => setHeightCm(e.target.value)}
                  style={{
                    borderColor: positiveBodyMeasure(heightCm)
                      ? undefined
                      : '#DC2626',
                  }}
                />
              </div>
              <div>
                <label className="field">
                  {t('Weight (kg)')} <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  type="number"
                  data-testid="subject-weight"
                  value={weightKg}
                  required
                  onChange={(e) => setWeightKg(e.target.value)}
                  style={{
                    borderColor: positiveBodyMeasure(weightKg)
                      ? undefined
                      : '#DC2626',
                  }}
                />
              </div>
            </div>
            <div className="block-title" style={{ margin: '6px 0 0' }}>
              {t('Standing posture')}
            </div>
            <div className="pst-list" data-testid="standing-checklist">
              {POSTURE_STEPS.map((q, k) => {
                const captured = capturedStanding.includes(q.code);
                const retaking = retakingCode === q.code;
                const st = retaking
                  ? 'active'
                  : captured || done
                    ? 'done'
                    : k === pstStep
                      ? 'active'
                      : '';
                const note = retaking
                  ? t('Retaking…')
                  : captured || done
                    ? t('Captured')
                    : k === pstStep
                      ? phase === 'count'
                        ? t('Hold still…')
                        : phase === 'capturing'
                          ? t('Taking photo…')
                          : phase === 'review'
                            ? t('Review photo')
                            : t('In progress')
                      : t('Next');
                return (
                  <div
                    className={`pst ${st}`}
                    key={q.code}
                    data-testid={`standing-step-${q.code}`}
                    data-state={st || 'pending'}
                  >
                    <i>{captured || done ? '✓' : k + 1}</i>
                    <b>{t(q.name)}</b>
                    <span>{note}</span>
                    {captured ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        type="button"
                        data-testid={`standing-retake-${q.code}`}
                        aria-label={t('Retake {name} posture', {
                          name: t(q.name),
                        })}
                        disabled={
                          !frontalId ||
                          saving ||
                          folderChoice ||
                          retakingCode != null ||
                          phase === 'count' ||
                          phase === 'capturing' ||
                          phase === 'review'
                        }
                        onClick={() => retakeSaved(q.code)}
                      >
                        {t('Retake')}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="sub" style={{ margin: 0, fontSize: 12 }}>
              {t(
                'Taken by the frontal camera only, every session, including for returning subjects. Saved as PNG cropped to the guide frame, plus the uncropped original, without the guide frame or pose overlay.',
              )}
            </p>
            <div className="actions" style={{ marginTop: 'auto' }}>
              <LeaveButton
                label={t('Back to pairing')}
                target={2}
                busy={
                  phase === 'count' ||
                  phase === 'capturing' ||
                  phase === 'review'
                }
                confirmText={t(
                  'Leave Subject? The photo in progress is discarded; accepted photos are kept.',
                )}
                testId="subject-back-pairing"
              />
              <button
                className="btn btn-green"
                type="button"
                data-testid="subject-continue"
                disabled={
                  saving || !canContinue || !subjectId.trim() || !bodyReady
                }
                onClick={() => void saveSubjectAndContinue()}
              >
                {saving ? t('Saving…') : t('Save Subject & continue')}
              </button>
              {import.meta.env.MODE === 'test' ? (
                <button
                  className="btn btn-secondary"
                  type="button"
                  hidden
                  data-testid="subject-demo-complete"
                  onClick={() => void demoComplete()}
                >
                  {t('Complete postures (demo)')}
                </button>
              ) : null}
            </div>
          </div>
          <div className="card fcol" style={{ gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="badge ok">
                <span className="dot" />{' '}
                {t(phase === 'review' ? 'REVIEW' : 'LIVE')}
              </span>
              <b style={{ fontSize: 14 }} data-testid="standing-cam-label">
                {t(STANDING_CAM_LABEL)}
              </b>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--muted)',
                  marginLeft: 'auto',
                }}
                data-testid="pose-source"
                data-detector={detector}
              >
                {sourceText}
              </span>
            </div>
            <div className="pst-msg" data-testid="standing-prompt">
              {done ? (
                <>
                  {t('All three postures captured.')}
                  <small>
                    {t('Will save:')} {photoNames.join(', ')}
                  </small>
                  <small
                    style={{
                      display: 'block',
                      marginTop: 6,
                      color: 'var(--primary)',
                    }}
                  >
                    {t(
                      'Next: face the frontal camera again, then continue to Capture.',
                    )}
                  </small>
                </>
              ) : phase === 'review' ? (
                <>
                  {t('Review the {name} photo.', { name: t(P.name) })}
                  <small>
                    {t(
                      'Proceed to keep it and move on, or Retake to try again.',
                    )}
                  </small>
                </>
              ) : (
                <>
                  {t(P.msg)}
                  <small>{t(P.sub)}</small>
                </>
              )}
              {retakingCode != null ? (
                <small>
                  {t(
                    'The current photo is kept until you accept its replacement.',
                  )}
                </small>
              ) : null}
            </div>
            <div className="standing-row">
              {showLive ? (
                <figure
                  className="standing-demo"
                  data-testid="standing-demo"
                  data-code={P.code}
                >
                  <img
                    src={DEMO_IMAGES[P.code]}
                    alt={t('{name} standing posture', { name: t(P.name) })}
                    draggable={false}
                  />
                  <figcaption>
                    {t('Example · {name}', { name: t(P.name) })}
                  </figcaption>
                </figure>
              ) : null}
              <div
                className="guide-feed"
                data-testid="standing-guide"
                ref={feedRef}
              >
                {review && reviewStage ? (
                  <div
                    className="standing-stage"
                    data-testid="standing-review"
                    style={{
                      width: reviewStage.width,
                      height: reviewStage.height,
                    }}
                  >
                    <img
                      src={review.url}
                      alt={t('{name} standing posture', { name: t(P.name) })}
                      draggable={false}
                    />
                  </div>
                ) : (
                  <div
                    className="standing-stage"
                    style={{ width: stage.width, height: stage.height }}
                  >
                    {previewUrl && showLive ? (
                      <img
                        src={previewUrl}
                        alt=""
                        draggable={false}
                        onLoad={(e) => onFrame(e.currentTarget)}
                      />
                    ) : null}
                    {previewUrl && showLive ? (
                      <span
                        className="cam-fps"
                        data-testid="standing-fps"
                        data-fps={fps}
                      >
                        {t('{fps} fps', { fps })}
                      </span>
                    ) : null}
                    <canvas ref={overlayRef} className="pose-overlay" />
                    <div
                      className={`guide-frame${guideOk ? ' ok' : ''}`}
                      data-testid="guide-frame"
                      data-ok={guideOk ? 'true' : 'false'}
                      style={{
                        left: `${rect.x * 100}%`,
                        top: `${rect.y * 100}%`,
                        width: `${rect.w * 100}%`,
                        height: `${rect.h * 100}%`,
                        transform: 'none',
                      }}
                    >
                      <span
                        className="guide-count"
                        data-testid="guide-countdown"
                      >
                        {phase === 'count' ? count : done ? '✓' : ''}
                      </span>
                    </div>
                  </div>
                )}
                {phase !== 'review' ? (
                  <div
                    className={`guide-status${guideOk ? ' ok' : ''}`}
                    data-testid="guide-status"
                  >
                    {statusText}
                  </div>
                ) : review?.warning ? (
                  <div className="guide-status" data-testid="review-warning">
                    {t('{parts} not detected', {
                      parts: review.warning
                        .replace(/ not detected$/, '')
                        .split(', ')
                        .map((part) => t(part))
                        .join(', '),
                    })}
                  </div>
                ) : null}
              </div>
            </div>
            {phase === 'review' ? (
              <div className="actions" data-testid="review-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  data-testid="standing-proceed"
                  disabled={saving || !subjectId.trim() || !bodyReady}
                  onClick={() => void proceed()}
                >
                  {saving ? t('Saving…') : t('Proceed')}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  data-testid="standing-retake"
                  disabled={saving}
                  onClick={retake}
                >
                  {t('Retake')}
                </button>
              </div>
            ) : phase === 'error' ? (
              <div className="actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  data-testid="standing-retake"
                  onClick={retake}
                >
                  {t('Retake')}
                </button>
              </div>
            ) : (
              <div className="lm-row" data-testid="landmark-row">
                {done ? (
                  <span className="lm ok">
                    {t('Three posture photos are ready to save')}
                  </span>
                ) : null}
                {!done && P.side ? (
                  <span className="lm-note">
                    {t('Checking the side facing the camera')}
                  </span>
                ) : null}
                {done
                  ? null
                  : partLabels.map((l) => {
                      const ok = guideOk || quality.present.includes(l);
                      return (
                        <span className={`lm${ok ? ' ok' : ''}`} key={l}>
                          {ok ? '✓' : '✕'} {t(l)}
                        </span>
                      );
                    })}
                {manual && !done && frontalId && phase === 'live' ? (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    data-testid="standing-capture-now"
                    style={{ marginLeft: 'auto' }}
                    disabled={!bodyReady}
                    onClick={startCountdown}
                  >
                    {t('Capture now')}
                  </button>
                ) : null}
              </div>
            )}
            {retakingCode != null ? (
              <div className="actions">
                <button
                  className="btn btn-secondary"
                  type="button"
                  data-testid="standing-cancel-retake"
                  disabled={saving}
                  onClick={cancelRetake}
                >
                  {t('Cancel retake')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {folderChoice ? (
        <div
          className="folder-choice"
          role="dialog"
          aria-modal="true"
          aria-labelledby="subject-folder-choice-title"
          data-testid="subject-folder-choice"
        >
          <div className="folder-choice-card">
            <b id="subject-folder-choice-title">{t('Save subject folder')}</b>
            <p>
              {t(
                'Select an existing subject folder, or create a new one under a parent directory.',
              )}
            </p>
            <div className="actions">
              <button
                className="btn btn-primary"
                type="button"
                data-testid="subject-folder-new"
                onClick={() => void confirmSubjectFolder('new')}
              >
                {t('Create a new subject folder')}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                data-testid="subject-folder-existing"
                onClick={() => void confirmSubjectFolder('existing')}
              >
                {t('Select an existing subject folder')}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                data-testid="subject-folder-cancel"
                onClick={() => setFolderChoice(false)}
              >
                {t('Cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
