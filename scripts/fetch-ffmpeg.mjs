/**
 * Populate assets/ffmpeg/ with the ffmpeg binary the backend uses to turn
 * WebM phone uploads into H.264 MP4.
 *
 * - Host platform: copied from node_modules/ffmpeg-static.
 * - Other platform (`--platform=win32 [--arch=x64]`, e.g. `make:win` on a
 *   Mac): downloaded from the same ffmpeg-static release.
 *
 * Only one binary is kept so a build never ships another platform's ffmpeg.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'ffmpeg');
const pkgDir = path.join(root, 'node_modules', 'ffmpeg-static');

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const platform = arg('platform') || os.platform();
const arch = arg('arch') || os.arch();
const target = `${platform}-${arch}`;
const exe = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const marker = path.join(outDir, '.target');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

if (
  (await exists(path.join(outDir, exe))) &&
  (await fs.readFile(marker, 'utf8').catch(() => '')) === target
) {
  console.log(`[ffmpeg] ${target} ready in ${path.relative(root, outDir)}`);
  process.exit(0);
}

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

if (target === `${os.platform()}-${os.arch()}`) {
  const src = path.join(pkgDir, exe);
  if (!(await exists(src))) {
    throw new Error(
      'ffmpeg-static binary missing — run `pnpm install` (its install step downloads it)',
    );
  }
  await fs.copyFile(src, path.join(outDir, exe));
  await fs
    .copyFile(path.join(pkgDir, 'ffmpeg.LICENSE'), path.join(outDir, 'LICENSE'))
    .catch(() => {});
} else {
  const pkg = JSON.parse(
    await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8'),
  );
  const release = pkg['ffmpeg-static']['binary-release-tag'];
  const base = `https://github.com/eugeneware/ffmpeg-static/releases/download/${release}`;
  console.log(`[ffmpeg] downloading ${target} (${release})…`);
  const res = await fetch(`${base}/ffmpeg-${target}.gz`);
  if (!res.ok) {
    throw new Error(`ffmpeg download failed: ${res.status} ${res.statusText}`);
  }
  const bin = gunzipSync(Buffer.from(await res.arrayBuffer()));
  await fs.writeFile(path.join(outDir, exe), bin);
  const license = await fetch(`${base}/${target}.LICENSE`);
  if (license.ok) {
    await fs.writeFile(path.join(outDir, 'LICENSE'), await license.text());
  }
}
await fs.chmod(path.join(outDir, exe), 0o755);
await fs.writeFile(marker, target);
console.log(`[ffmpeg] ${target} ready in ${path.relative(root, outDir)}`);
