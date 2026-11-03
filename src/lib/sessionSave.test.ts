import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrialInfo } from './backendClient';
import type { SaveWriteFile } from './saveExport';

const backend = vi.hoisted(() => ({
  trial: null as null | (() => TrialInfo),
  bytes: new Map<string, Uint8Array>(),
  deleted: [] as string[],
}));

vi.mock('./backendClient', () => ({
  backendClient: {
    baseUrl: () => 'http://127.0.0.1:9',
    getTrial: async () => {
      if (!backend.trial) throw new Error('Trial not found');
      return backend.trial();
    },
    fetchUpload: async (_trialId: string, deviceId: string) =>
      backend.bytes.get(deviceId) ?? null,
    deleteRecordings: async (id: string) => {
      backend.deleted.push(id);
      return { ok: true };
    },
  },
}));

import {
  buildSubjectInfoCsv,
  exportPoseToFolder,
  formatPostureSaveToast,
  formatSaveResultNote,
  formatSaveResultToast,
  rehomeStandingPhotos,
  savePosturePhotos,
  saveSessionToFolder,
  SELECT_SUBJECT_FOLDER_PROMPT,
  CREATE_SUBJECT_FOLDER_PROMPT,
} from './sessionSave';

const writeAll = () =>
  vi.fn(async (folder: string, files: SaveWriteFile[]) => ({
    ok: true,
    folder,
    written: files.map((f) => f.filename),
  }));

const threeCams = [0, 1, 2].map((i) => ({ deviceId: `dev_${i}`, camIndex: i }));

