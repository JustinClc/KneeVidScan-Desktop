import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { AnalysisInput, AnalysisResponse } from '../lib/analysis';
import { isAnalysisResponse } from '../lib/analysis';
import { emptyQuestionnaire, choiceQuestions } from '../lib/questionnaire';
import { STANDING_SEQUENCE, standingFullFileName } from '../lib/naming';

export type WorkerRequest = {
  questionnaire: AnalysisInput['questionnaire'];
  locale: AnalysisInput['locale'];
  seed?: string;
  images: Record<string, string>;
  videos: string[];
};
export type WorkerConfig = {
  executable: string;
  args?: string[];
  fingerprint: string;
};

/** No shell, bounded output/time, one request per process. Never expose diagnostics to the report. */
export function runAnalysisWorker(
  config: WorkerConfig,
  input: WorkerRequest,
): Promise<AnalysisResponse> {
  return new Promise((resolve) => {
    const child = spawn(config.executable, config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '',
      settled = false;
    const finish = (value: AnalysisResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const fail = () => finish({ ok: false, code: 'runtime', step: 7 });
    const timer = setTimeout(() => {
      child.kill();
      fail();
    }, 180_000);
    child.stdout.on('data', (b) => {
      stdout += b.toString();
      if (stdout.length > 2_000_000) {
        child.kill();
        fail();
      }
    });
    child.stderr.resume();
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.on('close', (code) => {
      if (code !== 0) return fail();
      try {
        const response: unknown = JSON.parse(stdout);
        if (isAnalysisResponse(response)) finish(response);
        else fail();
      } catch {
        fail();
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

async function digestFile(
  filename: string,
  hash: ReturnType<typeof createHash>,
) {
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
}
async function containedFile(folder: string, name: string) {
  if (typeof name !== 'string' || path.isAbsolute(name))
    throw new Error('Invalid path');
  const file = await fs.realpath(path.resolve(folder, name));
  const relative = path.relative(folder, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Outside assessment');
  if (!(await fs.stat(file)).isFile()) throw new Error('Not a file');
  return file;
}

function questionnaireIssue(
  q: AnalysisInput['questionnaire'] | undefined,
): string | undefined {
  if (!q) return 'name';
  const missing = Object.keys(emptyQuestionnaire()).find(
    (k) => typeof (q as unknown as Record<string, unknown>)[k] !== 'string',
  );
  if (missing) return missing;
  if (!q.name.trim()) return 'name';
  if (!/^\d+$/.test(q.age) || Number(q.age) < 18 || Number(q.age) > 120)
    return 'age';
  for (const [key, min, max] of [
    ['height', 0.8, 2.3],
    ['weight', 20, 200],
  ] as const) {
    if (
      !/^\d*(\.\d*)?$/.test(q[key]) ||
      !Number.isFinite(Number(q[key])) ||
      Number(q[key]) < min ||
      Number(q[key]) > max
    )
      return key;
  }
  return choiceQuestions.find(
    (question) =>
      !(question.options as readonly string[]).includes(q[question.key]),
  )?.key;
}

/** Content-addressed cache prevents new random scores on report reopen or PDF export. */
export function createAnalysisService(
  config: WorkerConfig,
  run = runAnalysisWorker,
) {
  const pending = new Map<string, Promise<AnalysisResponse>>();
  const queues = new Map<string, Promise<void>>();
  return async (input: AnalysisInput): Promise<AnalysisResponse> => {
    const field = questionnaireIssue(input?.questionnaire);
    if (field) return { ok: false, code: 'questionnaire', step: 1, field };
    if (!['en', 'zh-Hant', 'zh-Hans'].includes(input.locale))
      return { ok: false, code: 'runtime', step: 7 };
    let folder: string;
    try {
      folder = await fs.realpath(input.folder);
    } catch {
      return { ok: false, code: 'image', step: 4 };
    }
    const images: Record<string, string> = {};
    for (const code of STANDING_SEQUENCE) {
      try {
        images[code] = await containedFile(
          folder,
          path.basename(
            standingFullFileName(input.subjectId, input.subjectName, code),
          ),
        );
      } catch {
        return { ok: false, code: 'image', step: 4, field: code };
      }
    }
    if (!Array.isArray(input.videos) || !input.videos.length)
      return { ok: false, code: 'video', step: 5 };
    const videos: string[] = [];
    for (const name of input.videos) {
      try {
        videos.push(await containedFile(folder, name));
      } catch {
        return { ok: false, code: 'video', step: 6 };
      }
    }
    try {
      // Hash all languages at once: changing the display locale must not reroll mobility.
      const payload = { questionnaire: input.questionnaire, images, videos };
      const fingerprint = async () => {
        const hash = createHash('sha256')
          .update(config.fingerprint)
          .update(JSON.stringify(payload));
        for (const f of [...Object.values(images), ...videos])
          await digestFile(f, hash);
        return hash.digest('hex');
      };
      const key = await fingerprint();
      const cacheDir = path.join(folder, '.analysis');
      const cacheFile = path.join(cacheDir, key + '.json');
      const queueKey = folder + ':' + key;
      const pendingKey = queueKey + ':' + input.locale;
      if (!pending.has(pendingKey)) {
        const work = (queues.get(queueKey) ?? Promise.resolve()).then(
          async (): Promise<AnalysisResponse> => {
            let cached: Partial<
              Record<AnalysisInput['locale'], AnalysisResponse>
            > = {};
            try {
              const raw = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
              if (raw.key === key) cached = raw.results;
            } catch {
              /* Missing or corrupt cache is safe to regenerate. */
            }
            const existing = cached?.[input.locale];
            if (isAnalysisResponse(existing) && existing.ok) return existing;
            const response = await run(config, {
              ...payload,
              locale: input.locale,
              seed: key,
            });
            if (!response.ok) return response;
            if ((await fingerprint()) !== key)
              return { ok: false, code: 'runtime', step: 7 };
            cached = { ...cached, [input.locale]: response };
            await fs.mkdir(cacheDir, { recursive: true });
            const temp = cacheFile + '.' + randomUUID() + '.tmp';
            try {
              await fs.writeFile(
                temp,
                JSON.stringify({ key, results: cached }),
                {
                  mode: 0o600,
                  flag: 'wx',
                },
              );
              await fs.rename(temp, cacheFile);
            } finally {
              await fs.rm(temp, { force: true });
            }
            return response;
          },
        );
        const tail = work.then(
          () => {},
          () => {},
        );
        queues.set(queueKey, tail);
        void tail.then(() => {
          if (queues.get(queueKey) === tail) queues.delete(queueKey);
        });
        pending.set(pendingKey, work);
        void work.finally(() => pending.delete(pendingKey)).catch(() => {});
      }
      return await pending.get(pendingKey)!;
    } catch {
      return { ok: false, code: 'runtime', step: 7 };
    }
  };
}
