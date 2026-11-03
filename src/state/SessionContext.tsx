import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { getLocale, t } from '../lib/locale';
import type { ScreenId } from '../lib/steps';
import {
  emptyQuestionnaire,
  type QuestionnaireAnswers,
} from '../lib/questionnaire';

export type SessionFlow = 'home' | 'record';
import type { StandingCode } from '../lib/naming';
import { IMU_SLOT_IDS, type ImuSlotId, toggleImuSlot } from '../lib/imu';
import {
  backendClient,
  type BackendDevice,
  type PairingCreated,
  type SessionSnapshot,
} from '../lib/backendClient';
import { UsbCamera, recorderMime } from '../lib/usbCamera';
import type { TrialPoseResult } from '../lib/fullResPose';
import { disposeTrialPoseResult } from '../lib/fullResPose';

export type SessionDevice = {
  source?: 'usb';
  deviceId: string;
  name: string;
  camIndex: number;
  viewCode: 'F' | 'L' | 'O' | null;
};

export type ActivePairing = {
  id: string;
  code: string;
  qrUrl: string;
  expiresAt: number;
  /** Slot the new phone will take (0-based). */
  reservedIndex: number;
  /** Set when re-pairing: the camera swapped out once the new phone pairs. */
  replaceDeviceId: string | null;
};

export type BackendStatus = {
  apiBase: string;
  pwaBase: string;
  https: boolean;
  lanHost: string;
  port: number;
} | null;

/**
 * Newest record with this name. "Record another" often reuses the name, and
 * the first take must not keep Review/Pose stuck on a failed upload.
 */
export function latestTrial(
  records: readonly SessionTrial[],
  name: string,
): SessionTrial | null {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]?.name === name) return records[i];
  }
  return records[records.length - 1] ?? null;
}

/** One captured trial kept in the session for Review / Pose pickers. */
export type SessionTrial = {
  id: string;
  name: string;
  /** Wall-clock shared start (ms), when known. */
  startAtMs: number | null;
  /** Recorded length in seconds (capped at 3 min). */
  durationSec: number;
  stoppedAt: number | null;
};

export type SessionState = {
  screen: ScreenId;
  pairingReturnScreen: Exclude<ScreenId, 2>;
  /** Home leads to the capture and recording step rail. */
  flow: SessionFlow;
  sessionName: string;
  sessionNotes: string;
  questionnaire: QuestionnaireAnswers;
  questionnaireCompleted: boolean;
  camCount: number;
  usbCameraErrors: Record<string, string>;
  usbHardwareIds: string[];
  devices: SessionDevice[];
  activePairing: ActivePairing | null;
  qrActive: boolean;
  /**
   * UI-mock IMU slots selected on Pair (any subset of Femur L/R, Tibia L/R).
   * Empty until the operator taps Scan & connect and selects chips.
   * No BLE / samples until the IMU backend lands.
   */
  connectedImus: ImuSlotId[];
  /** Derived: `connectedImus.length > 0`. */
  hasImus: boolean;
  subjectId: string;
  subjectName: string;
  heightCm: string;
  weightKg: string;
  postureDone: boolean;
  /** Standing codes captured this session (retake clears). */
  capturedStanding: StandingCode[];
  standingFiles: Partial<Record<StandingCode, string>>;
  trialName: string;
  /** Trial names in capture order (picker values). */
  trials: string[];
  /** Full trial records — Review / Pose keep all trials in the session. */
  trialRecords: SessionTrial[];
  activeTrialId: string | null;
  /** Shared start for the in-flight recording. */
  activeStartAtMs: number | null;
  recording: boolean;
  elapsed: number;
  poseOn: boolean;
  /**
   * Full-res Pose re-run results keyed by trial name.
   * Each trial keeps its own per-camera 2D/3D (no fusion).
   */
  poseByTrial: Record<string, TrialPoseResult>;
  /** Folder from the last successful Save, per trial. This is the trial subfolder. Pose re-run reads MP4s from it after temp videos are deleted. */
  savedFolderByTrial: Record<string, string>;
  /** Subject folder the operator created or selected. Trials are subfolders of it. */
  subjectFolderById: Record<string, string>;
  /** Subject ids whose posture photos and subject CSV were written. */
  postureSavedById: Record<string, true>;
  toast: string | null;
  backend: BackendStatus;
  backendReady: boolean;
};