describe('saveSessionToFolder', () => {
  beforeEach(() => {
    backend.trial = null;
    backend.bytes.clear();
    backend.deleted.length = 0;
  });

  it('asks for a folder and names the missing video instead of a placeholder', async () => {
    const chooseFolder = vi.fn(async () => '/tmp/motuscap-save');
    const writeFiles = writeAll();
    const result = await saveSessionToFolder({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      trialName: 'gait01',
      trialId: null,
      camCount: 1,
      devices: [],
      chooseFolder,
      writeFiles,
    });

    expect(chooseFolder).toHaveBeenCalledOnce();
    expect(chooseFolder).toHaveBeenCalledWith(CREATE_SUBJECT_FOLDER_PROMPT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subjectFolder).toBe('/tmp/motuscap-save/UG0001_Chan-Tai-Man');
    expect(result.folder).toBe('/tmp/motuscap-save/UG0001_Chan-Tai-Man/gait01');
    expect(result.written).not.toContain('UG0001_Chan-Tai-Man_gait01.mp4');
    expect(result.written.some((f) => f.includes('standing_'))).toBe(false);
    expect(result.written.some((f) => f.endsWith('_IMU.csv'))).toBe(false);
    expect(result.failedVideos).toEqual([
      {
        filename: 'UG0001_Chan-Tai-Man_gait01.mp4',
        camLabel: 'Cam 1',
        reason: 'no recorded trial',
      },
    ]);
    expect(formatSaveResultToast(result)).toContain('VIDEO NOT SAVED: Cam 1');
    expect(result.clearedTemp).toBe(false);
    expect(writeFiles).toHaveBeenCalledOnce();
  });

  it('cancels when folder dialog returns null', async () => {
    const result = await saveSessionToFolder({
      subjectId: 'UG0001',
      subjectName: 'X',
      trialName: 'gait01',
      trialId: null,
      camCount: 2,
      devices: [],
      chooseFolder: async () => null,
      writeFiles: async () => ({ ok: true, folder: '', written: [] }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cancelled).toBe(true);
  });

  it('writes ready MP4s with view suffixes and then clears the temp copies', async () => {
    backend.trial = () => ({
      trial_id: 'tr_1',
      phase: 'done',
      uploads: Object.fromEntries(
        threeCams.map((d) => [
          d.deviceId,
          { status: 'ready' as const, bytes: 3, filename: 'x.mp4' },
        ]),
      ),
    });
    for (const d of threeCams) {
      backend.bytes.set(d.deviceId, new TextEncoder().encode(d.deviceId));
    }
    const writeFiles = writeAll();
    const result = await saveSessionToFolder({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      trialName: 'gait01',
      trialId: 'tr_1',
      camCount: 3,
      devices: threeCams,
      chooseFolder: async () => '/tmp/out',
      writeFiles,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.folder).toBe('/tmp/out/UG0001_Chan-Tai-Man/gait01');
    expect(writeFiles).toHaveBeenCalledWith(
      '/tmp/out/UG0001_Chan-Tai-Man/gait01',
      expect.any(Array),
    );
    expect(result.written).toEqual(
      expect.arrayContaining([
        'UG0001_Chan-Tai-Man_gait01_F.mp4',
        'UG0001_Chan-Tai-Man_gait01_L.mp4',
        'UG0001_Chan-Tai-Man_gait01_O.mp4',
      ]),
    );
    const lateral = writeFiles.mock.calls[0][1].find((f) =>
      f.filename.endsWith('_L.mp4'),
    )!;
    expect(atob(lateral.base64)).toBe('dev_1');
    expect(lateral.mime).toBe('video/mp4');
    expect(result.failedVideos).toEqual([]);
    expect(result.clearedTemp).toBe(true);
    expect(backend.deleted).toEqual(['tr_1']);
  });

  it('waits for uploading / converting cameras and names the one that failed', async () => {
    let polls = 0;
    backend.trial = () => {
      polls += 1;
      const done = polls >= 3;
      return {
        trial_id: 'tr_1',
        phase: 'done',
        uploads: {
          dev_0: {
            status: done ? 'ready' : 'converting',
            bytes: 5,
            filename: 'a',
          },
          dev_1: {
            status: done ? 'failed' : 'uploading',
            bytes: 2_500_000,
            filename: 'b',
            ...(done ? { error: 'Network lost' } : {}),
          },
        },
      };
    };
    backend.bytes.set('dev_0', new Uint8Array([1, 2, 3]));
    const progress: string[] = [];
    const result = await saveSessionToFolder({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      trialName: 'gait01',
      trialId: 'tr_1',
      camCount: 2,
      devices: threeCams.slice(0, 2),
      chooseFolder: async () => '/tmp/out',
      writeFiles: writeAll(),
      onProgress: (m) => progress.push(m),
      uploadPollMs: 1,
    });
    expect(progress[0]).toBe(
      'Waiting for videos · Cam 1 · Frontal View: Converting to MP4… · Cam 2 · Lateral View (right): Uploading… 2.5 MB',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.written).toContain('UG0001_Chan-Tai-Man_gait01_F.mp4');
    expect(result.written).not.toContain('UG0001_Chan-Tai-Man_gait01_L.mp4');
    expect(result.written.some((f) => f.includes('standing_'))).toBe(false);
    expect(result.failedVideos).toEqual([
      {
        filename: 'UG0001_Chan-Tai-Man_gait01_L.mp4',
        camLabel: 'Cam 2 · Lateral View (right)',
        reason: 'Network lost',
      },
    ]);
    // A missing video keeps every temp copy for a later Save.
    expect(result.clearedTemp).toBe(false);
    expect(backend.deleted).toEqual([]);
  });
});

describe('formatSaveResultToast', () => {
  it('names every camera whose video was not saved', () => {
    const failedVideos = [
      { filename: 'a.mp4', camLabel: 'Cam 2 · L', reason: 'Network lost' },
    ];
    const toast = formatSaveResultToast({
      folder: '/tmp/out',
      written: ['UG0001_Chan-Tai-Man_gait01_F.mp4', 'x.png'],
      failedVideos,
    });
    expect(toast).toContain('Saved to /tmp/out');
    expect(toast).toContain('VIDEO NOT SAVED: Cam 2 · L (Network lost)');
    expect(formatSaveResultNote({ written: ['a', 'b'], failedVideos })).toBe(
      'Saved 2 files · 1 video(s) not saved: Cam 2 · L (Network lost)',
    );
  });

  it('omits the warning when every video was saved', () => {
    const toast = formatSaveResultToast({
      folder: '/tmp/out',
      written: ['UG0001_Chan-Tai-Man_gait01.mp4'],
      failedVideos: [],
    });
    expect(toast).not.toContain('NOT SAVED');
    expect(formatSaveResultNote({ written: ['a'], failedVideos: [] })).toBe(
      'Saved 1 files · just now',
    );
  });
});

describe('exportPoseToFolder', () => {
  it('writes pose CSV/JSON without overlay videos', async () => {
    const writeFiles = vi.fn(
      async (folder: string, files: { filename: string }[]) => ({
        ok: true,
        folder,
        written: files.map((f) => f.filename),
      }),
    );
    const result = await exportPoseToFolder({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      trialName: 'gait01',
      camCount: 1,
      format: 'json',
      chooseFolder: async () => '/tmp/export',
      writeFiles,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.folder).toBe('/tmp/export/UG0001_Chan-Tai-Man/gait01');
    expect(writeFiles).toHaveBeenCalledWith(
      '/tmp/export/UG0001_Chan-Tai-Man/gait01',
      expect.any(Array),
    );
    expect(result.written).toEqual(['UG0001_Chan-Tai-Man_gait01_pose.json']);
    expect(result.written.some((f) => f.endsWith('.mp4'))).toBe(false);
  });

  it('exports full-res re-run frames in MediaPipe units (not height-scaled)', async () => {
    const writeFiles = vi.fn(
      async (
        folder: string,
        files: { filename: string; base64: string }[],
      ) => ({
        ok: true,
        folder,
        written: files.map((f) => f.filename),
      }),
    );
    const { buildStubCamPose } = await import('./fullResPose');
    const cam = buildStubCamPose({
      camIndex: 0,
      camCount: 1,
      durationSec: 1,
      maxFrames: 3,
    });
    const result = await exportPoseToFolder({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      trialName: 'gait01',
      camCount: 1,
      format: 'csv3d',
      poseResult: {
        trialId: 't1',
        trialName: 'gait01',
        model: 'Full',
        params: {
          model: 'Full',
          landmarkSmoothing: true,
          landmarkStrength: 0.5,
          temporalFilter: true,
          filterStrength: 0.5,
          minDetectionConfidence: 0.5,
          minPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        },
        cameras: [cam],
        ranAt: Date.now(),
        note: 'stub',
      },
      chooseFolder: async () => '/tmp/export',
      writeFiles,
    });
    expect(result.ok).toBe(true);
    const body = Buffer.from(
      writeFiles.mock.calls[0][1][0].base64,
      'base64',
    ).toString('utf8');
    expect(body.split('\n')[0]).toMatch(/^Frame,FPS,left_shoulder_x,/);
    expect(body).toContain('-0.55');
    expect(body.startsWith('#')).toBe(false);
    expect(writeFiles.mock.calls[0][0]).toBe(
      '/tmp/export/UG0001_Chan-Tai-Man/gait01',
    );
  });

  it('reuses the subject folder and writes landmarks into the trial subfolder', async () => {
    const chooseFolder = vi.fn(async () => '/should-not-ask');
    const writeFiles = vi.fn(
      async (folder: string, files: { filename: string }[]) => ({
        ok: true,
        folder,
        written: files.map((f) => f.filename),
      }),
    );
    const result = await exportPoseToFolder({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      trialName: 'gait 02',
      camCount: 1,
      format: 'csv2d',
      subjectFolder: '/data/Chan',
      chooseFolder,
      writeFiles,
    });
    expect(chooseFolder).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subjectFolder).toBe('/data/Chan');
    expect(result.folder).toBe('/data/Chan/gait-02');
  });
});

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);

describe('savePosturePhotos', () => {
  it('writes the six real photos at the subject-folder root and skips a missing still', async () => {
    const chooseFolder = vi.fn(async () => '/data/Chan');
    const writeFiles = writeAll();
    const result = await savePosturePhotos({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      heightCm: '172',
      weightKg: '68',
      chooseFolder,
      writeFiles,
      fetchStanding: async (_id, code, variant) => {
        if (code === 'LL' && variant === 'full') return null;
        return PNG;
      },
    });
    expect(chooseFolder).toHaveBeenCalledWith(SELECT_SUBJECT_FOLDER_PROMPT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.folder).toBe('/data/Chan');
    expect(writeFiles).toHaveBeenCalledWith('/data/Chan', expect.any(Array));
    expect(result.written).toEqual([
      'UG0001_Chan-Tai-Man_standing_F.png',
      'UG0001_Chan-Tai-Man_standing_F_full.png',
      'UG0001_Chan-Tai-Man_standing_LL.png',
      'UG0001_Chan-Tai-Man_standing_RL.png',
      'UG0001_Chan-Tai-Man_standing_RL_full.png',
      'UG0001_Chan-Tai-Man_subject.csv',
    ]);
    expect(result.missing).toEqual([
      {
        filename: 'UG0001_Chan-Tai-Man_standing_LL_full.png',
        code: 'LL',
        variant: 'full',
      },
    ]);
    const payloads = writeFiles.mock.calls[0][1].map((f) => f.base64);
    expect(
      payloads.every(
        (p) =>
          p !==
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ),
    ).toBe(true);
    expect(formatPostureSaveToast(result)).toContain('not saved:');
    const csv = Buffer.from(
      writeFiles.mock.calls[0][1].find((f) =>
        f.filename.endsWith('_subject.csv'),
      )!.base64,
      'base64',
    ).toString('utf8');
    expect(csv).toBe(
      buildSubjectInfoCsv({
        subjectId: 'UG0001',
        subjectName: 'Chan Tai Man',
        heightCm: '172',
        weightKg: '68',
      }),
    );
    expect(csv).toBe(
      'subject_id,display_name,height_cm,weight_kg\nUG0001,Chan Tai Man,172,68\n',
    );
  });

  it('does not ask again or write a placeholder when every still is missing', async () => {
    const chooseFolder = vi.fn(async () => '/data/Chan');
    const writeFiles = writeAll();
    const again = await savePosturePhotos({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      heightCm: '172',
      weightKg: '68',
      subjectFolder: '/data/Chan',
      chooseFolder,
      writeFiles,
      fetchStanding: async () => null,
    });
    expect(chooseFolder).not.toHaveBeenCalled();
    expect(writeFiles).not.toHaveBeenCalled();
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.folder).toBe('/data/Chan');
    expect(again.error).toContain('UG0001_Chan-Tai-Man_standing_F.png');
    expect(again.error).not.toContain('iVBORw0KGgo');
  });

  it('creates the subject folder under the chosen parent', async () => {
    const chooseFolder = vi.fn(async () => '/data/Chan');
    const writeFiles = writeAll();
    const result = await savePosturePhotos({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      heightCm: '172',
      weightKg: '68',
      destination: 'new',
      chooseFolder,
      writeFiles,
      fetchStanding: async () => PNG,
    });
    expect(chooseFolder).toHaveBeenCalledWith(CREATE_SUBJECT_FOLDER_PROMPT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.folder).toBe('/data/Chan/UG0001_Chan-Tai-Man');
    expect(writeFiles).toHaveBeenCalledWith(
      '/data/Chan/UG0001_Chan-Tai-Man',
      expect.any(Array),
    );
  });
});

describe('rehomeStandingPhotos', () => {
  it('copies the captured photos onto the subject id in the form', async () => {
    const png = new Uint8Array([1, 2, 3]);
    const fetchStanding = vi.fn(async () => png);
    const saveStanding = vi.fn(async () => ({ ok: true }));
    await rehomeStandingPhotos({
      fromId: 'UG0001',
      toId: 'UG0002',
      subjectName: 'Chan Siu Man',
      fetchStanding,
      saveStanding,
    });
    expect(fetchStanding).toHaveBeenCalledWith('UG0001', 'F', 'crop');
    expect(saveStanding).toHaveBeenCalledWith(
      'UG0002',
      'F',
      'UG0002_Chan-Siu-Man_standing_F.png',
      png,
      'crop',
    );
    expect(saveStanding).toHaveBeenCalledWith(
      'UG0002',
      'RL',
      'UG0002_Chan-Siu-Man_standing_RL_full.png',
      png,
      'full',
    );
  });

  it('does nothing when the form id is the id the photos were captured under', async () => {
    const fetchStanding = vi.fn();
    const saveStanding = vi.fn();
    await rehomeStandingPhotos({
      fromId: 'UG0001',
      toId: 'UG0001',
      subjectName: 'Chan Tai Man',
      fetchStanding,
      saveStanding,
    });
    expect(fetchStanding).not.toHaveBeenCalled();
    expect(saveStanding).not.toHaveBeenCalled();
  });
});
