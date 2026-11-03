import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyQuestionnaire } from '../lib/questionnaire';
import { setLocale } from '../lib/locale';
import { FinalReport } from './FinalReport';

const session = vi.hoisted(() => ({
  go: vi.fn(),
  resetSession: vi.fn(async () => {}),
  showToast: vi.fn(),
  subjectId: 'S001',
  subjectName: '<script>name</script>',
  heightCm: '170',
  weightKg: '65',
  questionnaire: {} as ReturnType<typeof emptyQuestionnaire>,
  subjectFolderById: { S001: '/tmp/subject' },
  sessionEpoch: { current: 0 },
  trialRecords: [],
}));
vi.mock('../state/SessionContext', () => ({ useSession: () => session }));
vi.mock('../lib/backendClient', () => ({
  backendClient: { publishLocale: async () => {} },
}));

beforeEach(() => {
  vi.clearAllMocks();
  session.questionnaire = {
    ...emptyQuestionnaire(),
    name: 'Name',
    age: '65',
    sex: 'Male',
  };
  window.motuscapLite = {
    platform: 'darwin',
    getBackendInfo: async () => null,
    chooseSaveFolder: async () => null,
    writeSaveFiles: async () => ({ ok: true, folder: '', written: [] }),
    readSaveFile: vi.fn(async () => 'iVBORw0KGgo='),
    exportReport: vi.fn(async () => ({
      ok: true as const,
      path: '/tmp/subject/report.pdf',
    })),
  };
});

describe('final report', () => {
  it('uses only the three saved annotated photos and exports the selected language', async () => {
    setLocale('zh-Hant');
    render(<FinalReport />);
    await waitFor(() =>
      expect(screen.getByTestId('report-export')).toBeEnabled(),
    );
    const reads = vi
      .mocked(window.motuscapLite!.readSaveFile)
      .mock.calls.map(([, name]) => name);
    expect(reads).toEqual([
      'S001_<script>name</script>_standing_F_annotated.png',
      'S001_<script>name</script>_standing_LL_annotated.png',
      'S001_<script>name</script>_standing_RL_annotated.png',
    ]);
    const images = screen
      .getAllByRole('img')
      .filter((el) => el.tagName === 'IMG');
    expect(images).toHaveLength(4);
    expect(
      images.every((el) =>
        el.getAttribute('src')?.startsWith('data:image/png;base64,'),
      ),
    ).toBe(true);
    fireEvent.click(screen.getByTestId('report-export'));
    await waitFor(() =>
      expect(screen.getByTestId('report-saved-path')).toHaveTextContent(
        '/tmp/subject/report.pdf',
      ),
    );
    const input = vi.mocked(window.motuscapLite!.exportReport!).mock
      .calls[0][0];
    expect(input.folder).toBe('/tmp/subject');
    expect(input.filename).not.toMatch(/[<>/\\]/);
    expect(input.html).toContain('lang="zh-HK"');
    expect(input.html).toContain('膝關節炎風險評估結果');
    expect(input.html).toContain('示例結果');
    expect(input.html).toContain('&lt;script&gt;name&lt;/script&gt;');
    expect(input.html).not.toContain('<script>');
    expect(session.showToast).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/subject/report.pdf'),
      10000,
    );
  });
  it('shows absent images without falling back to clean photos and ends the assessment', async () => {
    vi.mocked(window.motuscapLite!.readSaveFile).mockResolvedValue(null);
    render(<FinalReport />);
    await waitFor(() =>
      expect(screen.getByTestId('report-export')).toBeEnabled(),
    );
    expect(
      screen.getAllByText('Annotated posture image unavailable'),
    ).toHaveLength(4);
    expect(screen.getAllByRole('img')).toHaveLength(6); // Six accessible gauges, no patient images.
    fireEvent.click(screen.getByTestId('report-end-assessment'));
    await waitFor(() => expect(session.resetSession).toHaveBeenCalledOnce());
  });
  it('keeps the assessment open when export fails', async () => {
    vi.mocked(window.motuscapLite!.exportReport!).mockResolvedValue({
      ok: false,
      error: 'Disk full',
    });
    render(<FinalReport />);
    await waitFor(() =>
      expect(screen.getByTestId('report-export')).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId('report-export'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Disk full'),
    );
    expect(screen.queryByTestId('report-saved-path')).not.toBeInTheDocument();
    expect(session.resetSession).not.toHaveBeenCalled();
  });
});