type SessionActions = {
  go: (screen: ScreenId) => void;
  openCameraPairing: () => void;
  closeCameraPairing: () => void;
  setFlow: (flow: SessionFlow) => void;
  setSessionName: (v: string) => void;
  setSessionNotes: (v: string) => void;
  setQuestionnaire: (v: QuestionnaireAnswers) => void;
  setQuestionnaireCompleted: (value: boolean) => void;
  setCamCount: (n: number) => void;
  setQrActive: (v: boolean) => void;
  /** Replace the connected IMU subset (UI mock only). */
  setConnectedImus: (slots: ImuSlotId[]) => void;
  /** Toggle one IMU chip on Pair. */
  toggleConnectedImu: (id: ImuSlotId) => void;
  /**
   * @deprecated Prefer `setConnectedImus` / `toggleConnectedImu`.
   * `true` connects all four slots; `false` clears.
   */
  setHasImus: (v: boolean) => void;
  setSubjectId: (v: string) => void;
  setSubjectName: (v: string) => void;
  setHeightCm: (v: string) => void;
  setWeightKg: (v: string) => void;
  setPostureDone: (v: boolean) => void;
  markStandingCaptured: (code: StandingCode, filename: string) => void;
  resetStanding: () => void;
  loadExistingDemoSubject: () => void;
  /**
   * Cover (Home) with the operator session back to its initial values.
   * Language, paired cameras, IMUs, and the live backend connection stay. Files already written
   * to disk stay. Bumps `sessionEpoch` so an in-flight save or export
   * does not write its result back into the fresh session.
   */
  resetSession: () => Promise<void>;
  sessionEpoch: MutableRefObject<number>;
  setTrialName: (v: string) => void;
  addTrial: (name: string) => void;
  /** Persist a finished trial (keeps all trials for the picker). */
  recordTrial: (trial: SessionTrial) => void;
  setActiveTrialId: (id: string | null) => void;
  setActiveStartAtMs: (ms: number | null) => void;
  setRecording: (v: boolean) => void;
  setElapsed: (n: number | ((prev: number) => number)) => void;
  setPoseOn: (v: boolean) => void;
  /** Store / replace full-res pose result for a trial (disposes prior URLs). */
  setTrialPose: (trialName: string, result: TrialPoseResult) => void;
  setSavedFolder: (trialName: string, folder: string) => void;
  setSubjectFolder: (subjectId: string, folder: string) => void;
  markPostureSaved: (subjectId: string) => void;
  clearTrialPose: (trialName: string) => void;
  /** Selected trial record, or null. */
  selectedTrial: () => SessionTrial | null;
  /** Optional durationMs — longer for Save warnings (missing uploads). */
  showToast: (msg: string, durationMs?: number) => void;
  refreshDevices: () => Promise<void>;
  connectUsbCamera: (cameraId: string, label: string) => Promise<void>;
  /** Pass `replaceDeviceId` to re-pair that camera in its current slot. */
  startPairing: (
    publicBaseUrl?: string,
    replaceDeviceId?: string,
  ) => Promise<void>;
  cancelPairing: () => Promise<void>;
  mockCompletePairing: () => Promise<void>;
  setDevicesFromBackend: (devices: BackendDevice[] | SessionDevice[]) => void;
};

type SessionContextValue = SessionState & SessionActions;

const SessionContext = createContext<SessionContextValue | null>(null);

function pairingFromPending(
  pending: NonNullable<SessionSnapshot['pendingPairing']>,
): ActivePairing | null {
  if (!pending.qrUrl) return null;
  return {
    id: pending.id,
    code: pending.code,
    qrUrl: pending.qrUrl,
    expiresAt: pending.expiresAt,
    reservedIndex: pending.reservedIndex,
    replaceDeviceId: pending.replaceDeviceId ?? null,
  };
}

function createdFromPending(
  pending: NonNullable<SessionSnapshot['pendingPairing']>,
): PairingCreated | null {
  const active = pairingFromPending(pending);
  if (!active) return null;
  return {
    id: active.id,
    code: active.code,
    status: pending.status,
    expires_at: active.expiresAt,
    qr_url: active.qrUrl,
    reserved_index: active.reservedIndex,
    replace_device_id: active.replaceDeviceId,
  };
}

