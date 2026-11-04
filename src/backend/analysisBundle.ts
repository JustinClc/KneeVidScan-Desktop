import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function analysisSourceFingerprint(root: string): string {
  const files: string[] = [];
  const scan = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__pycache__') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (entry.isFile()) files.push(file);
    }
  };
  const source = path.join(root, 'analysis');
  scan(source);
  const relative = (f: string) =>
    path.relative(source, f).split(path.sep).join('/');
  files.sort((a, b) =>
    relative(a) < relative(b) ? -1 : relative(a) > relative(b) ? 1 : 0,
  );
  const hash = createHash('sha256');
  for (const file of files)
    hash.update(relative(file)).update(fs.readFileSync(file));
  return hash.digest('hex');
}

export function verifyAnalysisBundle(
  root: string,
  platform: string,
  arch: string,
): void {
  const bundle = path.join(root, 'assets', 'analysis-worker');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'),
  );
  const machines: Record<string, string[]> = {
    x64: ['x86_64', 'amd64'],
    arm64: ['arm64', 'aarch64'],
  };
  if (
    manifest.platform !== platform ||
    !machines[arch]?.includes(manifest.machine)
  )
    throw new Error(
      `Build the analysis worker natively for ${platform}/${arch}.`,
    );
  if (manifest.sourceSha256 !== analysisSourceFingerprint(root))
    throw new Error(
      'Analysis sources changed. Rebuild with python analysis/build_worker.py.',
    );
  fs.accessSync(
    path.join(
      bundle,
      'kneevid-analysis',
      platform === 'win32' ? 'kneevid-analysis.exe' : 'kneevid-analysis',
    ),
  );
}
