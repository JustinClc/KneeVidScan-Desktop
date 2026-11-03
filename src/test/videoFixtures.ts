import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

export const run = promisify(execFile);
export const ffmpegBin = ffmpegPath ?? '';
export const hasFfmpeg = Boolean(ffmpegPath && existsSync(ffmpegPath));

/** `seconds` of 64×64 H.264, long enough to trim and compare durations. */
export async function makeTinyMp4(out: string, seconds = 1) {
  await run(ffmpegBin, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=64x64:rate=30',
    '-t',
    String(seconds),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-f',
    'mp4',
    '-y',
    out,
  ]);
}

/** Half a second of 64×64 VP8 — enough for a real container round trip. */
export async function makeTinyWebm(out: string) {
  await run(ffmpegBin, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=64x64:rate=10',
    '-t',
    '0.5',
    '-c:v',
    'libvpx',
    '-f',
    'webm',
    '-y',
    out,
  ]);
}

export const MP4_HEAD = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.alloc(16),
]);

export const WEBM_HEAD = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.alloc(16),
]);
