import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isQuestionnaireValid,
  type QuestionnaireAnswers,
} from './questionnaire';

/** Use the operator's local calendar date, including near midnight. */
export function questionnaireFolderName(
  name: string,
  date = new Date(),
): string {
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  const slug = name
    .trim()
    .replace(/\s+/g, '-')
    // Strip control characters as well as cross-platform filename separators.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/, '');
  if (!slug) throw new Error('Name/ID is required.');
  return `${day}_${slug}`;
}

/** Exclusive mkdir preserves existing sessions, even with concurrent submissions. */
export async function createQuestionnaireFolder(
  parent: string,
  answers: QuestionnaireAnswers,
  date = new Date(),
): Promise<string> {
  if (!isQuestionnaireValid(answers))
    throw new Error('Complete the questionnaire before saving.');
  const base = questionnaireFolderName(answers.name, date);
  for (let count = 1; ; count++) {
    const folder = path.join(parent, count === 1 ? base : `${base}_${count}`);
    try {
      await fs.mkdir(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    try {
      await fs.writeFile(
        path.join(folder, 'questionnaire.json'),
        JSON.stringify(answers, null, 2) + '\n',
        'utf8',
      );
    } catch (error) {
      await fs.rmdir(folder).catch(() => undefined);
      throw error;
    }
    return folder;
  }
}
