/** @vitest-environment node */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { PWA_HELPERS_JS, PWA_HTML, PWA_JS } from './pwaAssets';

type Sample = { rtt: number; offset: number };
const helpers = vm.runInNewContext(
  `${PWA_HELPERS_JS}; ({ pickRecorderType, extensionFor, emptyRecordingMessage, clockSample, pushClockSample, bestOffset, UPLOAD_RETRY_DELAYS_MS, isLanHost, previewProfile, stepDownLongSide, PREVIEW_MIN_LONG_SIDE, previewSuppressed, presetIdeals, resolutionConstraints, PROBE_BODY_BYTES, pickCamera, translateText, retainLocale })`,
) as {
  pickRecorderType: (isSupported: (t: string) => boolean) => string;
  extensionFor: (t: string) => string;
  emptyRecordingMessage: (size: number, mime: string) => string;
  clockSample: (t0: number, t1: number, serverNow: number) => Sample;
  pushClockSample: (samples: Sample[], s: Sample) => Sample[];
  bestOffset: (samples: Sample[]) => number;
  UPLOAD_RETRY_DELAYS_MS: number[];
  isLanHost: (h: string) => boolean;
  previewProfile: (
    mode: 'standing' | 'capture' | 'captureRecording' | 'idle',
    lan: boolean,
  ) => { intervalMs: number; longSide: number; quality: number };
  stepDownLongSide: (longSide: number, floor: number) => number;
  PREVIEW_MIN_LONG_SIDE: Record<
    'standing' | 'capture' | 'captureRecording' | 'idle',
    number
  >;
  previewSuppressed: (mode: string, enabled: boolean) => boolean;
  presetIdeals: (id: string) => { width: number; height: number };
  resolutionConstraints: (
    maxRes: boolean,
    presetId: string,
  ) => { width: { ideal: number }; height: { ideal: number } };
  PROBE_BODY_BYTES: number;
  pickCamera: (
    videos: Array<{ deviceId: string; label: string }>,
    savedId: string,
    savedLabel: string,
  ) => string;
  translateText: (
    messages: Record<string, Record<string, string>> | null,
    locale: string,
    text: string,
    vars?: Record<string, string | number>,
  ) => string;
  retainLocale: (
    prev: { locale: string; received: boolean },
    result: { ok?: boolean; ready?: boolean; locale?: string } | null,
  ) => { locale: string; received: boolean };
};

