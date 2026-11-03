import { describe, expect, it, vi } from 'vitest';
import {
  applyViewTransforms,
  buildPoseFrames,
  buildStubCamPose,
  DEFAULT_POSE_PARAMS,
  describeCamPoseStatus,
  landmarkerOptionsFromParams,
  MP3D,
  runFullResPoseEstimation,
  scaleLandmarksForView,
  stubWorldLandmarks,
  videoBlobFromBase64,
} from './fullResPose';
import { poseModelToComplexity } from './poseCheck';
import { poseTaskFile } from './mediapipePose';

describe('fullResPose', () => {
  it('builds a stub cam sequence in MediaPipe units (hip-centred)', () => {
    const cam = buildStubCamPose({
      camIndex: 0,
      camCount: 1,
      durationSec: 2,
      fps: 12,
      maxFrames: 24,
    });
    expect(cam.source).toBe('stub');
    expect(cam.frames.length).toBeGreaterThan(0);
    expect(cam.frames[0].landmarks3d).toHaveLength(33);
    expect(cam.frames[0].landmarks2d).toHaveLength(33);
    // Hips near origin (MediaPipe world convention)
    const lHip = cam.frames[0].landmarks3d[23];
    const rHip = cam.frames[0].landmarks3d[24];
    expect(Math.abs((lHip.x + rHip.x) / 2)).toBeLessThan(0.05);
    expect(Math.abs((lHip.y + rHip.y) / 2)).toBeLessThan(0.05);
  });

  it('scale-to-height is view-only and does not mutate source landmarks', () => {
    const src = stubWorldLandmarks(0);
    const copy = src.map((p) => ({ ...p }));
    const scaled = scaleLandmarksForView(src, 180);
    expect(src).toEqual(copy);
    const srcSpan =
      Math.max(...src.map((p) => p.y)) - Math.min(...src.map((p) => p.y));
    const scaledSpan =
      Math.max(...scaled.map((p) => p.y)) - Math.min(...scaled.map((p) => p.y));
    expect(Math.abs(scaledSpan - 1.8)).toBeLessThan(0.05);
    expect(Math.abs(srcSpan - 1.8)).toBeGreaterThan(0.1);
  });

  it('applyViewTransforms can lock hips without changing export data', () => {
    const src = stubWorldLandmarks(0.5);
    const viewed = applyViewTransforms(src, {
      scaleToHeight: false,
      heightCm: 172,
      lockHips: true,
    });
    expect(viewed).toHaveLength(33);
    expect(src[23].y).toBe(stubWorldLandmarks(0.5)[23].y);
  });

  it('stores MediaPipe y-down and flips y only for the view', () => {
    const src = stubWorldLandmarks(0);
    expect(src[MP3D.lShoulder].y).toBeLessThan(0);
    const viewed = applyViewTransforms(src, {
      scaleToHeight: false,
      heightCm: 172,
      lockHips: false,
    });
    expect(viewed[MP3D.lShoulder].y).toBeGreaterThan(0);
    expect(src[MP3D.lShoulder].y).toBeLessThan(0);
  });

  it('keeps a frame index when a sample has no detection, and takes 3D only from world landmarks', () => {
    const built = buildPoseFrames([
      {
        time_s: 0,
        landmarks2d: [{ x: 0.2, y: 0.3, visibility: 0.9 }],
        worldLandmarks: [{ x: 0.1, y: 0.2, z: 0.3, visibility: 0.8 }],
      },
      { time_s: 0.1, landmarks2d: null, worldLandmarks: null },
      {
        time_s: 0.2,
        landmarks2d: [{ x: 0.4, y: 0.5 }],
        worldLandmarks: null,
      },
    ]);
    expect(built.frames).toHaveLength(3);
    expect(built.frames[1].frame).toBe(1);
    expect(built.frames[1].landmarks2d).toEqual([]);
    expect(built.frames[1].landmarks3d).toEqual([]);
    expect(built.frames[0].landmarks3d[0].z).toBe(0.3);
    expect(built.frames[2].landmarks3d).toEqual([]);
    expect(built.had2dLandmarks).toBe(true);
    expect(built.hadWorldLandmarks).toBe(true);
  });

  it('runFullResPoseEstimation soft-stubs when WASM / uploads unavailable', async () => {
    const result = await runFullResPoseEstimation({
      trialName: 'gait01',
      trialId: null,
      camCount: 2,
      devices: [],
      durationSec: 3,
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
      forceStub: true,
    });
    expect(result.trialName).toBe('gait01');
    expect(result.cameras).toHaveLength(2);
    expect(result.cameras.every((c) => c.source === 'stub')).toBe(true);
    expect(result.cameras[0].source2d).toBe('stub');
    expect(result.cameras[0].source3d).toBe('stub');
    expect(result.cameras[0].statusNote).toMatch(/2D stub/i);
    expect(result.cameras[0].frames.length).toBeGreaterThan(0);
    expect(result.note).toMatch(/mediapipe|stub/i);
    expect(result.note).toMatch(/not height-scaled/i);
  });

  it('applies landmark smoothing and the temporal filter on a re-run', async () => {
    const raw = buildStubCamPose({
      camIndex: 0,
      camCount: 1,
      durationSec: 3,
    });
    const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    const rawSpan = span(raw.frames.map((f) => f.landmarks2d[MP3D.lWrist].x));

    const result = await runFullResPoseEstimation({
      trialName: 'gait01',
      trialId: null,
      camCount: 1,
      devices: [],
      durationSec: 3,
      params: {
        ...DEFAULT_POSE_PARAMS,
        landmarkSmoothing: true,
        landmarkStrength: 1,
        temporalFilter: true,
        filterStrength: 1,
      },
      forceStub: true,
    });
    const outSpan = span(
      result.cameras[0].frames.map((f) => f.landmarks2d[MP3D.lWrist].x),
    );
    expect(outSpan).toBeLessThan(rawSpan * 0.75);
    expect(result.cameras[0].frames[0].landmarks2d).toHaveLength(33);
    expect(result.cameras[0].frames[0].landmarks3d).toHaveLength(33);
  });

  it('leaves stub landmarks unchanged when both filters are off', async () => {
    const raw = buildStubCamPose({
      camIndex: 0,
      camCount: 1,
      durationSec: 2,
    });
    const result = await runFullResPoseEstimation({
      trialName: 'gait01',
      trialId: null,
      camCount: 1,
      devices: [],
      durationSec: 2,
      params: {
        ...DEFAULT_POSE_PARAMS,
        landmarkSmoothing: false,
        temporalFilter: false,
      },
      forceStub: true,
    });
    expect(
      result.cameras[0].frames.map((f) => f.landmarks3d[MP3D.lWrist].x),
    ).toEqual(raw.frames.map((f) => f.landmarks3d[MP3D.lWrist].x));
  });

  it('smooths detected frames when the filters are on', async () => {
    const frames = Array.from({ length: 40 }, (_, i) => {
      const x = i % 2 === 0 ? 1 : -1;
      const landmarks3d = Array.from({ length: 33 }, () => ({
        x: 0,
        y: 0,
        z: 0,
        visibility: 1,
      }));
      landmarks3d[0] = { x, y: 0, z: 0, visibility: 1 };
      const landmarks2d = Array.from({ length: 33 }, () => ({
        x: 0.5,
        y: 0.5,
        visibility: 1,
      }));
      landmarks2d[0] = { x, y: 0.5, visibility: 1 };
      return { frame: i, time_s: i / 15, landmarks2d, landmarks3d };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob([new Uint8Array(128)]),
      })),
    );
    const result = await runFullResPoseEstimation({
      trialName: 'gait01',
      trialId: 't1',
      camCount: 1,
      devices: [{ deviceId: 'dev', camIndex: 0 }],
      durationSec: 1,
      params: {
        ...DEFAULT_POSE_PARAMS,
        landmarkSmoothing: true,
        landmarkStrength: 1,
        temporalFilter: true,
        filterStrength: 1,
      },
      createLandmarker: async () => ({
        detect: () => ({ landmarks: [] }),
        close: () => {},
      }),
      readFrames: async () => ({
        frames,
        had2dLandmarks: true,
        hadWorldLandmarks: true,
        videoWidth: 1080,
        videoHeight: 1920,
        fps: 15,
      }),
    });
    const tail = result.cameras[0].frames
      .slice(10)
      .map((f) => Math.abs(f.landmarks3d[0].x));
    expect(Math.max(...tail)).toBeLessThan(0.35);
    expect(result.cameras[0].videoWidth).toBe(1080);
    expect(result.cameras[0].videoHeight).toBe(1920);
    vi.unstubAllGlobals();
  });

  it('describeCamPoseStatus warns when 2D is real but 3D lacks worldLandmarks', () => {
    expect(
      describeCamPoseStatus({ source2d: 'mediapipe', source3d: 'stub' }),
    ).toBe('2D from MediaPipe; 3D stub — no worldLandmarks');
    expect(
      describeCamPoseStatus({ source2d: 'mediapipe', source3d: 'mediapipe' }),
    ).toMatch(/2D \+ 3D from MediaPipe/);
  });

  it('maps Lite/Full/Heavy to MediaPipe modelComplexity 0/1/2', () => {
    expect(poseModelToComplexity('Lite')).toBe(0);
    expect(poseModelToComplexity('Full')).toBe(1);
    expect(poseModelToComplexity('Heavy')).toBe(2);
  });

  it('maps Lite/Full/Heavy onto the bundled task files and confidence sliders', () => {
    expect(poseTaskFile('Lite')).toBe('pose_landmarker_lite.task');
    expect(poseTaskFile('Full')).toBe('pose_landmarker_full.task');
    expect(poseTaskFile('Heavy')).toBe('pose_landmarker_heavy.task');
    expect(
      landmarkerOptionsFromParams({ ...DEFAULT_POSE_PARAMS, model: 'Heavy' }),
    ).toMatchObject({
      model: 'Heavy',
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  });

  it('does not open a landmarker when the re-run is forced to the stub', async () => {
    const createLandmarker = vi.fn(async () => null);
    await runFullResPoseEstimation({
      trialName: 'gait01',
      trialId: 't1',
      camCount: 1,
      devices: [{ deviceId: 'dev', camIndex: 0 }],
      durationSec: 1,
      params: DEFAULT_POSE_PARAMS,
      forceStub: true,
      createLandmarker,
    });
    expect(createLandmarker).not.toHaveBeenCalled();
  });

  it('keeps real world landmarks and closes the landmarker after each view', async () => {
    const close = vi.fn();
    const createLandmarker = vi.fn(async () => ({
      detect: () => ({ landmarks: [] }),
      close,
    }));
    const readFrames = vi.fn(async () => ({
      frames: [
        {
          frame: 0,
          time_s: 0,
          landmarks2d: [{ x: 0.5, y: 0.2, visibility: 1 }],
          landmarks3d: [{ x: 0.1, y: 0.2, z: 0, visibility: 1 }],
        },
        {
          frame: 1,
          time_s: 1 / 15,
          landmarks2d: [],
          landmarks3d: [],
        },
      ],
      had2dLandmarks: true,
      hadWorldLandmarks: true,
      videoWidth: 1920,
      videoHeight: 1080,
      fps: 15,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob([new Uint8Array(128)]),
      })),
    );
    const result = await runFullResPoseEstimation({
      trialName: 'gait01',
      trialId: 't1',
      camCount: 1,
      devices: [{ deviceId: 'dev', camIndex: 0 }],
      durationSec: 1,
      params: {
        ...DEFAULT_POSE_PARAMS,
        landmarkSmoothing: false,
        temporalFilter: false,
      },
      createLandmarker,
      readFrames,
    });
    expect(createLandmarker).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
    expect(result.cameras[0].source3d).toBe('mediapipe');
    expect(result.cameras[0].frames[1].landmarks3d).toEqual([]);
    expect(result.cameras[0].frames[0].landmarks3d[0].y).toBeCloseTo(0.2);
    expect(result.cameras[0].videoWidth).toBe(1920);
    expect(result.cameras[0].fps).toBe(15);
    vi.unstubAllGlobals();
  });

  it('decodes a saved MP4 and uses it when the temp upload is gone', async () => {
    const payload = new Uint8Array(80);
    payload[0] = 7;
    const b64 = btoa(String.fromCharCode(...payload));
    const decoded = videoBlobFromBase64(b64);
    expect(decoded?.size).toBe(80);
    expect(videoBlobFromBase64('')).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, blob: async () => new Blob() })),
    );
    const loadSavedVideo = vi.fn(async () => ({ blob: decoded }));
    const createLandmarker = vi.fn(async () => ({
      detect: () => ({ landmarks: [] }),
      close: vi.fn(),
    }));
    const readFrames = vi.fn(async () => ({
      frames: [
        {
          frame: 0,
          time_s: 0,
          landmarks2d: [{ x: 0.2, y: 0.3, visibility: 1 }],
          landmarks3d: [{ x: 0.1, y: -0.2, z: 0.05, visibility: 1 }],
        },
      ],
      had2dLandmarks: true,
      hadWorldLandmarks: true,
      videoWidth: 1280,
      videoHeight: 720,
      fps: 15,
    }));
    const result = await runFullResPoseEstimation({
      trialName: 'gait01',
      trialId: 't1',
      camCount: 1,
      devices: [{ deviceId: 'dev', camIndex: 0 }],
      durationSec: 1,
      params: {
        ...DEFAULT_POSE_PARAMS,
        landmarkSmoothing: false,
        temporalFilter: false,
      },
      loadSavedVideo,
      createLandmarker,
      readFrames,
    });
    expect(loadSavedVideo).toHaveBeenCalledWith(0);
    expect(result.cameras[0].source).toBe('mediapipe');
    expect(result.cameras[0].videoUrl).toBeTruthy();
    expect(result.cameras[0].frames[0].landmarks3d[0].y).toBeCloseTo(-0.2);
    vi.unstubAllGlobals();
  });

  it('says when the saved video cannot be found instead of blaming WASM', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, blob: async () => new Blob() })),
    );
    const result = await runFullResPoseEstimation({
      trialName: 'gait01',
      trialId: 't1',
      camCount: 1,
      devices: [{ deviceId: 'dev', camIndex: 0 }],
      durationSec: 1,
      params: DEFAULT_POSE_PARAMS,
      loadSavedVideo: async () => ({
        blob: null,
        reason:
          'Could not find UG0001_Chan-Tai-Man_gait01.mp4 in the save folder',
      }),
    });
    expect(result.cameras[0].statusNote).toMatch(/Could not find/);
    expect(result.note).toMatch(/Could not find/);
    expect(result.note).not.toMatch(/WASM/);
    vi.unstubAllGlobals();
  });
});
