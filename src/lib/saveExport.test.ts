import { describe, expect, it } from 'vitest';
import {
  buildPose2dCsv,
  buildPose3dCsv,
  buildPose3dTrc,
  buildPoseJson,
  EXPORT_LANDMARKS,
  listSaveFilenames,
  planPoseExport,
  planPosturePhotos,
  planSessionSave,
} from './saveExport';
import {
  imuCsvFileName,
  poseExportFileName,
  recordingVideoFileName,
} from './naming';

describe('save / export naming plans', () => {
  it('plans multi-cam videos with F/L/O and no posture photos or IMU by default', () => {
    const plan = planSessionSave({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      trialName: 'gait01',
      camCount: 3,
    });
    expect(plan.folderRequired).toBe(true);
    expect(plan.videos.map((v) => v.filename)).toEqual([
      'UG0001_Chan-Tai-Man_gait01_F.mp4',
      'UG0001_Chan-Tai-Man_gait01_L.mp4',
      'UG0001_Chan-Tai-Man_gait01_O.mp4',
    ]);
    expect(plan.videos.map((v) => v.viewCode)).toEqual(['F', 'L', 'O']);
    expect(plan.imuCsv).toBeNull();
    expect(listSaveFilenames(plan)).toEqual([
      'UG0001_Chan-Tai-Man_gait01_F.mp4',
      'UG0001_Chan-Tai-Man_gait01_L.mp4',
      'UG0001_Chan-Tai-Man_gait01_O.mp4',
    ]);
  });

  it('single-cam video has no view suffix', () => {
    const plan = planSessionSave({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      trialName: 'gait01',
      camCount: 1,
    });
    expect(plan.videos).toEqual([
      {
        filename: 'UG0001_Chan-Tai-Man_gait01.mp4',
        camIndex: 0,
        viewCode: null,
      },
    ]);
    expect(
      recordingVideoFileName('UG0001', 'Chan Tai Man', 'gait01', 1, 0),
    ).toBe('UG0001_Chan-Tai-Man_gait01.mp4');
  });

  it('keeps non-ASCII names; only spaces → hyphens', () => {
    const plan = planSessionSave({
      subjectId: 'UG0002',
      subjectName: '陳 大文',
      trialName: 'walk02',
      camCount: 2,
    });
    expect(plan.videos[0].filename).toBe('UG0002_陳-大文_walk02_F.mp4');
    expect(
      planPosturePhotos({
        subjectId: 'UG0002',
        subjectName: '陳 大文',
      })[4].filename,
    ).toBe('UG0002_陳-大文_standing_RL.png');
  });

  it('plans six posture photos with no trial in the name', () => {
    expect(
      planPosturePhotos({
        subjectId: 'UG0001',
        subjectName: 'Chan Tai Man',
      }).map((p) => p.filename),
    ).toEqual([
      'UG0001_Chan-Tai-Man_standing_F.png',
      'UG0001_Chan-Tai-Man_standing_F_full.png',
      'UG0001_Chan-Tai-Man_standing_LL.png',
      'UG0001_Chan-Tai-Man_standing_LL_full.png',
      'UG0001_Chan-Tai-Man_standing_RL.png',
      'UG0001_Chan-Tai-Man_standing_RL_full.png',
    ]);
  });

  it('IMU csv name helper exists but Save plan skips it until backend', () => {
    expect(imuCsvFileName('UG0001', 'Chan Tai Man', 'gait01')).toBe(
      'UG0001_Chan-Tai-Man_gait01_IMU.csv',
    );
    const withImu = planSessionSave({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      trialName: 'gait01',
      camCount: 1,
      includeImuCsv: true,
    });
    expect(withImu.imuCsv).toBe('UG0001_Chan-Tai-Man_gait01_IMU.csv');
  });

  it('pose export plans one file per view, with no overlay', () => {
    const csv = planPoseExport({
      subjectId: 'UG0001',
      subjectName: 'Chan Tai Man',
      trialName: 'gait01',
      camCount: 2,
      format: 'csv3d',
      camIndex: 'all',
    });
    expect(csv.every((p) => p.overlay === false)).toBe(true);
    expect(csv.map((p) => p.camIndex)).toEqual([0, 1]);
    expect(csv.map((p) => p.filename)).toEqual([
      'UG0001_Chan-Tai-Man_gait01_F_pose3d.csv',
      'UG0001_Chan-Tai-Man_gait01_L_pose3d.csv',
    ]);
    expect(
      poseExportFileName('UG0001', 'Chan Tai Man', 'gait01', 1, 0, 'json'),
    ).toBe('UG0001_Chan-Tai-Man_gait01_pose.json');
    expect(
      poseExportFileName('UG0001', 'Chan Tai Man', 'gait01', 1, 0, 'csv2d'),
    ).toBe('UG0001_Chan-Tai-Man_gait01_pose2d.csv');
    expect(
      poseExportFileName('UG0001', 'Chan Tai Man', 'gait01', 2, 0, 'trc'),
    ).toBe('UG0001_Chan-Tai-Man_gait01_F_pose3d.trc');
  });

  const landmarkHeader = (suffix: string) =>
    EXPORT_LANDMARKS.map((lm) => `${lm.name}_${suffix}`).join(',');

  it('writes 2D CSV in the lab column order, with confidence and video size', () => {
    const points = Array.from({ length: 33 }, () => ({
      x: 0,
      y: 0,
      visibility: 0,
    }));
    points[23] = { x: 0.42, y: 0.55, visibility: 0.87 };
    const csv = buildPose2dCsv({
      fps: 15,
      videoWidth: 1920,
      videoHeight: 1080,
      frames: [
        { frame: 0, time_s: 0, landmarks2d: points, landmarks3d: [] },
        { frame: 1, time_s: 1 / 15, landmarks2d: [], landmarks3d: [] },
      ],
    });
    const [header, row, blank] = csv.trim().split('\n');
    expect(header).toBe(
      [
        'Frame',
        'FPS',
        landmarkHeader('x'),
        landmarkHeader('y'),
        landmarkHeader('p'),
        'VideoWidth',
        'VideoHeight',
      ].join(','),
    );
    expect(
      header.startsWith(
        'Frame,FPS,left_shoulder_x,right_shoulder_x,left_hip_x,right_hip_x,',
      ),
    ).toBe(true);
    const cells = row.split(',');
    const hipX = header.split(',').indexOf('left_hip_x');
    const hipY = header.split(',').indexOf('left_hip_y');
    const hipP = header.split(',').indexOf('left_hip_p');
    expect(cells[0]).toBe('1');
    expect(cells[1]).toBe('15');
    expect(cells[hipX]).toBe('0.42');
    expect(cells[hipY]).toBe('0.55');
    expect(cells[hipP]).toBe('0.87');
    expect(cells.at(-2)).toBe('1920');
    expect(cells.at(-1)).toBe('1080');
    expect(
      blank
        .split(',')
        .slice(2, -2)
        .every((c) => c === ''),
    ).toBe(true);
    expect(csv.startsWith('#')).toBe(false);
  });

  it('writes 3D CSV in raw metres and TRC in Y-up metres with Pose2Sim names', () => {
    const points = Array.from({ length: 33 }, () => ({
      x: 0,
      y: 0,
      z: 0,
      visibility: 1,
    }));
    points[11] = { x: 0.1, y: 0.2, z: 0.3, visibility: 0.66 };
    const frames = [
      { frame: 0, time_s: 0, landmarks3d: points },
      { frame: 1, time_s: 1 / 15, landmarks3d: [] },
    ];
    const csv = buildPose3dCsv({ fps: 15, frames });
    const header = csv.trim().split('\n')[0];
    expect(header).toBe(
      [
        'Frame',
        'FPS',
        landmarkHeader('x'),
        landmarkHeader('y'),
        landmarkHeader('z'),
        landmarkHeader('p'),
      ].join(','),
    );
    const row = csv.trim().split('\n')[1].split(',');
    const cols = header.split(',');
    expect(row[cols.indexOf('left_shoulder_x')]).toBe('0.1');
    expect(row[cols.indexOf('left_shoulder_y')]).toBe('0.2');
    expect(row[cols.indexOf('left_shoulder_z')]).toBe('0.3');
    expect(row[cols.indexOf('left_shoulder_p')]).toBe('0.66');

    const trc = buildPose3dTrc({
      filename: 'trial_pose3d.trc',
      fps: 15,
      frames,
    });
    const lines = trc.trim().split('\n');
    expect(lines[0]).toBe('PathFileType\t4\t(X/Y/Z)\ttrial_pose3d.trc');
    expect(lines[1]).toContain('Units');
    expect(lines[2].split('\t')[4]).toBe('m');
    expect(lines[2].split('\t')[3]).toBe('19');
    expect(lines[3]).toContain('LShoulder');
    expect(lines[3]).toContain('LBigToe');
    expect(lines[3]).not.toContain('LEar');
    expect(lines[3]).not.toContain('left_shoulder');
    const data = lines[5].split('\t');
    const shoulder = lines[3].split('\t').indexOf('LShoulder');
    expect(data[shoulder]).toBe('0.1');
    expect(data[shoulder + 1]).toBe('-0.2');
    expect(data[shoulder + 2]).toBe('-0.3');
    expect(lines).toHaveLength(7);
  });

  it('JSON keeps raw 2D and 3D plus the video size', () => {
    const json = JSON.parse(
      buildPoseJson({
        subjectId: 'UG0001',
        subjectName: 'Chan Tai Man',
        trialName: 'gait01',
        camCount: 1,
        viewLabel: 'Cam 1',
        camIndex: 0,
        fps: 15,
        videoWidth: 1280,
        videoHeight: 720,
        frames: [
          {
            frame: 0,
            time_s: 0,
            landmarks2d: [{ x: 0.25, y: 0.5, visibility: 1 }],
            landmarks3d: [{ x: 0.01, y: 0.2, z: 0, visibility: 1 }],
          },
        ],
        source: 'mediapipe',
      }),
    );
    expect(json.units).toBe('mediapipe');
    expect(json.overlay_on_video).toBe(false);
    expect(json.video_width).toBe(1280);
    expect(json.video_height).toBe(720);
    expect(json.frames[0].landmarks2d[0].x).toBeCloseTo(0.25);
    expect(json.frames[0].landmarks3d[0].y).toBeCloseTo(0.2);
    expect(json.note).toMatch(/hip-centred/i);
  });
});