function mapDevices(
  devices: BackendDevice[] | SessionDevice[],
): SessionDevice[] {
  return devices.map((d) => {
    if ('deviceId' in d) return d;
    return {
      deviceId: d.device_id,
      source: d.source,
      name: d.name,
      camIndex: d.cam_index,
      viewCode: d.view_code,
    };
  });
}

function sameDevices(a: SessionDevice[], b: SessionDevice[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (d, i) =>
        d.deviceId === b[i].deviceId &&
        d.source === b[i].source &&
        d.name === b[i].name &&
        d.camIndex === b[i].camIndex &&
        d.viewCode === b[i].viewCode,
    )
  );
}

const initial: SessionState = {
  screen: 0,
  pairingReturnScreen: 0,
  flow: 'home',
  sessionName: 'Lab session — gait pilot',
  sessionNotes: 'Indoor lab, 2× iPhone',
  questionnaire: emptyQuestionnaire(),
  questionnaireCompleted: false,
  camCount: 0,
  usbCameraErrors: {},
  usbHardwareIds: [],
  devices: [],
  activePairing: null,
  qrActive: false,
  connectedImus: [],
  hasImus: false,
  subjectId: '',
  subjectName: '',
  heightCm: '',
  weightKg: '',
  postureDone: false,
  capturedStanding: [],
  standingFiles: {},
  trialName: 'gait01',
  trials: [],
  trialRecords: [],
  activeTrialId: null,
  activeStartAtMs: null,
  recording: false,
  elapsed: 0,
  poseOn: false,
  poseByTrial: {},
  savedFolderByTrial: {},
  subjectFolderById: {},
  postureSavedById: {},
  toast: null,
  backend: null,
  backendReady: false,
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const sessionEpoch = useRef(0);
  const usbCameras = useRef(new Map<string, UsbCamera>());
  const usbConnecting = useRef(false);

  useEffect(
    () => () => {
      usbCameras.current.forEach((camera) => camera.dispose());
      usbCameras.current.clear();
    },
    [],
  );

  useEffect(() => {
    for (const [id, camera] of usbCameras.current) {
      if (!state.devices.some((device) => device.deviceId === id)) {
        camera.dispose();
        usbCameras.current.delete(id);
        setState((s) => {
          const errors = { ...s.usbCameraErrors };
          delete errors[id];
          return {
            ...s,
            usbCameraErrors: errors,
            usbHardwareIds: [...usbCameras.current.values()].map(
              (c) => c.hardwareId,
            ),
          };
        });
      }
    }
  }, [state.devices]);

  const patch = useCallback((partial: Partial<SessionState>) => {
    setState((s) => ({ ...s, ...partial }));
  }, []);

  const showToast = useCallback((msg: string, durationMs = 2200) => {
    setState((s) => ({ ...s, toast: msg }));
    const hold =
      durationMs > 2200 || /WARNING:|do not ship/i.test(msg)
        ? 6500
        : durationMs;
    window.setTimeout(() => {
      setState((s) => (s.toast === msg ? { ...s, toast: null } : s));
    }, hold);
  }, []);

  const setDevicesFromBackend = useCallback(
    (devices: BackendDevice[] | SessionDevice[]) => {
      const mapped = mapDevices(devices);
      setState((s) =>
        sameDevices(s.devices, mapped)
          ? s
          : { ...s, devices: mapped, camCount: mapped.length },
      );
    },
    [],
  );

  const refreshDevices = useCallback(async () => {
    try {
      let { devices } = await backendClient.listDevices();
      // A renderer reload loses USB streams; do not display those stale slots as ready.
      const stale = devices.filter(
        (d) => d.source === 'usb' && !usbCameras.current.has(d.device_id),
      );
      if (stale.length) {
        await Promise.all(
          stale.map((d) => backendClient.removeDevice(d.device_id)),
        );
        devices = (await backendClient.listDevices()).devices;
      }
      setDevicesFromBackend(devices);
    } catch {
      /* backend may still be starting */
    }
  }, [setDevicesFromBackend]);

  const connectUsbCamera = useCallback(
    async (cameraId: string, label: string) => {
      if (usbConnecting.current)
        throw new Error(t('A USB camera is already connecting.'));
      if (
        [...usbCameras.current.values()].some(
          (camera) => camera.hardwareId === cameraId,
        )
      )
        throw new Error(t('This camera is already connected'));
      usbConnecting.current = true;
      let stream: MediaStream | null = null;
      let camera: UsbCamera | null = null;
      let registeredId: string | null = null;
      try {
        recorderMime();
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: cameraId },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
        });
        const registered = await backendClient.connectUsbCamera(
          cameraId,
          label,
        );
        registeredId = registered.device_id;
        camera = new UsbCamera(
          cameraId,
          registered.device_id,
          registered.device_pairing_token,
          stream,
          (message) => {
            setState((s) => {
              const errors = { ...s.usbCameraErrors };
              if (message) errors[registered.device_id] = message;
              else delete errors[registered.device_id];
              return { ...s, usbCameraErrors: errors };
            });
            if (message) showToast(t(message), 6500);
          },
        );
        usbCameras.current.set(registered.device_id, camera);
        await camera.start();
        const { devices } = await backendClient.listDevices();
        setDevicesFromBackend(devices);
        setState((s) => ({
          ...s,
          usbHardwareIds: [...usbCameras.current.values()].map(
            (c) => c.hardwareId,
          ),
        }));
      } catch (error) {
        camera?.dispose();
        stream?.getTracks().forEach((track) => track.stop());
        if (registeredId) {
          usbCameras.current.delete(registeredId);
          await backendClient.removeDevice(registeredId).catch(() => {});
        }
        throw error;
      } finally {
        usbConnecting.current = false;
      }
    },
    [setDevicesFromBackend, showToast],
  );

  const startPairing = useCallback(
    async (publicBaseUrl?: string, replaceDeviceId?: string) => {
      let created: PairingCreated;
      try {
        created = await backendClient.createPairing(
          publicBaseUrl,
          replaceDeviceId,
        );
      } catch (err) {
        // A reload drops the on-screen QR while the backend still holds it.
        // Show that code again instead of leaving Pair a device with nothing.
        const message = err instanceof Error ? err.message : '';
        if (!message.includes('already active')) throw err;
        let pending: SessionSnapshot['pendingPairing'];
        try {
          pending = (await backendClient.session()).pendingPairing;
        } catch {
          throw err;
        }
        const existing = pending ? createdFromPending(pending) : null;
        if (!existing) throw err;
        created = existing;
      }
      setState((s) => ({
        ...s,
        qrActive: true,
        activePairing: {
          id: created.id,
          code: created.code,
          qrUrl: created.qr_url,
          expiresAt: created.expires_at,
          reservedIndex: created.reserved_index ?? s.camCount,
          replaceDeviceId: created.replace_device_id ?? null,
        },
      }));
    },
    [],
  );

  const cancelPairing = useCallback(async () => {
    const id = state.activePairing?.id;
    if (id) {
      try {
        await backendClient.cancelPairing(id);
      } catch {
        /* ignore */
      }
    }
    setState((s) => ({ ...s, qrActive: false, activePairing: null }));
  }, [state.activePairing?.id]);

  const mockCompletePairing = useCallback(async () => {
    await backendClient.mockComplete();
    setState((s) => ({
      ...s,
      qrActive: false,
      activePairing: null,
    }));
    await refreshDevices();
  }, [refreshDevices]);

  const markStandingCaptured = useCallback(
    (code: StandingCode, filename: string) => {
      setState((s) => {
        const capturedStanding = s.capturedStanding.includes(code)
          ? s.capturedStanding
          : [...s.capturedStanding, code];
        const standingFiles = { ...s.standingFiles, [code]: filename };
        const postureDone =
          capturedStanding.includes('F') &&
          capturedStanding.includes('LL') &&
          capturedStanding.includes('RL');
        const postureSavedById = { ...s.postureSavedById };
        delete postureSavedById[s.subjectId];
        return {
          ...s,
          capturedStanding,
          standingFiles,
          postureDone,
          postureSavedById,
        };
      });
    },
    [],
  );

  const resetStanding = useCallback(() => {
    setState((s) => {
      const postureSavedById = { ...s.postureSavedById };
      delete postureSavedById[s.subjectId];
      return {
        ...s,
        capturedStanding: [],
        standingFiles: {},
        postureDone: false,
        postureSavedById,
      };
    });
  }, []);

  const resetSession = useCallback(async () => {
    sessionEpoch.current += 1;
    const snapshot = stateRef.current;
    usbCameras.current.forEach((camera) => camera.resetAssessment());
    for (const result of Object.values(snapshot.poseByTrial)) {
      disposeTrialPoseResult(result);
    }
    const trialIds = new Set(snapshot.trialRecords.map((trial) => trial.id));
    if (snapshot.activeTrialId) trialIds.add(snapshot.activeTrialId);
    await Promise.all([
      ...[...trialIds].map((id) =>
        backendClient.deleteRecordings(id).catch(() => {}),
      ),
      snapshot.activePairing
        ? backendClient.cancelPairing(snapshot.activePairing.id).catch(() => {})
        : Promise.resolve(),
    ]);
    setState((s) => ({
      ...initial,
      devices: s.devices,
      camCount: s.camCount,
      usbCameraErrors: s.usbCameraErrors,
      usbHardwareIds: s.usbHardwareIds,
      connectedImus: s.connectedImus,
      hasImus: s.hasImus,
      backend: s.backend,
      backendReady: s.backendReady,
    }));
  }, []);

  const loadExistingDemoSubject = useCallback(() => {
    setState((s) => {
      const postureSavedById = { ...s.postureSavedById };
      delete postureSavedById.UG0001;
      return {
        ...s,
        subjectId: 'UG0001',
        subjectName: 'Chan Tai Man',
        heightCm: '172',
        weightKg: '68',
        capturedStanding: [],
        standingFiles: {},
        postureDone: false,
        postureSavedById,
      };
    });
  }, []);

  // Resolve backend URL from preload, then hydrate device list.
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const info = await window.motuscapLite?.getBackendInfo?.();
        if (cancelled) return;
        if (info) {
          backendClient.setBaseUrl(info.apiBase);
          void backendClient.publishLocale?.(getLocale())?.catch(() => {});
          setState((s) => ({
            ...s,
            backend: info,
            backendReady: true,
          }));
          await refreshDevices();
          if (cancelled) return;
          try {
            const pending = (await backendClient.session()).pendingPairing;
            const active = pending ? pairingFromPending(pending) : null;
            if (cancelled || !active) return;
            setState((s) => ({
              ...s,
              qrActive: true,
              activePairing: active,
            }));
          } catch {
            /* pairing QR is restored on the next Pair a device click */
          }
        } else {
          setState((s) => ({ ...s, backendReady: false }));
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, backendReady: false }));
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [refreshDevices]);

  // Poll active pairing until phone completes (or mock).
  useEffect(() => {
    if (!state.qrActive || !state.activePairing) return;
    const { id, reservedIndex, replaceDeviceId } = state.activePairing;
    const timer = window.setInterval(async () => {
      try {
        const p = await backendClient.getPairing(id);
        if (p.status === 'completed') {
          await refreshDevices();
          setState((s) => ({
            ...s,
            qrActive: false,
            activePairing: null,
          }));
          showToast(
            replaceDeviceId
              ? t('Cam {n} re-paired', { n: reservedIndex + 1 })
              : t('Cam paired'),
          );
        } else if (p.status === 'expired' || p.status === 'cancelled') {
          setState((s) => ({
            ...s,
            qrActive: false,
            activePairing: null,
          }));
        }
      } catch {
        /* keep polling */
      }
    }, 700);
    return () => window.clearInterval(timer);
  }, [state.qrActive, state.activePairing, refreshDevices, showToast]);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      go: (screen) => patch({ screen }),
      openCameraPairing: () =>
        setState((s) =>
          s.screen === 2
            ? s
            : { ...s, pairingReturnScreen: s.screen, screen: 2 },
        ),
      closeCameraPairing: () =>
        setState((s) => ({ ...s, screen: s.pairingReturnScreen })),
      setFlow: (flow) => patch({ flow }),
      setSessionName: (sessionName) => patch({ sessionName }),
      setSessionNotes: (sessionNotes) => patch({ sessionNotes }),
      setQuestionnaire: (questionnaire) =>
        patch({ questionnaire, questionnaireCompleted: false }),
      setQuestionnaireCompleted: (questionnaireCompleted) =>
        patch({ questionnaireCompleted }),
      setCamCount: (camCount) => patch({ camCount }),
      setQrActive: (qrActive) => patch({ qrActive }),
      setConnectedImus: (connectedImus) =>
        patch({
          connectedImus,
          hasImus: connectedImus.length > 0,
        }),
      toggleConnectedImu: (id) =>
        setState((s) => {
          const connectedImus = toggleImuSlot(s.connectedImus, id);
          return {
            ...s,
            connectedImus,
            hasImus: connectedImus.length > 0,
          };
        }),
      setHasImus: (on) =>
        patch({
          connectedImus: on ? [...IMU_SLOT_IDS] : [],
          hasImus: on,
        }),
      setSubjectId: (subjectId) => patch({ subjectId }),
      setSubjectName: (subjectName) => patch({ subjectName }),
      setHeightCm: (heightCm) => patch({ heightCm }),
      setWeightKg: (weightKg) => patch({ weightKg }),
      setPostureDone: (postureDone) => patch({ postureDone }),
      markStandingCaptured,
      resetStanding,
      loadExistingDemoSubject,
      resetSession,
      sessionEpoch,
      setTrialName: (trialName) => patch({ trialName }),
      addTrial: (name) =>
        setState((s) =>
          s.trials.includes(name) ? s : { ...s, trials: [...s.trials, name] },
        ),
      recordTrial: (trial) =>
        setState((s) => {
          const trials = s.trials.includes(trial.name)
            ? s.trials
            : [...s.trials, trial.name];
          const existing = s.trialRecords.findIndex((t) => t.id === trial.id);
          const trialRecords =
            existing >= 0
              ? s.trialRecords.map((t, i) => (i === existing ? trial : t))
              : [...s.trialRecords, trial];
          return {
            ...s,
            trials,
            trialRecords,
            trialName: trial.name,
          };
        }),
      setActiveTrialId: (activeTrialId) => patch({ activeTrialId }),
      setActiveStartAtMs: (activeStartAtMs) => patch({ activeStartAtMs }),
      setRecording: (recording) => patch({ recording }),
      setElapsed: (elapsed) =>
        setState((s) => ({
          ...s,
          elapsed: typeof elapsed === 'function' ? elapsed(s.elapsed) : elapsed,
        })),
      setPoseOn: (poseOn) => patch({ poseOn }),
      setSavedFolder: (trialName, folder) =>
        setState((s) => ({
          ...s,
          savedFolderByTrial: { ...s.savedFolderByTrial, [trialName]: folder },
        })),
      setSubjectFolder: (subjectId, folder) =>
        setState((s) => ({
          ...s,
          subjectFolderById: {
            ...s.subjectFolderById,
            [subjectId]: folder,
          },
        })),
      markPostureSaved: (subjectId) =>
        setState((s) => ({
          ...s,
          postureSavedById: { ...s.postureSavedById, [subjectId]: true },
        })),
      setTrialPose: (trialName, result) =>
        setState((s) => {
          const prev = s.poseByTrial[trialName];
          if (prev && prev !== result) disposeTrialPoseResult(prev);
          return {
            ...s,
            poseByTrial: { ...s.poseByTrial, [trialName]: result },
          };
        }),
      clearTrialPose: (trialName) =>
        setState((s) => {
          const prev = s.poseByTrial[trialName];
          if (prev) disposeTrialPoseResult(prev);
          const next = { ...s.poseByTrial };
          delete next[trialName];
          return { ...s, poseByTrial: next };
        }),
      selectedTrial: () => latestTrial(state.trialRecords, state.trialName),
      showToast,
      refreshDevices,
      connectUsbCamera,
      startPairing,
      cancelPairing,
      mockCompletePairing,
      setDevicesFromBackend,
    }),
    [
      state,
      patch,
      showToast,
      refreshDevices,
      connectUsbCamera,
      startPairing,
      cancelPairing,
      mockCompletePairing,
      setDevicesFromBackend,
      markStandingCaptured,
      resetStanding,
      loadExistingDemoSubject,
      resetSession,
      sessionEpoch,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
