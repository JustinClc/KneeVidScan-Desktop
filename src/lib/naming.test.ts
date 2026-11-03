import { describe, expect, it } from 'vitest';
import {
  STANDING_SEQUENCE,
  hyphenateName,
  incrementTrialName,
  joinSaveFolder,
  recordingFileBase,
  recordingVideoFileName,
  standingFileName,
  subjectBase,
  subjectInfoFileName,
  trialFolderSlug,
} from './naming';

describe('naming', () => {
  it('hyphenates spaces but keeps non-ASCII', () => {
    expect(hyphenateName('Chan Tai Man')).toBe('Chan-Tai-Man');
    expect(hyphenateName('陳大文')).toBe('陳大文');
    expect(hyphenateName('陳 大文')).toBe('陳-大文');
  });

  it('names the subject info CSV from the subject id and display name', () => {
    expect(subjectInfoFileName('UG0001', 'Chan Tai Man')).toBe(
      'UG0001_Chan-Tai-Man_subject.csv',
    );
  });
  it('builds a trial subfolder that cannot leave the subject folder', () => {
    expect(trialFolderSlug('gait 01')).toBe('gait-01');
    expect(trialFolderSlug('  ')).toBe('gait01');
    expect(trialFolderSlug('../gait')).toBe('..gait');
    expect(trialFolderSlug('..')).toBe('gait01');
    expect(joinSaveFolder('/tmp/out', 'gait01')).toBe('/tmp/out/gait01');
    expect(joinSaveFolder('C:\\Lab\\Chan', 'gait01')).toBe(
      'C:\\Lab\\Chan\\gait01',
    );
  });
  it('builds multi-cam and single-cam file bases', () => {
    expect(subjectBase('UG0001', 'Chan Tai Man')).toBe('UG0001_Chan-Tai-Man');
    expect(recordingFileBase('UG0001', 'Chan Tai Man', 'gait01', 2, 0)).toBe(
      'UG0001_Chan-Tai-Man_gait01_F',
    );
    expect(recordingFileBase('UG0001', 'Chan Tai Man', 'gait01', 2, 1)).toBe(
      'UG0001_Chan-Tai-Man_gait01_L',
    );
    expect(recordingFileBase('UG0001', 'Chan Tai Man', 'gait01', 3, 2)).toBe(
      'UG0001_Chan-Tai-Man_gait01_O',
    );
    expect(recordingFileBase('UG0001', 'Chan Tai Man', 'gait01', 1, 0)).toBe(
      'UG0001_Chan-Tai-Man_gait01',
    );
    expect(
      recordingVideoFileName('UG0001', 'Chan Tai Man', 'gait01', 1, 0),
    ).toBe('UG0001_Chan-Tai-Man_gait01.mp4');
    expect(
      recordingVideoFileName('UG0001', 'Chan Tai Man', 'gait01', 2, 0),
    ).toBe('UG0001_Chan-Tai-Man_gait01_F.mp4');
  });

  it('increments a trailing trial number and keeps its width', () => {
    expect(incrementTrialName('Gait01')).toBe('Gait02');
    expect(incrementTrialName('gait01')).toBe('gait02');
    expect(incrementTrialName('Gait9')).toBe('Gait10');
    expect(incrementTrialName('Trial009')).toBe('Trial010');
    expect(incrementTrialName('Gait 01')).toBe('Gait 02');
    expect(incrementTrialName('walk')).toBe('walk');
    expect(incrementTrialName('Gait01-left')).toBe('Gait01-left');
    expect(incrementTrialName('  Gait01  ')).toBe('Gait02');
  });

  it('names standing PNGs F → LL → RL with hyphenated subject name', () => {
    expect(STANDING_SEQUENCE).toEqual(['F', 'LL', 'RL']);
    expect(standingFileName('UG0001', 'Chan Tai Man', 'F')).toBe(
      'UG0001_Chan-Tai-Man_standing_F_annotated.png',
    );
    expect(standingFileName('UG0001', 'Chan Tai Man', 'LL')).toBe(
      'UG0001_Chan-Tai-Man_standing_LL_annotated.png',
    );
    expect(standingFileName('UG0001', '陳 大文', 'RL')).toBe(
      'UG0001_陳-大文_standing_RL_annotated.png',
    );
  });
});
