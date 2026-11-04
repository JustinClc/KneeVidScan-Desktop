import path from 'node:path';
import { verifyAnalysisBundle } from '../src/backend/analysisBundle.ts';
const root = path.resolve(import.meta.dirname, '..');
const platform =
  process.argv.find((a) => a.startsWith('--platform='))?.split('=')[1] ??
  process.platform;
const arch =
  process.argv.find((a) => a.startsWith('--arch='))?.split('=')[1] ??
  process.arch;
try {
  verifyAnalysisBundle(root, platform, arch);
} catch (error) {
  throw new Error(
    'Offline analysis runtime missing, stale or incompatible. Build on the target platform with Python 3.9: python analysis/build_worker.py',
    { cause: error },
  );
}
console.log(`[analysis] ${platform}/${arch} offline runtime ready`);
