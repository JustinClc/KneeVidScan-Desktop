/** @vitest-environment node */
import { beforeEach, describe, expect, it } from 'vitest';
import type { LinkProbeSample } from '../lib/recordingQuality';
import { LiteStore } from './store';

const strongProbe: LinkProbeSample = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  uploadBytesPerSec: 2_000_000,
};
const weakProbe: LinkProbeSample = {
  width: 1920,
  height: 1080,
  frameRate: 24,
  uploadBytesPerSec: 80_000,
};

describe('LiteStore pairing + sync', () => {
  let store: LiteStore;

  beforeEach(() => {
    store = new LiteStore();
    store.setInfo({
      apiBase: 'https://127.0.0.1:9443',
      pwaBase: 'https://127.0.0.1:9443/pwa/',
      https: true,
      lanHost: '127.0.0.1',
      port: 9443,
    });
  });

  it('pairs up to 3 devices with F/L/O roles and single-cam no suffix', () => {
    const p1 = store.createPairing();
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    const c1 = store.completePairing(p1.pairing.id, { code: p1.code });
    expect(c1.ok).toBe(true);
    if (!c1.ok) return;
    expect(c1.viewCode).toBeNull();
    expect(store.devices).toHaveLength(1);

    const p2 = store.createPairing();
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    const c2 = store.completePairing(p2.pairing.id, { code: p2.code });
    expect(c2.ok).toBe(true);
    expect(store.devices.map((d) => d.viewCode)).toEqual(['F', 'L']);

    const p3 = store.createPairing();
    expect(p3.ok).toBe(true);
    if (!p3.ok) return;
    store.completePairing(p3.pairing.id, { code: p3.code });
    expect(store.devices.map((d) => d.viewCode)).toEqual(['F', 'L', 'O']);

    const p4 = store.createPairing();
    expect(p4.ok).toBe(false);
  });

  it('remembers the QR url so a later Pair a device can show it', () => {
    const created = store.createPairing();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.pairing.qrUrl).toBe(created.qrUrl);
    expect(store.snapshot().pendingPairing?.qrUrl).toBe(created.qrUrl);
    const again = store.createPairing();
    expect(again).toMatchObject({
      ok: false,
      error: 'A pairing QR is already active — complete or cancel it first',
    });
  });

  it('mock-completes active QR without a phone', () => {
    const p = store.createPairing();
    expect(p.ok).toBe(true);
    const mock = store.mockCompleteActivePairing('Mock Cam');
    expect(mock.ok).toBe(true);
    expect(store.deviceCount()).toBe(1);
  });

  it('broadcasts a shared start signal for a trial', () => {
    const trial = store.createTrial('gait01');
    store.armTrial(trial.id);
    const signal = store.startTrial(trial.id);
    expect(signal?.trialName).toBe('gait01');
    expect(signal!.startAtMs).toBeGreaterThan(Date.now() - 50);
    store.stopTrial(trial.id);
    expect(store.trials.get(trial.id)?.phase).toBe('done');
  });

  it('tracks each camera from recording to a ready file on disk', () => {
    const trial = store.createTrial('gait01');
    store.startTrial(trial.id);
    store.stopTrial(trial.id);
    expect(store.getUpload(trial.id, 'dev_0')).toBeNull();

    store.beginUpload(trial.id, 'dev_0', 'cam.webm');
    store.uploadProgress(trial.id, 'dev_0', 10);
    expect(store.getUpload(trial.id, 'dev_0')).toMatchObject({
      status: 'uploading',
      bytes: 10,
    });
    store.uploadConverting(trial.id, 'dev_0', 20);
    store.uploadReady(trial.id, 'dev_0', '/tmp/x/dev_0.mp4', 18);
    expect(store.getUpload(trial.id, 'dev_0')).toMatchObject({
      status: 'ready',
      path: '/tmp/x/dev_0.mp4',
      bytes: 18,
    });
    expect(store.listTrials()[0]?.uploadCount).toBe(1);

    store.clearRecordings(trial.id);
    expect(store.getUpload(trial.id, 'dev_0')?.status).toBe('cleared');
    expect(store.getUpload(trial.id, 'dev_0')?.path).toBeUndefined();
  });

  it('lists cameras paired at Start as recording, and fails quiet ones', () => {
    store.createPairing();
    store.mockCompleteActivePairing();
    const dev = store.devices[0].deviceId;
    const trial = store.createTrial('gait01');
    store.startTrial(trial.id);
    expect(store.trials.get(trial.id)?.participants).toEqual([dev]);
    expect(store.getUpload(trial.id, dev)?.status).toBe('recording');
    store.stopTrial(trial.id);
    const later = Date.now() + 61_000;
    expect(store.uploadStatuses(trial.id, later)?.[dev]).toMatchObject({
      status: 'failed',
      error: 'No upload from this camera 60 s after Stop',
    });
  });

  it('saves standing PNGs F→LL→RL and clears them on retake', () => {
    store.upsertSubject({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      heightCm: '172',
      weightKg: '68',
    });
    const png = LiteStore.minimalPng();
    for (const code of ['F', 'LL', 'RL'] as const) {
      store.saveStandingPng(
        'UG0001',
        code,
        `UG0001_Chan-Tai-Man_standing_${code}.png`,
        png,
      );
    }
    const s = store.getSubject('UG0001')!;
    expect(s.standing.F?.filename).toBe('UG0001_Chan-Tai-Man_standing_F.png');
    expect(s.standing.LL?.filename).toBe('UG0001_Chan-Tai-Man_standing_LL.png');
    expect(s.standing.RL?.filename).toBe('UG0001_Chan-Tai-Man_standing_RL.png');
    store.clearStanding('UG0001');
    expect(store.getSubject('UG0001')!.standing).toEqual({});
  });

  it('re-pairs a camera in place, keeping its slot and role', () => {
    for (const name of ['Front', 'Side', 'Extra']) {
      store.createPairing();
      store.mockCompleteActivePairing(name);
    }
    const old = store.devices[0];
    const oldToken = [...store.tokens].find(
      ([, id]) => id === old.deviceId,
    )![0];

    // Replacing works even with all 3 slots in use.
    const repl = store.createPairing({ replaceDeviceId: old.deviceId });
    expect(repl.ok).toBe(true);
    if (!repl.ok) return;
    expect(repl.pairing.reservedIndex).toBe(0);

    // Old phone stays connected until the new phone completes.
    expect(store.authDevice(oldToken)?.deviceId).toBe(old.deviceId);
    const done = store.completePairing(repl.pairing.id, {
      code: repl.code,
      deviceName: 'New Front',
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.camIndex).toBe(0);
    expect(done.viewCode).toBe('F');
    expect(store.devices.map((d) => d.name)).toEqual([
      'New Front',
      'Side',
      'Extra',
    ]);
    expect(store.authDevice(oldToken)).toBeNull();
  });

  it('keeps the old camera when a replacement QR is cancelled', () => {
    store.createPairing();
    store.mockCompleteActivePairing('Front');
    const old = store.devices[0];
    const repl = store.createPairing({ replaceDeviceId: old.deviceId });
    expect(repl.ok).toBe(true);
    if (!repl.ok) return;
    store.cancelPairing(repl.pairing.id);
    expect(store.devices.map((d) => d.deviceId)).toEqual([old.deviceId]);
    expect(store.createPairing({ replaceDeviceId: 'dev_missing' }).ok).toBe(
      false,
    );
  });

  it('requests and stores a full-res still for the frontal device', () => {
    const p = store.createPairing();
    expect(p.ok).toBe(true);
    store.mockCompleteActivePairing('Frontal');
    const id = store.devices[0].deviceId;
    expect(store.requestStill(id)).toBe(true);
    expect(store.hasStillRequest(id)).toBe(true);
    store.setStill(id, LiteStore.minimalPng(), true);
    store.consumeStillRequest(id);
    const still = store.takeStill(id);
    expect(still?.fullRes).toBe(true);
    expect(still?.png.length).toBeGreaterThan(0);
    expect(store.takeStill(id)).toBeNull();
  });
});