describe('phone recorder helpers', () => {
  it('prefers WebM, then H.264 MP4 when WebM is unavailable', () => {
    const only =
      (...ok: string[]) =>
      (t: string) =>
        ok.includes(t);
    expect(helpers.pickRecorderType(() => true)).toBe('video/webm;codecs=vp9');
    expect(helpers.pickRecorderType(only('video/mp4', 'video/webm'))).toBe(
      'video/webm',
    );
    expect(
      helpers.pickRecorderType(only('video/mp4;codecs=avc1', 'video/mp4')),
    ).toBe('video/mp4;codecs=avc1');
    expect(
      helpers.pickRecorderType(only('video/webm;codecs=vp9', 'video/webm')),
    ).toBe('video/webm;codecs=vp9');
    expect(helpers.pickRecorderType(only('video/webm'))).toBe('video/webm');
    expect(
      helpers.pickRecorderType(() => {
        throw new Error('no MediaRecorder');
      }),
    ).toBe('');
    expect(helpers.extensionFor('video/mp4;codecs=avc1')).toBe('mp4');
    expect(helpers.extensionFor('video/webm;codecs=vp9')).toBe('webm');
  });

  it('reports an empty recording instead of uploading it', () => {
    expect(helpers.emptyRecordingMessage(0, 'video/mp4;codecs=avc1')).toBe(
      'Recorder produced no data (video/mp4;codecs=avc1)',
    );
    expect(helpers.emptyRecordingMessage(0, '')).toBe(
      'Recorder produced no data (unknown)',
    );
    expect(helpers.emptyRecordingMessage(8, 'video/webm')).toBe('');
    const guard = PWA_JS.indexOf('emptyRecordingMessage(blob.size, type)');
    const send = PWA_JS.indexOf('await sendUpload(');
    expect(guard).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(guard);
    expect(PWA_JS).toContain('reportUploadError(rec.trialId, empty)');
  });

  it('estimates the desktop clock offset from the fastest round trip', () => {
    // Phone is 5 s behind; the reply was stamped half way through the trip.
    expect(helpers.clockSample(1000, 1100, 6050)).toEqual({
      rtt: 100,
      offset: 5000,
    });
    let samples: Sample[] = [];
    samples = helpers.pushClockSample(samples, { rtt: 300, offset: 5120 });
    samples = helpers.pushClockSample(samples, { rtt: 20, offset: 5004 });
    samples = helpers.pushClockSample(samples, { rtt: 150, offset: 4950 });
    expect(helpers.bestOffset(samples)).toBe(5004);
    expect(helpers.bestOffset([])).toBe(0);
    for (let i = 0; i < 12; i++) {
      samples = helpers.pushClockSample(samples, { rtt: 200, offset: i });
    }
    expect(samples).toHaveLength(10);
    expect(helpers.bestOffset(samples)).toBe(2);
  });

  it('retries uploads after 2, 4 and 8 s', () => {
    expect(helpers.UPLOAD_RETRY_DELAYS_MS).toEqual([2000, 4000, 8000]);
  });

  it('inlines the helpers and wires stop, cancel, countdown and Retry', () => {
    expect(() => new vm.Script(PWA_JS)).not.toThrow();
    expect(PWA_JS).toContain('function pickRecorderType');
    expect(PWA_JS).toMatch(/t\.phase === 'done'/);
    expect(PWA_JS).toMatch(/t\.phase === 'cancelled'/);
    expect(PWA_JS).toContain("'Starting in {seconds}'");
    expect(PWA_JS).toContain('/v1/locale');
    expect(PWA_JS).not.toContain('motuscap-lite.locale');
    expect(PWA_JS).toContain('/upload-error');
    expect(PWA_JS).toContain('uploadBusy');
    expect(PWA_JS).toContain('function supersedeUpload');
    expect(PWA_JS).toContain('body.server_now');
    expect(PWA_HTML).toContain('id="btn-retry"');
  });

  it('paces previews from the mode profile and steps down when slow', () => {
    expect(PWA_JS).toContain('previewProfile(');
    expect(PWA_JS).toContain('isLanHost(new URL(api).hostname)');
    expect(PWA_JS).toContain('stepDownLongSide(');
    expect(PWA_JS).not.toContain('LIVE_POSE_PREVIEW_INTERVAL_MS');
    expect(PWA_JS).toContain('captureMode = Boolean(body && body.livePose)');
  });

  it('reads recording quality from still-request and applies preset, preview off, probe', () => {
    expect(PWA_JS).toContain('body.recordingPreset');
    expect(PWA_JS).toContain('body.videoBitsPerSecond');
    expect(PWA_JS).toContain('body.previewEnabled');
    expect(PWA_JS).toContain('body.probeRequested');
    expect(PWA_JS).toContain('captureMode && session');
    expect(PWA_JS).toContain("'captureRecording'");
    expect(PWA_JS).toContain('!previewSuppressed(mode, previewEnabled)');
    expect(PWA_JS).toContain('videoBitsPerSecond: recordingBitrate');
    expect(PWA_JS).toContain('/link-probe-bytes');
    expect(PWA_JS).toContain('/link-probe');
    expect(PWA_JS).toContain('probeInFlight');
  });

  it('skips encoding before drawImage when preview is suppressed', () => {
    const gate = PWA_JS.indexOf('!previewSuppressed(mode, previewEnabled)');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(PWA_JS.indexOf('ctx.drawImage(el.video'));
    expect(gate).toBeLessThan(
      PWA_JS.indexOf("el.canvas.toBlob(resolve, 'image/jpeg'"),
    );
  });

  it('applies the desired preset when it differs from the applied one, incl. before recording', () => {
    expect(PWA_JS).toContain(
      'if (session || standingMode || appliedPresetId === recordingPresetId) return;',
    );
    const prep = PWA_JS.slice(
      PWA_JS.indexOf('async function prepareRecording'),
    );
    const standingOff = prep.indexOf('await setStandingMode(false);');
    const apply = prep.indexOf('await applyRecordingPresetIfIdle();');
    const recorder = prep.indexOf('new MediaRecorder(');
    expect(standingOff).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(standingOff);
    expect(recorder).toBeGreaterThan(apply);
  });

  it('leaves a link probe pending while recording, preparing or uploading', () => {
    const probe = PWA_JS.slice(PWA_JS.indexOf('async function runLinkProbe'));
    const guard = probe.indexOf(
      'if (session || preparingTrial || uploadBusy || stillBusy) return;',
    );
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(probe.indexOf('probeRequestedLocal = false'));
  });
});

