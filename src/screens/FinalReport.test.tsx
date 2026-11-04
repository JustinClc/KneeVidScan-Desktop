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
  trialName: 'sts01',
  camCount: 1,
  setAnalysisRecovery: vi.fn(),
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
    analyzeAssessment: vi.fn(async () => ({
      ok: true as const,
      result: {
        version: 'test',
        risk: 62.34,
        mobility: 71,
        alignmentLeft: 0.52,
        alignmentRight: 6.64,
        extensionLeft: 5.25,
        extensionRight: 0.97,
        riskText: 'Assessment risk text',
        advice: ['Assessment advice'],
        videoMeasurements: { STS5_pace: 20 },
        featureImportance: {},
      },
    })),
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
    expect(input.html).not.toContain('示例結果');
    expect(input.html).toContain('62.34');
    expect(input.html).toContain('Assessment risk text');
    expect(input.html).not.toContain('17.5');
    expect(window.motuscapLite!.analyzeAssessment).toHaveBeenCalledOnce();
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
  it('routes an image failure to recapture and blocks PDF export', async () => {
    vi.mocked(window.motuscapLite!.analyzeAssessment!).mockResolvedValue({
      ok: false,
      code: 'pose',
      step: 4,
      field: 'LL',
    });
    render(<FinalReport />);
    await screen.findByTestId('analysis-failure');
    expect(screen.getByTestId('report-export')).toBeDisabled();
    expect(screen.queryByTestId('assessment-report')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('analysis-correct'));
    expect(session.setAnalysisRecovery).toHaveBeenCalledWith({
      ok: false,
      code: 'pose',
      step: 4,
      field: 'LL',
    });
    expect(session.go).toHaveBeenCalledWith(4);
  });
  it('keeps runtime failures on the report for retry without requesting a retake', async () => {
    vi.mocked(window.motuscapLite!.analyzeAssessment!).mockResolvedValue({
      ok: false,
      code: 'runtime',
      step: 7,
    });
    render(<FinalReport />);
    await screen.findByTestId('analysis-failure');
    expect(screen.queryByTestId('analysis-correct')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-export')).toBeDisabled();
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
