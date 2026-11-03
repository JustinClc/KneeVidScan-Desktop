/**
 * Populate assets/mediapipe/ for offline pose detection:
 * - wasm/ copied from @mediapipe/tasks-vision
 * - pose_landmarker_full.task, pose_landmarker_lite.task and
 *   pose_landmarker_heavy.task downloaded once (skipped when present)
 *
 * The local backend serves this folder at /mediapipe/ to the renderer.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'mediapipe');
const wasmSrc = path.join(
  root,
  'node_modules',
  '@mediapipe',
  'tasks-vision',
  'wasm',
);
const wasmOut = path.join(outDir, 'wasm');
const MODELS = ['full', 'lite', 'heavy'].map((variant) => ({
  name: `pose_landmarker_${variant}.task`,
  url: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/latest/pose_landmarker_${variant}.task`,
}));

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

await fs.mkdir(wasmOut, { recursive: true });
for (const name of await fs.readdir(wasmSrc)) {
  await fs.copyFile(path.join(wasmSrc, name), path.join(wasmOut, name));
}

for (const model of MODELS) {
  const modelPath = path.join(outDir, model.name);
  if (await exists(modelPath)) continue;
  console.log(`[mediapipe] downloading ${model.name}…`);
  const res = await fetch(model.url);
  if (!res.ok)
    throw new Error(`Model download failed: ${res.status} ${res.statusText}`);
  const tmp = `${modelPath}.part`;
  await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  await fs.rename(tmp, modelPath);
}
console.log(`[mediapipe] assets ready in ${path.relative(root, outDir)}`);