describe('preview profiles', () => {
  it('treats private and local addresses as LAN, tunnels as public', () => {
    for (const h of [
      '192.168.0.8',
      '10.1.2.3',
      '172.20.0.5',
      'localhost',
      '127.0.0.1',
      'my-mac.local',
    ]) {
      expect(helpers.isLanHost(h)).toBe(true);
    }
    for (const h of [
      'motuscap-lite.ngrok-free.app',
      '8.8.8.8',
      '172.32.0.1',
      '',
    ]) {
      expect(helpers.isLanHost(h)).toBe(false);
    }
  });

  it('runs posture at 20 fps and motion at 15 fps on the LAN', () => {
    expect(helpers.previewProfile('standing', true)).toEqual({
      intervalMs: 50,
      longSide: 640,
      quality: 0.6,
    });
    expect(helpers.previewProfile('capture', true)).toEqual({
      intervalMs: 66,
      longSide: 480,
      quality: 0.6,
    });
    expect(helpers.previewProfile('idle', true)).toEqual({
      intervalMs: 400,
      longSide: 320,
      quality: 0.55,
    });
  });

  it('keeps slower previews through a public URL', () => {
    expect(helpers.previewProfile('standing', false).intervalMs).toBe(66);
    expect(helpers.previewProfile('capture', false)).toEqual({
      intervalMs: 200,
      longSide: 320,
      quality: 0.55,
    });
  });

  it('uses milder captureRecording previews while a trial records', () => {
    expect(helpers.previewProfile('captureRecording', true)).toEqual({
      intervalMs: 100,
      longSide: 360,
      quality: 0.5,
    });
    expect(helpers.previewProfile('captureRecording', false)).toEqual({
      intervalMs: 250,
      longSide: 280,
      quality: 0.5,
    });
    expect(helpers.PREVIEW_MIN_LONG_SIDE.captureRecording).toBe(240);
  });

  it('maps recording presets to stream ideals unless standing max-res', () => {
    expect(helpers.presetIdeals('1080p')).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(helpers.presetIdeals('720p')).toEqual({ width: 1280, height: 720 });
    expect(helpers.presetIdeals('480p')).toEqual({ width: 854, height: 480 });
    expect(helpers.presetIdeals('unknown')).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(helpers.resolutionConstraints(true, '480p')).toEqual({
      width: { ideal: 3840 },
      height: { ideal: 2160 },
    });
    expect(helpers.resolutionConstraints(false, '720p')).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
    });
  });

  it('preview off only suppresses Capture frames, never Standing or Pair', () => {
    expect(helpers.previewSuppressed('capture', false)).toBe(true);
    expect(helpers.previewSuppressed('captureRecording', false)).toBe(true);
    expect(helpers.previewSuppressed('standing', false)).toBe(false);
    expect(helpers.previewSuppressed('idle', false)).toBe(false);
    expect(helpers.previewSuppressed('capture', true)).toBe(false);
  });

  it('sizes link-probe upload bodies for throughput measurement', () => {
    expect(helpers.PROBE_BODY_BYTES).toBe(65536);
  });

  it('finds the saved camera by id, then by label', () => {
    const cams = [
      { deviceId: 'a', label: 'Back Camera' },
      { deviceId: 'b', label: 'Front Camera' },
    ];
    expect(helpers.pickCamera(cams, 'b', 'Back Camera')).toBe('b');
    expect(helpers.pickCamera(cams, 'stale', 'Front Camera')).toBe('b');
    expect(helpers.pickCamera(cams, 'stale', 'Telephoto')).toBe('');
    expect(helpers.pickCamera(cams, '', '')).toBe('');
    expect(helpers.pickCamera([], 'a', 'Back Camera')).toBe('');
  });

  it('asks the desktop for the Locale and keeps the last answer', () => {
    const en = { locale: 'en', received: false };
    expect(helpers.retainLocale(en, { ok: false })).toEqual(en);
    expect(
      helpers.retainLocale(en, { ok: true, ready: false, locale: 'zh-Hant' }),
    ).toEqual(en);
    const zh = helpers.retainLocale(en, {
      ok: true,
      ready: true,
      locale: 'zh-Hant',
    });
    expect(zh).toEqual({ locale: 'zh-Hant', received: true });
    expect(helpers.retainLocale(zh, { ok: false })).toEqual(zh);
    expect(
      helpers.retainLocale(zh, { ok: true, ready: false, locale: 'en' }),
    ).toEqual(zh);
    expect(
      helpers.retainLocale(zh, { ok: true, ready: true, locale: 'fr' }),
    ).toEqual({ locale: 'en', received: true });
  });

  it('translates phone copy and leaves an unknown sentence in English', () => {
    const messages = {
      'zh-Hant': {
        'Pair this phone': '配對此手機',
        'Starting in {seconds}': '{seconds} 秒後開始',
      },
      'zh-Hans': { 'Pair this phone': '配对此手机' },
    };
    expect(helpers.translateText(messages, 'zh-Hant', 'Pair this phone')).toBe(
      '配對此手機',
    );
    expect(helpers.translateText(messages, 'zh-Hans', 'Pair this phone')).toBe(
      '配对此手机',
    );
    expect(
      helpers.translateText(messages, 'zh-Hant', 'Starting in {seconds}', {
        seconds: 3,
      }),
    ).toBe('3 秒後開始');
    expect(helpers.translateText(messages, 'zh-Hant', 'MotusCap Lite')).toBe(
      'MotusCap Lite',
    );
    expect(helpers.translateText(messages, 'en', 'Pair this phone')).toBe(
      'Pair this phone',
    );
  });

  it('steps the long side down by a quarter, never below the floor', () => {
    expect(helpers.stepDownLongSide(640, 480)).toBe(480);
    expect(helpers.stepDownLongSide(480, 480)).toBe(480);
    expect(helpers.stepDownLongSide(480, 320)).toBe(360);
    expect(helpers.stepDownLongSide(360, 320)).toBe(320);
  });
});
