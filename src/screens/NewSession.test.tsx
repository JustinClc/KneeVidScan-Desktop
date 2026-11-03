import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewSession } from './NewSession';
import { SessionProvider, useSession } from '../state/SessionContext';
import { setLocale } from '../lib/locale';

function State() {
  const state = useSession();
  return (
    <output data-testid="state">
      {JSON.stringify({
        answers: state.questionnaire,
        screen: state.screen,
        completed: state.questionnaireCompleted,
        folders: state.subjectFolderById,
        height: state.heightCm,
        weight: state.weightKg,
        id: state.subjectId,
      })}
    </output>
  );
}
function setup() {
  render(
    <SessionProvider>
      <NewSession />
      <State />
    </SessionProvider>,
  );
}
function fill() {
  for (const [label, value] of [
    ['Name/SID', 'P001'],
    ['Age', '45'],
    ['Height (m)', '1.72'],
    ['Weight (kg)', '68'],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  for (const group of screen.getAllByRole('group')) {
    fireEvent.click(within(group).getAllByRole('radio')[0]);
  }
}
describe('intake questionnaire', () => {
  beforeEach(() => {
    window.motuscapLite = {
      ...window.motuscapLite!,
      saveQuestionnaire: vi.fn(async () => ({
        ok: true as const,
        folder: '/tmp/2026-11-04_P001',
      })),
    };
  });
  it('requires every answer except phone and preserves zero pain on submit', async () => {
    setup();
    expect(screen.getByTestId('questionnaire-submit')).toBeDisabled();
    expect(screen.getByLabelText('Tel.')).not.toBeRequired();
    fill();
    expect(screen.getByTestId('questionnaire-submit')).toBeEnabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId('questionnaire-submit'));
    });
    const state = JSON.parse(screen.getByTestId('state').textContent!);
    expect(state).toMatchObject({
      screen: 4,
      completed: true,
      folders: { P001: '/tmp/2026-11-04_P001' },
      height: '172',
      weight: '68',
      id: 'P001',
      answers: { phone: '', pain: '0' },
    });
  });
  it('stays on the questionnaire after cancellation or a disk error and supports retry', async () => {
    const save = vi.mocked(window.motuscapLite!.saveQuestionnaire!);
    save
      .mockResolvedValueOnce({ ok: false, cancelled: true, error: 'Cancelled' })
      .mockResolvedValueOnce({ ok: false, error: 'Disk full' });
    setup();
    fill();
    for (let attempt = 0; attempt < 2; attempt++) {
      await act(async () => {
        fireEvent.click(screen.getByTestId('questionnaire-submit'));
      });
      expect(
        JSON.parse(screen.getByTestId('state').textContent!),
      ).toMatchObject({ screen: 0, completed: false, folders: {} });
    }
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full');
    await act(async () => {
      fireEvent.click(screen.getByTestId('questionnaire-submit'));
    });
    expect(JSON.parse(screen.getByTestId('state').textContent!).screen).toBe(4);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'P001', pain: '0', phone: '' }),
      'Choose the parent folder',
      'Choose',
    );
  });
  it('prevents duplicate submissions while choosing or saving a folder', async () => {
    let finish!: (result: { ok: true; folder: string }) => void;
    const save = vi.mocked(window.motuscapLite!.saveQuestionnaire!);
    save.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    setup();
    fill();
    fireEvent.click(screen.getByTestId('questionnaire-submit'));
    fireEvent.submit(
      screen.getByTestId('questionnaire-submit').closest('form')!,
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('questionnaire-submit')).toBeDisabled();
    expect(screen.getByLabelText('Name/SID')).toBeDisabled();
    await act(async () => {
      finish({ ok: true, folder: '/tmp/subject' });
    });
    expect(JSON.parse(screen.getByTestId('state').textContent!).screen).toBe(4);
  });
  it('rejects nonnumeric measurements including pasted text and out-of-range values', () => {
    setup();
    fill();
    const height = screen.getByLabelText('Height (m)');
    for (const value of ['1e2', '-1', '1.7m', '1.2.3']) {
      fireEvent.change(height, { target: { value } });
      expect(height).toHaveValue('1.72');
    }
    fireEvent.change(height, { target: { value: '2.4' } });
    expect(screen.getByTestId('questionnaire-submit')).toBeDisabled();
    fireEvent.submit(
      screen.getByTestId('questionnaire-submit').closest('form')!,
    );
    expect(JSON.parse(screen.getByTestId('state').textContent!).screen).toBe(0);
    fireEvent.change(height, { target: { value: '0.8' } });
    fireEvent.change(screen.getByLabelText('Weight (kg)'), {
      target: { value: 'abc' },
    });
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue('68');
    expect(screen.getByTestId('questionnaire-submit')).toBeEnabled();
  });
  it('uses the supplied question order and Chinese wording without losing answers', () => {
    setup();
    expect(
      [...document.querySelectorAll('.questionnaire-question')].map((el) =>
        el.querySelector('legend, label')?.textContent?.replace('*', ''),
      ),
    ).toEqual([
      'Name/SID',
      'Tel.',
      'Age',
      'Sex',
      'Height (m)',
      'Weight (kg)',
      'Smoking habit',
      'Work activity level',
      'Diabetes history',
      'History of knee injury affecting mobility for more than 2 weeks',
      'History of knee surgery',
      'Persistent clicking sound in the knee',
      'Use of walking aid',
      'Degree of knee pain within the recent month (0: no pain, 10: the most painful)',
    ]);
    fill();
    act(() => setLocale('zh-Hant'));
    expect(screen.getByLabelText('姓名/編號')).toHaveValue('P001');
    expect(screen.getByText('日常活動水平')).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: /吸煙習慣/ })).getByLabelText(
        '有',
      ),
    ).toBeChecked();
    expect(
      within(screen.getByRole('group', { name: /糖尿病病史/ })).getByLabelText(
        '沒有',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('膝關節持續有摩擦聲出現 (咔噠聲)'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交報告' })).toBeEnabled();
  });
});
