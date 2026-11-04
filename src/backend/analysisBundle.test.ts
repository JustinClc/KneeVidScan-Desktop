import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  analysisSourceFingerprint,
  verifyAnalysisBundle,
} from './analysisBundle';
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-bundle-'));
  await fs.mkdir(path.join(root, 'analysis'));
  await fs.writeFile(path.join(root, 'analysis/worker.py'), 'worker-v1');
  await fs.mkdir(path.join(root, 'assets/analysis-worker/kneevid-analysis'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, 'assets/analysis-worker/kneevid-analysis/kneevid-analysis'),
    'binary',
  );
  await fs.writeFile(
    path.join(root, 'assets/analysis-worker/manifest.json'),
    JSON.stringify({
      platform: 'linux',
      machine: 'x86_64',
      sourceSha256: analysisSourceFingerprint(root),
    }),
  );
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it('refuses stale or wrong-platform worker bundles', async () => {
  expect(() => verifyAnalysisBundle(root, 'linux', 'x64')).not.toThrow();
  expect(() => verifyAnalysisBundle(root, 'win32', 'x64')).toThrow('natively');
  await fs.writeFile(path.join(root, 'analysis/worker.py'), 'worker-v2');
  expect(() => verifyAnalysisBundle(root, 'linux', 'x64')).toThrow(
    'sources changed',
  );
});
