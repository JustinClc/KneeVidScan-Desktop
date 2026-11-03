import { contextBridge, ipcRenderer } from 'electron';

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

export type MotusCapLiteApi = {
  chooseSaveFolder: (
    title?: string,
    buttonLabel?: string,
  ) => Promise<string | null>;
  /**
   * Ask for the subject folder and write the posture photos plus the subject
   * CSV from the in-memory store. Present in the desktop app.
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
