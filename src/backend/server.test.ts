/** @vitest-environment node */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ffmpegBin,
  hasFfmpeg,
  makeTinyMp4,
  makeTinyWebm,
  MP4_HEAD,
  run,
  WEBM_HEAD,
} from '../test/videoFixtures';
import { PWA_JS } from './pwaAssets';
import { probeDurationSec, sniffVideoFormat } from './recordings';
import {
  convertedMp4Path,
  startLiteServer,
  store,
  type LiteServer,
} from './server';

const MP4_CONTAINERS = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'edts',
  'mvex',
  'moof',
  'traf',
  'dinf',
]);

type Mp4Box = { type: string; start: number; size: number; header: number };

function mp4Boxes(buf: Buffer, start: number, end: number): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    let header = 8;
    if (size === 1) {
      if (off + 16 > end) break;
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < header || off + size > end) break;
    boxes.push({
      type: buf.toString('latin1', off + 4, off + 8),
      start: off,
      size,
      header,
    });
    off += size;
  }
  return boxes;
}

/** Drop `ftyp` and fix chunk offsets so the file starts at `moov`, still playable. */
function moovFirst(buf: Buffer): Buffer {
  const top = mp4Boxes(buf, 0, buf.length);
  const ftyp = top[0];
  if (!ftyp || ftyp.type !== 'ftyp' || ftyp.start !== 0) {
    throw new Error('expected an ftyp box');
  }
  const out = Buffer.from(buf.subarray(ftyp.size));
  const shift = (start: number, end: number) => {
    for (const box of mp4Boxes(out, start, end)) {
      if (MP4_CONTAINERS.has(box.type)) {
        shift(box.start + box.header, box.start + box.size);
      } else if (box.type === 'stco' || box.type === 'co64') {
        const count = out.readUInt32BE(box.start + box.header + 4);
        let p = box.start + box.header + 8;
        for (let i = 0; i < count; i++) {
          if (box.type === 'stco') {
            out.writeUInt32BE(out.readUInt32BE(p) - ftyp.size, p);
            p += 4;
          } else {
            out.writeBigUInt64BE(out.readBigUInt64BE(p) - BigInt(ftyp.size), p);
            p += 8;
          }
        }
      }
    }
  };
  shift(0, out.length);
  return out;
}