describe('LiteStore recording quality session settings', () => {
  let store: LiteStore;

  beforeEach(() => {
    store = new LiteStore();
  });

  it('defaults to auto mode and preview on with no probes', () => {
    expect(store.recordingQualityMode).toBe('auto');
    expect(store.previewEnabled).toBe(true);
    expect(store.linkProbes.size).toBe(0);
    expect(store.listLinkProbes()).toEqual([]);
    expect(store.resolvedRecordingPreset()).toBe('720p');
  });

  it('persists explicit quality mode and preview toggle', () => {
    store.setRecordingQualityMode('480p');
    expect(store.recordingQualityMode).toBe('480p');
    store.setPreviewEnabled(false);
    expect(store.previewEnabled).toBe(false);
    expect(store.resolvedRecordingPreset()).toBe('480p');
  });

  it('stores and replaces link probes per device', () => {
    store.setLinkProbe('dev_a', strongProbe);
    store.setLinkProbe('dev_b', weakProbe);
    expect(store.listLinkProbes()).toHaveLength(2);
    expect(store.linkProbes.get('dev_a')).toEqual(strongProbe);

    const updated = { ...strongProbe, frameRate: 60 };
    store.setLinkProbe('dev_a', updated);
    expect(store.linkProbes.get('dev_a')).toEqual(updated);
    expect(store.listLinkProbes()).toHaveLength(2);
  });

  it('resolved preset in auto follows the weakest probe', () => {
    store.setLinkProbe('dev_a', strongProbe);
    expect(store.resolvedRecordingPreset()).toBe('1080p');
    store.setLinkProbe('dev_b', weakProbe);
    expect(store.resolvedRecordingPreset()).toBe('480p');
  });

  it('resolved preset in auto keeps 1080p for a 24 fps camera on a strong link', () => {
    store.setLinkProbe('dev_a', { ...strongProbe, frameRate: 24 });
    expect(store.resolvedRecordingPreset()).toBe('1080p');
    store.setLinkProbe('dev_b', weakProbe);
    expect(store.resolvedRecordingPreset()).toBe('480p');
  });

  it('requestLinkProbes starts a fresh round for every device', () => {
    store.setLinkProbe('dev_a', strongProbe);
    store.acknowledgeLinkProbe('dev_a');
    store.setLinkProbe('dev_b', weakProbe);
    store.acknowledgeLinkProbe('dev_b');
    expect(store.isProbeRequested('dev_a')).toBe(false);

    store.requestLinkProbes();
    expect(store.listLinkProbes()).toEqual([]);
    expect(store.isProbeRequested('dev_a')).toBe(true);
    expect(store.isProbeRequested('dev_b')).toBe(true);
    // Old samples still resolve auto so phones do not bounce to 720p.
    expect(store.resolvedRecordingPreset()).toBe('480p');

    store.setLinkProbe('dev_b', strongProbe);
    store.acknowledgeLinkProbe('dev_b');
    expect(store.listLinkProbes()).toHaveLength(1);
    expect(store.isProbeRequested('dev_b')).toBe(false);
    expect(store.isProbeRequested('dev_a')).toBe(true);
    expect(store.resolvedRecordingPreset()).toBe('1080p');
  });

  it('clears a probe explicitly and when a device is removed or replaced', () => {
    store.setInfo({
      apiBase: 'https://127.0.0.1:9443',
      pwaBase: 'https://127.0.0.1:9443/pwa/',
      https: true,
      lanHost: '127.0.0.1',
      port: 9443,
    });
    store.createPairing();
    store.mockCompleteActivePairing('Front');
    const devId = store.devices[0].deviceId;
    store.setLinkProbe(devId, strongProbe);
    expect(store.linkProbes.has(devId)).toBe(true);

    store.clearLinkProbe(devId);
    expect(store.linkProbes.has(devId)).toBe(false);

    store.setLinkProbe(devId, strongProbe);
    store.requestLinkProbes();
    expect(store.staleLinkProbes.has(devId)).toBe(true);
    store.removeDevice(devId);
    expect(store.linkProbes.has(devId)).toBe(false);
    expect(store.staleLinkProbes.has(devId)).toBe(false);

    store.createPairing();
    store.mockCompleteActivePairing('Again');
    const againId = store.devices[0].deviceId;
    store.setLinkProbe(againId, strongProbe);
    const repl = store.createPairing({ replaceDeviceId: againId });
    expect(repl.ok).toBe(true);
    if (!repl.ok) return;
    store.completePairing(repl.pairing.id, { code: repl.code });
    expect(store.linkProbes.has(againId)).toBe(false);
  });
});
