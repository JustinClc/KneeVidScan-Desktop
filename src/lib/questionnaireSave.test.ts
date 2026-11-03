import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createQuestionnaireFolder,
  questionnaireFolderName,
} from './questionnaireSave';
import { emptyQuestionnaire } from './questionnaire';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});
const answers = {
  ...emptyQuestionnaire(),
  name: 'Chan Tai Man',
  age: '45',
  height: '1.72',
  weight: '68',
  sex: 'Male',
  smoking: 'No',
  activity: 'Mostly sit',
  diabetes: 'No',
  injury: 'No',
  surgery: 'No',
  clicking: 'No',
  walkingAid: 'No',
  pain: '0',
};

describe('questionnaire subject folder', () => {
  it('uses local date, hyphenates whitespace and keeps the name inside one folder', () => {
    const date = new Date(2026, 10, 4, 0, 1);
    expect(questionnaireFolderName('  Chan  Tai\tMan  ', date)).toBe(
      '2026-11-04_Chan-Tai-Man',
    );
    expect(questionnaireFolderName('../a\\b:c', date)).toBe(
      '2026-11-04_..-a-b-c',
    );
  });
  it('writes every answer immediately and preserves earlier sessions including concurrent submissions', async () => {
    const parent = await fs.mkdtemp(
      path.join(os.tmpdir(), 'knee-questionnaire-'),
    );
    roots.push(parent);
    const date = new Date(2026, 10, 4);
    const first = await createQuestionnaireFolder(parent, answers, date);
    const others = await Promise.all([
      createQuestionnaireFolder(parent, answers, date),
      createQuestionnaireFolder(parent, { ...answers, pain: '5' }, date),
    ]);
    expect(
      [first, ...others].map((folder) => path.basename(folder)).sort(),
    ).toEqual([
      '2026-11-04_Chan-Tai-Man',
      '2026-11-04_Chan-Tai-Man_2',
      '2026-11-04_Chan-Tai-Man_3',
    ]);
    expect(
      JSON.parse(
        await fs.readFile(path.join(first, 'questionnaire.json'), 'utf8'),
      ),
    ).toEqual(answers);
    expect(
      JSON.parse(
        await fs.readFile(path.join(others[1], 'questionnaire.json'), 'utf8'),
      ).pain,
    ).toBe('5');
    await expect(
      createQuestionnaireFolder(parent, emptyQuestionnaire(), date),
    ).rejects.toThrow('Complete the questionnaire');
    expect((await fs.readdir(parent)).length).toBe(3);
  });
});
