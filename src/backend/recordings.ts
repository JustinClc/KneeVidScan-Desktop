/**
 * Temporary on-disk storage for phone trial uploads.
 *
 * Layout: `<launch dir>/<trialId>/<deviceId>.<mp4|webm|src.mp4>`. Uploads
 * stream through a `.part` file so a half-received video never looks complete.
 * WebM, and MP4 that does not start with `ftyp`, are re-encoded to H.264
 * MP4 with the bundled ffmpeg. A normal `ftyp` MP4 is kept as uploaded.
 */

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type VideoFormat = 'mp4' | 'webm' | 'mp4-raw';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const LAUNCH_PREFIX = 'launch-';

/**
 * ISO BMFF box types Android's MP4 recorder may put first. `ftyp` is a
 * finished MP4. The others are still MP4, but need a remux before playback.
 */
const MP4_BOX_TYPES = new Set([
  'ftyp',
  'styp',
  'moov',
  'moof',
  'mdat',
  'free',
  'skip',
  'wide',
]);

export function sniffVideoFormat(head: Buffer): VideoFormat | null {
  if (
    head.length >= 4 &&
    head[0] === 0x1a &&
    head[1] === 0x45 &&
    head[2] === 0xdf &&
    head[3] === 0xa3
  ) {
    return 'webm';
  }
  if (head.length >= 8) {
    const box = head.toString('latin1', 4, 8);
    if (box === 'ftyp') return 'mp4';
    if (MP4_BOX_TYPES.has(box)) return 'mp4-raw';
  }
  return null;
}

/** On-disk suffix. `mp4-raw` keeps an `.mp4` extension so ffmpeg probes it. */
function videoFileSuffix(format: VideoFormat): string {
  if (format === 'mp4') return 'mp4';
  if (format === 'webm') return 'webm';
  return 'src.mp4';
}

function safeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid id: ${id}`);
  return id;
}

export type SavedRecording = {
  path: string;
  bytes: number;
  format: VideoFormat;
};

export class RecordingFiles {
  private constructor(readonly dir: string) {}

  /**
   * With `root`, the launch folder is `<root>/launch-…` and earlier launch
   * folders under `root` are removed. Without it, a fresh temp folder is used
   * and nothing else is touched.
   */
  static async create(opts: { root?: string } = {}): Promise<RecordingFiles> {
    if (!opts.root) {
      return new RecordingFiles(
        await fs.mkdtemp(path.join(os.tmpdir(), 'motuscap-lite-')),
      );
    }
    await fs.mkdir(opts.root, { recursive: true });
    for (const name of await fs.readdir(opts.root)) {
      if (name.startsWith(LAUNCH_PREFIX)) {
        await fs.rm(path.join(opts.root, name), {
          recursive: true,
          force: true,
        });
      }
    }
    return new RecordingFiles(
      await fs.mkdtemp(path.join(opts.root, LAUNCH_PREFIX)),
    );
  }

  trialDir(trialId: string): string {
    return path.join(this.dir, safeId(trialId));
  }

  async write(
    trialId: string,
    deviceId: string,
    body: Readable,
    onProgress?: (bytes: number) => void,
  ): Promise<SavedRecording> {
    const dir = this.trialDir(trialId);
    const base = path.join(dir, safeId(deviceId));
    await fs.mkdir(dir, { recursive: true });
    const part = `${base}.part`;
    let bytes = 0;
    let head = Buffer.alloc(0);
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        if (head.length < 12) {
          head = Buffer.concat([head, chunk]).subarray(0, 12);
        }
        bytes += chunk.length;
        onProgress?.(bytes);
        done(null, chunk);
      },
    });
    try {
      await pipeline(body, counter, createWriteStream(part));
      if (bytes === 0) throw new Error('Phone sent an empty recording');
      const format = sniffVideoFormat(head);
      if (!format) {
        const hex = head.subarray(0, 12).toString('hex');
        const message = `Upload is not MP4 or WebM (${bytes} bytes, head ${hex})`;
        console.error(message);
        throw new Error(message);
      }
      await this.removeDevice(trialId, deviceId);
      const finalPath = `${base}.${videoFileSuffix(format)}`;
      await fs.rename(part, finalPath);
      return { path: finalPath, bytes, format };
    } catch (err) {
      await fs.rm(part, { force: true });
      throw err;
    }
  }

  async removeDevice(trialId: string, deviceId: string) {
    const base = path.join(this.trialDir(trialId), safeId(deviceId));
    for (const ext of ['mp4', 'webm', 'src.mp4']) {
      await fs.rm(`${base}.${ext}`, { force: true });
    }
  }

  async removeTrial(trialId: string) {
    await fs.rm(this.trialDir(trialId), { recursive: true, force: true });
  }

  async close() {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}

export const FFMPEG_MP4_ARGS = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '20',
  '-pix_fmt',
  'yuv420p',
  // yuv420p needs even dimensions.
  '-vf',
  'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  '-movflags',
  '+faststart',
  '-an',
];

/** `Duration: HH:MM:SS.xx` from `ffmpeg -i`, else null. */
export function parseDurationSeconds(text: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Container duration. ffmpeg exits non-zero when it is only probing. */
export function probeDurationSec(
  ffmpegPath: string,
  input: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', input], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-4000);
    });
    child.on('error', (err) =>
      reject(new Error(`ffmpeg failed: ${err.message}`)),
    );
    child.on('close', () => {
      const sec = parseDurationSeconds(stderr);
      if (sec == null || !(sec > 0)) {
        reject(new Error('Could not read video duration'));
        return;
      }
      resolve(sec);
    });
  });
}

/**
 * Frame-accurate cut to `[startSec, endSec)`. Writes `output` only on success.
 * Same encode settings as the WebM → MP4 convert, so every view matches.
 */
export function trimMp4(
  ffmpegPath: string,
  input: string,
  output: string,
  startSec: number,
  endSec: number,
): Promise<void> {
  const duration = endSec - startSec;
  if (!(duration > 0)) {
    return Promise.reject(new Error('Trim window is empty'));
  }
  const tmp = `${output}.part`;
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        input,
        '-ss',
        startSec.toFixed(3),
        '-t',
        duration.toFixed(3),
        ...FFMPEG_MP4_ARGS,
        '-f',
        'mp4',
        tmp,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-2000);
    });
    child.on('error', (err) =>
      reject(new Error(`ffmpeg failed: ${err.message}`)),
    );
    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `ffmpeg failed (exit ${code}): ${stderr.trim().split('\n').at(-1) ?? ''}`,
          ),
        );
      }
    });
  }).then(
    () => fs.rename(tmp, output),
    async (err: unknown) => {
      await fs.rm(tmp, { force: true });
      throw err;
    },
  );
}

export type TrimmedCopy = { path: string; bytes: number };

/**
 * Trim each input to the same window, writing new files beside the sources.
 * Sources stay untouched. If any view fails, the new files are removed.
 */
export async function trimCopies(
  ffmpegPath: string,
  inputs: readonly string[],
  startSec: number,
  endSec: number,
): Promise<TrimmedCopy[]> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const made: string[] = [];
  try {
    const copies: TrimmedCopy[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      if (!input) throw new Error('Trim is missing a view');
      const out = path.join(
        path.dirname(input),
        `${path.basename(input, path.extname(input))}.cut-${stamp}-${i}.mp4`,
      );
      await trimMp4(ffmpegPath, input, out, startSec, endSec);
      made.push(out);
      const bytes = (await fs.stat(out)).size;
      copies.push({ path: out, bytes });
    }
    return copies;
  } catch (err) {
    await Promise.all(made.map((p) => fs.rm(p, { force: true })));
    throw err;
  }
}

/** Encoded media time in seconds from one `-progress` line, else null. */
export function parseProgressSeconds(line: string): number | null {
  // out_time_ms is microseconds too (long-standing ffmpeg quirk).
  const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  return m ? Number(m[1]) / 1_000_000 : null;
}

/** Re-encode to H.264 MP4. `output` only appears once ffmpeg succeeds. */
export function convertToMp4(
  ffmpegPath: string,
  input: string,
  output: string,
  opts: {
    /** Expected media length; MediaRecorder WebM often has none in its header. */
    durationSec?: number | null;
    /** Fraction 0–1 of `durationSec` encoded so far. */
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<void> {
  const tmp = `${output}.part`;
  const { onProgress } = opts;
  const durationSec = opts.durationSec ?? 0;
  const track = Boolean(onProgress) && durationSec > 0;
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        ...(track ? ['-progress', 'pipe:1', '-nostats'] : []),
        '-y',
        '-i',
        input,
        ...FFMPEG_MP4_ARGS,
        '-f',
        'mp4',
        tmp,
      ],
      { stdio: ['ignore', track ? 'pipe' : 'ignore', 'pipe'] },
    );
    if (track && child.stdout) {
      let pending = '';
      child.stdout.on('data', (c: Buffer) => {
        const lines = (pending + c.toString()).split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const sec = parseProgressSeconds(line);
          if (sec != null) onProgress?.(Math.min(1, sec / durationSec));
        }
      });
    }
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString()).slice(-2000);
    });
    child.on('error', (err) =>
      reject(new Error(`ffmpeg failed: ${err.message}`)),
    );
    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `ffmpeg failed (exit ${code}): ${stderr.trim().split('\n').at(-1) ?? ''}`,
          ),
        );
      }
    });
  }).then(
    () => fs.rename(tmp, output),
    async (err: unknown) => {
      await fs.rm(tmp, { force: true });
      throw err;
    },
  );
}
