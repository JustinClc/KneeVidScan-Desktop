import { contextBridge, ipcRenderer } from 'electron';
import type { QuestionnaireAnswers } from './lib/questionnaire';

export type BackendInfo = {
  apiBase: string;
  pwaBase: string;
  https: boolean;
  lanHost: string;
  port: number;
};

export type SaveFilePayload = {
  filename: string;
  /** Base64-encoded file bytes. */
  base64: string;
};

export type WriteSaveResult = {
  ok: boolean;
  folder: string;
  written: string[];
  error?: string;
};

export type SaveSubjectFolderInput = {
  subjectId: string;
  subjectName: string;
  heightCm: string;
  weightKg: string;
  destination: 'existing' | 'new';
  folder?: string;
  dialogTitle?: string;
  buttonLabel?: string;
};

export type SaveSubjectFolderResult =
  | {
      ok: true;
      folder: string;
      written: string[];
      missing: Array<{
        filename: string;
        code: 'F' | 'LL' | 'RL';
        variant: 'crop' | 'full';
      }>;
    }
  | {
      ok: false;
      cancelled?: boolean;
      error: string;
      folder?: string;
    };

export type SaveQuestionnaireResult =
  | { ok: true; folder: string }
  | { ok: false; cancelled?: boolean; error: string };

export type ExportReportInput = {
  folder: string;
  filename: string;
  html: string;
};

export type ExportReportResult =
  | { ok: true; path: string; openError?: string }
  | { ok: false; error: string };

export type MotusCapLiteApi = {
  exportReport?: (input: ExportReportInput) => Promise<ExportReportResult>;
  saveQuestionnaire?: (
    answers: QuestionnaireAnswers,
    title?: string,
    buttonLabel?: string,
  ) => Promise<SaveQuestionnaireResult>;
  chooseSaveFolder: (
    title?: string,
    buttonLabel?: string,
  ) => Promise<string | null>;
  /**
   * Write annotated report photos, clean originals and the subject CSV.
   * With folder supplied, reuse the questionnaire folder without a dialog.
   */
  saveSubjectFolder?: (
    input: SaveSubjectFolderInput,
  ) => Promise<SaveSubjectFolderResult>;
  /** Write Save/Export files into a user-chosen folder (main process). */
  writeSaveFiles: (
    folder: string,
    files: SaveFilePayload[],
  ) => Promise<WriteSaveResult>;
  /** Read one file back from a save folder. Null when it is missing. */
  readSaveFile: (folder: string, filename: string) => Promise<string | null>;
  getBackendInfo: () => Promise<BackendInfo | null>;
  /** Convenience: API base URL once backend is up. */
  backendUrl?: string;
  platform: NodeJS.Platform;
};

const api: MotusCapLiteApi = {
  exportReport: (input) => ipcRenderer.invoke('report:export', input),
  saveQuestionnaire: (answers, title, buttonLabel) =>
    ipcRenderer.invoke('save:questionnaire', answers, title, buttonLabel),
  chooseSaveFolder: (title, buttonLabel) =>
    ipcRenderer.invoke('dialog:chooseSaveFolder', title, buttonLabel),
  saveSubjectFolder: (input) => ipcRenderer.invoke('save:subjectFolder', input),
  writeSaveFiles: (folder, files) =>
    ipcRenderer.invoke('save:writeFiles', folder, files),
  readSaveFile: (folder, filename) =>
    ipcRenderer.invoke('save:readFile', folder, filename),
  getBackendInfo: () => ipcRenderer.invoke('backend:info'),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('motuscapLite', api);
