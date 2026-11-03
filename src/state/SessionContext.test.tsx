import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendClient } from '../lib/backendClient';
import { SessionProvider, useSession } from './SessionContext';

function Controls() {
  const state = useSession();
  return (
    <>
      <button
        onClick={() => {
          state.setDevicesFromBackend([
            { deviceId: 'phone-1', name: 'Phone', camIndex: 0, viewCode: null },
          ]);
          state.setSubjectId('P001');
          state.setQuestionnaire({
            ...state.questionnaire,
            name: 'P001',
            age: '50',
          });
          state.setQuestionnaireCompleted(true);
          state.setHeightCm('170');
          state.recordTrial({
            id: 'trial-1',
            name: 'gait01',
            startAtMs: 1,
            durationSec: 3,
            stoppedAt: 4,
          });
          state.go(7);
        }}
      >
        Seed assessment
      </button>
      <button onClick={() => void state.resetSession()}>
        Reset for future report
      </button>
      <output data-testid="session-state">
        {JSON.stringify({
          screen: state.screen,
          devices: state.devices,
          camCount: state.camCount,
          subjectId: state.subjectId,
          questionnaire: state.questionnaire,
          completed: state.questionnaireCompleted,
          trials: state.trials,
        })}
      </output>
    </>
  );
}

afterEach(() => vi.restoreAllMocks());
describe('assessment lifecycle', () => {
  it('clears assessment data and returns Home while retaining camera connections', async () => {
    const remove = vi
      .spyOn(backendClient, 'removeDevice')
      .mockResolvedValue({ ok: true });
    const deleted = vi
      .spyOn(backendClient, 'deleteRecordings')
      .mockResolvedValue({ ok: true });
    render(
      <SessionProvider>
        <Controls />
      </SessionProvider>,
    );
    fireEvent.click(screen.getByText('Seed assessment'));
    fireEvent.click(screen.getByText('Reset for future report'));
    await waitFor(() => {
      const state = JSON.parse(
        screen.getByTestId('session-state').textContent!,
      );
      expect(state).toMatchObject({
        screen: 0,
        camCount: 1,
        subjectId: '',
        completed: false,
        questionnaire: { name: '', age: '' },
        trials: [],
      });
      expect(state.devices).toHaveLength(1);
      expect(state.devices[0].deviceId).toBe('phone-1');
    });
    expect(remove).not.toHaveBeenCalled();
    expect(deleted).toHaveBeenCalledWith('trial-1');
  });
});
