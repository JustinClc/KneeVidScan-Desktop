import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ExportReportInput, ExportReportResult } from '../preload';

export type ReportPrintWindow = {
  loadFile: (file: string) => Promise<unknown>;
  webContents: {
    printToPDF: (options: {
      printBackground: boolean;
      preferCSSPageSize: boolean;
      pageSize: 'A4';
    }) => Promise<Buffer>;
  };
  destroy: () => void;
};

/** The PDF is persisted before opening; an opening failure never hides a saved report. */
export async function exportReportPdf(
  input: ExportReportInput,
  deps: {
    createWindow: () => ReportPrintWindow;
    openPath: (file: string) => Promise<string>;
  },
): Promise<ExportReportResult> {
  let win: ReportPrintWindow | undefined;
  let tempFolder: string | undefined;
  try {
    if (
      !input ||
      typeof input.folder !== 'string' ||
      !path.isAbsolute(input.folder)
    )
      throw new Error('A subject folder is required.');
    if (
      typeof input.filename !== 'string' ||
      /[\\/]/.test(input.filename) ||
      !input.filename.endsWith('.pdf')
    )
      throw new Error('Invalid report filename.');
    if (
      typeof input.html !== 'string' ||
      input.html.length > 50_000_000 ||
      !input.html.includes('assessment-report')
    )
      throw new Error('Invalid report document.');
    const folder = await fs.stat(input.folder);
    if (!folder.isDirectory())
      throw new Error('The subject folder is unavailable.');
    win = deps.createWindow();
    const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`;
    // Keep the doctype first so Chromium uses the same standards layout as
    // the desktop preview. Prefixing a meta tag would trigger quirks mode.
    if (!input.html.includes('<head>'))
      throw new Error('Invalid report document.');
    const html = input.html.replace('<head>', `<head>${policy}`);
    // Full-resolution embedded PNGs can exceed Chromium's navigation URL
    // limit. Keep the document on disk so its size does not affect the URL.
    tempFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'kneevid-report-'));
    const documentPath = path.join(tempFolder, 'report.html');
    await fs.writeFile(documentPath, html, { mode: 0o600 });
    await win.loadFile(documentPath);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
    });
    const destination = path.join(input.folder, input.filename);
    // Unique filenames are supplied by the renderer. Never replace an existing report.
    await fs.writeFile(destination, pdf, { flag: 'wx' });
    let openError: string | undefined;
    try {
      openError = (await deps.openPath(destination)) || undefined;
    } catch (error) {
      openError = error instanceof Error ? error.message : String(error);
    }
    return { ok: true, path: destination, ...(openError ? { openError } : {}) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      win?.destroy();
    } finally {
      if (tempFolder)
        await fs
          .rm(tempFolder, { recursive: true, force: true })
          .catch(() => {});
    }
  }
}
