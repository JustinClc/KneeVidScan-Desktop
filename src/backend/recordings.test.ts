/** @vitest-environment node */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ffmpegBin,
  hasFfmpeg,
  makeTinyMp4,
  makeTinyWebm,
  MP4_HEAD,
  run,
  WEBM_HEAD,
} from '../test/videoFixtures';
import {
  convertToMp4,
  parseDurationSeconds,
  parseProgressSeconds,
  probeDurationSec,
  RecordingFiles,
  sniffVideoFormat,
  trimCopies,
} from './recordings';

function boxHead(type: string): Buffer {
  const head = Buffer.alloc(12);
  head.writeUInt32BE(12, 0);
  head.write(type, 4, 4, 'latin1');
  return head;
}

describe('sniffVideoFormat', () => {
  it('tells a finished MP4 from WebM by magic bytes', () => {
    expect(sniffVideoFormat(MP4_HEAD)).toBe('mp4');
    expect(sniffVideoFormat(WEBM_HEAD)).toBe('webm');
    expect(sniffVideoFormat(Buffer.from('not a video'))).toBeNull();
    expect(sniffVideoFormat(Buffer.alloc(0))).toBeNull();
  });

  it('treats other ISO BMFF boxes as MP4 that still needs a remux', () => {
    for (const type of [
      'styp',
      'moov',
      'moof',
      'mdat',
      'free',
      'skip',
      'wide',
    ]) {
      expect(sniffVideoFormat(boxHead(type))).toBe('mp4-raw');
    }
    expect(sniffVideoFormat(boxHead('ftyp'))).toBe('mp4');
    expect(sniffVideoFormat(boxHead('uuid'))).toBeNull();
  });
});

describe('RecordingFiles', () => {
  const made: RecordingFiles[] = [];
  const roots: string[] = [];
  afterEach(async () => {
    for (const r of made.splice(0)) await r.close();
    for (const r of roots.splice(0)) {
      await fs.rm(r, { recursive: true, force: true });
    }
  });

  it('streams an upload to <trial>/<device>.<format> via a .part file', async () => {
    const files = await RecordingFiles.create();
    made.push(files);
    const seen: number[] = [];
    const saved = await files.write(
      'tr_1',
      'dev_1',
      Readable.from([MP4_HEAD, Buffer.from('rest')]),
      (bytes) => seen.push(bytes),
    );
    expect(saved.format).toBe('mp4');
    expect(saved.bytes).toBe(MP4_HEAD.length + 4);
    expect(saved.path).toBe(path.join(files.dir, 'tr_1', 'dev_1.mp4'));
    expect(seen.at(-1)).toBe(saved.bytes);
    expect(await fs.readdir(path.join(files.dir, 'tr_1'))).toEqual([
      'dev_1.mp4',
    ]);

    const webm = await files.write('tr_1', 'dev_2', Readable.from([WEBM_HEAD]));
    expect(webm.path.endsWith('dev_2.webm')).toBe(true);
  });

  it('keeps a non-ftyp MP4 aside as .src.mp4 for remux', async () => {
    const files = await RecordingFiles.create();
    made.push(files);
    const saved = await files.write(
      'tr_1',
      'dev_1',
      Readable.from([boxHead('moov')]),
    );
    expect(saved.format).toBe('mp4-raw');
    expect(saved.path).toBe(path.join(files.dir, 'tr_1', 'dev_1.src.mp4'));
    expect(await fs.readdir(path.join(files.dir, 'tr_1'))).toEqual([
      'dev_1.src.mp4',
    ]);
  });

  it('rejects unknown formats and unsafe ids without leaving files', async () => {
    const files = await RecordingFiles.create();
    made.push(files);
    await expect(
      files.write('tr_1', 'dev_1', Readable.from([])),
    ).rejects.toThrow('Phone sent an empty recording');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      files.write('tr_1', 'dev_1', Readable.from([Buffer.from('junk')])),
    ).rejects.toThrow('Upload is not MP4 or WebM (4 bytes, head 6a756e6b)');
    expect(spy).toHaveBeenCalledWith(
      'Upload is not MP4 or WebM (4 bytes, head 6a756e6b)',
    );
    spy.mockRestore();
    await expect(
      files.write('../x', 'dev_1', Readable.from([MP4_HEAD])),
    ).rejects.toThrow();
    expect(
      await fs.readdir(path.join(files.dir, 'tr_1')).catch(() => []),
    ).toEqual([]);
  });

  it('removes one trial, and the whole launch folder on close', async () => {
    const files = await RecordingFiles.create();
    await files.write('tr_1', 'dev_1', Readable.from([MP4_HEAD]));
    await files.write('tr_2', 'dev_1', Readable.from([MP4_HEAD]));
    await files.removeTrial('tr_1');
    expect(existsSync(path.join(files.dir, 'tr_1'))).toBe(false);
    expect(existsSync(path.join(files.dir, 'tr_2'))).toBe(true);
    await files.close();
    expect(existsSync(files.dir)).toBe(false);
  });

  it('sweeps earlier launch folders only when given a root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcl-rec-root-'));
    roots.push(root);
    await fs.mkdir(path.join(root, 'launch-old', 'tr_1'), { recursive: true });
    await fs.writeFile(path.join(root, 'keep.txt'), 'x');

    const files = await RecordingFiles.create({ root });
    made.push(files);
    expect(path.dirname(files.dir)).toBe(root);
    expect(path.basename(files.dir)).toMatch(/^launch-/);
    expect((await fs.readdir(root)).sort()).toEqual(
      [path.basename(files.dir), 'keep.txt'].sort(),
    );

    const other = await RecordingFiles.create();
    made.push(other);
    expect(existsSync(files.dir)).toBe(true);
  });
});

