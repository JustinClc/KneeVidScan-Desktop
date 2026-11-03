import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportReportPdf } from './reportExport';

let folder: string;
beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'knee-report-'));
});
afterEach(async () => {
  await fs.rm(folder, { recursive: true, force: true });
});
function fixture() {
  const win = {
    loadFile: vi.fn(async (file: string) => {
      expect(await fs.readFile(file, 'utf8')).toContain("default-src 'none'");
    }),
    webContents: { printToPDF: vi.fn(async () => Buffer.from('%PDF-test')) },
    destroy: vi.fn(),
  };
  const openPath = vi.fn(async (file: string) => {
    expect(await fs.readFile(file, 'utf8')).toBe('%PDF-test');
    return '';
  });
  return {
    win,
    deps: { createWindow: () => win, openPath },
    input: {
      folder,
      filename: 'report.pdf',
      html: '<!DOCTYPE html><html><head></head><body class="assessment-report">Report</body></html>',
    },
  };
}
describe('report PDF persistence', () => {
  it('prints with backgrounds, saves before opening, and destroys the print window', async () => {
    const { win, deps, input } = fixture();
    const result = await exportReportPdf(input, deps);
    expect(result).toEqual({ ok: true, path: path.join(folder, 'report.pdf') });
    expect(deps.openPath).toHaveBeenCalledOnce();
    expect(win.loadFile).toHaveBeenCalledOnce();
    await expect(
      fs.stat(path.dirname(win.loadFile.mock.calls[0][0])),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(win.webContents.printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
    });
    expect(win.destroy).toHaveBeenCalledOnce();
  });
  it('reports opening failures separately from a successful save', async () => {
    const { deps, input } = fixture();
    deps.openPath.mockResolvedValue('No PDF viewer');
    expect(await exportReportPdf(input, deps)).toEqual({
      ok: true,
      path: path.join(folder, 'report.pdf'),
      openError: 'No PDF viewer',
    });
    expect(await fs.readFile(path.join(folder, 'report.pdf'), 'utf8')).toBe(
      '%PDF-test',
    );
  });
  it('cleans up a failed print and never opens a nonexistent report', async () => {
    const { win, deps, input } = fixture();
    win.webContents.printToPDF.mockRejectedValue(new Error('Print failed'));
    expect(await exportReportPdf(input, deps)).toEqual({
      ok: false,
      error: 'Print failed',
    });
    expect(deps.openPath).not.toHaveBeenCalled();
    expect(win.destroy).toHaveBeenCalledOnce();
    expect(await fs.readdir(folder)).toEqual([]);
    await expect(
      fs.stat(path.dirname(win.loadFile.mock.calls[0][0])),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects traversal and preserves an existing report', async () => {
    const { win, deps, input } = fixture();
    expect(
      (await exportReportPdf({ ...input, filename: '../report.pdf' }, deps)).ok,
    ).toBe(false);
    expect(win.loadFile).not.toHaveBeenCalled();
    await fs.writeFile(path.join(folder, 'report.pdf'), 'original');
    expect((await exportReportPdf(input, deps)).ok).toBe(false);
    expect(await fs.readFile(path.join(folder, 'report.pdf'), 'utf8')).toBe(
      'original',
    );
    expect(deps.openPath).not.toHaveBeenCalled();
  });
  it('loads a report with large embedded images from a short file path and removes it afterward', async () => {
    const { win, deps, input } = fixture();
    const image = 'data:image/png;base64,' + 'A'.repeat(12_000_000);
    const html = input.html.replace(
      'Report</body>',
      `<img src="${image}">Report</body>`,
    );
    win.loadFile.mockImplementation(async (file) => {
      expect(file.length).toBeLessThan(1024);
      const document = await fs.readFile(file, 'utf8');
      expect(document).toContain(image);
      expect(document.startsWith('<!DOCTYPE html>')).toBe(true);
    });
    expect((await exportReportPdf({ ...input, html }, deps)).ok).toBe(true);
    await expect(
      fs.stat(path.dirname(win.loadFile.mock.calls[0][0])),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('removes the temporary document when navigation fails', async () => {
    const { win, deps, input } = fixture();
    win.loadFile.mockRejectedValue(new Error('Load failed'));
    expect(await exportReportPdf(input, deps)).toEqual({
      ok: false,
      error: 'Load failed',
    });
    await expect(
      fs.stat(path.dirname(win.loadFile.mock.calls[0][0])),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(win.destroy).toHaveBeenCalledOnce();
    expect(deps.openPath).not.toHaveBeenCalled();
  });
});