describe('Lite HTTPS backend smoke', () => {
  it('phone pairing script parses', () => {
    expect(() => new vm.Script(PWA_JS)).not.toThrow();
  });

  it('derives the finished MP4 path from either source name', () => {
    expect(convertedMp4Path('/tmp/tr/dev.webm')).toBe('/tmp/tr/dev.mp4');
    expect(convertedMp4Path('/tmp/tr/dev.src.mp4')).toBe('/tmp/tr/dev.mp4');
    expect(() => convertedMp4Path('/tmp/tr/dev.mp4')).toThrow(/Unexpected/);
  });

  let server: LiteServer | null = null;

  afterEach(async () => {
    // Reset in-memory state between tests
    store.pairings.clear();
    store.devices.length = 0;
    store.tokens.clear();
    store.trials.clear();
    store.previews.clear();
    store.operatorLocale = 'en';
    store.localeReady = false;
    store.recordingQualityMode = 'auto';
    store.previewEnabled = true;
    store.linkProbes.clear();
    store.staleLinkProbes.clear();
    store.probeGeneration = 0;
    store.lastProbeGeneration.clear();
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('publishes the operator Locale and ignores an unknown one', async () => {
    server = await startLiteServer({ preferHttps: false });
    const base = `http://127.0.0.1:${server.port}`;
    expect(await (await fetch(`${base}/v1/locale`)).json()).toEqual({
      locale: 'en',
      ready: false,
    });
    const posted = await fetch(`${base}/v1/locale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'zh-Hant' }),
    });
    expect(posted.status).toBe(200);
    expect(await posted.json()).toEqual({ locale: 'zh-Hant', ready: true });
    const bad = await fetch(`${base}/v1/locale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'zh-TW' }),
    });
    expect(bad.status).toBe(400);
    expect(await (await fetch(`${base}/v1/locale`)).json()).toEqual({
      locale: 'zh-Hant',
      ready: true,
    });
    const health = await (await fetch(`${base}/v1/health`)).json();
    expect(health).not.toHaveProperty('operatorLocale');
    expect(health).not.toHaveProperty('locale');
  });

  it('serves health, pairing limit, mock complete, and shared start', async () => {
    server = await startLiteServer({ preferHttps: false });
    const base = `http://127.0.0.1:${server.port}`;

    const health = await fetch(`${base}/v1/health`);
    expect(health.ok).toBe(true);

    for (let i = 0; i < 3; i++) {
      const created = await fetch(`${base}/v1/device-pairings`, {
        method: 'POST',
      });
      expect(created.status).toBe(201);
      const mock = await fetch(`${base}/v1/device-pairings/mock-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_name: `Cam ${i + 1}` }),
      });
      expect(mock.ok).toBe(true);
    }

    const fourth = await fetch(`${base}/v1/device-pairings`, {
      method: 'POST',
    });
    expect(fourth.status).toBe(409);

    const devices = await (await fetch(`${base}/v1/devices`)).json();
    expect(devices.devices).toHaveLength(3);
    expect(
      devices.devices.map((d: { view_code: string }) => d.view_code),
    ).toEqual(['F', 'L', 'O']);

    const trial = await (
      await fetch(`${base}/v1/trials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'gait01' }),
      })
    ).json();

    await fetch(`${base}/v1/trials/${trial.trial_id}/arm`, { method: 'POST' });
    const started = await (
      await fetch(`${base}/v1/trials/${trial.trial_id}/start`, {
        method: 'POST',
      })
    ).json();
    expect(started.start_signal.startAtMs).toBeTypeOf('number');

    const pwa = await fetch(`${base}/pwa/`);
    expect(pwa.ok).toBe(true);
    const html = await pwa.text();
    expect(html).toContain('Pair this phone');
    expect(html).toContain('Show cameras');
    expect(html).toContain('Complete pairing');
    expect(html).toContain('camera-select');
    expect(html).toContain('Open secure camera page');
  });

  it('serves the phone page over HTTP while the desktop stays on HTTPS', async () => {
    server = await startLiteServer({ preferHttps: true, pagePort: 0 });
    expect(server.https).toBe(true);
    expect(server.apiBase.startsWith('https://')).toBe(true);
    expect(server.pwaBase.startsWith('http://')).toBe(true);

    const pagePort = new URL(server.pwaBase).port;
    const created = await fetch(
      `http://127.0.0.1:${pagePort}/v1/device-pairings`,
      { method: 'POST' },
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { qr_url: string };
    const qr = new URL(body.qr_url);
    expect(qr.protocol).toBe('http:');
    expect(qr.searchParams.get('api')).toBe(
      `http://${server.lanHost}:${pagePort}`,
    );
    expect(qr.searchParams.get('secure')).toBe(server.apiBase);
    expect(qr.searchParams.get('device_pairing_code')).toMatch(/^MCAP-/);

    const html = await (
      await fetch(`http://127.0.0.1:${pagePort}/pwa/`)
    ).text();
    expect(html).toContain('Pair this phone');
  });

  it('builds the QR from a public ngrok URL when one is given', async () => {
    server = await startLiteServer({ preferHttps: false });
    const base = `http://127.0.0.1:${server.port}`;

    const bad = await fetch(`${base}/v1/device-pairings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_base_url: 'http://abc.ngrok-free.app' }),
    });
    expect(bad.status).toBe(400);

    const created = await fetch(`${base}/v1/device-pairings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_base_url: 'https://abc.ngrok-free.app/' }),
    });
    expect(created.status).toBe(201);
    const qr = new URL(((await created.json()) as { qr_url: string }).qr_url);
    expect(qr.origin).toBe('https://abc.ngrok-free.app');
    expect(qr.pathname).toBe('/pwa/');
    expect(qr.searchParams.get('api')).toBe('https://abc.ngrok-free.app');
    expect(qr.searchParams.get('secure')).toBeNull();
  });

  it('standing mode heartbeat, fresh stills, and cropped + full PNGs', async () => {
    server = await startLiteServer({ preferHttps: false });
    const base = `http://127.0.0.1:${server.port}`;
    const json = { 'Content-Type': 'application/json' };

    const created = (await (
      await fetch(`${base}/v1/device-pairings`, { method: 'POST' })
    ).json()) as { id: string; code: string };
    const paired = (await (
      await fetch(`${base}/v1/device-pairings/${created.id}/complete`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ code: created.code }),
      })
    ).json()) as { device_id: string; device_pairing_token: string };
    const dev = paired.device_id;
    const auth = { Authorization: `Bearer ${paired.device_pairing_token}` };

    const poll = async () =>
      (await (
        await fetch(`${base}/v1/devices/${dev}/still-request`, {
          headers: auth,
        })
      ).json()) as { pending: boolean; standing: boolean };

    expect(await poll()).toMatchObject({
      pending: false,
      standing: false,
      livePose: false,
    });
    await fetch(`${base}/v1/devices/${dev}/standing-mode`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ active: true }),
    });
    expect((await poll()).standing).toBe(true);

    // A stale still from an earlier capture is dropped by a new request.
    store.setStill(dev, Buffer.from('old'));
    await fetch(`${base}/v1/devices/${dev}/still-request`, { method: 'POST' });
    expect((await fetch(`${base}/v1/devices/${dev}/still`)).status).toBe(404);
    expect((await poll()).pending).toBe(true);
    await fetch(`${base}/v1/devices/${dev}/still`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'image/png' },
      body: Buffer.from('new'),
    });
    const still = await fetch(`${base}/v1/devices/${dev}/still`);
    expect(Buffer.from(await still.arrayBuffer()).toString()).toBe('new');

    await fetch(`${base}/v1/devices/${dev}/standing-mode`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ active: false }),
    });
    expect((await poll()).standing).toBe(false);

    for (const [suffix, body] of [
      ['', 'crop'],
      ['/full', 'full'],
    ] as const) {
      const saved = await fetch(
        `${base}/v1/subjects/UG0001/standing/LL${suffix}?filename=x${suffix}.png`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: Buffer.from(body),
        },
      );
      expect(saved.ok).toBe(true);
    }
    const crop = await fetch(`${base}/v1/subjects/UG0001/standing/LL`);
    const full = await fetch(`${base}/v1/subjects/UG0001/standing/LL/full`);
    expect(await crop.text()).toBe('crop');
    expect(await full.text()).toBe('full');
    expect(store.getSubject('UG0001')?.standingFull.LL?.filename).toBe(
      'x/full.png',
    );
  });

  it('replaces accepted standing images together and preserves both on invalid uploads', async () => {
    server = await startLiteServer({ preferHttps: false });
    const base = `http://127.0.0.1:${server.port}`;
    const subjectId = 'retake-subject';
    store.saveStandingPng(
      subjectId,
      'LL',
      'old-crop.png',
      Buffer.from('old-crop'),
    );
    store.saveStandingPng(
      subjectId,
      'LL',
      'old-full.png',
      Buffer.from('old-full'),
      'full',
    );
    store.saveStandingPng(subjectId, 'F', 'front.png', Buffer.from('front'));

    try {
      for (const cropBytes of ['0', '4', 'invalid']) {
        const failed = await fetch(
          `${base}/v1/subjects/${subjectId}/standing/LL/pair?filename=new.png&fullFilename=new-full.png&cropBytes=${cropBytes}`,
          { method: 'POST', body: Buffer.from('crop') },
        );
        expect(failed.status).toBe(400);
        expect(store.getSubject(subjectId)?.standing.LL?.png.toString()).toBe(
          'old-crop',
        );
        expect(
          store.getSubject(subjectId)?.standingFull.LL?.png.toString(),
        ).toBe('old-full');
      }

      const { backendClient } = await import('../lib/backendClient');
      backendClient.setBaseUrl(base);
      await backendClient.saveStandingCapture(subjectId, 'LL', {
        filename: 'new crop.png',
        croppedPng: Buffer.from('new-crop'),
        fullFilename: 'new full.png',
        fullPng: Buffer.from('new-full'),
      });
      const crop = await fetch(`${base}/v1/subjects/${subjectId}/standing/LL`);
      const full = await fetch(
        `${base}/v1/subjects/${subjectId}/standing/LL/full`,
      );
      expect(await crop.text()).toBe('new-crop');
      expect(await full.text()).toBe('new-full');
      expect(store.getSubject(subjectId)?.standing.LL?.filename).toBe(
        'new crop.png',
      );
      expect(store.getSubject(subjectId)?.standingFull.LL?.filename).toBe(
        'new full.png',
      );
      expect(store.getSubject(subjectId)?.standing.F?.png.toString()).toBe(
        'front',
      );
    } finally {
      store.subjects.delete(subjectId);
    }
  });

  it('live pose heartbeat boosts the phone preview rate', async () => {
    server = await startLiteServer({ preferHttps: false });
    const base = `http://127.0.0.1:${server.port}`;
    const json = { 'Content-Type': 'application/json' };
    await fetch(`${base}/v1/device-pairings`, { method: 'POST' });
    const paired = (await (
      await fetch(`${base}/v1/device-pairings/mock-complete`, {
        method: 'POST',
      })
    ).json()) as { device_id: string; device_pairing_token: string };
    const dev = paired.device_id;
    const auth = { Authorization: `Bearer ${paired.device_pairing_token}` };
    const poll = async () =>
      (await (
        await fetch(`${base}/v1/devices/${dev}/still-request`, {
          headers: auth,
        })
      ).json()) as { livePose: boolean };
    const setLive = (active: boolean) =>
      fetch(`${base}/v1/devices/${dev}/live-pose-mode`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ active }),
      });

    expect((await poll()).livePose).toBe(false);
    expect((await setLive(true)).ok).toBe(true);
    expect((await poll()).livePose).toBe(true);
    await setLive(false);
    expect((await poll()).livePose).toBe(false);
    expect(
      (
        await fetch(`${base}/v1/devices/dev_missing/live-pose-mode`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ active: true }),
        })
      ).status,
    ).toBe(404);

    expect(PWA_JS).toContain("previewProfile('capture'");
    expect(PWA_JS).toMatch(/body\.livePose/);
  });

  it('session recording-quality GET/POST and link probes on still-request', async () => {
    server = await startLiteServer({ preferHttps: false });
    const base = `http://127.0.0.1:${server.port}`;
    const json = { 'Content-Type': 'application/json' };
    await fetch(`${base}/v1/device-pairings`, { method: 'POST' });
    const paired = (await (
      await fetch(`${base}/v1/device-pairings/mock-complete`, {
        method: 'POST',
      })
    ).json()) as { device_id: string; device_pairing_token: string };
    const dev = paired.device_id;
    const auth = { Authorization: `Bearer ${paired.device_pairing_token}` };

    const getQuality = async () =>
      (await (await fetch(`${base}/v1/session/recording-quality`)).json()) as {
        mode: string;
        resolved: string;
        previewEnabled: boolean;
        recommendation: string;
        estimates: Record<string, number>;
        probes: number;
      };

    expect(await getQuality()).toMatchObject({
      mode: 'auto',
      resolved: '720p',
      previewEnabled: true,
      recommendation: '720p',
      probes: 0,
      estimates: { '1080p': 0, '720p': 0, '480p': 0 },
    });

    const updated = await (
      await fetch(`${base}/v1/session/recording-quality`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ mode: '480p', previewEnabled: false }),
      })
    ).json();
    expect(updated).toMatchObject({
      mode: '480p',
      resolved: '480p',
      previewEnabled: false,
    });

    const stillPoll = async () =>
      (await (
        await fetch(`${base}/v1/devices/${dev}/still-request`, {
          headers: auth,
        })
      ).json()) as {
        probeRequested: boolean;
        recordingPreset: string;
        videoBitsPerSecond: number;
        previewEnabled: boolean;
      };

    const beforeProbe = await stillPoll();
    expect(beforeProbe.probeRequested).toBe(true);
    expect(beforeProbe.recordingPreset).toBe('480p');
    expect(beforeProbe.videoBitsPerSecond).toBe(1_750_000);
    expect(beforeProbe.previewEnabled).toBe(false);

    const bytesRes = await fetch(`${base}/v1/devices/${dev}/link-probe-bytes`, {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type': 'application/octet-stream',
      },
      body: Buffer.alloc(1024, 1),
    });
    expect(await bytesRes.json()).toEqual({ ok: true, received: 1024 });

    expect(
      (
        await fetch(`${base}/v1/devices/dev_missing/link-probe`, {
          method: 'POST',
          headers: { ...auth, ...json },
          body: JSON.stringify({
            width: 1920,
            height: 1080,
            frameRate: 30,
            uploadBytesPerSec: 2_000_000,
          }),
        })
      ).status,
    ).toBe(401);

    const probeSample = {
      width: 1920,
      height: 1080,
      frameRate: 30,
      uploadBytesPerSec: 2_000_000,
    };
    expect(
      await (
        await fetch(`${base}/v1/devices/${dev}/link-probe`, {
          method: 'POST',
          headers: { ...auth, ...json },
          body: JSON.stringify(probeSample),
        })
      ).json(),
    ).toEqual({ ok: true });

    expect((await stillPoll()).probeRequested).toBe(false);
    const withProbe = await getQuality();
    expect(withProbe.probes).toBe(1);
    expect(withProbe.resolved).toBe('480p');

    await fetch(`${base}/v1/session/recording-quality`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ mode: 'auto' }),
    });
    expect((await getQuality()).resolved).toBe('1080p');

    const refreshed = (await (
      await fetch(`${base}/v1/session/recording-quality`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ requestProbes: true }),
      })
    ).json()) as { probes: number; resolved: string; estimates: object };
    expect(refreshed.probes).toBe(0);
    // Pre-refresh sample still drives auto until the phone re-probes.
    expect(refreshed.resolved).toBe('1080p');
    expect(refreshed.estimates).toEqual({
      '1080p': 30,
      '720p': 30,
      '480p': 30,
    });
    expect((await stillPoll()).probeRequested).toBe(true);

    await fetch(`${base}/v1/devices/${dev}/link-probe`, {
      method: 'POST',
      headers: { ...auth, ...json },
      body: JSON.stringify({ ...probeSample, frameRate: 24 }),
    });
    expect((await stillPoll()).probeRequested).toBe(false);
    expect(await getQuality()).toMatchObject({
      probes: 1,
      resolved: '1080p',
      estimates: { '1080p': 24, '720p': 24, '480p': 24 },
    });
  });

  it('reports still progress: pending → sending → ready, or failed', async () => {
    server = await startLiteServer({ preferHttps: false });
    const base = `http://127.0.0.1:${server.port}`;
    await fetch(`${base}/v1/device-pairings`, { method: 'POST' });
    const paired = (await (
      await fetch(`${base}/v1/device-pairings/mock-complete`, {
        method: 'POST',
      })
    ).json()) as { device_id: string; device_pairing_token: string };
    const dev = paired.device_id;
    const auth = { Authorization: `Bearer ${paired.device_pairing_token}` };
    const desktopState = async () =>
      (await (await fetch(`${base}/v1/devices/${dev}/still`)).json()) as {
        state: string;
        error?: string;
      };
    const phonePoll = async () =>
      (await (
        await fetch(`${base}/v1/devices/${dev}/still-request`, {
          headers: auth,
        })
      ).json()) as { pending: boolean };

    await fetch(`${base}/v1/devices/${dev}/still-request`, { method: 'POST' });
    expect((await desktopState()).state).toBe('pending');
    // The phone claims the request once; later polls do not re-trigger it.
    expect((await phonePoll()).pending).toBe(true);
    expect((await phonePoll()).pending).toBe(false);
    expect((await desktopState()).state).toBe('sending');

    await fetch(`${base}/v1/devices/${dev}/still-error`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Encode failed' }),
    });
    expect(await desktopState()).toEqual({
      state: 'failed',
      error: 'Encode failed',
    });

    await fetch(`${base}/v1/devices/${dev}/still-request`, { method: 'POST' });
    expect((await phonePoll()).pending).toBe(true);
    await fetch(`${base}/v1/devices/${dev}/still`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'image/jpeg' },
      body: Buffer.from('jpeg'),
    });
    const ready = await fetch(`${base}/v1/devices/${dev}/still`);
    expect(ready.headers.get('content-type')).toBe('image/jpeg');
    expect(await ready.text()).toBe('jpeg');
  });

  it('CORS preflight allows every method the desktop client uses', async () => {
    server = await startLiteServer({ preferHttps: false });
    const base = `http://127.0.0.1:${server.port}`;
    const pre = await fetch(`${base}/v1/subjects/UG0001`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(pre.ok).toBe(true);
    const methods = pre.headers.get('access-control-allow-methods') ?? '';
    for (const m of ['GET', 'POST', 'PUT', 'DELETE']) {
      expect(methods).toContain(m);
    }
  });

  it('long-polls the preview until a newer frame arrives', async () => {
    server = await startLiteServer({ preferHttps: false });
    const base = `http://127.0.0.1:${server.port}`;
    await fetch(`${base}/v1/device-pairings`, { method: 'POST' });
    const paired = (await (
      await fetch(`${base}/v1/device-pairings/mock-complete`, {
        method: 'POST',
      })
    ).json()) as { device_id: string; device_pairing_token: string };
    const dev = paired.device_id;
    const upload = (body: string) =>
      fetch(`${base}/v1/devices/${dev}/preview`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paired.device_pairing_token}`,
          'Content-Type': 'image/jpeg',
        },
        body: Buffer.from(body),
      });

    await upload('one');
    const first = await fetch(`${base}/v1/devices/${dev}/preview?after=0`);
    expect(await first.text()).toBe('one');
    const firstAt = Number(first.headers.get('x-frame-at'));
    expect(firstAt).toBeGreaterThan(0);
    expect(first.headers.get('access-control-expose-headers')).toContain(
      'X-Frame-At',
    );

    const waiting = fetch(`${base}/v1/devices/${dev}/preview?after=${firstAt}`);
    await new Promise((r) => setTimeout(r, 50));
    await upload('two');
    const second = await waiting;
    expect(await second.text()).toBe('two');
    expect(Number(second.headers.get('x-frame-at'))).toBeGreaterThan(firstAt);
  });

  describe('trial recordings', () => {
    const json = { 'Content-Type': 'application/json' };
    let base = '';

    async function pair() {
      await fetch(`${base}/v1/device-pairings`, { method: 'POST' });
      const paired = (await (
        await fetch(`${base}/v1/device-pairings/mock-complete`, {
          method: 'POST',
        })
      ).json()) as { device_id: string; device_pairing_token: string };
      return {
        id: paired.device_id,
        auth: { Authorization: `Bearer ${paired.device_pairing_token}` },
      };
    }

    async function startedTrial(name = 'gait01') {
      const trial = (await (
        await fetch(`${base}/v1/trials`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ name }),
        })
      ).json()) as { trial_id: string };
      await fetch(`${base}/v1/trials/${trial.trial_id}/arm`, {
        method: 'POST',
      });
      await fetch(`${base}/v1/trials/${trial.trial_id}/start`, {
        method: 'POST',
      });
      return trial.trial_id;
    }

    const active = async () =>
      (await (await fetch(`${base}/v1/trials/active`)).json()) as {
        server_now: number;
        trial: { trial_id: string; phase: string } | null;
      };

    type Cam = { status: string; error?: string; bytes: number };
    const statuses = async (tid: string) =>
      (
        (await (await fetch(`${base}/v1/trials/${tid}`)).json()) as {
          uploads: Record<string, Cam>;
        }
      ).uploads;

    const upload = (
      dev: { id: string; auth: Record<string, string> },
      tid: string,
      body: Buffer,
    ) =>
      fetch(`${base}/v1/devices/${dev.id}/trials/${tid}/upload`, {
        method: 'POST',
        headers: {
          ...dev.auth,
          'Content-Type': 'application/octet-stream',
          'X-Filename': `trial_${tid}.webm`,
        },
        body: new Uint8Array(body),
      });

    async function until(check: () => Promise<boolean>, ms = 15_000) {
      const end = Date.now() + ms;
      while (!(await check())) {
        if (Date.now() > end) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    it('keeps a stopped trial visible to phones with the server clock', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      await pair();
      expect((await active()).trial).toBeNull();
      expect((await active()).server_now).toBeTypeOf('number');

      const tid = await startedTrial();
      const before = Date.now();
      const rec = await active();
      expect(rec.trial).toMatchObject({ trial_id: tid, phase: 'recording' });
      expect(Math.abs(rec.server_now - before)).toBeLessThan(1000);

      await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });
      expect((await active()).trial).toMatchObject({
        trial_id: tid,
        phase: 'done',
      });

      // 30 s after Stop the trial drops out of the phones' poll.
      const trial = store.trials.get(tid)!;
      trial.stoppedAt = Date.now() - 31_000;
      expect((await active()).trial).toBeNull();
    });

    it('cancel during the countdown tells phones and drops the trial', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      const dev = await pair();
      const tid = await startedTrial();
      const res = await fetch(`${base}/v1/trials/${tid}/cancel`, {
        method: 'POST',
      });
      expect(res.ok).toBe(true);
      expect((await active()).trial).toMatchObject({
        trial_id: tid,
        phase: 'cancelled',
      });
      expect((await upload(dev, tid, MP4_HEAD)).status).toBe(409);
      const list = (await (await fetch(`${base}/v1/trials`)).json()) as {
        trials: Array<{ id: string }>;
      };
      expect(list.trials.map((t) => t.id)).not.toContain(tid);
    });

    it('a dropped upload stays retryable, and the next trial still accepts video', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      const dev = await pair();
      const tid = await startedTrial();
      await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });

      await new Promise<void>((resolve) => {
        const req = http.request(
          `${base}/v1/devices/${dev.id}/trials/${tid}/upload`,
          {
            method: 'POST',
            headers: {
              ...dev.auth,
              'Content-Type': 'application/octet-stream',
              'X-Filename': `trial_${tid}.mp4`,
            },
          },
          () => resolve(),
        );
        req.write(MP4_HEAD);
        req.write(Buffer.alloc(64 * 1024, 1));
        setTimeout(() => req.destroy(), 30);
        req.on('error', () => resolve());
      });
      await until(
        async () => (await statuses(tid))[dev.id]?.status === 'uploading',
      );
      expect((await statuses(tid))[dev.id].error).toBeUndefined();
      // Let the reset request finish deleting its .part file before retrying.
      await new Promise((r) => setTimeout(r, 50));

      const again = await upload(dev, tid, MP4_HEAD);
      expect(again.ok).toBe(true);
      expect((await statuses(tid))[dev.id].status).toBe('ready');

      const next = await startedTrial('gait01');
      await fetch(`${base}/v1/trials/${next}/stop`, { method: 'POST' });
      expect((await statuses(next))[dev.id].status).toBe('recording');
      expect((await upload(dev, next, MP4_HEAD)).ok).toBe(true);
      expect((await statuses(next))[dev.id].status).toBe('ready');
    });

    it('streams an MP4 upload to disk and serves it back', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      const dev = await pair();
      const tid = await startedTrial();
      expect((await statuses(tid))[dev.id].status).toBe('recording');
      await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });

      const body = Buffer.concat([MP4_HEAD, Buffer.from('frames')]);
      const res = await upload(dev, tid, body);
      expect(res.ok).toBe(true);
      expect((await statuses(tid))[dev.id]).toMatchObject({
        status: 'ready',
        bytes: body.length,
      });
      const file = store.getUpload(tid, dev.id)!.path!;
      expect(path.basename(file)).toBe(`${dev.id}.mp4`);
      expect(path.basename(path.dirname(file))).toBe(tid);
      expect(existsSync(file)).toBe(true);
      expect(store.getUpload(tid, dev.id)).not.toHaveProperty('data');

      const back = await fetch(
        `${base}/v1/devices/${dev.id}/trials/${tid}/upload`,
      );
      expect(back.headers.get('content-type')).toBe('video/mp4');
      expect(back.headers.get('accept-ranges')).toBe('bytes');
      expect(Buffer.from(await back.arrayBuffer()).equals(body)).toBe(true);

      // <video> seeks with Range requests.
      const part = await fetch(
        `${base}/v1/devices/${dev.id}/trials/${tid}/upload`,
        { headers: { Range: 'bytes=2-5' } },
      );
      expect(part.status).toBe(206);
      expect(part.headers.get('content-range')).toBe(
        `bytes 2-5/${body.length}`,
      );
      expect(
        Buffer.from(await part.arrayBuffer()).equals(body.subarray(2, 6)),
      ).toBe(true);
      const bad = await fetch(
        `${base}/v1/devices/${dev.id}/trials/${tid}/upload`,
        { headers: { Range: `bytes=${body.length + 10}-` } },
      );
      expect(bad.status).toBe(416);
    });

    it('reports the announced upload size while uploading', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      const dev = await pair();
      const tid = await startedTrial();
      store.beginUpload(tid, dev.id, 'a.webm', 1234);
      store.uploadProgress(tid, dev.id, 600);
      expect((await statuses(tid))[dev.id]).toMatchObject({
        status: 'uploading',
        bytes: 600,
        totalBytes: 1234,
      });
      store.uploadConverting(tid, dev.id, 1234);
      store.conversionProgress(tid, dev.id, 0.25);
      const conv = (await statuses(tid))[dev.id] as Cam & {
        convertProgress?: number;
        totalBytes?: number;
      };
      expect(conv.status).toBe('converting');
      expect(conv.convertProgress).toBe(0.25);
      expect(conv.totalBytes).toBeUndefined();
    });

    it.skipIf(!hasFfmpeg)(
      'converts a WebM upload to MP4 in the background',
      async () => {
        server = await startLiteServer({
          preferHttps: false,
          ffmpegPath: ffmpegBin,
        });
        base = `http://127.0.0.1:${server.port}`;
        const dev = await pair();
        const tid = await startedTrial();
        await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcl-webm-'));
        try {
          const webm = path.join(dir, 'in.webm');
          await makeTinyWebm(webm);
          expect((await upload(dev, tid, await fs.readFile(webm))).ok).toBe(
            true,
          );
        } finally {
          await fs.rm(dir, { recursive: true, force: true });
        }
        expect(['converting', 'ready']).toContain(
          (await statuses(tid))[dev.id].status,
        );
        await until(
          async () => (await statuses(tid))[dev.id].status === 'ready',
        );
        const file = store.getUpload(tid, dev.id)!.path!;
        expect(file.endsWith('.mp4')).toBe(true);
        expect((await statuses(tid))[dev.id]).toMatchObject({
          filename: `trial_${tid}.mp4`,
        });
        expect(await fs.readdir(path.dirname(file))).toEqual([`${dev.id}.mp4`]);
        const head = Buffer.from(
          await (
            await fetch(`${base}/v1/devices/${dev.id}/trials/${tid}/upload`)
          ).arrayBuffer(),
        ).subarray(0, 12);
        expect(sniffVideoFormat(head)).toBe('mp4');
      },
    );

    it.skipIf(!hasFfmpeg)(
      'remuxes an MP4 that starts with moov into a normal MP4',
      async () => {
        server = await startLiteServer({
          preferHttps: false,
          ffmpegPath: ffmpegBin,
        });
        base = `http://127.0.0.1:${server.port}`;
        const dev = await pair();
        const tid = await startedTrial();
        await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcl-moov-'));
        try {
          const src = path.join(dir, 'in.mp4');
          await run(ffmpegBin, [
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'lavfi',
            '-i',
            'testsrc=size=64x64:rate=30',
            '-t',
            '0.5',
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-an',
            '-movflags',
            '+faststart',
            '-f',
            'mp4',
            '-y',
            src,
          ]);
          const moved = moovFirst(await fs.readFile(src));
          expect(moved.subarray(4, 8).toString('latin1')).toBe('moov');
          expect(sniffVideoFormat(moved.subarray(0, 12))).toBe('mp4-raw');
          expect((await upload(dev, tid, moved)).ok).toBe(true);
        } finally {
          await fs.rm(dir, { recursive: true, force: true });
        }
        await until(async () => {
          const hit = (await statuses(tid))[dev.id];
          if (hit.status === 'failed') throw new Error(hit.error);
          return hit.status === 'ready';
        });
        const file = store.getUpload(tid, dev.id)!.path!;
        expect(file.endsWith('.mp4')).toBe(true);
        expect(file.endsWith('.src.mp4')).toBe(false);
        expect(await fs.readdir(path.dirname(file))).toEqual([`${dev.id}.mp4`]);
        const served = Buffer.from(
          await (
            await fetch(`${base}/v1/devices/${dev.id}/trials/${tid}/upload`)
          ).arrayBuffer(),
        );
        expect(sniffVideoFormat(served.subarray(0, 12))).toBe('mp4');
        expect(await probeDurationSec(ffmpegBin, file)).toBeGreaterThan(0.2);
      },
      15_000,
    );

    it('refuses to trim until every view has a video', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      const a = await pair();
      const b = await pair();
      const tid = await startedTrial();
      await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });
      expect((await upload(a, tid, MP4_HEAD)).ok).toBe(true);
      const res = await fetch(`${base}/v1/trials/${tid}/trim`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ start_sec: 0, end_sec: 1 }),
      });
      expect(res.status).toBe(409);
      expect((await statuses(tid))[a.id].status).toBe('ready');
      expect((await statuses(tid))[b.id].status).toBe('recording');
    });

    it.skipIf(!hasFfmpeg)(
      'replaces every view with the same trimmed length',
      async () => {
        server = await startLiteServer({
          preferHttps: false,
          ffmpegPath: ffmpegBin,
        });
        base = `http://127.0.0.1:${server.port}`;
        const a = await pair();
        const b = await pair();
        const tid = await startedTrial();
        await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcl-trim-api-'));
        const longPath = path.join(dir, 'long.mp4');
        const shortPath = path.join(dir, 'short.mp4');
        try {
          await makeTinyMp4(longPath, 1.2);
          await makeTinyMp4(shortPath, 1);
          expect((await upload(a, tid, await fs.readFile(longPath))).ok).toBe(
            true,
          );
          expect((await upload(b, tid, await fs.readFile(shortPath))).ok).toBe(
            true,
          );
          const oldA = store.getUpload(tid, a.id)!.path!;
          const oldB = store.getUpload(tid, b.id)!.path!;
          const res = await fetch(`${base}/v1/trials/${tid}/trim`, {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ start_sec: 0.2, end_sec: 0.8 }),
          });
          expect(res.status).toBe(200);
          const body = (await res.json()) as {
            duration_sec: number;
            views: number;
          };
          expect(body.views).toBe(2);
          expect(body.duration_sec).toBeCloseTo(0.6, 2);
          const nextA = store.getUpload(tid, a.id)!;
          const nextB = store.getUpload(tid, b.id)!;
          expect(nextA.status).toBe('ready');
          expect(nextB.status).toBe('ready');
          expect(nextA.path).not.toBe(oldA);
          expect(nextA.originalPath).toBe(oldA);
          expect(nextB.originalPath).toBe(oldB);
          expect(existsSync(oldA)).toBe(true);
          expect(existsSync(oldB)).toBe(true);
          expect((await statuses(tid))[a.id]).toMatchObject({ trimmed: true });
          const durA = await probeDurationSec(ffmpegBin, nextA.path!);
          const durB = await probeDurationSec(ffmpegBin, nextB.path!);
          expect(Math.abs(durA - durB)).toBeLessThan(1 / 30);
          const served = Buffer.from(
            await (
              await fetch(`${base}/v1/devices/${a.id}/trials/${tid}/upload`)
            ).arrayBuffer(),
          );
          expect(sniffVideoFormat(served.subarray(0, 16))).toBe('mp4');
          expect(served.length).toBe(nextA.bytes);

          const tooFar = await fetch(`${base}/v1/trials/${tid}/trim`, {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ start_sec: 0, end_sec: 5 }),
          });
          expect(tooFar.status).toBe(400);
          expect(store.getUpload(tid, a.id)!.path).toBe(nextA.path);
          expect(store.getUpload(tid, a.id)!.originalPath).toBe(oldA);

          const again = await fetch(`${base}/v1/trials/${tid}/trim`, {
            method: 'POST',
            headers: json,
            body: JSON.stringify({ start_sec: 0.1, end_sec: 0.4 }),
          });
          expect(again.status).toBe(200);
          expect(store.getUpload(tid, a.id)!.originalPath).toBe(oldA);
          expect(await fs.readFile(oldA)).toEqual(await fs.readFile(longPath));

          const restored = await fetch(`${base}/v1/trials/${tid}/revert`, {
            method: 'POST',
          });
          expect(restored.status).toBe(200);
          const restoredBody = (await restored.json()) as { views: number };
          expect(restoredBody.views).toBe(2);
          expect(store.getUpload(tid, a.id)!.path).toBe(oldA);
          expect(store.getUpload(tid, b.id)!.path).toBe(oldB);
          expect((await statuses(tid))[a.id]).not.toMatchObject({
            trimmed: true,
          });
          const back = Buffer.from(
            await (
              await fetch(`${base}/v1/devices/${a.id}/trials/${tid}/upload`)
            ).arrayBuffer(),
          );
          expect(back.equals(await fs.readFile(longPath))).toBe(true);
          const durBackA = await probeDurationSec(ffmpegBin, oldA);
          const durBackB = await probeDurationSec(ffmpegBin, oldB);
          expect(durBackA).toBeGreaterThan(durBackB);

          const twice = await fetch(`${base}/v1/trials/${tid}/revert`, {
            method: 'POST',
          });
          expect(twice.status).toBe(409);
        } finally {
          await fs.rm(dir, { recursive: true, force: true });
        }
      },
      30_000,
    );

    it('fails a WebM upload clearly when ffmpeg is missing', async () => {
      server = await startLiteServer({
        preferHttps: false,
        ffmpegPath: '/nonexistent/ffmpeg',
      });
      base = `http://127.0.0.1:${server.port}`;
      const dev = await pair();
      const tid = await startedTrial();
      await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });
      expect((await upload(dev, tid, WEBM_HEAD)).ok).toBe(true);
      await until(
        async () => (await statuses(tid))[dev.id].status === 'failed',
      );
      expect((await statuses(tid))[dev.id].error).toMatch(/ffmpeg/i);
    });

    it('rejects uploads that are not video and marks the camera failed', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      const dev = await pair();
      const tid = await startedTrial();
      await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });
      const body = Buffer.from('nope');
      expect((await upload(dev, tid, body)).status).toBe(400);
      expect((await statuses(tid))[dev.id]).toMatchObject({
        status: 'failed',
        error: `Upload is not MP4 or WebM (${body.length} bytes, head ${body.toString('hex')})`,
      });
    });

    it('rejects an empty upload with a clear message', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      const dev = await pair();
      const tid = await startedTrial();
      await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });
      expect((await upload(dev, tid, Buffer.alloc(0))).status).toBe(400);
      expect((await statuses(tid))[dev.id]).toMatchObject({
        status: 'failed',
        error: 'Phone sent an empty recording',
      });
    });

    it('marks a silent camera failed 60 s after Stop, and records phone errors', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      const a = await pair();
      const b = await pair();
      const tid = await startedTrial();
      await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });
      expect((await statuses(tid))[a.id].status).toBe('recording');

      const err = await fetch(
        `${base}/v1/devices/${b.id}/trials/${tid}/upload-error`,
        {
          method: 'POST',
          headers: { ...b.auth, ...json },
          body: JSON.stringify({ error: 'Network lost' }),
        },
      );
      expect(err.ok).toBe(true);

      const trial = store.trials.get(tid)!;
      trial.stoppedAt = Date.now() - 61_000;
      trial.uploads[a.id].at = Date.now() - 61_000;
      const s = await statuses(tid);
      expect(s[a.id]).toMatchObject({ status: 'failed' });
      expect(s[a.id].error).toMatch(/60 s/);
      expect(s[b.id]).toMatchObject({
        status: 'failed',
        error: 'Network lost',
      });

      // A later successful retry still wins.
      expect((await upload(b, tid, MP4_HEAD)).ok).toBe(true);
      expect((await statuses(tid))[b.id].status).toBe('ready');
    });

    it('deletes a trial’s files after Save and everything on close', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      const dev = await pair();
      const t1 = await startedTrial('gait01');
      await fetch(`${base}/v1/trials/${t1}/stop`, { method: 'POST' });
      await upload(dev, t1, MP4_HEAD);
      const t2 = await startedTrial('gait02');
      await fetch(`${base}/v1/trials/${t2}/stop`, { method: 'POST' });
      await upload(dev, t2, MP4_HEAD);
      const f1 = store.getUpload(t1, dev.id)!.path!;
      const f2 = store.getUpload(t2, dev.id)!.path!;

      const del = await fetch(`${base}/v1/trials/${t1}/recordings`, {
        method: 'DELETE',
      });
      expect(del.ok).toBe(true);
      expect(existsSync(path.dirname(f1))).toBe(false);
      expect((await statuses(t1))[dev.id].status).toBe('cleared');
      expect(
        (await fetch(`${base}/v1/devices/${dev.id}/trials/${t1}/upload`))
          .status,
      ).toBe(404);
      expect(existsSync(f2)).toBe(true);

      const launchDir = path.dirname(path.dirname(f2));
      await server.close();
      server = null;
      expect(existsSync(launchDir)).toBe(false);
    });

    /** The real phone script in a VM with a fake camera and MP4 recorder. */
    function runPhone(creds: { id: string; token: string }, skewMs = 0) {
      let dead = false;
      const RealDate = Date;
      class PhoneDate extends RealDate {
        static now() {
          return RealDate.now() + skewMs;
        }
      }
      const els = new Map<string, Record<string, unknown>>();
      const listeners = new Map<string, () => void>();
      const el = (id = '') => {
        const node: Record<string, unknown> & { options: unknown[] } = {
          id,
          textContent: '',
          className: '',
          hidden: false,
          disabled: false,
          value: '',
          options: [],
          selectedIndex: 0,
          videoWidth: 0,
          videoHeight: 0,
          addEventListener(type: string, fn: () => void) {
            listeners.set(`${id}:${type}`, fn);
          },
          appendChild(child: unknown) {
            node.options.push(child);
          },
          play: async () => {},
          getContext: () => ({ drawImage() {} }),
        };
        Object.defineProperty(node, 'innerHTML', {
          set: () => {
            node.options.length = 0;
          },
        });
        return node;
      };
      // Fake phone with a back and a front camera.
      const cameras = [
        { kind: 'videoinput', deviceId: 'cam-back', label: 'Back Camera' },
        { kind: 'videoinput', deviceId: 'cam-front', label: 'Front Camera' },
      ];
      const opened: string[] = [];
      const getUserMedia = async (c: {
        video: { deviceId?: { exact: string } };
      }) => {
        const id = c.video.deviceId?.exact ?? 'cam-back';
        opened.push(id);
        const track = {
          stop() {},
          getSettings: () => ({ deviceId: id }),
          applyConstraints: async () => {},
        };
        return { getTracks: () => [track], getVideoTracks: () => [track] };
      };
      type FakeRec = {
        state: string;
        startedAt?: number;
        ondataavailable?: (ev: { data: Blob }) => void;
        onstop?: () => void;
      };
      const recorders: FakeRec[] = [];
      class FakeRecorder {
        static isTypeSupported = (t: string) => t === 'video/mp4';
        state = 'inactive';
        startedAt?: number;
        ondataavailable?: (ev: { data: Blob }) => void;
        onstop?: () => void;
        constructor(
          _stream: unknown,
          readonly opts: { mimeType?: string },
        ) {
          recorders.push(this);
        }
        get mimeType() {
          return this.opts.mimeType ?? '';
        }
        start() {
          this.state = 'recording';
          this.startedAt = Date.now();
        }
        stop() {
          this.state = 'inactive';
          this.ondataavailable?.({
            data: new Blob([new Uint8Array(MP4_HEAD), 'frames']),
          });
          this.onstop?.();
        }
      }
      const saved: Record<string, string> = {
        mcl_device_id: creds.id,
        mcl_token: creds.token,
      };
      const guard =
        <A extends unknown[]>(fn: (...a: A) => unknown) =>
        (...a: A) => {
          if (!dead) fn(...a);
        };
      const ctx: Record<string, unknown> = {
        document: {
          getElementById: (id: string) => {
            if (!els.has(id)) els.set(id, el(id));
            return els.get(id);
          },
          createElement: () => el(),
        },
        localStorage: {
          getItem: (k: string) => saved[k] ?? null,
          setItem() {},
          removeItem() {},
        },
        location: { search: '', origin: base },
        navigator: {
          mediaDevices: {
            getUserMedia,
            enumerateDevices: async () => cameras,
          },
        },
        isSecureContext: true,
        MediaRecorder: FakeRecorder,
        fetch: (...a: Parameters<typeof fetch>) =>
          dead ? new Promise(() => {}) : fetch(...a),
        setTimeout: (fn: () => void, ms: number) => setTimeout(guard(fn), ms),
        setInterval: (fn: () => void, ms: number) => {
          const id = setInterval(() => (dead ? clearInterval(id) : fn()), ms);
          return id;
        },
        clearTimeout,
        clearInterval,
        Date: PhoneDate,
        URLSearchParams,
        URL,
        Headers,
        Blob,
        AbortController,
        console,
      };
      ctx.window = ctx;
      vm.runInNewContext(PWA_JS, ctx);
      return {
        recorders,
        opened,
        node: (id: string) => els.get(id)!,
        pickCamera: (id: string) => {
          els.get('camera-select')!.value = id;
          listeners.get('camera-select:change')!();
        },
        text: (id: string) => String(els.get(id)?.textContent ?? ''),
        kill: () => {
          dead = true;
        },
      };
    }

    it('a phone 5 s behind counts down, records at the shared start, stops and uploads', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      const dev = await pair();
      const phone = runPhone(
        { id: dev.id, token: dev.auth.Authorization.slice('Bearer '.length) },
        -5000,
      );
      try {
        await until(async () => phone.text('status').startsWith('Paired'));
        const tid = await startedTrial();
        const startAtMs = store.trials.get(tid)!.startSignal!.startAtMs;
        expect(startAtMs - Date.now()).toBeGreaterThan(2500);
        await until(async () =>
          phone.text('rec-pill').startsWith('Starting in'),
        );
        expect(phone.recorders[0].state).toBe('inactive');
        await until(
          async () => phone.recorders[0]?.state === 'recording',
          5000,
        );
        expect(
          Math.abs(phone.recorders[0].startedAt! - startAtMs),
        ).toBeLessThan(100);
        expect(phone.text('rec-pill')).toBe('REC');

        await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });
        await until(
          async () => (await statuses(tid))[dev.id].status === 'ready',
        );
        expect(phone.recorders[0].state).toBe('inactive');
        expect(path.extname(store.getUpload(tid, dev.id)!.path!)).toBe('.mp4');
        await until(async () => phone.text('rec-pill') === 'Uploaded');

        // Stop during the countdown: the phone never starts recording.
        const t2 = await startedTrial('gait02');
        await until(async () => phone.recorders.length === 2);
        await fetch(`${base}/v1/trials/${t2}/cancel`, { method: 'POST' });
        await until(async () =>
          phone.text('status').startsWith('Trial cancelled'),
        );
        await new Promise((r) => setTimeout(r, 3200));
        expect(phone.recorders[1].state).toBe('inactive');
        expect(phone.recorders[1].startedAt).toBeUndefined();
      } finally {
        phone.kill();
      }
    }, 20_000);

    it('switches to another phone camera between trials, never during one', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      const dev = await pair();
      const phone = runPhone({
        id: dev.id,
        token: dev.auth.Authorization.slice('Bearer '.length),
      });
      const select = phone.node('camera-select');
      const nameOf = () =>
        store.devices.find((d) => d.deviceId === dev.id)!.name;
      try {
        await until(async () => select.hidden === false);
        expect((select.options as unknown[]).length).toBe(2);
        expect(select.value).toBe('cam-back');
        expect(select.disabled).toBe(false);

        phone.pickCamera('cam-front');
        await until(async () => nameOf() === 'Front Camera');
        expect(phone.opened.at(-1)).toBe('cam-front');
        expect(select.value).toBe('cam-front');
        expect(phone.text('status')).toBe('Paired. Camera is live.');

        const tid = await startedTrial();
        await until(async () =>
          phone.text('rec-pill').startsWith('Starting in'),
        );
        expect(select.disabled).toBe(true);
        const opens = phone.opened.length;
        phone.pickCamera('cam-back');
        expect(phone.text('pair-err')).toMatch(/Wait until recording/);
        expect(select.value).toBe('cam-front');

        await until(
          async () => phone.recorders[0]?.state === 'recording',
          5000,
        );
        await fetch(`${base}/v1/trials/${tid}/stop`, { method: 'POST' });
        await until(async () => phone.text('rec-pill') === 'Uploaded');
        expect(phone.opened.length).toBe(opens);
        expect(select.disabled).toBe(false);

        phone.pickCamera('cam-back');
        await until(async () => nameOf() === 'Back Camera');
        expect(phone.opened.at(-1)).toBe('cam-back');
      } finally {
        phone.kill();
      }
    }, 20_000);

    it('only lets the paired phone rename its camera', async () => {
      server = await startLiteServer({ preferHttps: false });
      base = `http://127.0.0.1:${server.port}`;
      const a = await pair();
      const b = await pair();
      const rename = (as: typeof a, name: unknown) =>
        fetch(`${base}/v1/devices/${a.id}/camera`, {
          method: 'POST',
          headers: { ...as.auth, ...json },
          body: JSON.stringify({ name }),
        });
      expect((await rename(b, 'Front Camera')).status).toBe(401);
      expect((await rename(a, '   ')).status).toBe(400);
      const ok = await rename(a, '  Front Camera ');
      expect(ok.status).toBe(200);
      expect(store.devices.find((d) => d.deviceId === a.id)!.name).toBe(
        'Front Camera',
      );
    });

    it('sweeps earlier launch folders under the recordings root', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcl-root-'));
      try {
        await fs.mkdir(path.join(root, 'launch-stale', 'tr_x'), {
          recursive: true,
        });
        server = await startLiteServer({
          preferHttps: false,
          recordingsRoot: root,
        });
        const entries = await fs.readdir(root);
        expect(entries).toHaveLength(1);
        expect(entries[0]).not.toBe('launch-stale');
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  });

  it('imports an MP4 without pairing and serves it on the trial upload URL', async () => {
    server = await startLiteServer({ preferHttps: false });
    const base = `http://127.0.0.1:${server.port}`;
    const body = Buffer.concat([MP4_HEAD, Buffer.from('imported-frames')]);
    const first = await fetch(
      `${base}/v1/imports?fresh=1&name=walk&filename=walk.mp4`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4' },
        body,
      },
    );
    expect(first.status).toBe(201);
    const created = (await first.json()) as {
      trial_id: string;
      name: string;
      device_id: string;
      cam_index: number;
      view_code: string | null;
      bytes: number;
      devices: Array<{ device_id: string; view_code: string | null }>;
    };
    expect(created.name).toBe('walk');
    expect(created.cam_index).toBe(0);
    expect(created.view_code).toBeNull();
    expect(created.bytes).toBe(body.length);
    expect(created.devices).toHaveLength(1);

    const back = await fetch(
      `${base}/v1/devices/${created.device_id}/trials/${created.trial_id}/upload`,
    );
    expect(back.headers.get('content-type')).toBe('video/mp4');
    expect(Buffer.from(await back.arrayBuffer()).equals(body)).toBe(true);
    const active = (await (await fetch(`${base}/v1/trials/active`)).json()) as {
      trial: unknown;
    };
    expect(active.trial).toBeNull();

    const side = Buffer.concat([MP4_HEAD, Buffer.from('side')]);
    const second = await fetch(
      `${base}/v1/imports?trial_id=${created.trial_id}&name=walk&filename=side.mp4`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4' },
        body: side,
      },
    );
    expect(second.status).toBe(201);
    const added = (await second.json()) as {
      devices: Array<{
        device_id: string;
        cam_index: number;
        view_code: string;
      }>;
    };
    expect(added.devices.map((d) => d.view_code)).toEqual(['F', 'L']);
    expect(added.devices.map((d) => d.cam_index)).toEqual([0, 1]);

    const rejected = await fetch(
      `${base}/v1/imports?fresh=1&name=nope&filename=notes.txt`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: Buffer.from('nope'),
      },
    );
    expect(rejected.status).toBe(400);

    // Phone uploads may remux a moov-first MP4. Desktop import stays ftyp-only.
    const moov = Buffer.alloc(12);
    moov.writeUInt32BE(12, 0);
    moov.write('moov', 4);
    const rawMp4 = await fetch(
      `${base}/v1/imports?fresh=1&name=raw&filename=raw.mp4`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4' },
        body: moov,
      },
    );
    expect(rawMp4.status).toBe(400);
    expect(((await rawMp4.json()) as { error: string }).error).toBe(
      'Only MP4 files can be imported',
    );
  });

  it('serves offline MediaPipe assets and refuses paths outside the folder', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcl-mp-'));
    await fs.mkdir(path.join(dir, 'wasm'));
    await fs.writeFile(
      path.join(dir, 'wasm', 'vision_wasm_internal.wasm'),
      'w',
    );
    await fs.writeFile(path.join(dir, 'pose_landmarker_full.task'), 'm');

    server = await startLiteServer({ preferHttps: false, mediapipeDir: dir });
    const base = `http://127.0.0.1:${server.port}`;
    const wasm = await fetch(
      `${base}/mediapipe/wasm/vision_wasm_internal.wasm`,
    );
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
    expect(wasm.headers.get('access-control-allow-origin')).toBe('*');
    expect(await wasm.text()).toBe('w');
    expect(
      (await fetch(`${base}/mediapipe/pose_landmarker_full.task`)).ok,
    ).toBe(true);
    expect(
      (await fetch(`${base}/mediapipe/..%2F..%2Fsecret.task`)).status,
    ).toBe(404);
  });
});
