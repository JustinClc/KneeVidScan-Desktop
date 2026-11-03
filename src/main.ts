import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { statSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { startLiteServer, type LiteServer } from './backend/server';
import { createQuestionnaireFolder } from './lib/questionnaireSave';
import { exportReportPdf } from './lib/reportExport';
import type { ExportReportInput } from './preload';
import type { QuestionnaireAnswers } from './lib/questionnaire';
import { buildSubjectInfoCsv } from './lib/sessionSave';
import {
  resolveChosenFolder,
  subjectWithPosturePhotos,
} from './lib/saveFolder';
import {
  joinSaveFolder,
  STANDING_SEQUENCE,
  standingFileName,
  standingFullFileName,
  subjectBase,
  subjectInfoFileName,
  type StandingCode,
} from './lib/naming';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

app.setName('KneeVidScan-Desktop');
if (process.platform === 'win32')
  app.setAppUserModelId('com.squirrel.KneeVidScanDesktop.KneeVidScan-Desktop');

// Opt-in for headless / CI environments where GPU or sandbox is unavailable.
if (process.env.MOTUSCAP_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('no-sandbox');
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let liteServer: LiteServer | null = null;
let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  const icon = path.join(
    app.isPackaged ? process.resourcesPath : app.getAppPath() + '/assets',
    'branding',
    process.platform === 'win32' ? 'kneevidscan.ico' : 'kneevidscan.png',
  );
  if (process.platform === 'darwin') app.dock?.setIcon(icon);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'KneeVidScan-Desktop',
    icon,
    backgroundColor: '#F4F6F9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (process.env.MOTUSCAP_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

function folderDialogProperties(): Array<
  'openFile' | 'openDirectory' | 'createDirectory'
> {
  const properties: Array<'openFile' | 'openDirectory' | 'createDirectory'> = [
    'openDirectory',
    'createDirectory',
  ];
  // On macOS, a directory-only panel drops the chosen folder when that URL
  // fails Electron's directory check, so Open comes back with no path.
  // Allowing a file skips that filter; a file selection is saved as its folder.
  if (process.platform === 'darwin') properties.push('openFile');
  return properties;
}

async function chooseDirectory(
  title: string,
  buttonLabel = 'Choose',
): Promise<{
  folder: string | null;
  detail: string;
}> {
  mainWindow?.show();
  mainWindow?.focus();
  const result = await dialog.showOpenDialog({
    title,
    buttonLabel,
    properties: folderDialogProperties(),
  });
  const detail = `canceled=${result.canceled} paths=${result.filePaths.length}${
    result.filePaths.length ? ` ${result.filePaths.join(' | ')}` : ''
  }`;
  console.log(`[KneeVidScan-Desktop] folder dialog "${title}": ${detail}`);
  try {
    await fs.appendFile(
      path.join(app.getPath('temp'), 'motuscap-save-dialog.log'),
      `${new Date().toISOString()} ${title} ${detail}\n`,
    );
  } catch {
    /* the toast still carries the same detail */
  }
  const folder = resolveChosenFolder(result, (candidate) => {
    try {
      return statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
  return { folder, detail };
}

app.whenReady().then(async () => {
  ipcMain.handle('report:export', async (_event, input: ExportReportInput) =>
    exportReportPdf(input, {
      createWindow: () => {
        const win = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            javascript: false,
          },
        });
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', (event) => event.preventDefault());
        return win;
      },
      openPath: (file) => shell.openPath(file),
    }),
  );
  ipcMain.handle(
    'save:questionnaire',
    async (
      _event,
      answers: QuestionnaireAnswers,
      title?: string,
      buttonLabel?: string,
    ) => {
      try {
        const picked = await chooseDirectory(
          title || 'Choose the parent folder',
          buttonLabel || 'Choose',
        );
        if (!picked.folder)
          return {
            ok: false,
            cancelled: true,
            error: 'Folder selection cancelled.',
          };
        const folder = await createQuestionnaireFolder(picked.folder, answers);
        return { ok: true, folder };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
  ipcMain.handle(
    'dialog:chooseSaveFolder',
    async (_event, title?: string, buttonLabel?: string) => {
      const titleText =
        typeof title === 'string' && title ? title : 'Choose save folder';
      const buttonText =
        typeof buttonLabel === 'string' && buttonLabel ? buttonLabel : 'Choose';
      const picked = await chooseDirectory(titleText, buttonText);
      return picked.folder;
    },
  );

  ipcMain.handle(
    'save:writeFiles',
    async (
      _event,
      folder: string,
      files: Array<{ filename: string; base64: string }>,
    ) => {
      if (!folder || typeof folder !== 'string') {
        return { ok: false, folder: '', written: [], error: 'No folder' };
      }
      const written: string[] = [];
      try {
        await fs.mkdir(folder, { recursive: true });
        for (const file of files ?? []) {
          const name = path.basename(String(file.filename || 'file.bin'));
          const dest = path.join(folder, name);
          const buf = Buffer.from(String(file.base64 || ''), 'base64');
          await fs.writeFile(dest, buf);
          written.push(name);
        }
        return { ok: true, folder, written };
      } catch (err) {
        return {
          ok: false,
          folder,
          written,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    'save:subjectFolder',
    async (
      _event,
      input: {
        subjectId?: string;
        subjectName?: string;
        heightCm?: string;
        weightKg?: string;
        destination?: 'existing' | 'new';
        folder?: string;
        dialogTitle?: string;
        buttonLabel?: string;
      },
    ) => {
      const subjectId = String(input?.subjectId ?? '').trim();
      const subjectName = String(input?.subjectName ?? '');
      const destination = input?.destination === 'new' ? 'new' : 'existing';
      const title =
        typeof input?.dialogTitle === 'string' && input.dialogTitle
          ? input.dialogTitle
          : destination === 'new'
            ? 'Choose the parent folder'
            : 'Select the subject folder';
      const button =
        typeof input?.buttonLabel === 'string' && input.buttonLabel
          ? input.buttonLabel
          : 'Choose';
      const picked = input?.folder
        ? { folder: input.folder }
        : await chooseDirectory(title, button);
      if (!picked.folder) {
        return {
          ok: false,
          cancelled: true,
          error:
            'Folder selection cancelled. The posture photos are still here.',
        };
      }
      if (!subjectId) {
        return {
          ok: false,
          error: 'Subject ID is required.',
          folder: picked.folder,
        };
      }
      const folder =
        !input?.folder && destination === 'new'
          ? joinSaveFolder(picked.folder, subjectBase(subjectId, subjectName))
          : picked.folder;
      const record = liteServer
        ? subjectWithPosturePhotos(
            liteServer.store.subjects.values(),
            subjectId,
          )
        : null;
      if (record && record.subjectId !== subjectId) {
        console.log(
          `[KneeVidScan-Desktop] posture photos were captured as ${record.subjectId}; saving them as ${subjectId}`,
        );
      }
      const missingCrops = STANDING_SEQUENCE.filter((code) => {
        const png = record?.standing[code]?.png;
        return !png || png.byteLength === 0;
      }).map((code) => standingFileName(subjectId, subjectName, code));
      if (!record || missingCrops.length > 0) {
        return {
          ok: false,
          folder,
          error: `No posture photos saved: ${
            missingCrops.join(', ') || 'subject is not in this session'
          }`,
        };
      }
      const written: string[] = [];
      const missing: Array<{
        filename: string;
        code: StandingCode;
        variant: 'full';
      }> = [];
      try {
        await fs.mkdir(folder, { recursive: true });
        for (const code of STANDING_SEQUENCE) {
          const cropName = path.basename(
            standingFileName(subjectId, subjectName, code),
          );
          await fs.writeFile(
            path.join(folder, cropName),
            record.standing[code]!.png,
          );
          written.push(cropName);
          const full = record.standingFull[code]?.png;
          const fullName = path.basename(
            standingFullFileName(subjectId, subjectName, code),
          );
          if (!full || full.byteLength === 0) {
            missing.push({ filename: fullName, code, variant: 'full' });
            continue;
          }
          await fs.writeFile(path.join(folder, fullName), full);
          written.push(fullName);
        }
        const csvName = path.basename(
          subjectInfoFileName(subjectId, subjectName),
        );
        await fs.writeFile(
          path.join(folder, csvName),
          buildSubjectInfoCsv({
            subjectId,
            subjectName,
            heightCm: String(input?.heightCm ?? ''),
            weightKg: String(input?.weightKg ?? ''),
          }),
          'utf8',
        );
        written.push(csvName);
        console.log(
          `[KneeVidScan-Desktop] saved subject folder ${folder} (${written.length} files)`,
        );
        return { ok: true, folder, written, missing };
      } catch (err) {
        return {
          ok: false,
          folder,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    'save:readFile',
    async (_event, folder: string, filename: string) => {
      if (!folder || typeof folder !== 'string') return null;
      if (!filename || typeof filename !== 'string') return null;
      const root = path.resolve(folder);
      const dest = path.resolve(root, path.basename(filename));
      if (dest !== root && !dest.startsWith(root + path.sep)) return null;
      try {
        const buf = await fs.readFile(dest);
        return buf.toString('base64');
      } catch {
        return null;
      }
    },
  );

  // Allow self-signed local certs for phone preview fetches from the renderer
  // when talking to the Lite HTTPS backend on LAN.
  app.on('certificate-error', (event, _webContents, url, _error, _cert, cb) => {
    try {
      const u = new URL(url);
      const local =
        u.hostname === 'localhost' ||
        u.hostname === '127.0.0.1' ||
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(u.hostname);
      if (local) {
        event.preventDefault();
        cb(true);
        return;
      }
    } catch {
      /* fall through */
    }
    cb(false);
  });

  try {
    const preferHttps = process.env.MOTUSCAP_HTTP !== '1';
    const assetsDir = app.isPackaged
      ? process.resourcesPath
      : path.join(app.getAppPath(), 'assets');
    const mediapipeDir = path.join(assetsDir, 'mediapipe');
    const ffmpegPath = path.join(
      assetsDir,
      'ffmpeg',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    );
    liteServer = await startLiteServer({
      preferHttps,
      mediapipeDir,
      ffmpegPath,
      // Trial videos live here until Save; earlier launches are swept.
      recordingsRoot: path.join(app.getPath('temp'), 'motuscap-lite'),
    });
    console.log(
      `[KneeVidScan-Desktop] backend ${liteServer.apiBase} (PWA ${liteServer.pwaBase})`,
    );
  } catch (err) {
    console.error('[KneeVidScan-Desktop] failed to start local backend', err);
  }

  ipcMain.handle('backend:info', () =>
    liteServer
      ? {
          apiBase: liteServer.apiBase,
          pwaBase: liteServer.pwaBase,
          https: liteServer.https,
          lanHost: liteServer.lanHost,
          port: liteServer.port,
        }
      : null,
  );

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Hold the quit until this launch's temp videos are deleted.
app.on('before-quit', (event) => {
  const server = liteServer;
  if (!server) return;
  liteServer = null;
  event.preventDefault();
  void server
    .close()
    .catch((err) =>
      console.error('[KneeVidScan-Desktop] backend close failed', err),
    )
    .finally(() => app.quit());
});
