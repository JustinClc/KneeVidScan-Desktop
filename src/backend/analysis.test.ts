import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAnalysisService, runAnalysisWorker } from './analysis';
import type { AnalysisInput, AnalysisResponse } from '../lib/analysis';
import { emptyQuestionnaire } from '../lib/questionnaire';
import { standingFullFileName } from '../lib/naming';

let folder: string;
let input: AnalysisInput;
const success = (): AnalysisResponse => ({
  ok: true,
  result: {
    version: 'test',
    risk: 61,
    mobility: 73,
    alignmentLeft: 1,
    alignmentRight: 2,
    extensionLeft: 3,
    extensionRight: 4,
    riskText: 'High risk',
    advice: ['Advice'],
    videoMeasurements: { STS5_pace: 20 },
    featureImportance: {},
  },
});
beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'knee-analysis-'));
  input = {
    folder,
    subjectId: 'S001',
    subjectName: 'Person',
    locale: 'en',
    videos: ['trial/record.mp4'],
    questionnaire: {
      ...emptyQuestionnaire(),
      name: 'Person',
      age: '65',
      height: '1.7',
      weight: '65',
      sex: 'Male',
      smoking: 'No',
      activity: 'Mostly sit',
      diabetes: 'No',
      injury: 'No',
      surgery: 'No',
      clicking: 'No',
      walkingAid: 'No',
      pain: '2',
    },
  };
  for (const code of ['F', 'LL', 'RL'] as const)
    await fs.writeFile(
      path.join(
        folder,
        standingFullFileName(input.subjectId, input.subjectName, code),
      ),
      code,
    );
  await fs.mkdir(path.join(folder, 'trial'));
  await fs.writeFile(path.join(folder, 'trial/record.mp4'), 'video');
});
afterEach(async () => {
  await fs.rm(folder, { recursive: true, force: true });
});
describe('local analysis integration', () => {
  it('reuses results across service restarts and reruns when content changes', async () => {
    const run = vi.fn(async () => success());
    const config = { executable: 'unused', fingerprint: 'v1' };
    const analyze = createAnalysisService(config, run);
    expect(await analyze(input)).toEqual(success());
    expect(await createAnalysisService(config, run)(input)).toEqual(success());
    expect(run).toHaveBeenCalledOnce();
    await fs.writeFile(path.join(folder, 'trial/record.mp4'), 'retaken video');
    await analyze(input);
    expect(run).toHaveBeenCalledTimes(2);
    await analyze({
      ...input,
      questionnaire: { ...input.questionnaire, age: '66' },
    });
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('coalesces concurrent requests and uses the same random seed across locales', async () => {
    const run = vi.fn(async () => success());
    const analyze = createAnalysisService(
      { executable: 'unused', fingerprint: 'v1' },
      run,
    );
    await Promise.all([analyze(input), analyze(input)]);
    expect(run).toHaveBeenCalledOnce();
    await analyze({ ...input, locale: 'zh-Hant' });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]).toBeDefined();
    const calls = run.mock.calls as unknown as Array<
      [unknown, { seed: string }]
    >;
    expect(calls[0][1].seed).toBe(calls[1][1].seed);
  });
  it('serializes concurrent locales without overwriting cached translations', async () => {
    const run = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return success();
    });
    const config = { executable: 'unused', fingerprint: 'v1' };
    const analyze = createAnalysisService(config, run);
    await Promise.all(
      ['en', 'zh-Hant', 'zh-Hans', 'zh-Hant'].map((locale) =>
        analyze({ ...input, locale: locale as AnalysisInput['locale'] }),
      ),
    );
    expect(run).toHaveBeenCalledTimes(3);
    const fresh = createAnalysisService(config, run);
    for (const locale of ['en', 'zh-Hant', 'zh-Hans'] as const)
      await fresh({ ...input, locale });
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('does not cache an analysis if media changes while inference is running', async () => {
    const run = vi.fn(async () => {
      await fs.writeFile(
        path.join(folder, 'trial/record.mp4'),
        'changed during analysis',
      );
      return success();
    });
    const analyze = createAnalysisService(
      { executable: 'unused', fingerprint: 'v1' },
      run,
    );
    expect(await analyze(input)).toEqual({
      ok: false,
      code: 'runtime',
      step: 7,
    });
    await expect(fs.stat(path.join(folder, '.analysis'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  });
  it('routes missing inputs without starting the model', async () => {
    const run = vi.fn(async () => success());
    const analyze = createAnalysisService(
      { executable: 'unused', fingerprint: 'v1' },
      run,
    );
    expect(
      await analyze({
        ...input,
        questionnaire: { ...input.questionnaire, age: '' },
      }),
    ).toMatchObject({ ok: false, code: 'questionnaire', step: 1 });
    await fs.rm(
      path.join(
        folder,
        standingFullFileName(input.subjectId, input.subjectName, 'LL'),
      ),
    );
    expect(await analyze(input)).toEqual({
      ok: false,
      code: 'image',
      step: 4,
      field: 'LL',
    });
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects video traversal and does not cache failures', async () => {
    const run = vi.fn(
      async (): Promise<AnalysisResponse> => ({
        ok: false,
        code: 'video',
        step: 6,
      }),
    );
    const analyze = createAnalysisService(
      { executable: 'unused', fingerprint: 'v1' },
      run,
    );
    expect(
      await analyze({ ...input, videos: ['../../etc/passwd'] }),
    ).toMatchObject({ code: 'video', step: 6 });
    expect(run).not.toHaveBeenCalled();
    await analyze(input);
    await analyze(input);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('treats a missing worker as a runtime failure', async () => {
    const response = await runAnalysisWorker(
      { executable: path.join(folder, 'missing'), fingerprint: 'v1' },
      {
        questionnaire: input.questionnaire,
        locale: 'en',
        images: {},
        videos: [],
      },
    );
    expect(response).toEqual({ ok: false, code: 'runtime', step: 7 });
  });
});
