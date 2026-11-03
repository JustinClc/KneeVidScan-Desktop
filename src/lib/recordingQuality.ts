export type RecordingPresetId = '1080p' | '720p' | '480p';
export type RecordingQualityMode = 'auto' | RecordingPresetId;

export const TARGET_MIN_FPS = 30;
export const PROBE_BODY_BYTES = 64 * 1024;

export const RECORDING_PRESETS: Record<
  RecordingPresetId,
  {
    id: RecordingPresetId;
    longSide: number;
    shortSide: number;
    videoBitsPerSecond: number;
    label: string;
  }
> = {
  '1080p': {
    id: '1080p',
    longSide: 1920,
    shortSide: 1080,
    videoBitsPerSecond: 6_000_000,
    label: '1080p',
  },
  '720p': {
    id: '720p',
    longSide: 1280,
    shortSide: 720,
    videoBitsPerSecond: 3_500_000,
    label: '720p',
  },
  '480p': {
    id: '480p',
    longSide: 854,
    shortSide: 480,
    videoBitsPerSecond: 1_750_000,
    label: '480p',
  },
};

export type LinkProbeSample = {
  width: number;
  height: number;
  frameRate: number;
  uploadBytesPerSec: number;
};

const PRESET_ORDER: RecordingPresetId[] = ['1080p', '720p', '480p'];

/** Rough FPS guess: camera cap, pixel load vs 1080p, and upload headroom. */
export function estimateFps(
  presetId: RecordingPresetId,
  probe: LinkProbeSample,
): number {
  const preset = RECORDING_PRESETS[presetId];
  const camFps =
    probe.frameRate > 0 && Number.isFinite(probe.frameRate)
      ? probe.frameRate
      : 30;
  const refPixels = 1920 * 1080;
  const presetPixels = preset.longSide * preset.shortSide;
  const pixelFactor = Math.sqrt(refPixels / Math.max(1, presetPixels));
  let fps = camFps * Math.min(1.15, Math.max(0.55, pixelFactor));
  // Local recording does not stream video live; weak upload mainly signals
  // contention with preview/other traffic — scale gently.
  const comfortable = preset.videoBitsPerSecond / 8 / 4;
  if (probe.uploadBytesPerSec > 0 && probe.uploadBytesPerSec < comfortable) {
    fps *= Math.max(0.4, probe.uploadBytesPerSec / comfortable);
  }
  return Math.max(1, Math.min(Math.round(fps), Math.round(camFps)));
}

export function recommendPreset(probes: LinkProbeSample[]): RecordingPresetId {
  if (!probes.length) return '720p';
  const worst = (id: RecordingPresetId) =>
    Math.min(...probes.map((p) => estimateFps(id, p)));
  for (const id of PRESET_ORDER) {
    if (worst(id) >= TARGET_MIN_FPS) return id;
  }
  // Nothing reaches the target (e.g. a 24 fps camera): dropping resolution
  // only costs detail unless it actually buys frames.
  const best = Math.max(...PRESET_ORDER.map(worst));
  return PRESET_ORDER.find((id) => worst(id) === best) ?? '480p';
}

export function resolvePreset(
  mode: RecordingQualityMode,
  probes: LinkProbeSample[],
): RecordingPresetId {
  if (mode === 'auto') return recommendPreset(probes);
  return mode;
}