describe('parseDurationSeconds', () => {
  it('reads ffmpeg Duration lines', () => {
    expect(
      parseDurationSeconds(
        'Duration: 00:01:02.50, start: 0.000000, bitrate: 1',
      ),
    ).toBeCloseTo(62.5);
    expect(parseDurationSeconds('no duration here')).toBeNull();
  });
});

describe.skipIf(!hasFfmpeg)('trimCopies', () => {
  it('cuts every view to the same window and leaves the sources in place', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcl-trim-'));
    try {
      const longer = path.join(dir, 'long.mp4');
      const shorter = path.join(dir, 'short.mp4');
      await makeTinyMp4(longer, 1.2);
      await makeTinyMp4(shorter, 1);
      const before = await fs.readFile(shorter);
      const copies = await trimCopies(ffmpegBin, [longer, shorter], 0.2, 0.8);
      expect(copies).toHaveLength(2);
      expect(copies[0].path).not.toBe(longer);
      expect(await fs.readFile(shorter)).toEqual(before);

      const durations = await Promise.all(
        copies.map((c) => probeDurationSec(ffmpegBin, c.path)),
      );
      expect(Math.abs(durations[0] - durations[1])).toBeLessThan(1 / 30);
      for (const d of durations) {
        expect(d).toBeGreaterThan(0.45);
        expect(d).toBeLessThan(0.75);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('drops finished copies when a later view cannot be trimmed', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcl-trim-'));
    try {
      const good = path.join(dir, 'good.mp4');
      const bad = path.join(dir, 'bad.mp4');
      await makeTinyMp4(good, 1);
      await fs.writeFile(bad, MP4_HEAD);
      const before = await fs.readFile(good);
      await expect(
        trimCopies(ffmpegBin, [good, bad], 0.1, 0.5),
      ).rejects.toThrow(/ffmpeg/);
      expect(await fs.readFile(good)).toEqual(before);
      expect(await fs.readdir(dir)).toEqual(['bad.mp4', 'good.mp4']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('parseProgressSeconds', () => {
  it('reads out_time_us / out_time_ms as microseconds', () => {
    expect(parseProgressSeconds('out_time_us=1500000')).toBe(1.5);
    expect(parseProgressSeconds('out_time_ms=2000000\r')).toBe(2);
    expect(parseProgressSeconds('out_time=00:00:01.50')).toBeNull();
    expect(parseProgressSeconds('progress=end')).toBeNull();
  });
});

describe.skipIf(!hasFfmpeg)('convertToMp4', () => {
  it('re-encodes WebM to H.264 MP4', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcl-conv-'));
    try {
      const webm = path.join(dir, 'in.webm');
      const mp4 = path.join(dir, 'out.mp4');
      await makeTinyWebm(webm);
      await convertToMp4(ffmpegBin, webm, mp4);
      const head = (await fs.readFile(mp4)).subarray(0, 16);
      expect(sniffVideoFormat(head)).toBe('mp4');
      const probe = await run(ffmpegBin, ['-hide_banner', '-i', mp4]).catch(
        (e: { stderr: string }) => e,
      );
      expect(probe.stderr).toMatch(/Video: h264/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reports encode progress against the expected duration', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcl-conv-'));
    try {
      const webm = path.join(dir, 'in.webm');
      await makeTinyWebm(webm);
      const seen: number[] = [];
      await convertToMp4(ffmpegBin, webm, path.join(dir, 'out.mp4'), {
        durationSec: 0.5,
        onProgress: (f) => seen.push(f),
      });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((f) => f >= 0 && f <= 1)).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects with ffmpeg output when the input is broken', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcl-conv-'));
    try {
      const bad = path.join(dir, 'bad.webm');
      await fs.writeFile(bad, WEBM_HEAD);
      await expect(
        convertToMp4(ffmpegBin, bad, path.join(dir, 'out.mp4')),
      ).rejects.toThrow(/ffmpeg/);
      expect(existsSync(path.join(dir, 'out.mp4'))).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
